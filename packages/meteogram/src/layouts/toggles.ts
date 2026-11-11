// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Switches of a layout (layout version 2, REQ-664): `toggles` names each switch with its values and default;
 * `showWhen` on a series or axis says at which values it is drawn. The render option `toggles` sets values; the
 * older options `dewPoint`, `relativeHumidity` and `scaleToVisibleRange` set the switch of the same name and win.
 */
import type {
  LayoutToggle,
  ResolvedChartLayout,
  ResolvedSeries,
  ShowWhen,
} from "./types";

/** Values of the switches of a chart, by name. */
export type ToggleValues = Readonly<Record<string, string>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Problems of a layout's `toggles`. */
export function toggleErrors(toggles: unknown): string[] {
  if (toggles === undefined || toggles === null) return [];
  if (!isObject(toggles)) return ["toggles must be an object"];
  const errors: string[] = [];
  for (const [name, toggle] of Object.entries(toggles)) {
    const values = isObject(toggle) ? toggle.values : undefined;
    if (
      !isObject(toggle) ||
      !Array.isArray(values) ||
      values.length < 2 ||
      !values.every(isName) ||
      new Set(values).size !== values.length
    ) {
      errors.push(`toggle ${name}: values must be at least two different texts`);
      continue;
    }
    if (!values.includes(toggle.default as string)) {
      errors.push(`toggle ${name}: default must be one of its values`);
    }
  }
  return errors;
}

/** Problems of a `showWhen` against the layout's `toggles`. */
export function showWhenErrors(where: string, showWhen: unknown, toggles: unknown): string[] {
  if (showWhen === undefined || showWhen === null) return [];
  if (!isObject(showWhen)) return [`${where}: showWhen must be an object`];
  const known = isObject(toggles) ? toggles : {};
  const errors: string[] = [];
  for (const [name, wanted] of Object.entries(showWhen)) {
    const toggle = known[name];
    const values = isObject(toggle) && Array.isArray(toggle.values) ? (toggle.values as unknown[]) : null;
    if (!values) {
      errors.push(`${where}: showWhen names unknown toggle ${name}`);
      continue;
    }
    const list = Array.isArray(wanted) ? wanted : [wanted];
    if (list.length === 0 || !list.every((value) => values.includes(value))) {
      errors.push(`${where}: showWhen ${name} needs values of the toggle (${values.join(", ")})`);
    }
  }
  return errors;
}

/** `toggles` with copied value lists. */
export function resolveToggles(
  toggles: Readonly<Record<string, LayoutToggle>> | null | undefined,
): Record<string, LayoutToggle> {
  const resolved: Record<string, LayoutToggle> = {};
  for (const [name, toggle] of Object.entries(toggles ?? {})) {
    resolved[name] = { values: [...toggle.values], default: toggle.default };
  }
  return resolved;
}

/** `showWhen` with every condition as a list, or null without one. */
export function resolveShowWhen(showWhen: ShowWhen | null | undefined): Record<string, string[]> | null {
  if (!showWhen) return null;
  const entries = Object.entries(showWhen).map(([name, wanted]) => [name, Array.isArray(wanted) ? [...wanted] : [wanted]]);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Values of a layout's switches: the default, else a value from `given` (render option `toggles`) that the switch
 * has, else one from `shorthands` (the older render options), which win. Values of unknown switches are ignored.
 */
export function toggleValues(
  layout: Pick<ResolvedChartLayout, "toggles">,
  given?: Readonly<Record<string, unknown>> | null,
  shorthands: Readonly<Record<string, unknown>> = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, toggle] of Object.entries(layout.toggles)) {
    const pick = (value: unknown) =>
      typeof value === "string" && toggle.values.includes(value) ? value : undefined;
    values[name] = pick(shorthands[name]) ?? pick(given?.[name]) ?? toggle.default;
  }
  return values;
}

/** Whether every condition of `showWhen` holds for `values` (no condition: always). */
export function showWhenHolds(showWhen: Readonly<Record<string, readonly string[]>> | null, values: ToggleValues) {
  if (!showWhen) return true;
  return Object.entries(showWhen).every(([name, wanted]) => {
    const value = values[name];
    return value !== undefined && wanted.includes(value);
  });
}

/**
 * Mode of a series with `autoRule: "spread"` (dew point, REQ-664): the value of the switch its `showWhen` names when
 * that is a mode (`"off"`, `"on"`, `"auto"`), else `"on"` or `"off"` by whether `showWhen` holds. Such a series stays
 * in the layout; its mode decides where it is drawn (`calculateSpreadStretches`). Null for other series.
 */
export function spreadModeOf(series: ResolvedSeries, values: ToggleValues): "off" | "on" | "auto" | null {
  if (series.autoRule !== "spread") return null;
  if (!showWhenHolds(series.showWhen, values)) return "off";
  const names = Object.keys(series.showWhen ?? {});
  const value = names.length === 1 ? values[names[0]!] : undefined;
  return value === "off" || value === "on" || value === "auto" ? value : "on";
}

/**
 * The layout as drawn with the switches at `values`: series and axes whose `showWhen` does not hold are left out,
 * each area is drawn exactly as a layout without them. Series with `autoRule` stay (their mode follows the switch).
 * Without any `showWhen`, the layout itself.
 */
export function withToggles(layout: ResolvedChartLayout, values: ToggleValues): ResolvedChartLayout {
  const touches = layout.areas.some(
    (area) =>
      area.series.some((series) => series.showWhen && !series.autoRule) ||
      area.axes.left?.showWhen ||
      area.axes.right?.showWhen,
  );
  if (!touches) return layout;
  return {
    ...layout,
    areas: layout.areas.map((area) => ({
      ...area,
      axes: {
        left: area.axes.left && showWhenHolds(area.axes.left.showWhen, values) ? area.axes.left : null,
        right: area.axes.right && showWhenHolds(area.axes.right.showWhen, values) ? area.axes.right : null,
      },
      series: area.series.filter((series) => series.autoRule || showWhenHolds(series.showWhen, values)),
    })),
  };
}
