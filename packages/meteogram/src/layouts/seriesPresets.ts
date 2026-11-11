// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Drawing defaults per quantity: stroke widths, test ids and axis rules. A
 * layout series overrides color, stroke width and dash; everything else
 * (label positions, plot paddings, axis headroom) is fixed per quantity so
 * `power-default` reproduces the hard-coded chart exactly. Colours come from
 * the theme (`core/theme.ts`).
 */
import { LIGHT_THEME, themeSeriesColor, type MeteogramTheme } from "../core/theme";
import { SPREAD_AXIS_K } from "../core/spread";
import { WIND_ICON_RADIUS_PX } from "../core/viewLayout";
import {
  BUILTIN_QUANTITY_REGISTRY,
  type QuantityRegistry,
} from "../quantities/registry";
import type { AxisScope, ResolvedAxis } from "./types";

export interface AxisPreset {
  /** Plot padding (viewBox units) between area edge and the axis extremes. */
  paddingTop: number;
  paddingBottom: number;
  /** Min label baseline above the area bottom. */
  minLabelOffset: number;
  /** Range "auto": axis extremes from the global data extremes, on multiples of `step` when given (REQ-663). */
  auto?: (min: number | null, max: number | null, step?: number) => [number, number];
  /**
   * Range "zero-based": axis maximum from the global data maximum. `fill` is
   * the share of the plot height the data may use (1 = up to the top padding);
   * axes with fixed steps pick a step that keeps the maximum below it.
   */
  zeroBasedMax?: (max: number | null, fill?: number) => number;
  /**
   * Height (viewBox units) from the area top that the data must stay below
   * when the area draws wind arrows, for an icon scale `windIconScaleY`.
   */
  arrowClearance?: (windIconScaleY: number) => number;
  /**
   * Axis minimum for the floor of a visible spread series (dew point) below the
   * axis' own minimum, given the lowest value of the axis' other series.
   */
  spreadFloor?: (floor: number, lowest: number | null, step?: number) => number;
  /** Text of the maximum label without unit. */
  formatMax?: (value: number) => string;
  /** Default range when the layout gives no axis for the quantity. */
  defaultRange?: { range: "fixed"; min: number; max: number };
  /**
   * Time range a left zero-based axis takes its maximum from while `scaleToVisibleRange` is on (REQ-655); the
   * layout's `scope` overrides it (REQ-663). Default `"all"`.
   */
  scope?: AxisScope;
  /**
   * Right axis labelled like a left one (relative humidity, REQ-649): maximum and minimum with their unit ("100 %",
   * "0 %") at the heights of the left axis' labels, in the colour of the axis' first series, without the quantity
   * name the other right axes show.
   */
  unnamedRightLabels?: boolean;
}

export interface SeriesPreset {
  strokeWidth?: number;
  dashArray?: string;
  lineCap?: "round";
  /** data-testid of the drawn path, bar or arrow. */
  testId?: string;
  /** Wrapping group (data-testid) with its own clip. */
  layerTestId?: string;
  /** data-testid of the solid stop markers of a dashed curve. */
  stopsTestId?: string;
  /** data-testid of the fill of a `fillTo` series (the spread). */
  fillTestId?: string;
  opacity?: number;
  /** Bars with the theme's snow outline (white snow bars). */
  outlined?: boolean;
  axis?: AxisPreset;
}

/**
 * Dash of the second curve of a pair (apparent temperature, wind gusts),
 * which shares its partner's colour (REQ-442). Finer than the model
 * boundaries (`4 3`) so the two stay distinguishable.
 */
export const PAIRED_SERIES_DASH_ARRAY = "2 2";

/** Dash of a series the layout marks `dashed` that has no dash of its own. */
export const DEFAULT_SERIES_DASH_ARRAY = "4 2";

/** Axis steps of the wind area in km/h (REQ-590). */
export const WIND_AXIS_STEPS = [10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400];

/**
 * Axis steps of the precipitation area in mm (REQ-591), smallest step 2 mm (REQ-651): an area whose largest amount
 * fits 2 mm, or that has no precipitation, gets an axis from 0 to 2 mm.
 */
export const PRECIPITATION_AXIS_STEPS = [2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 400];

