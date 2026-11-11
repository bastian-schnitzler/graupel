// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Everything the renderer draws, derived once from the input and the view
 * state (layout, visible range, size). Hover does not change a scene: the
 * overlay layer is drawn from the scene plus the hover position.
 */
import {
  computeAreaScales,
  computeChartGeometry,
  type AreaScales,
  type AxisFloors,
  type ChartGeometry,
  type ExtremesLookup,
} from "../core/chartGeometry";
import {
  SEPARATOR_OPACITY,
  SEPARATOR_STROKE_WIDTH,
  buildDataPointTimeMap,
  buildVerticalCloudMap,
  calculateIconSlotsByMode,
  extractWindDirectionSamples,
  prepareRenderDayGroups,
} from "../core/chartData";
import { getCloudAltitudeY } from "../core/cloudProfile";
import { getSupportedPointAtTimestamp } from "../core/convective";
import type { DayGroupRenderItem, NoonPositionItem } from "../core/drawingTypes";
import { calculateDailyTemperatureExtremes } from "../core/extremes";
import {
  chainRunSegments,
  chainToWeatherModels,
  type MeteogramInput,
} from "../core/input";
import { buildLocationLabel } from "../core/locationLabel";
import {
  calculateDaylightSpans,
  calculateModelSliceEnds,
  calculateNoonPositions,
  findCurveMarkers,
} from "../core/paths";
import {
  RELATIVE_HUMIDITY_QUANTITY,
  isRelativeHumidityMode,
  withRelativeHumidity,
  type RelativeHumidityMode,
} from "../core/relativeHumidity";
import { calculateSunTimeLabels } from "../core/sunTimes";
import {
  calculateSpreadStretches,
  isDewPointMode,
  spreadAxisFloor,
  type DewPointMode,
  type SpreadStretch,
} from "../core/spread";
import {
  DEFAULT_LOCALE,
  resolveMeteogramTexts,
  type MeteogramTexts,
} from "../core/texts";
import {
  resolveMeteogramTheme,
  type MeteogramTheme,
  type MeteogramThemeInput,
} from "../core/theme";
import { aggregateThunderstorms } from "../core/thunderstormIcons";
import {
  HOUR_MS,
  buildHourlyTimeline,
  createTimelineScale,
  getBoundaryTimestamp,
  normalizeTimestamp,
  uniqueSortedTimestamps,
  type TimelineScale,
} from "../core/timeline";
import {
  calculateCloudTransitionCoordinates,
  calculateMeteogramMaximumRange,
  calculateModelSegments,
  calculateZeroSpanModelNames,
  filterVisibleDayGroups,
  groupTimestampsByDay,
  type HeaderModelSegment,
} from "../core/timelineUtils";
import type { DataPoint, ModelInfo, WeatherModel } from "../core/types";
import {
  METEOGRAM_VIEWBOX_WIDTH,
  WIND_ICON_FOOTPRINT_PX,
  getMeteogramLayout,
  type MeteogramLayout,
  type MeteogramRenderMode,
} from "../core/viewLayout";
import { calculateWindIcons, type WindIconItem } from "../core/wind";
import { clampTimeRange, type TimeRange } from "../core/zoom";
import { spreadModeOf, toggleValues, withToggles } from "../layouts/toggles";
import { getLayoutQuantities } from "../layouts/quantities";
import { POWER_DEFAULT_LAYOUT_ID, resolveChartLayout } from "../layouts/resolution";
import {
  tooltipGroups as layoutTooltipGroups,
  undrawnQuantities,
  withoutLayoutTooltipRows,
  withoutTooltipRows,
} from "../layouts/tooltip";
import type { ChartLayout, ResolvedChartLayout, ResolvedSeries, ResolvedTooltipGroup } from "../layouts/types";
import { PRECIPITATION_RAIN_SNOW, withDerivedPoints } from "../quantities/derived";
import { BUILTIN_QUANTITY_REGISTRY, type QuantityRegistry } from "../quantities/registry";
import type { ChartAreaContext, ThunderstormIcon } from "./chartArea";
import type { OverlayArea, TerrainMaskItem } from "./timelineOverlay";

