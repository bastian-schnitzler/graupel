import { getQuantity } from "../quantities/registry";
import { BUILTIN_LAYOUTS } from "./builtinLayouts.generated";
import type {
  ChartLayout,
  LayoutArea,
  LayoutAxis,
  LayoutSeries,
  ResolvedArea,
  ResolvedAxis,
  ResolvedChartLayout,
  ResolvedSeries,
} from "./types";

export const POWER_DEFAULT_LAYOUT_ID = "power-default";
export const NORMAL_LAYOUT_ID = "normal-default";

const AXIS_RANGES = ["auto", "fixed", "zero-based"];
const SERIES_AXES = ["left", "right", "hidden"];
const LABEL_POSITIONS = ["top", "bottom", "none"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isEnabled = (entry: { enabled?: boolean }) => entry.enabled !== false;
const isPositive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function axisErrors(where: string, axis: unknown): string[] {
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
  if (typeof axis.quantity === "string" && !getQuantity(axis.quantity)) {
    errors.push(`${where}: unknown quantity: ${axis.quantity}`);
  }
  return errors;
}

function styleError(
  where: string,
  quantityId: unknown,
  style: unknown,
): string | null {
  if (typeof quantityId !== "string") return `${where}: missing quantity`;
  const quantity = getQuantity(quantityId);
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
export function validateChartLayout(input: unknown): string[] {
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
  const areas = input.areas;
  if (!Array.isArray(areas) || areas.length === 0) {
    return [...errors, "layout needs at least one area"];
  }
  const ids = new Set<string>();
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
        errors.push(...axisErrors(`${where} left axis`, axes.left));
        errors.push(...axisErrors(`${where} right axis`, axes.right));
      }
    }
    const background = area.background;
    if (background !== undefined && background !== null) {
      const error = isObject(background)
        ? styleError(`${where} background`, background.kind, "profile")
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
      const error = styleError(seriesWhere, entry.quantity, entry.style);
      if (error) errors.push(error);
      if (
        entry.axis !== undefined &&
        !SERIES_AXES.includes(entry.axis as string)
      ) {
        errors.push(`${seriesWhere}: unknown axis ${String(entry.axis)}`);
      }
      if (typeof entry.snowFrom === "string" && !getQuantity(entry.snowFrom)) {
        errors.push(`${seriesWhere}: unknown quantity: ${entry.snowFrom}`);
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
    showLabels: axis.showLabels ?? true,
  };
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
    half: series.half ?? null,
    iconFootprintPx: series.iconFootprintPx ?? null,
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
    areas: layout.areas.filter(isEnabled).map(resolveArea),
  };
}

export function getBuiltinLayout(id: string): ChartLayout {
  return (
    BUILTIN_LAYOUTS.find((layout) => layout.id === id) ??
    BUILTIN_LAYOUTS.find((layout) => layout.id === POWER_DEFAULT_LAYOUT_ID)!
  );
}

export interface LayoutResolution {
  layout: ResolvedChartLayout;
  /** Set when the given layout was invalid and the fallback is drawn. */
  warning: string | null;
}

/**
 * Layout to draw: the given one when valid, else the built-in fallback with a
 * warning. Never throws, so a broken stored layout cannot crash the chart.
 */
export function resolveChartLayout(
  input: unknown,
  fallbackId: string = POWER_DEFAULT_LAYOUT_ID,
): LayoutResolution {
  if (input === null || input === undefined) {
    return {
      layout: resolveValid(getBuiltinLayout(fallbackId)),
      warning: null,
    };
  }
  let errors: string[];
  try {
    errors = validateChartLayout(input);
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)];
  }
  return errors.length === 0
      ? { layout: resolveValid(input as ChartLayout), warning: null }
      : {
          layout: resolveValid(getBuiltinLayout(fallbackId)),
          warning: `Invalid meteogram layout, showing "${getBuiltinLayout(fallbackId).name}" instead: ${errors[0]}`,
        };
}
