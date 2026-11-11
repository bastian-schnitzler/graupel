// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Panel geometry and value scales of a layout (system.md §4.2). Pure functions:
 * `MeteogramChart` derives every y coordinate from these instead of fixed
 * panel constants.
 */
import type {
  ResolvedArea,
  ResolvedAxis,
  ResolvedChartLayout,
  ResolvedSeries,
} from "../layouts/types";
import { axisPresetFor, type AxisPreset } from "../layouts/seriesPresets";

export const MODEL_HEADER_HEIGHT = 22;
export const MODEL_HEADER_BOX_OFFSET = 2;
export const MODEL_HEADER_BOX_HEIGHT = 18;
export const DAY_HEADER_HEIGHT = 22;
/** White gap between areas: about 2/3 of the day header height. */
export const AREA_GAP = Math.round((2 / 3) * DAY_HEADER_HEIGHT);
export const BOTTOM_PADDING = 10;
/**
 * Plot height per weight unit: the available plot height is
 * `HEIGHT_PER_WEIGHT * Σ heightWeight`, so an area gets exactly
 * `heightWeight / Σ heightWeight` of it.
 */
export const HEIGHT_PER_WEIGHT = 100;

// Names the built-in areas had as fixed panels; they keep test ids, clip ids
// and border names stable.
const AREA_NAMES: Record<string, string> = {
  temp: "temperature",
  precip: "precipitation",
  wind: "wind",
  convective: "convective",
};

export function getAreaName(areaId: string): string {
  return AREA_NAMES[areaId] ?? areaId.replace(/[^A-Za-z0-9_-]/g, "-");
}

export interface AreaGeometry {
  area: ResolvedArea;
  /** Stable name for ids and classes ("temperature", "wind", custom id). */
  name: string;
  index: number;
  top: number;
  height: number;
  bottom: number;
  /** The area's background (cloud profile) is drawn. */
  hasBackground: boolean;
  /** Shared zero line of upper/lower half series, else null. */
  zeroY: number | null;
}

export interface ChartGeometry {
  showModelHeaders: boolean;
  modelHeaderTop: number;
  modelHeaderHeight: number;
  modelHeaderBoxTop: number;
  modelHeaderBoxHeight: number;
  modelHeaderBoxBottom: number;
  dayHeaderTop: number;
  dayHeaderHeight: number;
  dayHeaderBottom: number;
  areas: AreaGeometry[];
  /** Bottom of the last area. */
  plotBottom: number;
  totalHeight: number;
}

const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000;

export function computeChartGeometry(
  layout: ResolvedChartLayout,
  { backgroundHasData }: { backgroundHasData: boolean },
): ChartGeometry {
  const modelHeaderTop = 0;
  const modelHeaderHeight = layout.showModelHeaders ? MODEL_HEADER_HEIGHT : 0;
  const modelHeaderBoxTop = modelHeaderTop + MODEL_HEADER_BOX_OFFSET;
  const dayHeaderTop = modelHeaderTop + modelHeaderHeight;
  const dayHeaderHeight = layout.showDayHeader ? DAY_HEADER_HEIGHT : 0;
  const dayHeaderBottom = dayHeaderTop + dayHeaderHeight;

  let top = dayHeaderBottom;
  const areas = layout.areas.map((area, index): AreaGeometry => {
    const hasBackground = Boolean(area.background) && backgroundHasData;
    const weight =
      area.heightWeight + (hasBackground ? area.background!.heightWeight : 0);
    const height = roundCoordinate(weight * HEIGHT_PER_WEIGHT);
    const geometry: AreaGeometry = {
      area,
      name: getAreaName(area.id),
      index,
      top,
      height,
      bottom: top + height,
      hasBackground,
      zeroY: area.series.some((series) => series.half)
        ? top + height / 2
        : null,
    };
    top = geometry.bottom + AREA_GAP;
    return geometry;
  });
  const plotBottom = areas[areas.length - 1]?.bottom ?? dayHeaderBottom;

  return {
    showModelHeaders: layout.showModelHeaders,
    modelHeaderTop,
    modelHeaderHeight,
    modelHeaderBoxTop,
    modelHeaderBoxHeight: MODEL_HEADER_BOX_HEIGHT,
    modelHeaderBoxBottom: modelHeaderBoxTop + MODEL_HEADER_BOX_HEIGHT,
    dayHeaderTop,
    dayHeaderHeight,
    dayHeaderBottom,
    areas,
    plotBottom,
    totalHeight: plotBottom + BOTTOM_PADDING,
  };
}