/** Step of the temperature axis in °C (REQ-592). */
export const TEMPERATURE_AXIS_STEP = 5;

/** Centre of the wind arrows below the area top (viewBox units). */
export const WIND_ARROW_CENTER_OFFSET = 14;

/** Gap between the lower edge of the wind arrows and the highest curve. */
export const WIND_ARROW_GAP = 2;

/**
 * Smallest step that is at least `value`; above the last step the next
 * multiple of 100.
 */
export function axisStepAtLeast(value: number, steps: readonly number[]): number {
  const step = steps.find((candidate) => candidate >= value);
  if (step !== undefined) return step;
  return Math.max(steps[steps.length - 1] ?? 0, Math.ceil(value / 100) * 100);
}

/** Axis maximum on fixed steps so that `max` uses at most `fill` of the height. */
function steppedMax(max: number, fill: number | undefined, steps: readonly number[]): number {
  const usable = fill !== undefined && fill > 0 && fill < 1 ? fill : 1;
  return axisStepAtLeast(max / usable, steps);
}

/** Lower and upper temperature axis limit on multiples of `TEMPERATURE_AXIS_STEP`. */
export function temperatureAxisRange(
  rawMin: number | null,
  rawMax: number | null,
  step: number = TEMPERATURE_AXIS_STEP,
): [number, number] {
  const low = rawMin ?? 0;
  const high = rawMax ?? 20;
  let min = Math.floor(low / step) * step;
  let max = Math.ceil(high / step) * step;
  if (low <= 15 && min > 0) min = 0;
  if (high >= -15 && max < 0) max = 0;
  if (max <= min) max = min + step;
  // -0 from Math.ceil of small negative values
  return [min + 0, max + 0];
}

/**
 * Temperature axis minimum with a visible dew point (REQ-595, DEC-051): the
 * floor rounded down to a multiple of 5, but not below the multiple of 5 that
 * lies at most `SPREAD_AXIS_K` below the lowest temperature; a lower dew point
 * is cut off at the edge.
 */
export function temperatureSpreadFloor(
  floor: number,
  lowest: number | null,
  step: number = TEMPERATURE_AXIS_STEP,
): number {
  const stepped = Math.floor(floor / step + 1e-9) * step;
  if (lowest === null) return stepped + 0;
  const limit = Math.ceil((lowest - SPREAD_AXIS_K) / step - 1e-9) * step;
  return Math.max(stepped, limit) + 0;
}

const GENERIC_AXIS: AxisPreset = {
  paddingTop: 10,
  paddingBottom: 10,
  minLabelOffset: 2,
};

const TEMPERATURE_AXIS: AxisPreset = {
  paddingTop: 22,
  paddingBottom: 10,
  minLabelOffset: 6,
  auto: temperatureAxisRange,
  spreadFloor: temperatureSpreadFloor,
};

const WIND_AXIS: AxisPreset = {
  scope: "visible",
  paddingTop: 25,
  paddingBottom: 0,
  minLabelOffset: 2,
  zeroBasedMax: (max, fill) =>
    max === null ? 50 : steppedMax(Math.max(0, max), fill, WIND_AXIS_STEPS),
  arrowClearance: (windIconScaleY) =>
    WIND_ARROW_CENTER_OFFSET + WIND_ICON_RADIUS_PX * windIconScaleY + WIND_ARROW_GAP,
};

const CONVECTIVE_AXIS: AxisPreset = {
  paddingTop: 0,
  paddingBottom: 0,
  minLabelOffset: 3,
  zeroBasedMax: (max) => Math.ceil(Math.max(1, max ?? 0) * 1.1),
};

// Precipitation (mm) on `PRECIPITATION_AXIS_STEPS`, also for a host-given `maxPrecipitation` (REQ-591, REQ-651).
const PRECIPITATION: SeriesPreset = {
  opacity: 0.85,
  testId: "precip-bar",
  layerTestId: "precipitation-bars-layer",
  axis: {
    scope: "visible",
    paddingTop: 10,
    paddingBottom: 0,
    minLabelOffset: 2,
    zeroBasedMax: (max, fill) =>
      steppedMax(max !== null && max > 0 ? max : 0, fill, PRECIPITATION_AXIS_STEPS),
    formatMax: (value) => `${value}`,
  },
};

