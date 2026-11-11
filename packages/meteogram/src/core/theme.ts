// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Design tokens of the meteogram: colours, a few font sizes. The renderer
 * takes every colour from a resolved theme; `light` is the default chart,
 * `dark` is its counterpart for dark pages. Unlike the reference SVGs,
 * apparent temperature and wind gusts take the colour of temperature and wind
 * speed; the series presets draw them dashed (REQ-442).
 */

/** Font sizes (viewBox units) of the fixed-size labels. */
export interface MeteogramFontSizes {
  /** Left axis maximum and minimum. */
  axis: number;
  /** Values of a half scale (CAPE upwards, CIN downwards). */
  axisHalf: number;
  /** Name, maximum and minimum on the right axis. */
  axisRight: number;
  /** Daily minimum and maximum temperature. */
  extremes: number;
  /** Altitude scale of the cloud profile. */
  altitude: number;
  /** Elevation of the terrain mask. */
  terrain: number;
  /** Text of the empty state. */
  emptyState: number;
}

export interface MeteogramTheme {
  /** Chart background; the host paints it, or the SVG with option `background`. */
  background: string;
  grid: {
    /** Day separators, area borders, guide line at half an axis (`midLine`, REQ-653). */
    line: string;
    /** Dotted noon lines. */
    noon: string;
    /** Tint of every other day. */
    dayTint: string;
    /** Separator line below a drawing area (when enabled). */
    panelSeparator: string;
    /** Zero-degree line of the temperature axis (`zeroLine`), set off from the grid (REQ-594). */
    freezingLine: string;
  };
  dayHeader: { background: string; text: string };
  /**
   * Model headers. `contrastText` is the alternative text colour on header colours passed per model
   * (`modelHeaderColors`): of `text` and `contrastText` the one with the higher contrast is used. `boundary` and
   * `boundaryOpacity`: the thin solid line at each model change of the weather chain, behind the curves (REQ-524).
   */
  modelHeader: { background: string; text: string; contrastText: string; boundary: string; boundaryOpacity: number };
  daylight: { fill: string; opacity: number };
  /** Sunrise and sunset labels. */
  sunTimes: string;
  axis: {
    /** Axis labels of quantities without an entry in `axisLabels`. */
    label: string;
    /** Zero label and zero line of the half scales. */
    zero: string;
    /**
     * Label of the guide line at half the axis (`midLine`, REQ-653): a step fainter than `label`. The line itself
     * takes `grid.line`.
     */
    midLabel: string;
  };
  /** Axis label colour per quantity (the axis' quantity). */
  axisLabels: Record<string, string>;
  /** Label colour of a half scale per quantity; default its axis label colour. */
  halfAxisLabels: Record<string, string>;
  /** Series colour per quantity; a layout colour wins, the registry colour follows. */
  series: Record<string, string>;
  /** Series colour when neither layout, theme nor registry give one. */
  seriesFallback: string;
  /** Top colour of the temperature gradient. */
  temperatureGradient: string;
  /**
   * Snow bars (snow hours of precipitation, snowfall). In both built-in themes `fill` is the chart
   * `background` (white bars on white, dark bars on dark), so only the `outline` draws them; an override
   * of `background` takes `fill` along unless it sets `fill` itself (see `resolveMeteogramTheme`).
   */
  snow: { fill: string; outline: string };
  /** Daily temperature extremes and the halo behind them. */
  extremes: { max: string; min: string; halo: string };
  /** Hover and current-time line. */
  cursor: string;
  terrain: { fill: string; line: string; label: string };
  cloud: {
    /** Cloud cells (opacity from the cover). */
    fill: string;
    /** Hours without a profile. */
    missing: string;
    altitudeLine: string;
    altitudeLabel: string;
    /** Cloud-chain boundaries and the drag indicator (thin solid line, option `showCloudBoundaries`). */
    boundary: string;
    boundaryOpacity: number;
  };
  windIcon: { background: string; outline: string; arrow: string };
  thunderstormIcon: { background: string; outline: string; glyph: string };
  /** Value colours of the detail rows per quantity. */
  details: Record<string, string>;
  emptyState: string;
  fontSizes: MeteogramFontSizes;
}

export type MeteogramThemeName = "light" | "dark";

type Overrides<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? Partial<T[K]> : T[K];
};

/** Partial theme on top of a built-in one (default `light`). */
export type MeteogramThemeOverrides = Overrides<MeteogramTheme> & {
  base?: MeteogramThemeName;
};

/** Option `theme`: a built-in theme or overrides of one. */
export type MeteogramThemeInput = MeteogramThemeName | MeteogramThemeOverrides;

const FONT_SIZES: MeteogramFontSizes = {
  axis: 9,
  axisHalf: 8,
  axisRight: 7,
  extremes: 9.5,
  altitude: 8,
  terrain: 7.5,
  emptyState: 14,
};