export interface MeteogramRenderOptions {
  /** Layout to draw (`ChartLayout` or stored JSON); checked, invalid ones fall back with a warning. */
  layout?: unknown;
  /** Built-in layout drawn without or instead of an invalid `layout`. */
  fallbackLayoutId?: string;
  /** Built-in layouts the fallback is taken from. */
  layouts?: readonly ChartLayout[];
  /** Model headers and boundaries whatever the layout says. */
  forceModelHeaders?: boolean;
  /** Quantity registry (default: the built-in copy). */
  quantities?: QuantityRegistry;
  /** Model catalogue for short names and supported quantities not in the chain. */
  availableModels?: Record<string, ModelInfo>;
  /** Time zone; overrides `input.timezone`. "auto": the location's. */
  timezone?: string;
  /** Current time (epoch ms or ISO); default `Date.now()`. */
  now?: number | string;
  /** Visible (zoomed) range; clamped to the maximum range. Default: everything. */
  visibleRange?: TimeRange | null;
  /** Rendered size in CSS pixels; text and icons keep their proportions. Default: as wide as the viewBox. */
  size?: { width: number; height?: number };
  /**
   * Width of the viewBox in its units (default 1000, `METEOGRAM_VIEWBOX_WIDTH`); its height stays the layout's. Text,
   * lines, icons and `padding` are given in viewBox units: a chart that scales with its width and is as much narrower
   * as its viewBox keeps its height and draws them at the same size, e.g. a part of the forecast at the scale of the
   * whole one with `1000 * shown span / whole span`. Values that are not a positive number fall back to the default.
   */
  viewBoxWidth?: number | null;
  /** Render mode, written to `data-render-mode` and the clip ids. */
  mode?: MeteogramRenderMode;
  /** Unique id part for clip paths and gradients when several charts share a page. */
  idPrefix?: string;
  /**
   * Axes follow the visible range (REQ-655, default true): while `visibleRange` is smaller than the whole range, the
   * maxima of the axes with range `"zero-based"` for precipitation and wind (`precipitation`,
   * `precipitation_rain_snow`, `wind_speed`, `wind_gusts`, `VISIBLE_RANGE_AXIS_QUANTITIES`) come from the values of
   * all models (stitched series and `modelSeries`) inside that range, including the hour at each edge (values less
   * than an hour before its start or after its end, so a bar or curve piece partly visible counts), on the usual steps
   * (wind 10, 15, 20 … km/h, precipitation 2, 5, 10 … mm). The wind arrows and the guide line at half the wind axis
   * follow the drawn axis. False, or with everything visible: the axes span all data as before. Other axes
   * (temperature, CAPE, relative humidity, snowfall), right axes and axes with another `range` never follow.
   */
  scaleToVisibleRange?: boolean;
  /**
   * Range the axes following the visible range take their maxima from (`scaleToVisibleRange`), clamped like
   * `visibleRange`; null or left out: the visible range. A host that moves the range with a pointer gesture (dragging,
   * swiping) sets it to the range at the gesture's start and clears it on release, so the axes hold still while the
   * range moves and are worked out anew when the gesture ends (DEC-061). A zoom step leaves it out, so the axes adapt.
   */
  axisRangeFrom?: TimeRange | null;
  /**
   * Largest precipitation amount the axis of the precipitation bars must hold (e.g. from all models). Like the data
   * maximum it goes through `PRECIPITATION_AXIS_STEPS` (2, 5, 10 … mm), e.g. 1 gives an axis to 2 mm. Applies while
   * the axes span all data: with `scaleToVisibleRange` on and a zoomed range the maximum in that range replaces it.
   */
  maxPrecipitation?: number;
  /** Hour after the forecast start of a cloud-chain boundary being dragged. */
  draggedCloudBoundaryHour?: number | null;
  /**
   * Draw the boundaries of the cloud chain in the cloud area (default false: hidden). A host sets it while the cloud
   * chain is moved (REQ-524).
   */
  showCloudBoundaries?: boolean;
  /** Colours and font sizes: `"light"` (default), `"dark"` or overrides of one. */
  theme?: MeteogramThemeInput | null;
  /**
   * Header colour per model, keyed by catalogue id (`id` of the chain entry) or model name (id first). The text is
   * `theme.modelHeader.text` or `.contrastText`, whichever reads better; models without an entry keep the theme.
   */
  modelHeaderColors?: Readonly<Record<string, string>> | null;
  /** Locale of weekday names and dates (default `en-US`). */
  locale?: string;
  /** Texts the chart writes itself, replacing the English defaults. */
  texts?: Partial<MeteogramTexts> | null;
  /** `font-family` of the SVG; default: inherited from the page. */
  fontFamily?: string | null;
  /** Paint the theme background into the SVG (default: transparent, the host paints it). */
  background?: boolean;
  /**
   * Room left and right of the plot in viewBox units (the viewBox is 1000 wide, or `viewBoxWidth`); the axis labels and
   * cloud altitudes stand in it. Default 50 on each side.
   */
  padding?: { left?: number; right?: number } | null;
  /** How the axis labels and cloud altitudes are set (default: unit in the value's line, next to the plot). */
  axisLabels?: MeteogramAxisLabelOptions | null;
  /**
   * Dew point and spread (REQ-595, REQ-604, REQ-620): whether the layout's spread series (lines with `fillTo`, in the
   * built-in layouts the dew point filled to the temperature) are drawn. `"on"`: across the whole width; `"off"`
   * (default): not at all, the chart is drawn as without them; `"auto"`: as `"on"` when, in the visible range, the
   * spread is at most 5 K or the dew point at least 15 °C somewhere and a temperature reaches 5 °C somewhere (at an
   * hour or between two hours, linearly interpolated), else as `"off"`, so another visible range decides anew. While
   * the series is drawn, the axis reaches down only as far as a spread of 5 K needs, on its 5 °C steps and at most to
   * the step within 5 K below the lowest temperature; a lower dew point is cut off at the bottom of the area. While
   * drawn, the popup and the side bar show the dew point and its spread after the apparent temperature (REQ-676).
   */
  dewPoint?: DewPointMode | null;
  /**
   * Relative humidity (REQ-649): whether the layout's `relative_humidity` series and its axis are drawn, in the
   * built-in layouts a thin line in the temperature area on a right axis from 0 to 100 %, labelled "100 %" at the top
   * and "0 %" at the bottom in the line's colour. `"on"`: drawn, missing values leave gaps; `"off"` (default), or
   * without any value of the quantity in the data: series and axis are left out, the chart is drawn as without them.
   * While drawn, the popup and the side bar show it after the apparent temperature, as the dew point and its spread
   * (REQ-676).
   */
  relativeHumidity?: RelativeHumidityMode | null;
  /**
   * Values of the layout's switches (`ChartLayout.toggles`, REQ-664), e.g. `{ dewPoint: "auto" }`. Unknown switches
   * and values a switch does not have are ignored (its default applies). The options `dewPoint`, `relativeHumidity`
   * and `scaleToVisibleRange` set the switch of the same name and win over this.
   */
  toggles?: Readonly<Record<string, string>> | null;
}

