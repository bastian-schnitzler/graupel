/**
 * Drawing defaults per quantity: today's chart colors, stroke widths, test
 * ids and axis rules. A layout series overrides color, stroke width and dash;
 * everything else (label positions, plot paddings, axis headroom) is fixed
 * per quantity so `power-default` reproduces the hard-coded chart exactly.
 */
import { getQuantity } from "../quantities/registry";

export interface AxisPreset {
  /** Plot padding (viewBox units) between area edge and the axis extremes. */
  paddingTop: number;
  paddingBottom: number;
  /** Min label baseline above the area bottom. */
  minLabelOffset: number;
  labelColor: string;
  /** Range "auto": axis extremes from the global data extremes. */
  auto?: (min: number | null, max: number | null) => [number, number];
  /** Range "zero-based": axis maximum from the global data maximum. */
  zeroBasedMax?: (max: number | null) => number;
  /** Text of the maximum label without unit. */
  formatMax?: (value: number) => string;
  /** Default range when the layout gives no axis for the quantity. */
  defaultRange?: { range: "fixed"; min: number; max: number };
  /** Label colors of a half (upper/lower) scale. */
  halfLabelColor?: string;
}

export interface SeriesPreset {
  color?: string;
  strokeWidth?: number;
  dashArray?: string;
  lineCap?: "round";
  /** data-testid of the drawn path, bar or arrow. */
  testId?: string;
  /** Wrapping group (data-testid) with its own clip. */
  layerTestId?: string;
  /** data-testid of the solid stop markers of a dashed curve. */
  stopsTestId?: string;
  opacity?: number;
  /** Bar outline (white snow bars). */
  outline?: string;
  axis?: AxisPreset;
}

const GENERIC_AXIS: AxisPreset = {
  paddingTop: 10,
  paddingBottom: 10,
  minLabelOffset: 2,
  labelColor: "#475569",
};

const TEMPERATURE_AXIS: AxisPreset = {
  paddingTop: 22,
  paddingBottom: 10,
  minLabelOffset: 6,
  labelColor: "#475569",
  auto: (rawMin, rawMax) => {
    const low = rawMin ?? 0;
    const high = rawMax ?? 20;
    let min = Math.floor(low - 2);
    let max = Math.ceil(high + 2);
    if (low <= 15 && min > 0) min = 0;
    if (high >= -15 && max < 0) max = 0;
    return [min, max];
  },
};

const WIND_AXIS: AxisPreset = {
  paddingTop: 25,
  paddingBottom: 0,
  minLabelOffset: 2,
  labelColor: "#475569",
  zeroBasedMax: (max) =>
    max === null ? 50 : Math.max(30, Math.ceil(max * 1.15)),
};

const CONVECTIVE_AXIS: AxisPreset = {
  paddingTop: 0,
  paddingBottom: 0,
  minLabelOffset: 3,
  labelColor: "#334155",
  zeroBasedMax: (max) => Math.ceil(Math.max(1, max ?? 0) * 1.1),
};

const PRECIPITATION: SeriesPreset = {
  color: "#2563eb",
  opacity: 0.85,
  testId: "precip-bar",
  layerTestId: "precipitation-bars-layer",
  axis: {
    paddingTop: 10,
    paddingBottom: 0,
    minLabelOffset: 2,
    labelColor: "#334155",
    zeroBasedMax: (max) => (max !== null && max > 0 ? max / 0.8 : 2.5),
    formatMax: (value) => (value < 1 ? value.toFixed(2) : value.toFixed(1)),
  },
};

const SNOWFALL_AXIS: AxisPreset = {
  ...PRECIPITATION.axis!,
  zeroBasedMax: (max) => (max !== null && max > 0 ? max / 0.8 : 2),
};

const SERIES_PRESETS: Record<string, SeriesPreset> = {
  temperature: {
    color: "#f43f5e",
    strokeWidth: 2.5,
    lineCap: "round",
    testId: "temperature-path",
    axis: TEMPERATURE_AXIS,
  },
  apparent_temperature: {
    color: "#92400e",
    strokeWidth: 2,
    lineCap: "round",
    testId: "apparent-temperature-path",
    axis: TEMPERATURE_AXIS,
  },
  wind_speed: {
    color: "#0ea5e9",
    strokeWidth: 2,
    lineCap: "round",
    testId: "wind-speed-path",
    axis: WIND_AXIS,
  },
  wind_gusts: {
    color: "#d97706",
    strokeWidth: 1.5,
    dashArray: "4 2",
    testId: "wind-gusts-path",
    stopsTestId: "wind-gusts-stops-path",
    axis: WIND_AXIS,
  },
  precipitation: PRECIPITATION,
  // Same bars, test ids and axis as precipitation (white in snow hours).
  precipitation_rain_snow: PRECIPITATION,
  snowfall: {
    color: "#ffffff",
    outline: "#475569",
    opacity: 1,
    testId: "snowfall-bar",
    layerTestId: "snowfall-bars-layer",
    axis: SNOWFALL_AXIS,
  },
  snowfall_with_rain: {
    color: "#ffffff",
    outline: "#475569",
    opacity: 1,
    testId: "snowfall-bar",
    layerTestId: "snowfall-bars-layer",
    axis: SNOWFALL_AXIS,
  },
  snow_depth: {
    color: "#0ea5e9",
    strokeWidth: 1.5,
    opacity: 0.6,
    testId: "snow-depth-path",
    axis: {
      ...GENERIC_AXIS,
      formatMax: (value) => (value < 1 ? value.toFixed(2) : value.toFixed(1)),
    },
  },
  precipitation_probability: {
    color: "#7c3aed",
    strokeWidth: 1.2,
    testId: "precip-probability-path",
    layerTestId: "precipitation-probability-layer",
    axis: {
      paddingTop: 0,
      paddingBottom: 0,
      minLabelOffset: 2,
      labelColor: "#7c3aed",
      defaultRange: { range: "fixed", min: 0, max: 100 },
    },
  },
  weather_code: { layerTestId: "thunderstorm-layer" },
  cape: {
    color: "#f59e0b",
    opacity: 0.75,
    testId: "cape-bar",
    axis: { ...CONVECTIVE_AXIS, halfLabelColor: "#b45309" },
  },
  convective_inhibition: {
    color: "#0284c7",
    opacity: 0.75,
    testId: "cin-bar",
    axis: { ...CONVECTIVE_AXIS, halfLabelColor: "#0369a1" },
  },
  lightning_potential: {
    color: "#7c3aed",
    strokeWidth: 1.5,
    testId: "lpi-path",
    layerTestId: "lpi-layer",
    axis: {
      paddingTop: 0,
      paddingBottom: 0,
      minLabelOffset: 2,
      labelColor: "#7c3aed",
      defaultRange: { range: "fixed", min: 0, max: 30 },
    },
  },
};

export function getSeriesPreset(quantityId: string): SeriesPreset {
  return SERIES_PRESETS[quantityId] ?? {};
}

export function getAxisPreset(quantityId: string | null): AxisPreset {
  return (quantityId && SERIES_PRESETS[quantityId]?.axis) || GENERIC_AXIS;
}

/** Series color: layout, then chart preset, then registry color. */
export function getSeriesColor(
  quantityId: string,
  layoutColor: string | null,
): string {
  return (
    layoutColor ??
    SERIES_PRESETS[quantityId]?.color ??
    getQuantity(quantityId)?.color ??
    "#334155"
  );
}

/** `${quantity}` with dashes, for generated test ids and clip ids. */
export function quantitySlug(quantityId: string): string {
  return quantityId.replace(/_/g, "-");
}