// Snowfall (cm) keeps its free axis (DEC-049) and spans all data.
const SNOWFALL_AXIS: AxisPreset = {
  ...PRECIPITATION.axis!,
  scope: "all",
  zeroBasedMax: (max) => (max !== null && max > 0 ? max / 0.8 : 2),
  formatMax: (value) => (value < 1 ? value.toFixed(2) : value.toFixed(1)),
};

const SERIES_PRESETS: Record<string, SeriesPreset> = {
  temperature: {
    strokeWidth: 2.5,
    lineCap: "round",
    testId: "temperature-path",
    axis: TEMPERATURE_AXIS,
  },
  apparent_temperature: {
    strokeWidth: 2,
    lineCap: "round",
    dashArray: PAIRED_SERIES_DASH_ARRAY,
    testId: "apparent-temperature-path",
    stopsTestId: "apparent-temperature-stops-path",
    axis: TEMPERATURE_AXIS,
  },
  // Solid, in its own colour (REQ-595); its line and the spread to the temperature are drawn in stretches.
  dew_point: {
    strokeWidth: 2,
    testId: "dew-point-path",
    fillTestId: "dew-point-spread",
    axis: TEMPERATURE_AXIS,
  },
  // Thin, on its own right axis from 0 to 100 % with the paddings of the temperature axis, so its labels stand level
  // with the temperature's (REQ-649).
  relative_humidity: {
    strokeWidth: 1.5,
    lineCap: "round",
    testId: "relative-humidity-path",
    axis: {
      paddingTop: TEMPERATURE_AXIS.paddingTop,
      paddingBottom: TEMPERATURE_AXIS.paddingBottom,
      minLabelOffset: TEMPERATURE_AXIS.minLabelOffset,
      defaultRange: { range: "fixed", min: 0, max: 100 },
      unnamedRightLabels: true,
    },
  },
  wind_speed: {
    strokeWidth: 2,
    lineCap: "round",
    testId: "wind-speed-path",
    axis: WIND_AXIS,
  },
  wind_gusts: {
    strokeWidth: 1.5,
    dashArray: PAIRED_SERIES_DASH_ARRAY,
    testId: "wind-gusts-path",
    stopsTestId: "wind-gusts-stops-path",
    axis: WIND_AXIS,
  },
  precipitation: PRECIPITATION,
  // Same bars, test ids and axis as precipitation (white in snow hours).
  precipitation_rain_snow: PRECIPITATION,
  snowfall: {
    outlined: true,
    opacity: 1,
    testId: "snowfall-bar",
    layerTestId: "snowfall-bars-layer",
    axis: SNOWFALL_AXIS,
  },
  snowfall_with_rain: {
    outlined: true,
    opacity: 1,
    testId: "snowfall-bar",
    layerTestId: "snowfall-bars-layer",
    axis: SNOWFALL_AXIS,
  },
  snow_depth: {
    strokeWidth: 1.5,
    opacity: 0.6,
    testId: "snow-depth-path",
    axis: {
      ...GENERIC_AXIS,
      formatMax: (value) => (value < 1 ? value.toFixed(2) : value.toFixed(1)),
    },
  },
  precipitation_probability: {
    strokeWidth: 1.2,
    testId: "precip-probability-path",
    layerTestId: "precipitation-probability-layer",
    axis: {
      paddingTop: 0,
      paddingBottom: 0,
      minLabelOffset: 2,
      defaultRange: { range: "fixed", min: 0, max: 100 },
    },
  },
  weather_code: { layerTestId: "thunderstorm-layer" },
  cape: {
    opacity: 0.75,
    testId: "cape-bar",
    axis: CONVECTIVE_AXIS,
  },
  convective_inhibition: {
    opacity: 0.75,
    testId: "cin-bar",
    axis: CONVECTIVE_AXIS,
  },
  lightning_potential: {
    strokeWidth: 1.5,
    testId: "lpi-path",
    layerTestId: "lpi-layer",
    axis: {
      paddingTop: 0,
      paddingBottom: 0,
      minLabelOffset: 2,
      defaultRange: { range: "fixed", min: 0, max: 30 },
    },
  },
};