/** Option `axisLabels`. */
export interface MeteogramAxisLabelOptions {
  /** `"inline"` (default): value and unit in one line, `11 mm`; `"below"`: the unit in a line below the value. */
  unit?: "inline" | "below";
  /**
   * `"plot"` (default): the labels end next to the plot (left) or start next to it (right); `"edge"`: the left labels
   * start at the chart's left edge, the right labels and cloud altitudes end at its right edge; `"inside"`: as `"edge"`,
   * for a plot without room beside it (`padding` 0): the labels stand over the plot, drawn after the data with a halo in
   * the background colour. Over the plot the left labels start 1 unit right of the edge (x = 1), and in an area with
   * sun times the left maximum hangs 1 unit below the sunrise row (REQ-602). In every mode a left axis with `zeroLine`
   * labels its zero line ("0°", REQ-603), one with `midLine` its guide line at half the axis ("38 km/h", REQ-653).
   */
  align?: "plot" | "edge" | "inside";
  /**
   * Compact labels for small charts (REQ-696), default `false` (labels as before). With `true` every axis (left, right,
   * half axes) writes its unit once, below its drawing area (in the gap to the next area or below the last one), in its
   * colour and font size, on its side; its maximum stands in the upper corner of the area (top edge of the digits
   * 1 px below the area's edge), its minimum in the lower corner (bottom edge 1 px above it), the temperature's
   * minimum included; the values have no unit, a degree sign stays with its value (`-35°`). Over the plot (`"inside"`)
   * in an area with sun times the maximum hangs 1 unit below the sunrise row where a sunrise time stands above it
   * (REQ-602). The labels of the zero line and the guide lines and the cloud altitudes keep their rules (REQ-603,
   * REQ-653); `unit` then only sets the cloud altitudes. 1 px is a CSS pixel of the rendered chart (`size`).
   */
  compact?: boolean;
}

/** Default room left and right of the plot (viewBox units). */
export const DEFAULT_PLOT_PADDING = 50;

