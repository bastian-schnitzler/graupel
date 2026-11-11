// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import {
  BUILTIN_QUANTITY_REGISTRY,
  type QuantityRegistry,
} from "../quantities/registry";
import { BUILTIN_LAYOUTS } from "./builtin";
import { resolveShowWhen, resolveToggles, showWhenErrors, toggleErrors } from "./toggles";
import { resolveTooltip, tooltipErrors } from "./tooltip";
import type {
  ChartLayout,
  LayoutArea,
  LayoutAxis,
  LayoutSeries,
  ResolvedArea,
  ResolvedAxis,
  ResolvedChartLayout,
  ResolvedGuide,
  ResolvedSeries,
} from "./types";

export const POWER_DEFAULT_LAYOUT_ID = "power-default";

/** Opacity of the fill of a `fillTo` series (the spread of dew point and temperature) without its own. */
export const DEFAULT_FILL_OPACITY = 0.18;
export const NORMAL_LAYOUT_ID = "normal-default";

/**
 * Registries a layout is checked and resolved against. Both default to the
 * built-in copies shipped with the package.
 */
export interface LayoutOptions {
  /** Quantity registry the series and axes are checked against. */
  quantities?: QuantityRegistry;
  /** Built-in layouts used as fallback (`fallbackId`). */
  layouts?: readonly ChartLayout[];
}

const AXIS_RANGES = ["auto", "fixed", "zero-based"];
const SERIES_AXES = ["left", "right", "hidden"];
const LABEL_POSITIONS = ["top", "bottom", "none"];
const AXIS_SCOPES = ["all", "visible"];

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isAbsent = (value: unknown) => value === undefined || value === null;
const isDecimals = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0);

/** Share of the axis range of a guide at `"<n>%"` (0 to 1), or null when `at` is no such text. */
export function guideShare(at: unknown): number | null {
  if (typeof at !== "string") return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/.exec(at);
  if (!match) return null;
  const share = Number(match[1]) / 100;
  return share >= 0 && share <= 1 ? share : null;
}