/** Value range on one axis or half, mapped into a vertical region. */
export interface ValueScale {
  min: number;
  max: number;
  /** Region (viewBox y) the range maps into, before paddings. */
  top: number;
  bottom: number;
  paddingTop: number;
  paddingBottom: number;
  /** Fixed range: values outside are clamped onto the region. */
  clamped: boolean;
  /** Draw absolute values (lower half: downwards from the zero line). */
  absolute: boolean;
  preset: AxisPreset;
  axis: ResolvedAxis | null;
  /** Quantity whose unit/label format the axis uses. */
  quantity: string;
}

/** Distance of a value from the scale's base line (bars, half areas). */
export function valueToOffset(scale: ValueScale, value: number): number {
  const range = scale.max - scale.min || 1;
  let normalized =
    ((scale.absolute ? Math.abs(value) : value) - scale.min) / range;
  if (scale.clamped) normalized = Math.max(0, Math.min(1, normalized));
  const usable =
    scale.bottom - scale.top - scale.paddingTop - scale.paddingBottom;
  return normalized * usable;
}

export function valueToY(scale: ValueScale, value: number): number {
  const offset = valueToOffset(scale, value);
  return scale.absolute
    ? scale.top + scale.paddingTop + offset
    : scale.bottom - scale.paddingBottom - offset;
}

/** Global extremes of quantities over every model (stable while dragging). */
export type ExtremesLookup = (
  quantities: string[],
  transform: "value" | "positive" | "absolute",
) => { min: number | null; max: number | null };

/** Kind of range an axis is drawn with: its own, else its preset's. */
function rangeKind(axis: ResolvedAxis | null, preset: AxisPreset): "fixed" | "zero-based" | "auto" {
  return (
    axis?.range ??
    preset.defaultRange?.range ??
    (preset.auto ? "auto" : preset.zeroBasedMax ? "zero-based" : "auto")
  );
}

function resolveRange(
  axis: ResolvedAxis | null,
  preset: AxisPreset,
  extremes: { min: number | null; max: number | null },
  fill?: number,
): { min: number; max: number; clamped: boolean } {
  const range = rangeKind(axis, preset);
  if (range === "fixed") {
    return {
      min: axis?.min ?? preset.defaultRange?.min ?? 0,
      max: axis?.max ?? preset.defaultRange?.max ?? 1,
      clamped: true,
    };
  }
  if (range === "zero-based") {
    const max = preset.zeroBasedMax
      ? preset.zeroBasedMax(extremes.max, fill)
      : extremes.max !== null && extremes.max > 0
        ? extremes.max * 1.1
        : 1;
    return { min: 0, max, clamped: false };
  }
  if (preset.auto) {
    const [min, max] = preset.auto(extremes.min, extremes.max);
    return { min, max, clamped: false };
  }
  if (extremes.min === null || extremes.max === null) {
    return { min: 0, max: 1, clamped: false };
  }
  const span = extremes.max - extremes.min;
  const pad = span > 0 ? span * 0.05 : 1;
  return { min: extremes.min - pad, max: extremes.max + pad, clamped: false };
}

export interface AreaScales {
  left: ValueScale | null;
  right: ValueScale | null;
  /** Scale per series index (axis, half or own hidden scale). */
  bySeries: (ValueScale | null)[];
}

const DRAWN_ON_AXIS = new Set(["line", "bars", "area"]);

/**
 * Values an axis side has to reach down to besides its own range: the floor of a visible spread series (dew point,
 * REQ-595, `spreadAxisFloor`). Null or left out: none.
 */
export interface AxisFloors {
  left?: number | null;
  right?: number | null;
}

export interface AreaScaleOptions {
  /** Vertical icon scale of the rendered chart (`MeteogramLayout.windIconScaleY`), default 1. */
  windIconScaleY?: number;
  /** Floors of visible spread series per axis side (dew point, REQ-595). */
  floors?: AxisFloors;
  /**
   * Extremes a left axis with range `"zero-based"` (also of a half series on it) takes instead of `extremes` when its
   * scope is `"visible"` (the layout's `scope`, else the quantity's: precipitation and wind, REQ-663): in the
   * meteogram those of the visible range (`scaleToVisibleRange`, REQ-655). Right and hidden axes keep `extremes`.
   * Null or left out: every axis uses `extremes`. `quantities`, when given, limits it further to those quantities.
   */
  rangeExtremes?: { quantities?: ReadonlySet<string> | null; lookup: ExtremesLookup } | null;
}

/**
 * Share of the plot height (between the paddings) the data of an axis may use
 * so that it stays below the wind arrows of the area (REQ-590).
 */
