// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Boundaries of a model chain as the cards show and move them (REQ-481): with a loaded forecast each boundary sits where the model's latest run ends
 * (`capChainToAvailability` of `@graupel/download`) and a boundary can be moved at most that far; a moved chain goes
 * back to the requested horizons wherever the user did not move a boundary, so a later, longer run extends them again.
 */
import { capChainToAvailability, type ModelAvailability, type WeatherModel } from "@graupel/download";
import { capabilityOf, getMetaForModel, type AvailableModels } from "./chainUtils.ts";

/** Run availability by model name, as `ForecastResult.availability` and `.cloudAvailability` hold it. */
export type Availability = Readonly<Record<string, ModelAvailability>>;

/** The chain as the cards show it: each boundary capped to the hours the model's latest run delivers. */
export function displayedChain(chain: readonly WeatherModel[], availability?: Availability): WeatherModel[] {
  return availability ? capChainToAvailability(chain, availability) : [...chain];
}

/**
 * Catalogue entries of the chain's models with the hours their latest run delivers as horizon: the limit of a dragged
 * boundary. Models without availability keep their catalogue horizon.
 */
export function boundaryLimits(
  available: AvailableModels,
  chain: readonly WeatherModel[],
  availability?: Availability,
): AvailableModels {
  if (!availability) return available;
  const limits: Record<string, WeatherModel> = { ...available };
  for (const model of chain) {
    const hours = availability[model.name]?.available_hours;
    if (typeof hours !== "number") continue;
    const meta = getMetaForModel(model, available) ?? model;
    const limit = Math.min(capabilityOf(model, available), hours);
    const limited: WeatherModel = { ...meta, max_forecast_horizon_hours: limit, max_forecast_hours: limit };
    limits[model.id ?? model.name] = limited;
    if (meta.id) limits[meta.id] = limited;
  }
  return limits;
}

/**
 * Applies a chain moved on the displayed (capped) chain to the requested one: only boundaries the user moved change,
 * all others keep their requested horizon.
 */
export function mergeMovedChain(
  requested: readonly WeatherModel[],
  displayed: readonly WeatherModel[],
  moved: readonly WeatherModel[],
): WeatherModel[] {
  if (requested.length !== moved.length || displayed.length !== moved.length) return [...moved];
  return moved.map((model, index) =>
    model.max_forecast_horizon_hours === displayed[index]!.max_forecast_horizon_hours ? requested[index]! : model,
  );
}

/**
 * Puts one boundary of a requested chain back where the auto chain has it (REQ-498): the model left of boundary
 * `index` gets its horizon from the auto chain, all other boundaries stay as they are. The chain as it is when the
 * auto chain has another model there.
 */
export function resetBoundary(
  requested: readonly WeatherModel[],
  auto: readonly WeatherModel[],
  index: number,
): WeatherModel[] {
  const model = requested[index];
  const original = auto[index];
  if (!model || !original || index >= requested.length - 1 || model.name !== original.name) return [...requested];
  return requested.map((entry, i) =>
    i === index ? { ...entry, max_forecast_horizon_hours: original.max_forecast_horizon_hours } : entry,
  );
}

/** Whether two chains have the same models with the same boundaries. */
export function sameBoundaries(a: readonly WeatherModel[], b: readonly WeatherModel[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (model, index) =>
        model.name === b[index]!.name && model.max_forecast_horizon_hours === b[index]!.max_forecast_horizon_hours,
    )
  );
}

/** Hours a pointer moved by `dx` pixels shifts a boundary on a row `width` pixels wide over `horizon` hours. */
export function pointerDeltaHours(dx: number, width: number, horizon: number): number {
  const effective = width > 0 ? width : 1000;
  return Math.round((dx / effective) * horizon) || 0;
}

/** Hours a key moves a boundary (REQ-481): arrows by one hour, with Shift and Page Up/Down by 12; null otherwise. */
export function keyDeltaHours(key: string, shiftKey: boolean): number | null {
  const step = shiftKey ? 12 : 1;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return -step;
    case "ArrowRight":
    case "ArrowUp":
      return step;
    case "PageDown":
      return -12;
    case "PageUp":
      return 12;
    default:
      return null;
  }
}

/** Roles of controls that use the arrow keys, Page Up/Down, Home or End themselves (REQ-657). */
const KEY_ROLES = new Set([
  "slider",
  "spinbutton",
  "combobox",
  "listbox",
  "option",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "tablist",
  "radio",
  "radiogroup",
  "grid",
  "gridcell",
  "tree",
  "treeitem",
  "treegrid",
  "textbox",
  "searchbox",
  "scrollbar",
]);

/** Where the keys belong to the focus: a field, a control with keys of its own, an open popup or dialog. */
const KEY_CONTAINERS =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), dialog, [role='dialog'], [role='alertdialog']";

/**
 * Whether the keys stay where the focus is, so the boundary under the mouse does not take them (REQ-657): an input
 * field (the place search), a control that uses the keys itself (a slider, a menu, a list), a button whose popup is
 * open, or an open modal dialog. A plain button or no focus at all leaves them to the boundary.
 */
export function keysStayWithFocus(doc: Document): boolean {
  if (doc.querySelector("dialog[open], [aria-modal='true']")) return true;
  const active = doc.activeElement;
  if (!active || active === doc.body || active === doc.documentElement) return false;
  if (active.closest(KEY_CONTAINERS)) return true;
  if (active.getAttribute("aria-expanded") === "true") return true;
  const role = active.getAttribute("role");
  return role !== null && KEY_ROLES.has(role);
}