/** The light chart (paired curves in the colour of their partner). */
export const LIGHT_THEME: MeteogramTheme = {
  background: "#ffffff",
  grid: {
    line: "#cbd5e1",
    noon: "#e2e8f0",
    dayTint: "rgba(0, 0, 0, 0.03)",
    panelSeparator: "#e2e8f0",
    freezingLine: "#3b82f6",
  },
  dayHeader: { background: "#f1f5f9", text: "#0f172a" },
  modelHeader: { background: "#f59e0b", text: "#0f172a", contrastText: "#ffffff", boundary: "#f59e0b", boundaryOpacity: 1 },
  daylight: { fill: "#fef08a", opacity: 0.45 },
  sunTimes: "#cbd5e1",
  axis: { label: "#475569", zero: "#334155", midLabel: "#64748b" },
  axisLabels: {
    precipitation: "#334155",
    precipitation_rain_snow: "#334155",
    snowfall: "#334155",
    snowfall_with_rain: "#334155",
    cape: "#334155",
    convective_inhibition: "#334155",
    precipitation_probability: "#7c3aed",
    lightning_potential: "#7c3aed",
  },
  halfAxisLabels: {
    cape: "#b45309",
    convective_inhibition: "#0369a1",
  },
  series: {
    temperature: "#f43f5e",
    // Paired curves share the colour of their partner and are drawn dashed (REQ-442).
    apparent_temperature: "#f43f5e",
    // Dew point and its spread to the temperature (REQ-595): green, apart from the reds of the temperatures.
    dew_point: "#059669",
    // Relative humidity on its own right axis in the temperature area (REQ-649): indigo, apart from reds and green.
    relative_humidity: "#4f46e5",
    wind_speed: "#0ea5e9",
    wind_gusts: "#0ea5e9",
    precipitation: "#2563eb",
    precipitation_rain_snow: "#2563eb",
    snowfall: "#ffffff",
    snowfall_with_rain: "#ffffff",
    snow_depth: "#0ea5e9",
    precipitation_probability: "#7c3aed",
    cape: "#f59e0b",
    convective_inhibition: "#0284c7",
    lightning_potential: "#7c3aed",
  },
  seriesFallback: "#334155",
  temperatureGradient: "#f43f5e",
  snow: { fill: "#ffffff", outline: "#475569" },
  extremes: { max: "#e11d48", min: "#0284c7", halo: "#ffffff" },
  cursor: "#f43f5e",
  terrain: { fill: "#f1f5f9", line: "#64748b", label: "#475569" },
  cloud: {
    fill: "#334155",
    missing: "#f8fafc",
    altitudeLine: "#f1f5f9",
    altitudeLabel: "#64748b",
    boundary: "#8b5cf6",
    boundaryOpacity: 0.7,
  },
  windIcon: { background: "#f1f5f9", outline: "#cbd5e1", arrow: "#0284c7" },
  thunderstormIcon: { background: "#f8fafc", outline: "#cbd5e1", glyph: "#7c3aed" },
  details: {
    temperature: "#e11d48",
    apparent_temperature: "#e11d48",
    wind_speed: "#0284c7",
    wind_gusts: "#0284c7",
    wind_direction: "#0284c7",
    precipitation_probability: "#7c3aed",
    precipitation: "#2563eb",
  },
  emptyState: "#475569",
  fontSizes: FONT_SIZES,
};