/** Problems of the axis rules of layout version 2 (REQ-663). */
function axisRuleErrors(where: string, axis: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const { steps, step, padding, format, scope, guides } = axis;
  if (!isAbsent(steps)) {
    if (
      !Array.isArray(steps) ||
      steps.length === 0 ||
      !steps.every((entry, index) => isPositive(entry) && (index === 0 || entry > steps[index - 1]))
    ) {
      errors.push(`${where}: steps must be rising positive numbers`);
    }
  }
  if (!isAbsent(step) && !isPositive(step)) errors.push(`${where}: step must be a positive number`);
  if (!isAbsent(padding)) {
    if (!isObject(padding)) errors.push(`${where}: padding must be an object`);
    else {
      for (const side of ["top", "bottom"] as const) {
        const value = padding[side];
        if (!isAbsent(value) && !(isFiniteNumber(value) && value >= 0)) {
          errors.push(`${where}: padding.${side} must be a number of at least 0`);
        }
      }
    }
  }
  if (!isAbsent(format)) {
    if (!isObject(format) || !isDecimals(format.decimals) || !isDecimals(format.below1Decimals)) {
      errors.push(`${where}: format needs whole numbers of decimals`);
    }
  }
  if (!isAbsent(scope) && !AXIS_SCOPES.includes(scope as string)) {
    errors.push(`${where}: unknown axis scope ${String(scope)}`);
  }
  if (!isAbsent(guides)) {
    if (!Array.isArray(guides)) errors.push(`${where}: guides must be a list`);
    else {
      guides.forEach((guide: unknown, index) => {
        const at = isObject(guide) ? guide.at : undefined;
        if (!isObject(guide) || !(isFiniteNumber(at) || guideShare(at) !== null)) {
          errors.push(`${where}: guide ${index + 1} needs at as a number or a share from "0%" to "100%"`);
          return;
        }
        for (const flag of ["dashed", "label"] as const) {
          if (guide[flag] !== undefined && typeof guide[flag] !== "boolean") {
            errors.push(`${where}: guide ${index + 1}: ${flag} must be true or false`);
          }
        }
      });
    }
  }
  return errors;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isEnabled = (entry: { enabled?: boolean }) => entry.enabled !== false;
const isPositive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function axisErrors(
  where: string,
  axis: unknown,
  registry: QuantityRegistry,
): string[] {
  if (axis === null || axis === undefined) return [];
  if (!isObject(axis)) return [`${where}: axis must be an object`];
  const errors: string[] = [];
  const range = axis.range ?? "auto";
  if (!AXIS_RANGES.includes(range as string)) {
    errors.push(`${where}: unknown axis range ${String(range)}`);
  }
  if (range === "fixed") {
    const { min, max } = axis;
    if (typeof min !== "number" || typeof max !== "number") {
      errors.push(`${where}: fixed axis range needs min and max`);
    } else if (min >= max) {
      errors.push(`${where}: fixed axis range needs min < max`);
    }
  }
  if (axis.midLine !== undefined && typeof axis.midLine !== "boolean") {
    errors.push(`${where}: midLine must be true or false`);
  }
  if (typeof axis.quantity === "string" && !registry.get(axis.quantity)) {
    errors.push(`${where}: unknown quantity: ${axis.quantity}`);
  }
  errors.push(...axisRuleErrors(where, axis));
  return errors;
}

function styleError(
  where: string,
  quantityId: unknown,
  style: unknown,
  registry: QuantityRegistry,
): string | null {
  if (typeof quantityId !== "string") return `${where}: missing quantity`;
  const quantity = registry.get(quantityId);
  if (!quantity) return `${where}: unknown quantity: ${quantityId}`;
  if (typeof style !== "string" || !quantity.allowed_styles.includes(style)) {
    return `${where}: style ${String(style)} not allowed for ${quantityId}`;
  }
  return null;
}

/**
 * Problems of a layout against the schema and the quantity registry (same
 * rules as the backend `validate_layout`). Empty list: the layout is valid.
 */
export function validateChartLayout(
  input: unknown,
  options: Pick<LayoutOptions, "quantities"> = {},
): string[] {
  const registry = options.quantities ?? BUILTIN_QUANTITY_REGISTRY;
  if (!isObject(input)) return ["layout must be an object"];
  const errors: string[] = [];
  if (typeof input.id !== "string" || input.id === "") {
    errors.push("layout needs an id");
  }
  if (
    input.showLocationLabel !== undefined &&
    !LABEL_POSITIONS.includes(input.showLocationLabel as string)
  ) {
    errors.push(`unknown location label position ${String(input.showLocationLabel)}`);
  }
  errors.push(...toggleErrors(input.toggles));
  const toggles = input.toggles;
  const areas = input.areas;
  if (!Array.isArray(areas) || areas.length === 0) {
    return [...errors, "layout needs at least one area"];
  }
  const ids = new Set<string>();
  const tooltipGroupNames = new Set<string>();
  areas.forEach((area: unknown, index) => {
    const where = `area ${index + 1}`;
    if (!isObject(area) || typeof area.id !== "string" || area.id === "") {
      errors.push(`${where}: missing id`);
      return;
    }
    if (ids.has(area.id)) errors.push(`area ids must be unique (${area.id})`);
    ids.add(area.id);
    if (area.heightWeight !== undefined && !isPositive(area.heightWeight)) {
      errors.push(`${where}: heightWeight must be greater than 0`);
    }
    const axes = area.axes;
    if (axes !== undefined && axes !== null) {
      if (!isObject(axes)) errors.push(`${where}: axes must be an object`);
      else {
        errors.push(...axisErrors(`${where} left axis`, axes.left, registry));
        errors.push(...axisErrors(`${where} right axis`, axes.right, registry));
        for (const side of ["left", "right"] as const) {
          const axis = axes[side];
          if (isObject(axis)) errors.push(...showWhenErrors(`${where} ${side} axis`, axis.showWhen, toggles));
        }
      }
    }
    errors.push(...tooltipErrors(where, area.tooltip, area.id, registry, tooltipGroupNames));
    const background = area.background;
    if (background !== undefined && background !== null) {
      const error = isObject(background)
        ? styleError(`${where} background`, background.kind, "profile", registry)
        : `${where}: background must be an object`;
      if (error) errors.push(error);
    }
    const series = area.series ?? [];
    if (!Array.isArray(series)) {
      errors.push(`${where}: series must be a list`);
      return;
    }
    series.forEach((entry: unknown, seriesIndex) => {
      const seriesWhere = `${where} series ${seriesIndex + 1}`;
      if (!isObject(entry)) {
        errors.push(`${seriesWhere}: must be an object`);
        return;
      }
      const error = styleError(
        seriesWhere,
        entry.quantity,
        entry.style,
        registry,
      );
      if (error) errors.push(error);
      if (
        entry.axis !== undefined &&
        !SERIES_AXES.includes(entry.axis as string)
      ) {
        errors.push(`${seriesWhere}: unknown axis ${String(entry.axis)}`);
      }
      if (
        typeof entry.snowFrom === "string" &&
        !registry.get(entry.snowFrom)
      ) {
        errors.push(`${seriesWhere}: unknown quantity: ${entry.snowFrom}`);
      }
      if (entry.fillTo !== undefined && entry.fillTo !== null) {
        if (typeof entry.fillTo !== "string" || !registry.get(entry.fillTo)) {
          errors.push(`${seriesWhere}: unknown quantity: ${String(entry.fillTo)}`);
        } else if (entry.style !== "line") {
          errors.push(`${seriesWhere}: fillTo needs style line`);
        }
      }
      errors.push(...showWhenErrors(seriesWhere, entry.showWhen, toggles));
      if (entry.autoRule !== undefined && entry.autoRule !== null) {
        if (entry.autoRule !== "spread") errors.push(`${seriesWhere}: unknown autoRule ${String(entry.autoRule)}`);
        else if (entry.fillTo === undefined || entry.fillTo === null) {
          errors.push(`${seriesWhere}: autoRule spread needs fillTo`);
        }
      }
      if (
        entry.fillOpacity !== undefined &&
        entry.fillOpacity !== null &&
        !(typeof entry.fillOpacity === "number" && entry.fillOpacity >= 0 && entry.fillOpacity <= 1)
      ) {
        errors.push(`${seriesWhere}: fillOpacity must be between 0 and 1`);
      }
    });
  });
  if (!areas.some((area) => isObject(area) && area.enabled !== false)) {
    errors.push("layout needs at least one enabled area");
  }
  return errors;
}

function resolveAxis(axis: LayoutAxis | null | undefined): ResolvedAxis | null {
  if (!axis) return null;
  return {
    quantity: axis.quantity ?? null,
    label: axis.label ?? null,
    range: axis.range ?? "auto",
    min: axis.min ?? null,
    max: axis.max ?? null,
    zeroLine: axis.zeroLine ?? false,
    midLine: axis.midLine ?? false,
    showLabels: axis.showLabels ?? true,
    steps: axis.steps && axis.steps.length > 0 ? [...axis.steps] : null,
    step: axis.step ?? null,
    paddingTop: axis.padding?.top ?? null,
    paddingBottom: axis.padding?.bottom ?? null,
    format: axis.format ? { ...axis.format } : null,
    scope: axis.scope ?? null,
    guides: resolveGuides(axis),
    showWhen: resolveShowWhen(axis.showWhen),
  };
}

/** Guides of an axis with defaults; `midLine` is `{ at: "50%" }` in front unless a guide already sits at 50 %. */
function resolveGuides(axis: LayoutAxis): ResolvedGuide[] {
  const guides: ResolvedGuide[] = (axis.guides ?? []).map((guide) => ({
    at: guide.at,
    dashed: guide.dashed ?? true,
    label: guide.label ?? true,
  }));
  if (axis.midLine && !guides.some((guide) => guideShare(guide.at) === 0.5)) {
    guides.unshift({ at: "50%", dashed: true, label: true });
  }
  return guides;
}

function resolveSeries(series: LayoutSeries): ResolvedSeries {
  return {
    quantity: series.quantity,
    style: series.style,
    color: series.color ?? null,
    axis: series.axis ?? "left",
    strokeWidth: series.strokeWidth ?? null,
    dashed: series.dashed ?? null,
    curveStops: series.curveStops ?? true,
    extremeLabels: series.extremeLabels ?? false,
    snowFrom: series.snowFrom ?? null,
    fillTo: series.fillTo ?? null,
    fillOpacity: series.fillOpacity ?? DEFAULT_FILL_OPACITY,
    half: series.half ?? null,
    iconFootprintPx: series.iconFootprintPx ?? null,
    showWhen: resolveShowWhen(series.showWhen),
    autoRule: series.autoRule ?? null,
  };
}

function resolveArea(area: LayoutArea): ResolvedArea {
  const background = area.background;
  return {
    id: area.id,
    heightWeight: area.heightWeight ?? 1,
    sunTimes: area.sunTimes ?? false,
    axes: {
      left: resolveAxis(area.axes?.left),
      right: resolveAxis(area.axes?.right),
    },
    background:
      background && isEnabled(background)
        ? {
            kind: background.kind,
            heightWeight: background.heightWeight ?? 0,
            maxAltitudeKm: background.maxAltitudeKm ?? 12,
            altitudeLabels: background.altitudeLabels ?? true,
            terrainMask: background.terrainMask ?? true,
          }
        : null,
    series: (area.series ?? []).filter(isEnabled).map(resolveSeries),
    tooltip: resolveTooltip(area),
  };
}

function resolveValid(layout: ChartLayout): ResolvedChartLayout {
  return {
    id: layout.id,
    name: layout.name ?? layout.id,
    version: layout.version ?? 1,
    showModelHeaders: layout.showModelHeaders ?? true,
    showDayHeader: layout.showDayHeader ?? true,
    showDaylight: layout.showDaylight ?? true,
    showLocationLabel: layout.showLocationLabel ?? "bottom",
    showCreatedTimestamp: layout.showCreatedTimestamp ?? true,
    toggles: resolveToggles(layout.toggles),
    areas: layout.areas.filter(isEnabled).map(resolveArea),
  };
}

/**
 * Built-in layout by id; the power default (else the first layout) for an
 * unknown id.
 */
export function getBuiltinLayout(
  id: string,
  layouts: readonly ChartLayout[] = BUILTIN_LAYOUTS,
): ChartLayout {
  const layout =
    layouts.find((entry) => entry.id === id) ??
    layouts.find((entry) => entry.id === POWER_DEFAULT_LAYOUT_ID) ??
    layouts[0];
  if (!layout) throw new Error("no built-in layouts given");
  return layout;
}

export interface LayoutResolution {
  layout: ResolvedChartLayout;
  /** Set when the given layout was invalid and the fallback is drawn. */
  warning: string | null;
}

export interface ResolveLayoutOptions extends LayoutOptions {
  /** Built-in layout drawn without or instead of an invalid layout. */
  fallbackId?: string;
}

/**
 * Layout to draw: the given one when valid, else the built-in fallback with a
 * warning. Never throws for a broken layout, so a stored layout cannot crash
 * the chart.
 */
export function resolveChartLayout(
  input: unknown,
  options: ResolveLayoutOptions = {},
): LayoutResolution {
  const fallback = getBuiltinLayout(
    options.fallbackId ?? POWER_DEFAULT_LAYOUT_ID,
    options.layouts,
  );
  if (input === null || input === undefined) {
    return { layout: resolveValid(fallback), warning: null };
  }
  let errors: string[];
  try {
    errors = validateChartLayout(input, options);
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)];
  }
  return errors.length === 0
    ? { layout: resolveValid(input as ChartLayout), warning: null }
    : {
        layout: resolveValid(fallback),
        warning: `Invalid meteogram layout, showing "${fallback.name}" instead: ${errors[0]}`,
      };
}