/** A padding from 0 to less than half the viewBox width; anything else falls back to the default. */
const paddingOrDefault = (value: number | undefined, viewBoxWidth: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value < viewBoxWidth / 2
    ? value
    : DEFAULT_PLOT_PADDING;

/** Option `viewBoxWidth`: a positive number, else the default width. */
const viewBoxWidthOrDefault = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : METEOGRAM_VIEWBOX_WIDTH;

export interface MeteogramScene {
  /** False without data or visible range; the chart shows the empty state. */
  available: boolean;
  layout: ResolvedChartLayout;
  /** Set when the given layout was invalid and the fallback is drawn. */
  layoutWarning: string | null;
  layoutQuantities: Set<string>;
  /**
   * Groups of the hover popup in display order (`tooltip` of the areas, else the default rows, REQ-665), without the
   * rows of quantities the chart does not draw now (switch off, dew point auto without its condition, REQ-676).
   */
  tooltipGroups: ResolvedTooltipGroup[];
  quantities: QuantityRegistry;
  timezone: string;
  theme: MeteogramTheme;
  /** Header colour per model id or name (option `modelHeaderColors`). */
  modelHeaderColors: Readonly<Record<string, string>>;
  locale: string;
  texts: MeteogramTexts;
  fontFamily: string | null;
  /** Paint `theme.background` into the SVG. */
  paintBackground: boolean;
  /** Text of the location label (`null` when hidden or unknown). */
  locationLabel: string | null;
  nowMs: number;
  maximumRange: TimeRange | null;
  visibleRange: TimeRange | null;
  timeline: TimelineScale;
  timestamps: number[];
  timeMap: Map<number, Record<string, DataPoint>>;
  modelChain: WeatherModel[];
  geometry: ChartGeometry;
  areaScales: AreaScales[];
  pixelLayout: MeteogramLayout;
  mode: MeteogramRenderMode;
  chartId: string;
  svgWidth: number;
  paddingLeft: number;
  paddingRight: number;
  /** Option `axisLabels` with its defaults. */
  axisLabels: Required<MeteogramAxisLabelOptions>;
  /** Option `dewPoint` with its default. */
  dewPoint: DewPointMode;
  /** Option `relativeHumidity` with its default. */
  relativeHumidity: RelativeHumidityMode;
  /** Values of the layout's switches (REQ-664), after `toggles` and the options of the same name. */
  toggles: Readonly<Record<string, string>>;
  /**
   * Range the precipitation and wind axes take their maxima from (`scaleToVisibleRange`, `axisRangeFrom`); null while
   * they span all data (option off or everything visible).
   */
  axisRange: TimeRange | null;
  graphWidth: number;
  outerLeftX: number;
  outerRightX: number;
  modelSegments: HeaderModelSegment[];
  zeroSpanModelNames: Set<string>;
  daylightSpans: { dayKey: string; x: number; width: number }[];
  dayGroups: DayGroupRenderItem[];
  noonPositions: NoonPositionItem[];
  overlayAreas: OverlayArea[];
  terrainMask: TerrainMaskItem | null;
  /** x of the current time, null outside the visible range. */
  currentTimeX: number | null;
  areaContext: ChartAreaContext;
  getX: (timestamp: number | string) => number;
}

// Placeholder scale used only while the chart renders its empty state.
const PLACEHOLDER_TIMELINE = createTimelineScale(
  0,
  HOUR_MS,
  DEFAULT_PLOT_PADDING,
  METEOGRAM_VIEWBOX_WIDTH - DEFAULT_PLOT_PADDING,
);

const finiteOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Quantities whose axes (range `"zero-based"`) follow the visible range with `scaleToVisibleRange` by default
 * (REQ-655): precipitation and wind. A layout axis sets it for itself with `scope` (REQ-663).
 */
export const VISIBLE_RANGE_AXIS_QUANTITIES: ReadonlySet<string> = new Set([
  "precipitation",
  PRECIPITATION_RAIN_SNOW,
  "wind_speed",
  "wind_gusts",
]);

interface QuantityExtremes {
  min: number;
  max: number;
  maxPositive: number;
  maxAbs: number;
}

function addExtreme(extremes: Map<string, QuantityExtremes>, quantity: string, value: number) {
  const entry = extremes.get(quantity);
  if (!entry) {
    extremes.set(quantity, { min: value, max: value, maxPositive: Math.max(0, value), maxAbs: Math.abs(value) });
    return;
  }
  entry.min = Math.min(entry.min, value);
  entry.max = Math.max(entry.max, value);
  entry.maxPositive = Math.max(entry.maxPositive, value);
  entry.maxAbs = Math.max(entry.maxAbs, Math.abs(value));
}

/**
 * Extremes of `quantities` over every point list (models' series and the stitched one) inside `range`, including the
 * hour at each edge: a point less than an hour before its start or after its end, so an hourly bar or curve piece
 * partly in the range counts (the last hour at or before the start, the first at or after the end), but not the value
 * of a model whose data end far before the range (REQ-655).
 */
function rangeExtremesOf(
  pointLists: unknown[],
  range: TimeRange,
  quantities: ReadonlySet<string>,
): Map<string, QuantityExtremes> {
  const extremes = new Map<string, QuantityExtremes>();
  const from = range.start - HOUR_MS;
  const to = range.end + HOUR_MS;
  for (const points of pointLists) {
    if (!Array.isArray(points)) continue;
    for (const point of withDerivedPoints(points as DataPoint[])) {
      if (!point || !quantities.has(point.variable)) continue;
      const value = finiteOrNull(point.value);
      if (value === null) continue;
      let ts: number;
      try {
        ts = normalizeTimestamp(point.timestamp);
      } catch {
        continue;
      }
      if (ts > from && ts < to) addExtreme(extremes, point.variable, value);
    }
  }
  return extremes;
}

/** Lookup of the extremes of a map (`ExtremesLookup`). */
function extremesLookup(extremes: Map<string, QuantityExtremes>): ExtremesLookup {
  return (ids, transform) => {
    let min: number | null = null;
    let max: number | null = null;
    for (const id of ids) {
      const entry = extremes.get(id);
      if (!entry) continue;
      const low = transform === "value" ? entry.min : 0;
      const high =
        transform === "value" ? entry.max : transform === "positive" ? entry.maxPositive : entry.maxAbs;
      min = min === null ? low : Math.min(min, low);
      max = max === null ? high : Math.max(max, high);
    }
    return { min, max };
  };
}

/** Whether the input has a value of `quantity` anywhere (stitched series or a model's own). */
function hasValuesOf(input: MeteogramInput, quantity: string): boolean {
  const hasValue = (points: unknown) =>
    Array.isArray(points) &&
    points.some((point: DataPoint | null | undefined) => point?.variable === quantity && finiteOrNull(point.value) !== null);
  return hasValue(input.series) || Object.values(input.modelSeries ?? {}).some(hasValue);
}

export function createMeteogramScene(
  input: MeteogramInput,
  options: MeteogramRenderOptions = {},
): MeteogramScene {
  const quantities = options.quantities ?? BUILTIN_QUANTITY_REGISTRY;
  const resolved = resolveChartLayout(options.layout, {
    quantities,
    ...(options.layouts ? { layouts: options.layouts } : {}),
    fallbackId: options.fallbackLayoutId ?? POWER_DEFAULT_LAYOUT_ID,
  });
  const withHeaders =
    options.forceModelHeaders && !resolved.layout.showModelHeaders
      ? { ...resolved.layout, showModelHeaders: true }
      : resolved.layout;
  // Switches of the layout (REQ-664): defaults, then `toggles`, then the options of the same name. Series and axes
  // whose `showWhen` does not hold are left out.
  const toggles = toggleValues(withHeaders, options.toggles, {
    dewPoint: options.dewPoint,
    relativeHumidity: options.relativeHumidity,
    scaleToVisibleRange:
      typeof options.scaleToVisibleRange === "boolean" ? (options.scaleToVisibleRange ? "on" : "off") : undefined,
  });
  const hasToggle = (name: string) => Object.prototype.hasOwnProperty.call(withHeaders.toggles, name);
  // Relative humidity (REQ-649): without the option (or switch), or without any value in the data, its series and
  // axis are left out, so the chart is drawn exactly as a layout without them.
  const relativeHumidity: RelativeHumidityMode = hasToggle("relativeHumidity")
    ? toggles.relativeHumidity === "on"
      ? "on"
      : "off"
    : isRelativeHumidityMode(options.relativeHumidity)
      ? options.relativeHumidity
      : "off";
  const toggled = withRelativeHumidity(
    withToggles(withHeaders, toggles),
    relativeHumidity === "on" && hasValuesOf(input, RELATIVE_HUMIDITY_QUANTITY),
  );
  // The popup shows a quantity drawn only under a switch while it is drawn (REQ-676): rows of series left out here
  // go, so do those of a dew point drawn nowhere (below, by its stretches).
  const leftOut = undrawnQuantities(withHeaders, toggled);
  const layout = withoutLayoutTooltipRows(toggled, leftOut);
  const layoutQuantities = getLayoutQuantities(layout, quantities);
  const mode = options.mode ?? "embedded";
  const chartId = options.idPrefix ?? "meteogram";
  const theme = resolveMeteogramTheme(options.theme);
  const locale = options.locale || DEFAULT_LOCALE;
  const nowMs = options.now !== undefined ? normalizeTimestamp(options.now) : Date.now();
  const modelChain = chainToWeatherModels(input.chain);
  const modelRunSegments = chainRunSegments(input.chain);
  const { availableModels } = options;
  const data = input.series;
  const forecastStartTime = input.timeline?.now;

  const svgWidth = viewBoxWidthOrDefault(options.viewBoxWidth);
  const paddingLeft = paddingOrDefault(options.padding?.left, svgWidth);
  const paddingRight = paddingOrDefault(options.padding?.right, svgWidth);
  const axisLabels: Required<MeteogramAxisLabelOptions> = {
    unit: options.axisLabels?.unit === "below" ? "below" : "inline",
    align: options.axisLabels?.align === "edge" || options.axisLabels?.align === "inside" ? options.axisLabels.align : "plot",
    compact: options.axisLabels?.compact === true,
  };
  const graphWidth = svgWidth - paddingLeft - paddingRight;
  const outerLeftX = paddingLeft;
  const outerRightX = svgWidth - paddingRight;

  let timezone = options.timezone ?? input.timezone;
  if (!timezone || timezone === "auto") timezone = input.location?.timezone;
  if (!timezone || timezone === "auto") timezone = "UTC";

  const locationLabel =
    layout.showLocationLabel === "none"
      ? null
      : buildLocationLabel(
          input.location,
          layout.showCreatedTimestamp ? input.generatedAt : null,
          timezone,
          locale,
        );

  // Every quantity by its canonical timestamp; derived quantities join the
  // fetched ones per hour and model.
  const timeMap = buildDataPointTimeMap(withDerivedPoints(data));
  const sourceTimestamps = uniqueSortedTimestamps(timeMap.keys());
  const timelineStart = input.timeline?.start
    ? normalizeTimestamp(input.timeline.start)
    : sourceTimestamps[0];
  const timelineEnd = input.timeline?.end
    ? normalizeTimestamp(input.timeline.end)
    : sourceTimestamps.length > 0
      ? // Hourly values are start-stamped intervals: include the last one.
        sourceTimestamps[sourceTimestamps.length - 1]! + HOUR_MS
      : undefined;

  const maximumRange = calculateMeteogramMaximumRange({
    resolvedTimelineStart: timelineStart,
    resolvedTimelineEnd: timelineEnd,
    effectiveNow: forecastStartTime ? normalizeTimestamp(forecastStartTime) : nowMs,
    resolvedTimezone: timezone,
  });
  const visibleRange = maximumRange
    ? options.visibleRange
      ? clampTimeRange(options.visibleRange, maximumRange)
      : maximumRange
    : null;
  const resolvedTimeline =
    visibleRange && visibleRange.end > visibleRange.start
      ? createTimelineScale(visibleRange.start, visibleRange.end, paddingLeft, svgWidth - paddingRight)
      : null;
  const timeline = resolvedTimeline ?? PLACEHOLDER_TIMELINE;

  const timestamps = maximumRange
    ? uniqueSortedTimestamps([
        ...buildHourlyTimeline(maximumRange.start, maximumRange.end),
        ...sourceTimestamps,
      ]).filter((ts) => ts >= maximumRange.start && ts < maximumRange.end)
    : sourceTimestamps;
  const available = timestamps.length > 0 && resolvedTimeline !== null;
  const getX = (timestamp: number | string) => timeline.timestampToX(timestamp);

  const vcloudMap = buildVerticalCloudMap(input.cloudProfile);
  const currentTimeX =
    nowMs < timeline.startMs || nowMs > timeline.endMs ? null : timeline.timestampToX(nowMs);
  const forecastStartMs = forecastStartTime
    ? normalizeTimestamp(forecastStartTime)
    : timeline.startMs;

  let draggedCloudX: number | null = null;
  const dragHour = options.draggedCloudBoundaryHour;
  if (dragHour !== null && dragHour !== undefined && timestamps.length >= 2) {
    const targetMs = getBoundaryTimestamp(forecastStartMs, dragHour);
    if (timeline.contains(targetMs)) draggedCloudX = timeline.timestampToX(targetMs);
  }

  const allDayGroups = groupTimestampsByDay(timestamps, timezone, locale);
  const visibleDayGroups = filterVisibleDayGroups(allDayGroups, timestamps, timeline);
  const daylightSpans = calculateDaylightSpans(input.sunPhases ?? [], timeline);

  // Values per quantity on the canonical timeline: the layout's quantities
  // plus precipitation and snowfall for the hover sums.
  const valuesMap = new Map(
    [...new Set([...layoutQuantities, "precipitation", "snowfall"])].map((quantity) => [
      quantity,
      timestamps.map((ts) => finiteOrNull(timeMap.get(ts)?.[quantity]?.value)),
    ]),
  );
  const valuesOf = (quantity: string) =>
    valuesMap.get(quantity) ?? timestamps.map(() => null);

  // Axis extremes over all data points of all models, so moving model
  // boundaries does not shift any axis.
  const pointLists: unknown[] = [...Object.values(input.modelSeries ?? {}), data];
  const quantityExtremes = new Map<string, QuantityExtremes>();
  for (const points of pointLists) {
    if (!Array.isArray(points)) continue;
    for (const point of withDerivedPoints(points as DataPoint[])) {
      const value = finiteOrNull(point?.value);
      if (value !== null) addExtreme(quantityExtremes, point.variable, value);
    }
  }
  const { maxPrecipitation } = options;
  const allExtremesOf = extremesLookup(quantityExtremes);
  const extremesOf: ExtremesLookup = (ids, transform) => {
    // Precipitation bars use the axis maximum given for them.
    if (
      (ids.includes("precipitation") || ids.includes(PRECIPITATION_RAIN_SNOW)) &&
      typeof maxPrecipitation === "number" &&
      maxPrecipitation >= 0
    ) {
      return { min: 0, max: maxPrecipitation };
    }
    return allExtremesOf(ids, transform);
  };

  // Precipitation and wind axes of a zoomed chart from the values in the visible range, or in the range a host holds
  // them at while the range moves (`scaleToVisibleRange`, `axisRangeFrom`, REQ-655, DEC-061); `maxPrecipitation` does
  // not apply then.
  const heldAxisRange =
    options.axisRangeFrom && maximumRange ? clampTimeRange(options.axisRangeFrom, maximumRange) : null;
  const axisRangeCandidate = heldAxisRange ?? visibleRange;
  const axisRange =
    (hasToggle("scaleToVisibleRange")
      ? toggles.scaleToVisibleRange === "on"
      : options.scaleToVisibleRange !== false) &&
    maximumRange &&
    resolvedTimeline &&
    axisRangeCandidate &&
    (axisRangeCandidate.start > maximumRange.start || axisRangeCandidate.end < maximumRange.end)
      ? { ...axisRangeCandidate }
      : null;
  // Which axes follow the range is their scope (layout `scope`, else the quantity's, REQ-663); the extremes are
  // gathered for every quantity the layout draws.
  const rangeQuantities = new Set([
    ...VISIBLE_RANGE_AXIS_QUANTITIES,
    ...layout.areas.flatMap((area) => area.series.map((series) => series.quantity)),
  ]);
  const rangeExtremes = axisRange
    ? { lookup: extremesLookup(rangeExtremesOf(pointLists, axisRange, rangeQuantities)) }
    : null;

  // Ends of the model slices: a curve stopping before its slice end gets a "|".
  const modelSliceEndsMs = calculateModelSliceEnds(modelChain, forecastStartMs);
  const noonPositions = calculateNoonPositions(visibleDayGroups, timestamps, timezone, timeline);

  const hasDetailedCloud = Boolean(input.cloudProfile?.profiles?.length);
  const geometry = computeChartGeometry(layout, { backgroundHasData: hasDetailedCloud });

  // Spread series (dew point, REQ-595): their stretches over the whole timeline, so the axis they lower does not move
  // with the visible range. Auto decides by the visible range whether they appear at all (REQ-604, REQ-620); without
  // the option they are off (REQ-620).
  // The switch `dewPoint` (REQ-664) gives the mode of series with `autoRule: "spread"`; others follow the option.
  const dewPoint: DewPointMode =
    hasToggle("dewPoint") && isDewPointMode(toggles.dewPoint)
      ? toggles.dewPoint
      : isDewPointMode(options.dewPoint)
        ? options.dewPoint
        : "off";
  const spreadStretches = new Map<ResolvedSeries, SpreadStretch[]>();
  const axisFloors = geometry.areas.map(({ area }) => {
    const floors: AxisFloors = {};
    for (const series of area.series) {
      if (series.style !== "line" || !series.fillTo) continue;
      const stretches = calculateSpreadStretches(
        timestamps,
        valuesOf(series.fillTo),
        valuesOf(series.quantity),
        spreadModeOf(series, toggles) ?? dewPoint,
        visibleRange,
      );
      spreadStretches.set(series, stretches);
      const floor = spreadAxisFloor(stretches);
      if (floor === null || series.half || (series.axis !== "left" && series.axis !== "right")) continue;
      const current = floors[series.axis];
      floors[series.axis] = typeof current === "number" ? Math.min(current, floor) : floor;
    }
    return floors;
  });
  // Quantities the popup leaves out (REQ-676): those of series left out by their switch, and those of spread series
  // without a stretch (dew point off, or auto without the condition in the visible range).
  const undrawn = new Set([
    ...leftOut,
    ...undrawnQuantities(layout, layout, (series) => (spreadStretches.get(series)?.length ?? 1) > 0),
  ]);
  const size = options.size;
  const renderedWidth = size?.width ?? svgWidth;
  const pixelLayout = getMeteogramLayout({
    mode,
    width: renderedWidth,
    height: size?.height ?? 0,
    viewBoxHeight: geometry.totalHeight,
    viewBoxWidth: svgWidth,
  });
  const areaScales = geometry.areas.map((area, index) =>
    computeAreaScales(area, extremesOf, {
      windIconScaleY: pixelLayout.windIconScaleY,
      floors: axisFloors[index],
      rangeExtremes,
    }),
  );

  const heldPointAt = (quantity: string, ts: number) => {
    const definition = quantities.get(quantity);
    if (definition?.optional && definition.catalogued) {
      return getSupportedPointAtTimestamp(quantity, ts, timeMap, modelChain, availableModels);
    }
    return timeMap.get(ts)?.[quantity] ?? null;
  };

  // Icon footprints in use (arrows and icons series share slots per
  // footprint, so wind and thunderstorm icons line up by default).
  const iconSlotsByFootprint = new Map<number, ReturnType<typeof calculateIconSlotsByMode>>();
  for (const area of layout.areas) {
    for (const series of area.series) {
      if (series.style !== "arrows" && series.style !== "icons") continue;
      const footprintPx = series.iconFootprintPx ?? WIND_ICON_FOOTPRINT_PX;
      if (iconSlotsByFootprint.has(footprintPx)) continue;
      iconSlotsByFootprint.set(
        footprintPx,
        calculateIconSlotsByMode({
          dayGroups: allDayGroups,
          timestamps,
          timeline,
          embeddedWidth: renderedWidth,
          fullscreenWidth: renderedWidth,
          svgWidth,
          footprintPx,
        }),
      );
    }
  }
  const slotsOf = (series: ResolvedSeries) =>
    iconSlotsByFootprint.get(series.iconFootprintPx ?? WIND_ICON_FOOTPRINT_PX)?.[mode] ?? [];
  const windIconsOf = (series: ResolvedSeries): WindIconItem[] =>
    calculateWindIcons(
      slotsOf(series),
      extractWindDirectionSamples(timestamps, timeMap, series.quantity),
      getX,
    );
  const thunderstormIconsOf = (series: ResolvedSeries): ThunderstormIcon[] =>
    aggregateThunderstorms(slotsOf(series), data);

  const areaContext: ChartAreaContext = {
    chartId,
    instance: mode,
    pixelLayout,
    quantities,
    paddingLeft,
    paddingRight,
    axisLabels,
    svgWidth,
    outerLeftX,
    outerRightX,
    graphWidth,
    timestamps,
    timeline,
    getX,
    valuesOf,
    curveMarkersOf: (values) => findCurveMarkers(values, timestamps, modelSliceEndsMs),
    heldPointAt,
    dailyExtremesOf: (series, scale) =>
      calculateDailyTemperatureExtremes({
        dayGroups: allDayGroups,
        timestamps,
        tempValues: valuesOf(series.quantity),
        minTemp: scale.min,
        maxTemp: scale.max,
        tempHeight: scale.bottom - scale.top,
        tempTop: scale.top,
        paddingLeft,
        paddingRight,
        svgWidth,
        timeline,
        getX,
        paddingTop: scale.paddingTop,
        paddingBottom: scale.paddingBottom,
        unit: quantities.get(series.quantity)?.unit ?? "",
      }),
    sunTimeLabelsOf: (area, textScaleX) =>
      calculateSunTimeLabels({
        sunPhases: input.sunPhases ?? [],
        startMs: timeline.startMs,
        endMs: timeline.endMs,
        timeZone: timezone,
        getX: (ts) => getX(ts),
        top: area.top,
        bottom: area.bottom,
        textScaleX,
      }),
    windIconsOf,
    thunderstormIconsOf,
    spreadStretchesOf: (series) => spreadStretches.get(series) ?? [],
    vcloudMap,
    draggedCloudX,
    cloudTransitionXs: options.showCloudBoundaries
      ? calculateCloudTransitionCoordinates(input.cloudTransitions ?? [], timeline)
      : [],
    separatorStroke: theme.grid.line,
    separatorStrokeWidth: SEPARATOR_STROKE_WIDTH,
    separatorOpacity: SEPARATOR_OPACITY,
    theme,
  };

  // Local ground elevation (km ASL) for the cloud profile terrain mask.
  const elevationKm = Math.max(0, (input.location?.elevation ?? 0) / 1000.0);
  const maskArea = geometry.areas.find(
    (item) => item.hasBackground && item.area.background?.terrainMask,
  );
  const terrainMask =
    maskArea && maskArea.area.background
      ? {
          groundY: getCloudAltitudeY(maskArea, maskArea.area.background.maxAltitudeKm, elevationKm),
          bottom: maskArea.bottom,
          elevationKm,
        }
      : null;

  return {
    available,
    layout,
    layoutWarning: resolved.warning,
    layoutQuantities,
    tooltipGroups: withoutTooltipRows(layoutTooltipGroups(layout, layoutQuantities), undrawn),
    quantities,
    timezone,
    theme,
    modelHeaderColors: options.modelHeaderColors ?? {},
    locale,
    texts: resolveMeteogramTexts(options.texts),
    fontFamily: options.fontFamily || null,
    paintBackground: options.background === true,
    locationLabel,
    nowMs,
    maximumRange,
    visibleRange: resolvedTimeline ? visibleRange : null,
    timeline,
    timestamps,
    timeMap,
    modelChain,
    geometry,
    areaScales,
    pixelLayout,
    mode,
    chartId,
    svgWidth,
    paddingLeft,
    paddingRight,
    axisLabels,
    dewPoint,
    relativeHumidity,
    toggles,
    axisRange,
    graphWidth,
    outerLeftX,
    outerRightX,
    modelSegments: calculateModelSegments(
      modelChain,
      forecastStartTime,
      timeline,
      modelRunSegments,
      availableModels,
      locale,
    ),
    zeroSpanModelNames: calculateZeroSpanModelNames(modelChain),
    daylightSpans,
    dayGroups: prepareRenderDayGroups({
      visibleDayGroups,
      dayGroups: allDayGroups,
      timestamps,
      getX,
      outerLeftX,
      outerRightX,
      resolvedTimezone: timezone,
    }),
    noonPositions,
    overlayAreas: geometry.areas.map(({ name, top, bottom }) => ({ name, top, bottom })),
    terrainMask,
    currentTimeX,
    areaContext,
    getX,
  };
}