/** Dark counterpart: slate background, lighter series colours; snow bars in the background colour. */
export const DARK_THEME: MeteogramTheme = {
  background: "#0f172a",
  grid: {
    line: "#334155",
    noon: "#1e293b",
    dayTint: "rgba(255, 255, 255, 0.04)",
    panelSeparator: "#1e293b",
    freezingLine: "#60a5fa",
  },
  dayHeader: { background: "#1e293b", text: "#f1f5f9" },
  modelHeader: { background: "#d97706", text: "#0f172a", contrastText: "#ffffff", boundary: "#f59e0b", boundaryOpacity: 1 },
  daylight: { fill: "#facc15", opacity: 0.1 },
  sunTimes: "#64748b",
  axis: { label: "#94a3b8", zero: "#cbd5e1", midLabel: "#64748b" },
  axisLabels: {
    precipitation: "#cbd5e1",
    precipitation_rain_snow: "#cbd5e1",
    snowfall: "#cbd5e1",
    snowfall_with_rain: "#cbd5e1",
    cape: "#cbd5e1",
    convective_inhibition: "#cbd5e1",
    precipitation_probability: "#a78bfa",
    lightning_potential: "#a78bfa",
  },
  halfAxisLabels: {
    cape: "#fbbf24",
    convective_inhibition: "#38bdf8",
  },
  series: {
    temperature: "#fb7185",
    apparent_temperature: "#fb7185",
    dew_point: "#34d399",
    relative_humidity: "#818cf8",
    wind_speed: "#38bdf8",
    wind_gusts: "#38bdf8",
    wind_direction: "#cbd5e1",
    cloud_cover: "#94a3b8",
    precipitation: "#60a5fa",
    precipitation_rain_snow: "#60a5fa",
    snowfall: "#0f172a",
    snowfall_with_rain: "#0f172a",
    snow_depth: "#7dd3fc",
    precipitation_probability: "#a78bfa",
    cape: "#fbbf24",
    convective_inhibition: "#38bdf8",
    lightning_potential: "#c4b5fd",
  },
  seriesFallback: "#cbd5e1",
  temperatureGradient: "#fb7185",
  // As in `light`: snow bars in the background colour, visible through their outline (REQ-486).
  snow: { fill: "#0f172a", outline: "#94a3b8" },
  extremes: { max: "#fb7185", min: "#38bdf8", halo: "#0f172a" },
  cursor: "#fb7185",
  terrain: { fill: "#1e293b", line: "#94a3b8", label: "#cbd5e1" },
  cloud: {
    fill: "#cbd5e1",
    missing: "#1e293b",
    altitudeLine: "#1e293b",
    altitudeLabel: "#94a3b8",
    boundary: "#a78bfa",
    boundaryOpacity: 0.7,
  },
  windIcon: { background: "#1e293b", outline: "#475569", arrow: "#38bdf8" },
  thunderstormIcon: { background: "#1e293b", outline: "#475569", glyph: "#c4b5fd" },
  details: {
    temperature: "#fb7185",
    apparent_temperature: "#fb7185",
    dew_point: "#34d399",
    wind_speed: "#38bdf8",
    wind_gusts: "#38bdf8",
    wind_direction: "#38bdf8",
    precipitation_probability: "#a78bfa",
    precipitation: "#60a5fa",
  },
  emptyState: "#94a3b8",
  fontSizes: FONT_SIZES,
};

export const BUILTIN_THEMES: Readonly<Record<MeteogramThemeName, MeteogramTheme>> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Series drawn as snow bars; their built-in colour is the background, like `snow.fill`. */
const SNOW_SERIES = ["snowfall", "snowfall_with_rain"] as const;

/**
 * Theme to draw with: a built-in theme by name, or overrides merged onto
 * their `base` (one level deep, so `{ series: { temperature: "red" } }`
 * keeps the other series colours). Unknown names fall back to `light`.
 *
 * Snow follows the background (REQ-486): when the overrides set `background`,
 * the snow colours that equal the base theme's background (`snow.fill`, the
 * series colours of `snowfall` and `snowfall_with_rain`) take the new
 * background, unless the overrides set them as well.
 */
export function resolveMeteogramTheme(input?: MeteogramThemeInput | null): MeteogramTheme {
  if (input === undefined || input === null) return LIGHT_THEME;
  if (typeof input === "string") return BUILTIN_THEMES[input] ?? LIGHT_THEME;
  const { base, ...overrides } = input;
  const baseTheme = (base && BUILTIN_THEMES[base]) || LIGHT_THEME;
  const merged: Record<string, unknown> = { ...baseTheme };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? { ...current, ...value } : value;
  }
  const theme = merged as unknown as MeteogramTheme;
  const background = overrides.background;
  if (typeof background === "string" && background !== baseTheme.background) {
    if (baseTheme.snow.fill === baseTheme.background && overrides.snow?.fill === undefined) {
      theme.snow = { ...theme.snow, fill: background };
    }
    const followers = SNOW_SERIES.filter(
      (id) => baseTheme.series[id] === baseTheme.background && overrides.series?.[id] === undefined,
    );
    if (followers.length > 0) {
      theme.series = { ...theme.series };
      for (const id of followers) theme.series[id] = background;
    }
  }
  return theme;
}

/** Series colour: layout, then theme, then registry, then the theme fallback. */
export function themeSeriesColor(
  theme: MeteogramTheme,
  quantityId: string,
  layoutColor: string | null,
  registryColor: string | null | undefined,
): string {
  return layoutColor ?? theme.series[quantityId] ?? registryColor ?? theme.seriesFallback;
}

/** Axis label colour of a quantity's axis. */
export function themeAxisLabelColor(theme: MeteogramTheme, quantityId: string | null): string {
  return (quantityId !== null && theme.axisLabels[quantityId]) || theme.axis.label;
}

/** Label colour of a half scale. */
export function themeHalfAxisLabelColor(theme: MeteogramTheme, quantityId: string): string {
  return theme.halfAxisLabels[quantityId] ?? themeAxisLabelColor(theme, quantityId);
}