export function getSeriesPreset(quantityId: string): SeriesPreset {
  return SERIES_PRESETS[quantityId] ?? {};
}

/**
 * Dash pattern of a line series, or undefined for a solid line: `dashed:
 * false` draws solid, otherwise the preset's dash wins (apparent temperature
 * and wind gusts are dashed by default) and `dashed: true` dashes any other.
 */
export function getSeriesDashArray(quantityId: string, dashed: boolean | null | undefined): string | undefined {
  if (dashed === false) return undefined;
  return getSeriesPreset(quantityId).dashArray ?? (dashed ? DEFAULT_SERIES_DASH_ARRAY : undefined);
}

export function getAxisPreset(quantityId: string | null): AxisPreset {
  return (quantityId && SERIES_PRESETS[quantityId]?.axis) || GENERIC_AXIS;
}

/** Minimum and maximum on multiples of `step`; without data 0 to `step` (range "auto" with `step`, REQ-663). */
export function steppedAutoRange(rawMin: number | null, rawMax: number | null, step: number): [number, number] {
  if (rawMin === null || rawMax === null) return [0, step];
  const min = Math.floor(rawMin / step + 1e-9) * step;
  let max = Math.ceil(rawMax / step - 1e-9) * step;
  if (max <= min) max = min + step;
  return [min + 0, max + 0];
}

/** Text of a maximum label with a layout `format` (REQ-663). */
function formatWith(format: NonNullable<ResolvedAxis["format"]>, fallback?: (value: number) => string) {
  return (value: number) => {
    const decimals = value < 1 && format.below1Decimals !== undefined ? format.below1Decimals : format.decimals;
    if (decimals !== undefined) return value.toFixed(decimals);
    return fallback ? fallback(value) : `${value}`;
  };
}

/**
 * Axis preset of a quantity with the rules a layout axis sets (layout version 2, REQ-663): `steps`, `step`,
 * `padding`, `format` and `scope` replace the quantity's own; what the axis leaves out keeps them. Without an axis or
 * rules this is `getAxisPreset(quantityId)` itself, so the chart draws as before.
 */
export function axisPresetFor(quantityId: string | null, axis: ResolvedAxis | null | undefined): AxisPreset {
  const base = getAxisPreset(quantityId);
  if (!axis) return base;
  const { steps, step, paddingTop, paddingBottom, format, scope } = axis;
  if (steps === null && step === null && paddingTop === null && paddingBottom === null && format === null && scope === null) {
    return base;
  }
  const preset: AxisPreset = { ...base };
  if (steps && steps.length > 0) {
    const baseMax = base.zeroBasedMax;
    preset.zeroBasedMax = (max, fill) =>
      max === null && baseMax ? baseMax(null, fill) : steppedMax(Math.max(0, max ?? 0), fill, steps);
  }
  if (step !== null && step > 0) {
    const baseAuto = base.auto;
    const baseFloor = base.spreadFloor;
    preset.auto = baseAuto ? (min, max) => baseAuto(min, max, step) : (min, max) => steppedAutoRange(min, max, step);
    preset.spreadFloor = baseFloor
      ? (floor, lowest) => baseFloor(floor, lowest, step)
      : (floor) => Math.floor(floor / step + 1e-9) * step + 0;
  }
  if (paddingTop !== null) preset.paddingTop = paddingTop;
  if (paddingBottom !== null) preset.paddingBottom = paddingBottom;
  if (format) preset.formatMax = formatWith(format, base.formatMax);
  if (scope !== null) preset.scope = scope;
  return preset;
}

/** Series color: layout, then theme, then registry color, then the theme fallback. */
export function getSeriesColor(
  quantityId: string,
  layoutColor: string | null,
  registry: QuantityRegistry = BUILTIN_QUANTITY_REGISTRY,
  theme: MeteogramTheme = LIGHT_THEME,
): string {
  return themeSeriesColor(theme, quantityId, layoutColor, registry.get(quantityId)?.color);
}

/** `${quantity}` with dashes, for generated test ids and clip ids. */
export function quantitySlug(quantityId: string): string {
  return quantityId.replace(/_/g, "-");
}
