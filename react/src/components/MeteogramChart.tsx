import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useId,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import type {
  DataPoint,
  WeatherModel,
  Location,
  DetailedCloudForecast,
  VerticalCloudTransition,
  SunPeriod,
  RunSegment,
} from "../types";
import {
  HOUR_MS,
  assertSameTimelineX,
  buildHourlyTimeline,
  canonicalTimestamp,
  createTimelineScale,
  getBoundaryTimestamp,
  normalizeTimestamp,
  uniqueSortedTimestamps,
  validateTimestampSequence,
} from "../utils/timeline";
import {
  calculateDayRange,
  clampTimeRange,
  findActiveDayRange,
  type DayRangeChoice,
  type TimeRange,
} from "../utils/meteogramZoom";
import {
  SEPARATOR_STROKE,
  SEPARATOR_STROKE_WIDTH,
  SEPARATOR_OPACITY,
  buildDataPointTimeMap,
  extractWindDirectionSamples,
  buildVerticalCloudMap,
  calculateIconSlotsByMode,
  prepareRenderDayGroups,
} from "./drawing/meteogramChart.logic";
import { ChartArea, type ChartAreaContext } from "./drawing/ChartArea";
import {
  computeAreaScales,
  computeChartGeometry,
  type ExtremesLookup,
} from "./drawing/chartGeometry";
import { getCloudAltitudeY } from "./drawing/cloudProfile.logic";
import { TimelineOverlay } from "./drawing/TimelineOverlay";
import { ChartTooltip } from "./drawing/ChartTooltip";
import { OpenMeteoAttribution } from "./meteogram/OpenMeteoAttribution";
import { buildLocationLabel } from "./meteogram/locationLabel.logic";
import { CopyPngButton } from "./meteogram/CopyPngButton";
import { DayRangeButtons } from "./meteogram/DayRangeButtons";
import { calculateSunTimeLabels } from "../utils/meteogramSunTimes";
import {
  exportLabelFontPx,
  renderMeteogramPng,
  type ExportTimeLine,
} from "./meteogram/exportPng.logic";
import { apiService } from "../services/apiService";
import { useChartDimensions } from "./drawing/useChartDimensions";
import { useMeteogramZoom } from "./drawing/useMeteogramZoom";
import { useMeteogramHover } from "./drawing/useMeteogramHover";
import {
  METEOGRAM_VIEWBOX_WIDTH,
  WIND_ICON_RADIUS_PX,
  WIND_ICON_FOOTPRINT_PX,
  type MeteogramRenderMode,
  type MeteogramLayout,
  getMeteogramLayout,
  getTextTransform,
} from "./drawing/meteogramLayout";
import { calculateWindIcons } from "../utils/meteogramWind";
import { calculateDailyTemperatureExtremes } from "../utils/meteogramExtremes";
import {
  calculateDaylightSpans,
  calculateModelSliceEnds,
  findCurveMarkers,
  calculateNoonPositions,
} from "./drawing/meteogramPaths";
import { getSupportedPointAtTimestamp } from "../utils/meteogramConvective";
import { buildFullscreenDetailRows } from "../utils/meteogramDetails";
import { getQuantity } from "../quantities/registry";
import { aggregateThunderstorms } from "../utils/thunderstormIcons";
import type { ResolvedSeries } from "../layouts/types";
import type { ThunderstormIcon } from "./drawing/ThunderstormIconLayer";
import {
  POWER_DEFAULT_LAYOUT_ID,
  resolveChartLayout,
} from "../layouts/layoutResolution";
import { getLayoutQuantities } from "../layouts/layoutQuantities";
import {
  PRECIPITATION_RAIN_SNOW,
  withDerivedPoints,
} from "../quantities/derivedQuantities";
import { formatModelRunTime } from "./modelChain/modelChainBuilderUtils";
import { chooseModelHeaderLabel } from "./drawing/modelHeaderLabel.logic";
import {
  calculateMeteogramMaximumRange,
  groupTimestampsByDay,
  filterVisibleDayGroups,
  calculateZeroSpanModelNames,
  calculateModelSegments,
  findRunAt,
  calculateCloudTransitionCoordinates,
} from "../utils/meteogramTimelineUtils";

export {
  METEOGRAM_VIEWBOX_WIDTH,
  WIND_ICON_RADIUS_PX,
  WIND_ICON_FOOTPRINT_PX,
  type MeteogramRenderMode,
  type MeteogramLayout,
};

interface MeteogramChartProps {
  data: DataPoint[];
  modelChain: WeatherModel[];
  availableModels?: Record<string, WeatherModel>;
  location?: Location;
  verticalCloudForecast?: DetailedCloudForecast | null;
  verticalCloudTransitions?: VerticalCloudTransition[];
  modelForecasts?: Record<string, DataPoint[]>;
  /** Runs per model (newest first); headers and boundaries split per run. */
  modelRunSegments?: Record<string, RunSegment[] | undefined>;
  maxPrecipitation?: number;
  sunPhases?: SunPeriod[];
  /** Zoom range restored when the chart remounts without a new forecast. */
  getPersistedVisibleRange?: () => TimeRange | null;
  onVisibleRangeChange?: (range: TimeRange | null) => void;
  /** Chosen day-range button (#162); applied when a new forecast loads. */
  dayRangeChoice?: DayRangeChoice;
  onDayRangeChoiceChange?: (days: DayRangeChoice) => void;
  forecastStartTime?: string;
  timelineStart?: string;
  timelineEnd?: string;
  onHoverPoint?: (point: DataPoint | null) => void;
  draggedCloudBoundaryHour?: number | null;
  isFullscreenMapOpen?: boolean;
  userTimezone?: string;
  /** UTC instant the forecast was generated (shown in the location label). */
  generatedAt?: string;
  /**
   * Meteogram layout (system.md §4). Missing: the fallback layout; invalid: the
   * fallback layout plus a warning.
   */
  chartLayout?: unknown;
  /** Built-in layout id used without or instead of `chartLayout`. */
  fallbackLayoutId?: string;
  /** Power mode (#203): model headers and boundaries whatever the layout says. */
  forceModelHeaders?: boolean;
}