function arrowFill(
  preset: AxisPreset,
  top: number,
  bottom: number,
  hasArrows: boolean,
  windIconScaleY: number,
): number | undefined {
  if (!hasArrows || !preset.arrowClearance) return undefined;
  const usable = bottom - top - preset.paddingTop - preset.paddingBottom;
  if (usable <= 0) return undefined;
  const allowed = bottom - preset.paddingBottom - (top + preset.arrowClearance(windIconScaleY));
  return Math.max(0.05, Math.min(1, allowed / usable));
}

/**
 * Value scales of an area: shared per axis side, own per half/hidden. A spread series (`fillTo`) does not widen its
 * side by its own values; `options.floors` lowers the side's minimum (not on a fixed range) only as far as its visible
 * stretches need, on the axis' steps and limit (`AxisPreset.spreadFloor`).
 */
export function computeAreaScales(
  geometry: AreaGeometry,
  extremes: ExtremesLookup,
  options: AreaScaleOptions = {},
): AreaScales {
  const { area, top, bottom, zeroY } = geometry;
  const onAxis = (series: ResolvedSeries) => DRAWN_ON_AXIS.has(series.style);
  const hasArrows = area.series.some((series) => series.style === "arrows");
  const windIconScaleY =
    options.windIconScaleY !== undefined && Number.isFinite(options.windIconScaleY) && options.windIconScaleY > 0
      ? options.windIconScaleY
      : 1;

  const rangeExtremes = options.rangeExtremes;
  const lookupFor = (
    side: ResolvedSeries["axis"],
    axis: ResolvedAxis | null,
    preset: AxisPreset,
    quantity: string,
  ): ExtremesLookup =>
    rangeExtremes &&
    side === "left" &&
    preset.scope === "visible" &&
    (!rangeExtremes.quantities || rangeExtremes.quantities.has(quantity)) &&
    rangeKind(axis, preset) === "zero-based"
      ? rangeExtremes.lookup
      : extremes;

  const sideScale = (side: "left" | "right"): ValueScale | null => {
    const members = area.series.filter(
      (series) => onAxis(series) && series.axis === side && !series.half,
    );
    const axis = area.axes[side];
    if (members.length === 0) return null;
    // Spread series count only on a side without other series.
    const ranged = members.some((series) => !series.fillTo)
      ? members.filter((series) => !series.fillTo)
      : members;
    const quantity = axis?.quantity ?? ranged[0]!.quantity;
    const preset = axisPresetFor(quantity, axis);
    const rangedExtremes = lookupFor(side, axis, preset, quantity)(
      ranged.map((series) => series.quantity),
      "value",
    );
    const range = resolveRange(
      axis,
      preset,
      rangedExtremes,
      arrowFill(preset, top, bottom, hasArrows, windIconScaleY),
    );
    const floor = options.floors?.[side];
    if (typeof floor === "number" && Number.isFinite(floor) && !range.clamped && floor < range.min) {
      const lowered = preset.spreadFloor
        ? preset.spreadFloor(floor, rangedExtremes.min)
        : Math.floor(floor + 1e-9);
      range.min = Math.min(range.min, lowered);
    }
    return {
      ...range,
      top,
      bottom,
      paddingTop: preset.paddingTop,
      paddingBottom: preset.paddingBottom,
      absolute: false,
      preset,
      axis,
      quantity,
    };
  };

  const left = sideScale("left");
  const right = sideScale("right");

  const ownScale = (series: ResolvedSeries): ValueScale => {
    const axis = series.axis === "hidden" ? null : area.axes[series.axis];
    // The axis' rules apply to a series of its own quantity (or of an axis without one).
    const preset = axisPresetFor(
      series.quantity,
      axis && (axis.quantity === null || axis.quantity === series.quantity) ? axis : null,
    );
    const lower = series.half === "lower";
    const range = resolveRange(
      axis,
      preset,
      lookupFor(series.axis, axis, preset, series.quantity)(
        [series.quantity],
        series.half ? (lower ? "absolute" : "positive") : "value",
      ),
    );
    const center = zeroY ?? (top + bottom) / 2;
    return {
      ...range,
      top: series.half && lower ? center : top,
      bottom: series.half && !lower ? center : bottom,
      paddingTop: series.half ? 0 : preset.paddingTop,
      paddingBottom: series.half ? 0 : preset.paddingBottom,
      absolute: lower,
      preset,
      axis,
      quantity: series.quantity,
    };
  };

  return {
    left,
    right,
    bySeries: area.series.map((series) => {
      if (!onAxis(series)) return null;
      if (series.half || series.axis === "hidden") return ownScale(series);
      return series.axis === "right" ? right : left;
    }),
  };
}

/** Full font size of the weekday labels in the day header (viewBox units);
 * narrow day columns use smaller sizes. */
export const DAY_HEADER_FONT_SIZE = 11;