// Placeholder scale used only while the chart renders its empty state.
const PLACEHOLDER_TIMELINE = createTimelineScale(
  0,
  HOUR_MS,
  50,
  METEOGRAM_VIEWBOX_WIDTH - 50,
);

export const MeteogramChart: React.FC<MeteogramChartProps> = ({
  data,
  modelChain,
  availableModels,
  location,
  verticalCloudForecast,
  modelForecasts,
  maxPrecipitation,
  sunPhases = [],
  forecastStartTime,
  timelineStart,
  timelineEnd,
  draggedCloudBoundaryHour,
  verticalCloudTransitions = [],
  isFullscreenMapOpen = false,
  userTimezone,
  generatedAt,
  modelRunSegments,
  getPersistedVisibleRange,
  onVisibleRangeChange,
  dayRangeChoice,
  onDayRangeChoiceChange,
  chartLayout,
  fallbackLayoutId = POWER_DEFAULT_LAYOUT_ID,
  forceModelHeaders = false,
}) => {
  const { layout: resolvedLayout, warning: layoutWarning } = useMemo(() => {
    const resolved = resolveChartLayout(chartLayout, fallbackLayoutId);
    return forceModelHeaders && !resolved.layout.showModelHeaders
      ? { ...resolved, layout: { ...resolved.layout, showModelHeaders: true } }
      : resolved;
  }, [chartLayout, fallbackLayoutId, forceModelHeaders]);
  useEffect(() => {
    if (layoutWarning) console.warn(layoutWarning);
  }, [layoutWarning]);
  const layoutQuantities = useMemo(
    () => getLayoutQuantities(resolvedLayout),
    [resolvedLayout],
  );
  const [visibleRange, setVisibleRange] = useState<TimeRange | null>(
    () => getPersistedVisibleRange?.() ?? null,
  );
  useEffect(() => {
    onVisibleRangeChange?.(visibleRange);
  }, [visibleRange, onVisibleRangeChange]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const embeddedSvgRef = useRef<SVGSVGElement>(null);
  const fullscreenSvgRef = useRef<SVGSVGElement>(null);
  const footerRowRef = useRef<HTMLDivElement>(null);
  const fullscreenHeaderRowRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const chartInstanceId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFullscreen((prev) => !prev);
  };

  useEffect(() => {
    // New data: refresh the current time right after the render, then every minute.
    const refresh = setTimeout(() => setNowMs(Date.now()), 0);
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 60000);
    return () => {
      clearTimeout(refresh);
      clearInterval(interval);
    };
  }, [data, forecastStartTime]);

  const svgWidth = METEOGRAM_VIEWBOX_WIDTH;
  const paddingLeft = 50;
  const paddingRight = 50;
  const graphWidth = svgWidth - paddingLeft - paddingRight;

  const resolvedTimezone = useMemo(() => {
    let tz = userTimezone;
    if (!tz || tz === "auto") {
      tz = location?.timezone;
    }
    if (!tz || tz === "auto") tz = "UTC";
    return tz;
  }, [userTimezone, location?.timezone]);

  const locationLabel = useMemo(
    () =>
      resolvedLayout.showLocationLabel === "none"
        ? null
        : buildLocationLabel(
            location,
            resolvedLayout.showCreatedTimestamp ? generatedAt : null,
            resolvedTimezone,
          ),
    [location, generatedAt, resolvedTimezone, resolvedLayout],
  );

  // Group every variable by its canonical Unix-millisecond timestamp.
  // Derived quantities (system.md §5.1) join the fetched ones per hour and model.
  const timeMap = useMemo(
    () => buildDataPointTimeMap(withDerivedPoints(data)),
    [data],
  );

  const sourceTimestamps = useMemo(
    () => uniqueSortedTimestamps(timeMap.keys()),
    [timeMap],
  );

  const resolvedTimelineStart = timelineStart
    ? normalizeTimestamp(timelineStart)
    : sourceTimestamps[0];
  const resolvedTimelineEnd = timelineEnd
    ? normalizeTimestamp(timelineEnd)
    : sourceTimestamps.length > 0
      ? // Hourly values are start-stamped intervals. Include the complete final
        // interval when an explicit backend display window is unavailable.
        sourceTimestamps[sourceTimestamps.length - 1] + HOUR_MS
      : undefined;

  const maximumRange = useMemo<TimeRange | null>(
    () =>
      calculateMeteogramMaximumRange({
        resolvedTimelineStart,
        resolvedTimelineEnd,
        effectiveNow: forecastStartTime
          ? normalizeTimestamp(forecastStartTime)
          : nowMs,
        resolvedTimezone,
      }),
    [
      resolvedTimelineStart,
      resolvedTimelineEnd,
      nowMs,
      forecastStartTime,
      resolvedTimezone,
    ],
  );

  // Chosen day-range button; App keeps it across forecasts (#162). Read
  // when a new forecast sets the first range, not a reason to rerun.
  const [chosenDayRange, setChosenDayRange] = useState<
    DayRangeChoice | undefined
  >(dayRangeChoice);
  const dayRangeChoiceRef = useRef<DayRangeChoice | undefined>(dayRangeChoice);
  useEffect(() => {
    dayRangeChoiceRef.current = chosenDayRange;
  }, [chosenDayRange]);

  useEffect(() => {
    if (!maximumRange) return;
    // The available domain is an external prop-derived constraint. Persisting
    // its intersection prevents an old, larger viewport from reappearing if a
    // later configuration expands the maximum again. A new forecast starts
    // with the chosen day-range button, else the whole range (#162).
    setVisibleRange((current) => {
      const chosen = dayRangeChoiceRef.current;
      const next = current
        ? clampTimeRange(current, maximumRange)
        : chosen !== undefined
          ? calculateDayRange(maximumRange, chosen, resolvedTimezone)
          : { ...maximumRange };
      return current && current.start === next.start && current.end === next.end
        ? current
        : next;
    });
  }, [maximumRange, resolvedTimezone]);

  const effectiveVisibleRange = maximumRange
    ? visibleRange
      ? clampTimeRange(visibleRange, maximumRange)
      : maximumRange
    : null;

  const activeDayRange =
    maximumRange && effectiveVisibleRange
      ? findActiveDayRange(
          effectiveVisibleRange,
          maximumRange,
          chosenDayRange,
          resolvedTimezone,
        )
      : undefined;
  const handleDayRange = (days: DayRangeChoice) => {
    if (!maximumRange) return;
    setVisibleRange(calculateDayRange(maximumRange, days, resolvedTimezone));
    setChosenDayRange(days);
    onDayRangeChoiceChange?.(days);
  };

  const resolvedTimeline = useMemo(() => {
    if (
      !effectiveVisibleRange ||
      effectiveVisibleRange.end <= effectiveVisibleRange.start
    )
      return null;
    return createTimelineScale(
      effectiveVisibleRange.start,
      effectiveVisibleRange.end,
      paddingLeft,
      svgWidth - paddingRight,
    );
  }, [effectiveVisibleRange, paddingLeft, paddingRight, svgWidth]);
  // Every hook below must run on every render (Rules of Hooks), so the empty
  // state is returned only after them; a placeholder scale keeps them safe.
  const timeline = resolvedTimeline ?? PLACEHOLDER_TIMELINE;

  const timestamps = useMemo(() => {
    if (!maximumRange) return sourceTimestamps;
    const hourlyGrid = buildHourlyTimeline(
      maximumRange.start,
      maximumRange.end,
    );
    return uniqueSortedTimestamps([...hourlyGrid, ...sourceTimestamps]).filter(
      (timestamp) =>
        timestamp >= maximumRange.start && timestamp < maximumRange.end,
    );
  }, [sourceTimestamps, maximumRange]);

  useEffect(() => {
    if (!import.meta.env.DEV || timestamps.length < 2) return;
    const anomalies = validateTimestampSequence(timestamps);
    if (anomalies.length > 0) {
      console.warn(
        "Meteogram canonical timeline contains non-hourly spacing",
        anomalies,
      );
    }
  }, [timestamps]);

  const windDirectionSamples = useMemo(
    () => extractWindDirectionSamples(timestamps, timeMap),
    [timestamps, timeMap],
  );

  const embeddedDimensions = useChartDimensions(
    embeddedSvgRef,
    true,
    METEOGRAM_VIEWBOX_WIDTH,
    isFullscreen,
  );
  const fullscreenDimensions = useChartDimensions(
    fullscreenSvgRef,
    isFullscreen,
    METEOGRAM_VIEWBOX_WIDTH,
  );

  // Detailed Cloud profile map by timestamp
  const vcloudMap = useMemo(
    () => buildVerticalCloudMap(verticalCloudForecast),
    [verticalCloudForecast],
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !timeline) return;

    for (const [timestampMs, profile] of vcloudMap) {
      if (timeMap.has(timestampMs)) {
        assertSameTimelineX(timeline, [timestampMs, profile.timestamp]);
      }
    }

    const forecastStartMs = forecastStartTime
      ? normalizeTimestamp(forecastStartTime)
      : timeline.startMs;
    for (const model of modelChain) {
      const boundaryMs = getBoundaryTimestamp(
        forecastStartMs,
        model.max_forecast_horizon_hours,
      );
      if (!timeline.contains(boundaryMs)) continue;
      const roundTripMs = timeline.xToTimestamp(
        timeline.timestampToX(boundaryMs),
      );
      if (Math.abs(roundTripMs - boundaryMs) > 0.001) {
        throw new Error(
          `Model boundary timeline round-trip mismatch for ${model.name}`,
        );
      }
    }
  }, [forecastStartTime, modelChain, timeMap, timeline, vcloudMap]);

  const chartUnavailable = timestamps.length === 0 || !resolvedTimeline;

  const getX = useCallback(
    (timestamp: number | string) => timeline.timestampToX(timestamp),
    [timeline],
  );

  const currentTimeX = useMemo(() => {
    if (nowMs < timeline.startMs || nowMs > timeline.endMs) return null;
    return timeline.timestampToX(nowMs);
  }, [timeline, nowMs]);

  const draggedCloudX = useMemo(() => {
    if (
      draggedCloudBoundaryHour === null ||
      draggedCloudBoundaryHour === undefined ||
      timestamps.length < 2
    ) {
      return null;
    }
    const forecastStartMs = forecastStartTime
      ? normalizeTimestamp(forecastStartTime)
      : timeline.startMs;
    const targetMs = getBoundaryTimestamp(
      forecastStartMs,
      draggedCloudBoundaryHour,
    );
    if (!timeline.contains(targetMs)) return null;
    return timeline.timestampToX(targetMs);
  }, [draggedCloudBoundaryHour, forecastStartTime, timeline, timestamps.length]);

  // Group timestamps by Day
  const dayGroups = useMemo(
    () => groupTimestampsByDay(timestamps, resolvedTimezone),
    [timestamps, resolvedTimezone],
  );

  // Days that actually intersect the visible timeline range
  const visibleDayGroups = useMemo(
    () => filterVisibleDayGroups(dayGroups, timestamps, timeline),
    [dayGroups, timestamps, timeline],
  );

  const outerLeftX = paddingLeft;
  const outerRightX = svgWidth - paddingRight;

  // Daylight spans from sunrise to sunset for each day
  const daylightSpans = useMemo(
    () => calculateDaylightSpans(sunPhases, timeline),
    [sunPhases, timeline],
  );

  // Values per quantity on the canonical timeline: the layout's quantities
  // plus precipitation and snowfall for the hover sums.
  const valuesMap = useMemo(() => {
    const ids = new Set([...layoutQuantities, "precipitation", "snowfall"]);
    return new Map(
      [...ids].map((quantity) => [
        quantity,
        timestamps.map((ts) => {
          const value = timeMap.get(ts)?.[quantity]?.value;
          return typeof value === "number" && Number.isFinite(value)
            ? value
            : null;
        }),
      ]),
    );
  }, [timestamps, timeMap, layoutQuantities]);
  const valuesByQuantity = (quantity: string) =>
    valuesMap.get(quantity) ?? timestamps.map(() => null);
  const precipValues = valuesByQuantity("precipitation");
  const snowfallValues = valuesByQuantity("snowfall");

  // Axis extremes over all data points of all models, so moving model
  // boundaries does not shift any axis.
  const quantityExtremes = useMemo(() => {
    const stats = new Map<
      string,
      { min: number; max: number; maxPositive: number; maxAbs: number }
    >();
    const consider = (variable: string, value: unknown) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      const entry = stats.get(variable);
      if (!entry) {
        stats.set(variable, {
          min: value,
          max: value,
          maxPositive: Math.max(0, value),
          maxAbs: Math.abs(value),
        });
        return;
      }
      entry.min = Math.min(entry.min, value);
      entry.max = Math.max(entry.max, value);
      entry.maxPositive = Math.max(entry.maxPositive, value);
      entry.maxAbs = Math.max(entry.maxAbs, Math.abs(value));
    };
    for (const points of [...Object.values(modelForecasts ?? {}), data]) {
      if (!Array.isArray(points)) continue;
      for (const point of withDerivedPoints(points)) {
        if (point) consider(point.variable, point.value);
      }
    }
    return stats;
  }, [modelForecasts, data]);

  const extremesOf = useMemo<ExtremesLookup>(
    () => (quantities, transform) => {
      // Precipitation bars use the axis maximum the view computed for them.
      if (
        (quantities.includes("precipitation") ||
          quantities.includes(PRECIPITATION_RAIN_SNOW)) &&
        typeof maxPrecipitation === "number" &&
        maxPrecipitation >= 0
      ) {
        return { min: 0, max: maxPrecipitation };
      }
      let min: number | null = null;
      let max: number | null = null;
      for (const quantity of quantities) {
        const entry = quantityExtremes.get(quantity);
        if (!entry) continue;
        const low = transform === "value" ? entry.min : 0;
        const high =
          transform === "value"
            ? entry.max
            : transform === "positive"
              ? entry.maxPositive
              : entry.maxAbs;
        min = min === null ? low : Math.min(min, low);
        max = max === null ? high : Math.max(max, high);
      }
      return { min, max };
    },
    [quantityExtremes, maxPrecipitation],
  );

  // Ends of the model slices: a curve stopping before its slice end gets a "|".
  const modelSliceEndsMs = useMemo(
    () =>
      calculateModelSliceEnds(
        modelChain,
        forecastStartTime
          ? normalizeTimestamp(forecastStartTime)
          : timeline.startMs,
      ),
    [modelChain, forecastStartTime, timeline.startMs],
  );
  // A curve resuming after a gap gets a "|" at its first point.
  const getCurveMarkers = (values: (number | null)[]) =>
    findCurveMarkers(values, timestamps, modelSliceEndsMs);

  // Noon grid lines (12:00 local time per day) calculated from actual time scale
  const noonPositions = useMemo(
    () =>
      calculateNoonPositions(
        visibleDayGroups,
        timestamps,
        resolvedTimezone,
        timeline,
      ),
    [visibleDayGroups, timestamps, resolvedTimezone, timeline],
  );

  // Panel geometry from the layout (header, day header, areas, gaps).
  const hasDetailedCloud = Boolean(
    verticalCloudForecast &&
    verticalCloudForecast.profiles &&
    verticalCloudForecast.profiles.length > 0,
  );
  const geometry = useMemo(
    () =>
      computeChartGeometry(resolvedLayout, {
        backgroundHasData: hasDetailedCloud,
      }),
    [resolvedLayout, hasDetailedCloud],
  );
  const {
    modelHeaderTop,
    modelHeaderBoxTop,
    modelHeaderBoxHeight,
    modelHeaderBoxBottom,
    dayHeaderTop,
    dayHeaderHeight,
    dayHeaderBottom,
    plotBottom,
  } = geometry;
  const areaScales = useMemo(
    () => geometry.areas.map((area) => computeAreaScales(area, extremesOf)),
    [geometry, extremesOf],
  );

  // The copied PNG shows the red time line at the generation time printed in
  // the location label, not at the moment of copying.
  const exportTimeLine = useMemo<ExportTimeLine>(() => {
    const generatedMs = generatedAt ? normalizeTimestamp(generatedAt) : NaN;
    const lineMs = Number.isFinite(generatedMs) ? generatedMs : nowMs;
    const inRange = lineMs >= timeline.startMs && lineMs <= timeline.endMs;
    return {
      x: inRange ? timeline.timestampToX(lineMs) : null,
      y1: dayHeaderTop,
      y2: plotBottom,
      timestamp: canonicalTimestamp(lineMs),
    };
  }, [generatedAt, nowMs, timeline, dayHeaderTop, plotBottom]);

  const copyChartPng = (mode: MeteogramRenderMode) => {
    const svg =
      mode === "fullscreen" ? fullscreenSvgRef.current : embeddedSvgRef.current;
    const row =
      mode === "fullscreen"
        ? fullscreenHeaderRowRef.current
        : footerRowRef.current;
    if (!svg) return Promise.resolve(false);
    return apiService.copyPngToClipboard(
      renderMeteogramPng({
        svg,
        textRows: row ? [row] : [],
        timeLine: exportTimeLine,
        labelFontPx: exportLabelFontPx(svg),
      }),
    );
  };
  const totalSvgHeight = geometry.totalHeight;

  const lpiAt = (ts: number) =>
    getSupportedPointAtTimestamp(
      "lightning_potential",
      ts,
      timeMap,
      modelChain,
      availableModels,
    );

  const heldPointAt = (quantity: string, ts: number) => {
    const definition = getQuantity(quantity);
    if (definition?.optional && definition.catalogued) {
      return getSupportedPointAtTimestamp(
        quantity,
        ts,
        timeMap,
        modelChain,
        availableModels,
      );
    }
    const point = timeMap.get(ts)?.[quantity];
    return point ?? null;
  };

  // Icon footprints in use (arrows and icons series share slots per
  // footprint, so wind and thunderstorm icons line up by default).
  const iconFootprints = useMemo(() => {
    const footprints = new Set<number>();
    for (const area of resolvedLayout.areas) {
      for (const series of area.series) {
        if (series.style === "arrows" || series.style === "icons") {
          footprints.add(series.iconFootprintPx ?? WIND_ICON_FOOTPRINT_PX);
        }
      }
    }
    return [...footprints];
  }, [resolvedLayout]);

  // Share slots even when wind observations are unavailable.
  const iconSlotsByFootprint = useMemo(
    () =>
      new Map(
        iconFootprints.map((footprintPx) => [
          footprintPx,
          calculateIconSlotsByMode({
            dayGroups,
            timestamps,
            timeline,
            embeddedWidth: embeddedDimensions.width,
            fullscreenWidth: fullscreenDimensions.width,
            svgWidth,
            footprintPx,
          }),
        ]),
      ),
    [
      iconFootprints,
      dayGroups,
      timestamps,
      embeddedDimensions.width,
      fullscreenDimensions.width,
      timeline,
      svgWidth,
    ],
  );

  // Icons per arrows / icons series and render mode.
  const windIconsBySeries = useMemo(() => {
    const result = new Map<
      ResolvedSeries,
      Record<MeteogramRenderMode, ReturnType<typeof calculateWindIcons>>
    >();
    for (const area of resolvedLayout.areas) {
      for (const series of area.series) {
        if (series.style !== "arrows") continue;
        const slots = iconSlotsByFootprint.get(
          series.iconFootprintPx ?? WIND_ICON_FOOTPRINT_PX,
        );
        const samples =
          series.quantity === "wind_direction"
            ? windDirectionSamples
            : extractWindDirectionSamples(timestamps, timeMap, series.quantity);
        result.set(series, {
          embedded: calculateWindIcons(slots?.embedded ?? [], samples, getX),
          fullscreen: calculateWindIcons(slots?.fullscreen ?? [], samples, getX),
        });
      }
    }
    return result;
  }, [
    resolvedLayout,
    iconSlotsByFootprint,
    windDirectionSamples,
    timestamps,
    timeMap,
    getX,
  ]);
  const thunderstormIconsBySeries = useMemo(() => {
    const result = new Map<
      ResolvedSeries,
      Record<MeteogramRenderMode, ThunderstormIcon[]>
    >();
    for (const area of resolvedLayout.areas) {
      for (const series of area.series) {
        if (series.style !== "icons") continue;
        const slots = iconSlotsByFootprint.get(
          series.iconFootprintPx ?? WIND_ICON_FOOTPRINT_PX,
        );
        result.set(series, {
          embedded: aggregateThunderstorms(slots?.embedded ?? [], data),
          fullscreen: aggregateThunderstorms(slots?.fullscreen ?? [], data),
        });
      }
    }
    return result;
  }, [resolvedLayout, iconSlotsByFootprint, data]);

  const {
    hoverTime,
    hoverTimestamp,
    hoverData,
    hoverX,
    hoverDateObj,
    hoverDateParts,
    popupPos,
    accumulatedPrecip,
    accumulatedSnowfall,
    handleMouseMove,
    handleMouseLeave,
    hidePopupOnZoom,
    programmaticCursorMoveRef,
  } = useMeteogramHover({
    containerRef,
    popupRef,
    timeline: chartUnavailable ? null : timeline,
    timestamps,
    timeMap,
    precipValues,
    snowfallValues,
    resolvedTimezone,
    svgWidth,
    paddingLeft,
    paddingRight,
    getX,
    dayHeaderBottom,
    totalSvgHeight,
    suppressPopup: isFullscreen || Boolean(isFullscreenMapOpen),
  });

  const hoverTimeRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    hoverTimeRef.current = hoverTime;
  }, [hoverTime]);

  // Popup: run start and length of the run delivering the hovered value.
  const hoverModelName =
    hoverData?.["temperature"]?.model || hoverData?.["wind_speed"]?.model;
  const hoverRun =
    hoverModelName && hoverTimestamp
      ? findRunAt(modelRunSegments?.[hoverModelName], hoverTimestamp)
      : undefined;
  const hoverRunTime = formatModelRunTime(
    hoverRun?.run_init_time,
    resolvedTimezone,
  );
  const hoverRunInfo = hoverRunTime
    ? `Run ${hoverRunTime}` +
      (typeof hoverRun?.run_length_hours === "number"
        ? ` + ${hoverRun.run_length_hours}h`
        : "")
    : null;

  useMeteogramZoom({
    maximumRange,
    timeline: chartUnavailable ? null : timeline,
    hoverTimeRef,
    isFullscreen,
    embeddedSvgRef,
    fullscreenSvgRef,
    svgWidth,
    paddingLeft,
    paddingRight,
    programmaticCursorMoveRef,
    visibleRange,
    setVisibleRange,
    onZoomStart: hidePopupOnZoom,
  });

  // Set of model names/IDs in modelChain that have 0 forecast horizon span (resized to 0)
  const zeroSpanModelNames = useMemo(
    () => calculateZeroSpanModelNames(modelChain),
    [modelChain],
  );

  // Model segments calculation for header row
  const modelSegments = useMemo(
    () =>
      calculateModelSegments(
        modelChain,
        forecastStartTime,
        timeline,
        modelRunSegments,
        availableModels,
      ),
    [modelChain, forecastStartTime, timeline, modelRunSegments, availableModels],
  );

  const cloudTransitionXs = useMemo(
    () =>
      calculateCloudTransitionCoordinates(verticalCloudTransitions, timeline),
    [verticalCloudTransitions, timeline],
  );

  // Local ground elevation (km ASL) for the cloud profile terrain mask.
  const locElevationMeters = location?.elevation ?? 0;
  const locElevationKm = Math.max(0, locElevationMeters / 1000.0);

  const terrainMask = useMemo(() => {
    const area = geometry.areas.find(
      (item) => item.hasBackground && item.area.background?.terrainMask,
    );
    if (!area || !area.area.background) return null;
    return {
      groundY: getCloudAltitudeY(
        area,
        area.area.background.maxAltitudeKm,
        locElevationKm,
      ),
      bottom: area.bottom,
      elevationKm: locElevationKm,
    };
  }, [geometry, locElevationKm]);

  // Daily min and max labels of a line series (real temperature only in the
  // built-in layouts).
  const dailyExtremesOf: ChartAreaContext["dailyExtremesOf"] = (
    series,
    scale,
  ) =>
    calculateDailyTemperatureExtremes({
      dayGroups,
      timestamps,
      tempValues: valuesByQuantity(series.quantity),
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
      unit: getQuantity(series.quantity)?.unit ?? "",
    });

  const detailRows = useMemo(
    () =>
      buildFullscreenDetailRows({
        hoverTimestamp,
        hoverData,
        accumulatedPrecip,
        resolvedTimezone,
        quantities: layoutQuantities,
      }),
    [
      hoverTimestamp,
      hoverData,
      accumulatedPrecip,
      resolvedTimezone,
      layoutQuantities,
    ],
  );

  const overlayAreas = geometry.areas.map(({ name, top, bottom }) => ({
    name,
    top,
    bottom,
  }));

  const renderSvgContent = (instance: MeteogramRenderMode) => {
    const pixelLayout = getMeteogramLayout({
      mode: instance,
      ...(instance === "embedded" ? embeddedDimensions : fullscreenDimensions),
      viewBoxHeight: totalSvgHeight,
    });
    const temperatureGradientId = `temperature-gradient-${chartInstanceId}-${instance}`;
    const areaContext: ChartAreaContext = {
      chartId: chartInstanceId,
      instance,
      pixelLayout,
      paddingLeft,
      paddingRight,
      svgWidth,
      outerLeftX,
      outerRightX,
      graphWidth,
      timestamps,
      timeline,
      getX,
      valuesOf: valuesByQuantity,
      curveMarkersOf: getCurveMarkers,
      heldPointAt,
      dailyExtremesOf,
      sunTimeLabelsOf: (geometry, textScaleX) =>
        calculateSunTimeLabels({
          sunPhases,
          startMs: timeline.startMs,
          endMs: timeline.endMs,
          timeZone: resolvedTimezone,
          getX: (ts) => getX(ts),
          top: geometry.top,
          bottom: geometry.bottom,
          textScaleX,
        }),
      windIconsOf: (series) => windIconsBySeries.get(series)?.[instance] ?? [],
      thunderstormIconsOf: (series) =>
        thunderstormIconsBySeries.get(series)?.[instance] ?? [],
      vcloudMap,
      draggedCloudX,
      cloudTransitionXs,
      separatorStroke: SEPARATOR_STROKE,
      separatorStrokeWidth: SEPARATOR_STROKE_WIDTH,
      separatorOpacity: SEPARATOR_OPACITY,
    };

    return (
      <>
        <defs>
          <linearGradient
            id={temperatureGradientId}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Model Segments Row (Above Day Labels) */}
        {resolvedLayout.showModelHeaders &&
          modelSegments.map((seg, idx) => {
            if (zeroSpanModelNames.has(seg.modelName.toLowerCase()))
              return null;
            const spanWidth = seg.endX - seg.startX;
            if (spanWidth <= 0) return null;
            const badgeX = seg.startX;
            const badgeWidth = spanWidth;
            const badgeY = modelHeaderBoxTop;
            const badgeHeight = modelHeaderBoxHeight;
            const badgeBottom = modelHeaderBoxBottom;
            const headerLabel = chooseModelHeaderLabel(
              seg.label,
              seg.shortLabel,
              badgeWidth,
            );
            const cornerRadius = Math.min(3, badgeWidth / 2, badgeHeight);
            const badgePath = [
              `M ${badgeX} ${badgeBottom}`,
              `V ${badgeY + cornerRadius}`,
              `Q ${badgeX} ${badgeY} ${badgeX + cornerRadius} ${badgeY}`,
              `H ${badgeX + badgeWidth - cornerRadius}`,
              `Q ${badgeX + badgeWidth} ${badgeY} ${badgeX + badgeWidth} ${badgeY + cornerRadius}`,
              `V ${badgeBottom}`,
              "Z",
            ].join(" ");

            return (
              <g
                key={`model-seg-${idx}-${seg.label}`}
                className="model-label-segment"
                data-testid="model-label-segment"
                data-model={seg.modelName}
                data-start-x={seg.startX}
                data-end-x={seg.endX}
              >
                <path
                  d={badgePath}
                  fill="#f59e0b"
                  data-testid="model-header-shape"
                  data-x={badgeX}
                  data-y={badgeY}
                  data-width={badgeWidth}
                  data-height={badgeHeight}
                  data-top-radius={cornerRadius}
                  data-bottom-radius="0"
                />
                <text
                  x={badgeX + badgeWidth / 2}
                  y={modelHeaderTop + 14}
                  transform={getTextTransform(
                    badgeX + badgeWidth / 2,
                    modelHeaderTop + 14,
                    pixelLayout.textScaleX,
                  )}
                  fill="#0f172a"
                  fontSize={headerLabel.fontSize}
                  fontWeight="800"
                  textAnchor="middle"
                  data-testid="model-header-label"
                  data-shortened={headerLabel.shortened ? "true" : undefined}
                >
                  {headerLabel.text}
                </text>
              </g>
            );
          })}

        {/* Daylight Stripes (Sunrise to Sunset), one rect per area */}
        {resolvedLayout.showDaylight &&
          daylightSpans.map((span, idx) => (
            <g
              key={`daylight-stripe-${span.dayKey || idx}`}
              className="daylight-stripe-group"
            >
              {geometry.areas.map((area) => (
                <rect
                  key={area.name}
                  x={span.x}
                  y={area.top}
                  width={span.width}
                  height={area.height}
                  fill="#fef08a"
                  opacity="0.45"
                  pointerEvents="none"
                  data-testid="daylight-stripe"
                />
              ))}
            </g>
          ))}

        <TimelineOverlay
          dayGroups={prepareRenderDayGroups({
            visibleDayGroups,
            dayGroups,
            timestamps,
            getX,
            outerLeftX,
            outerRightX,
            resolvedTimezone,
          })}
          noonPositions={noonPositions}
          modelSegments={modelSegments}
          dayHeaderTop={dayHeaderTop}
          dayHeaderBottom={dayHeaderBottom}
          dayHeaderHeight={dayHeaderHeight}
          areas={overlayAreas}
          outerLeftX={outerLeftX}
          outerRightX={outerRightX}
          paddingLeft={paddingLeft}
          paddingRight={paddingRight}
          svgWidth={svgWidth}
          modelHeaderBoxBottom={modelHeaderBoxBottom}
          showModelBoundaries={resolvedLayout.showModelHeaders}
          showDayHeader={resolvedLayout.showDayHeader}
          terrainMask={terrainMask}
          graphWidth={graphWidth}
          timeline={timeline}
          separatorStroke={SEPARATOR_STROKE}
          separatorStrokeWidth={SEPARATOR_STROKE_WIDTH}
          separatorOpacity={SEPARATOR_OPACITY}
          textScaleX={pixelLayout.textScaleX}
        />

        {/* DRAWING AREAS (layout order) */}
        {geometry.areas.map((area, index) => (
          <ChartArea
            key={area.area.id}
            geometry={area}
            scales={areaScales[index]}
            context={areaContext}
          />
        ))}

        {/* HOVER OR CURRENT-TIME CROSSHAIR */}
        {hoverX !== null ? (
          <g
            className="hover-crosshair-group"
            data-testid="hover-crosshair-group"
          >
            <line
              x1={hoverX}
              y1={dayHeaderTop}
              x2={hoverX}
              y2={plotBottom}
              stroke="#f43f5e"
              strokeWidth="1.2"
              strokeDasharray="4 2"
              data-testid="hover-cursor-line"
              data-timestamp={
                hoverTimestamp !== null
                  ? canonicalTimestamp(hoverTimestamp)
                  : undefined
              }
              data-hover-time={
                hoverTime !== null ? canonicalTimestamp(hoverTime) : undefined
              }
            />
          </g>
        ) : currentTimeX !== null ? (
          <g
            className="current-time-crosshair-group"
            data-testid="current-time-crosshair-group"
          >
            <line
              x1={currentTimeX}
              y1={dayHeaderTop}
              x2={currentTimeX}
              y2={plotBottom}
              stroke="#f43f5e"
              strokeWidth="1.2"
              strokeDasharray="4 2"
              data-testid="current-time-cursor-line"
              data-timestamp={canonicalTimestamp(nowMs)}
            />
          </g>
        ) : null}
      </>
    );
  };

  // Location label and attribution; above or below the embedded chart.
  const footerRow = (
    <div
      ref={footerRowRef}
      className={`meteogram-footer-row${resolvedLayout.showLocationLabel === "top" ? " meteogram-footer-row--top" : ""}`}
      data-testid="meteogram-footer-row"
    >
      <span
        className="meteogram-location-label"
        data-testid="meteogram-footer-location"
        title={locationLabel ?? undefined}
      >
        {locationLabel}
      </span>
      <DayRangeButtons
        active={activeDayRange}
        onChoose={handleDayRange}
        testId="day-range-buttons"
      />
      <OpenMeteoAttribution
        className="meteogram-footer-attribution"
        testId="meteogram-footer-attribution"
      />
    </div>
  );

  if (chartUnavailable) {
    return (
      <div className="card empty-state">
        <p>No forecast data available for the selected parameters.</p>
      </div>
    );
  }

  return (
    <div
      className="meteogram-redesign-container card"
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className="meteogram-chart-area-white"
        data-testid="meteogram-chart-white-bg"
      >
        {layoutWarning && (
          <div
            className="meteogram-layout-warning"
            role="status"
            data-testid="meteogram-layout-warning"
          >
            {layoutWarning}
          </div>
        )}
        {resolvedLayout.showLocationLabel === "top" && footerRow}
        <svg
          ref={embeddedSvgRef}
          viewBox={`0 0 ${svgWidth} ${totalSvgHeight}`}
          className="meteogram-svg-integrated"
          preserveAspectRatio="none"
          data-render-mode="embedded"
          data-visible-start-time={canonicalTimestamp(timeline.startMs)}
          data-visible-end-time={canonicalTimestamp(timeline.endMs)}
          data-maximum-start-time={
            maximumRange ? canonicalTimestamp(maximumRange.start) : undefined
          }
          data-maximum-end-time={
            maximumRange ? canonicalTimestamp(maximumRange.end) : undefined
          }
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {renderSvgContent("embedded")}
        </svg>
        {resolvedLayout.showLocationLabel !== "top" && footerRow}
      </div>

      <CopyPngButton
        className="meteogram-copy-btn-embedded"
        testId="copy-png-button"
        onCopy={() => copyChartPng("embedded")}
      />

      {/* Floating Hover Tooltip overlay (disabled in full-screen mode) */}
      <ChartTooltip
        isFullscreen={isFullscreen}
        isFullscreenMapOpen={isFullscreenMapOpen}
        hoverData={hoverData}
        hoverX={hoverX}
        hoverDateObj={hoverDateObj}
        hoverDateParts={hoverDateParts}
        popupPos={popupPos}
        popupRef={popupRef}
        hoverTimestamp={hoverTimestamp}
        location={location}
        userTimezone={resolvedTimezone}
        accumulatedPrecip={accumulatedPrecip}
        accumulatedSnowfall={accumulatedSnowfall}
        lpiValue={
          hoverTimestamp && layoutQuantities.has("lightning_potential")
            ? lpiAt(hoverTimestamp)?.value
            : null
        }
        runInfo={hoverRunInfo}
        quantities={layoutQuantities}
      />

      {/* Dedicated Full-Screen View Portal */}
      {isFullscreen &&
        createPortal(
          <div
            className="fullscreen-meteogram-overlay"
            data-testid="fullscreen-meteogram-overlay"
            onDoubleClick={handleDoubleClick}
          >
            <CopyPngButton
              className="meteogram-copy-btn-fullscreen"
              testId="fullscreen-copy-png-button"
              onCopy={() => copyChartPng("fullscreen")}
            />
            <div
              ref={fullscreenHeaderRowRef}
              className="fullscreen-header-row"
              data-testid="fullscreen-header-row"
            >
              <span
                className="meteogram-location-label"
                data-testid="fullscreen-header-location"
                title={locationLabel ?? undefined}
              >
                {locationLabel}
              </span>
              <DayRangeButtons
                active={activeDayRange}
                onChoose={handleDayRange}
                testId="fullscreen-day-range-buttons"
              />
              <OpenMeteoAttribution
                className="fullscreen-header-attribution"
                testId="fullscreen-header-attribution"
              />
            </div>
            <div
              className="fullscreen-chart-area"
              data-testid="fullscreen-chart-area"
            >
              <svg
                ref={fullscreenSvgRef}
                viewBox={`0 0 ${svgWidth} ${totalSvgHeight}`}
                className="meteogram-svg-integrated"
                preserveAspectRatio="none"
                data-render-mode="fullscreen"
                data-visible-start-time={canonicalTimestamp(timeline.startMs)}
                data-visible-end-time={canonicalTimestamp(timeline.endMs)}
                data-maximum-start-time={
                  maximumRange
                    ? canonicalTimestamp(maximumRange.start)
                    : undefined
                }
                data-maximum-end-time={
                  maximumRange
                    ? canonicalTimestamp(maximumRange.end)
                    : undefined
                }
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                {renderSvgContent("fullscreen")}
              </svg>
            </div>
            <div
              className="fullscreen-details-panel"
              data-testid="fullscreen-details-panel"
            >
              <div
                className="fullscreen-details-grid"
                data-testid="fullscreen-details-grid"
              >
                {detailRows.map((row, rowIndex) => (
                  <div
                    key={`fullscreen-detail-row-${rowIndex + 1}`}
                    className={`fullscreen-details-row fullscreen-details-row-${rowIndex + 1}`}
                    data-testid={`fullscreen-detail-row-${rowIndex + 1}`}
                    style={
                      row.length === 6
                        ? undefined
                        : {
                            gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                          }
                    }
                  >
                    {row.map((item) => (
                      <div
                        key={item.testId}
                        className="fullscreen-detail-pair"
                        data-testid={item.testId}
                      >
                        <span className="attr-name">{item.label}</span>
                        <span
                          className="attr-val"
                          style={item.color ? { color: item.color } : undefined}
                        >
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
