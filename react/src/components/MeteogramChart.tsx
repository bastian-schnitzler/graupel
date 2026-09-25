import React, { useState, useMemo, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import type {
  DataPoint,
  WeatherModel,
  Location,
  DetailedCloudForecast,
  VerticalCloudTransition,
  SunPeriod,
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
import { clampTimeRange, type TimeRange } from "../utils/meteogramZoom";
import {
  SEPARATOR_STROKE,
  SEPARATOR_STROKE_WIDTH,
  SEPARATOR_OPACITY,
  buildDataPointTimeMap,
  extractWindDirectionSamples,
  buildVerticalCloudMap,
  calculateIconSlotsByMode,
  calculateThunderstormIconsByMode,
  prepareRenderDayGroups,
} from "./drawing/meteogramChart.logic";
import { TemperatureArea } from "./drawing/TemperatureArea";
import { PrecipitationCloudArea } from "./drawing/PrecipitationCloudArea";
import { WindArea } from "./drawing/WindArea";
import { ConvectionArea } from "./drawing/ConvectionArea";
import { TimelineOverlay } from "./drawing/TimelineOverlay";
import { ChartTooltip } from "./drawing/ChartTooltip";
import { OpenMeteoAttribution } from "./meteogram/OpenMeteoAttribution";
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
import {
  interpolateWindDirection,
  calculateWindIcons,
} from "../utils/meteogramWind";
import {
  calculateTemperatureExtremes,
  calculateMaxPrecipitation,
  calculateDailyTemperatureExtremes,
} from "../utils/meteogramExtremes";
import {
  buildSvgLinePath,
  buildPrecipitationProbabilityPath as createPrecipProbPath,
  calculateDaylightSpans,
  calculateNoonPositions,
} from "./drawing/meteogramPaths";
import {
  calculateConvectiveExtremes,
  getLpiAtTimestamp,
  buildLpiSegments,
} from "../utils/meteogramConvective";
import { buildFullscreenDetailRows } from "../utils/meteogramDetails";
import {
  calculateMeteogramMaximumRange,
  groupTimestampsByDay,
  filterVisibleDayGroups,
  calculateZeroSpanModelNames,
  calculateModelSegments,
  calculateCloudTransitionCoordinates,
} from "../utils/meteogramTimelineUtils";

export {
  METEOGRAM_VIEWBOX_WIDTH,
  WIND_ICON_RADIUS_PX,
  WIND_ICON_FOOTPRINT_PX,
  type MeteogramRenderMode,
  type MeteogramLayout,
  getMeteogramLayout,
  getTextTransform,
  interpolateWindDirection,
};

interface MeteogramChartProps {
  data: DataPoint[];
  modelChain: WeatherModel[];
  availableModels?: Record<string, WeatherModel>;
  location?: Location;
  verticalCloudForecast?: DetailedCloudForecast | null;
  verticalCloudTransitions?: VerticalCloudTransition[];
  modelForecasts?: Record<string, DataPoint[]>;
  maxPrecipitation?: number;
  sunPhases?: SunPeriod[];
  forecastStartTime?: string;
  timelineStart?: string;
  timelineEnd?: string;
  onHoverPoint?: (point: DataPoint | null) => void;
  draggedCloudBoundaryHour?: number | null;
  isFullscreenMapOpen?: boolean;
  userTimezone?: string;
}

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
}) => {
  const [visibleRange, setVisibleRange] = useState<TimeRange | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const embeddedSvgRef = useRef<SVGSVGElement>(null);
  const fullscreenSvgRef = useRef<SVGSVGElement>(null);
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
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 60000);
    return () => clearInterval(interval);
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

  // Group every variable by its canonical Unix-millisecond timestamp.
  const timeMap = useMemo(() => buildDataPointTimeMap(data), [data]);

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

  useEffect(() => {
    if (!maximumRange) return;
    // The available domain is an external prop-derived constraint. Persisting
    // its intersection prevents an old, larger viewport from reappearing if a
    // later configuration expands the maximum again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleRange((current) => {
      const next = current
        ? clampTimeRange(current, maximumRange)
        : { ...maximumRange };
      return current && current.start === next.start && current.end === next.end
        ? current
        : next;
    });
  }, [maximumRange]);

  const effectiveVisibleRange = maximumRange
    ? visibleRange
      ? clampTimeRange(visibleRange, maximumRange)
      : maximumRange
    : null;

  const timeline = useMemo(() => {
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

  if (timestamps.length === 0 || !timeline) {
    return (
      <div className="card empty-state">
        <p>No forecast data available for the selected parameters.</p>
      </div>
    );
  }

  const getX = (timestamp: number | string) => timeline.timestampToX(timestamp);

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
  }, [draggedCloudBoundaryHour, forecastStartTime, timeline]);

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

  // Data values extraction
  const tempValues = timestamps.map(
    (ts) => timeMap.get(ts)?.["temperature"]?.value ?? null,
  );
  const apparentTempValues = timestamps.map(
    (ts) => timeMap.get(ts)?.["apparent_temperature"]?.value ?? null,
  );
  const windValues = timestamps.map(
    (ts) => timeMap.get(ts)?.["wind_speed"]?.value ?? null,
  );
  const gustValues = timestamps.map(
    (ts) => timeMap.get(ts)?.["wind_gusts"]?.value ?? null,
  );

  const precipValues = timestamps.map(
    (ts) => timeMap.get(ts)?.["precipitation"]?.value ?? null,
  );
  const precipProbValues = timestamps.map(
    (ts) => timeMap.get(ts)?.["precipitation_probability"]?.value ?? null,
  );

  // Range Calculations:
  // Temperature Y-axis minimum and maximum considering both temperature and apparent_temperature
  // across all data points of all models in the configuration, ensuring slider resizing doesn't shift the axis.
  const { minTemp, maxTemp } = useMemo(
    () =>
      calculateTemperatureExtremes(
        modelForecasts,
        tempValues,
        apparentTempValues,
      ),
    [modelForecasts, tempValues, apparentTempValues],
  );

  const validWinds = [...windValues, ...gustValues].filter(
    (v): v is number => v !== null,
  );
  const maxWind = validWinds.length
    ? Math.max(30, Math.ceil(Math.max(...validWinds) * 1.15))
    : 50;

  const validPrecip = precipValues.filter(
    (v): v is number => v !== null && v >= 0,
  );

  // Precipitation maximum across all data of all models, so moving boundaries doesn't shift the Y-axis
  const rawMaxPrecip = useMemo(
    () =>
      calculateMaxPrecipitation(maxPrecipitation, modelForecasts, validPrecip),
    [maxPrecipitation, modelForecasts, validPrecip],
  );

  const precipAxisMax = rawMaxPrecip > 0 ? rawMaxPrecip / 0.8 : 2.5;

  // Path Builder with gap handling for missing data
  const buildPath = (
    values: (number | null)[],
    minY: number,
    maxY: number,
    panelTop: number,
    panelHeight: number,
    paddingTop = 10,
    paddingBottom = 10,
  ) =>
    buildSvgLinePath(
      values,
      minY,
      maxY,
      panelTop,
      panelHeight,
      timestamps,
      getX,
      paddingTop,
      paddingBottom,
    );

  const buildPrecipitationProbabilityPath = () =>
    createPrecipProbPath(
      precipProbValues,
      timestamps,
      combinedPlotBottom,
      combinedPlotHeight,
      getX,
    );

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

  // Panel Heights & Layout
  const modelHeaderTop = 0;
  const modelHeaderHeight = 22;
  const modelHeaderBoxTop = modelHeaderTop + 2;
  const modelHeaderBoxHeight = 18;
  const modelHeaderBoxBottom = modelHeaderBoxTop + modelHeaderBoxHeight;

  const dayHeaderTop = modelHeaderTop + modelHeaderHeight;
  const dayHeaderHeight = 22;
  const dayHeaderBottom = dayHeaderTop + dayHeaderHeight; // 44

  const tempTop = dayHeaderBottom; // 44
  const tempHeight = 115;
  const tempBottom = tempTop + tempHeight; // 159

  // White Separator Height: approx 2/3 of date header height (22 * 2/3 = 14.67 -> 15px)
  const separatorHeight = Math.round((2 / 3) * dayHeaderHeight); // 15

  // Combined Panel: Detailed Clouds, Precipitation & Probability
  const hasDetailedCloud = Boolean(
    verticalCloudForecast &&
    verticalCloudForecast.profiles &&
    verticalCloudForecast.profiles.length > 0,
  );

  const combinedPlotTop = tempBottom + separatorHeight; // 174
  const combinedPlotHeight = hasDetailedCloud ? 125 : 95;
  const combinedPlotBottom = combinedPlotTop + combinedPlotHeight; // 299 (or 269)

  // Panel 3: Wind speed, gusts & direction
  const windTop = combinedPlotBottom + separatorHeight; // 314 (or 284)
  const windHeight = 105;
  const windBottom = windTop + windHeight; // 419 (or 389)

  const convectiveTop = windBottom + separatorHeight;
  const convectiveHalfHeight = 65;
  const convectiveZero = convectiveTop + convectiveHalfHeight;
  const convectiveBottom = convectiveZero + convectiveHalfHeight;
  const totalSvgHeight = convectiveBottom + 10;

  const convectiveValues = (variable: string) =>
    timestamps.map((ts) => {
      const value = timeMap.get(ts)?.[variable]?.value;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    });
  const capeValues = convectiveValues("cape");
  const cinValues = convectiveValues("convective_inhibition");
  const { capeMax, cinMax } = useMemo(
    () => calculateConvectiveExtremes(modelForecasts, data),
    [modelForecasts, data],
  );

  const lpiAt = (ts: number) =>
    getLpiAtTimestamp(ts, timeMap, modelChain, availableModels);

  const lpiSegments = useMemo(
    () =>
      buildLpiSegments(
        timestamps,
        timeMap,
        modelChain,
        availableModels,
        convectiveZero,
        convectiveHalfHeight,
        getX,
        timeline.endMs,
      ),
    [
      timestamps,
      timeMap,
      modelChain,
      availableModels,
      convectiveZero,
      convectiveHalfHeight,
      getX,
      timeline.endMs,
    ],
  );

  // Share slots even when wind observations are unavailable.
  const iconSlotsByMode = useMemo(
    () =>
      calculateIconSlotsByMode({
        dayGroups,
        timestamps,
        timeline,
        embeddedWidth: embeddedDimensions.width,
        fullscreenWidth: fullscreenDimensions.width,
        svgWidth,
      }),
    [
      dayGroups,
      timestamps,
      embeddedDimensions.width,
      fullscreenDimensions.width,
      timeline,
      svgWidth,
    ],
  );

  const windIconsByMode = useMemo(
    () => ({
      embedded: calculateWindIcons(
        iconSlotsByMode.embedded,
        windDirectionSamples,
        getX,
      ),
      fullscreen: calculateWindIcons(
        iconSlotsByMode.fullscreen,
        windDirectionSamples,
        getX,
      ),
    }),
    [iconSlotsByMode, windDirectionSamples, getX],
  );

  const thunderstormIconsByMode = useMemo(
    () => calculateThunderstormIconsByMode(iconSlotsByMode, data),
    [iconSlotsByMode, data],
  );

  const {
    hoverTime,
    hoverTimestamp,
    hoverData,
    hoverX,
    hoverDateObj,
    hoverDateParts,
    popupPos,
    accumulatedPrecip,
    handleMouseMove,
    handleMouseLeave,
    hidePopupOnZoom,
    programmaticCursorMoveRef,
  } = useMeteogramHover({
    containerRef,
    popupRef,
    timeline,
    timestamps,
    timeMap,
    precipValues,
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
  hoverTimeRef.current = hoverTime;

  useMeteogramZoom({
    maximumRange,
    timeline,
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
    () => calculateModelSegments(modelChain, forecastStartTime, timeline),
    [modelChain, forecastStartTime, timeline],
  );

  const cloudTransitionXs = useMemo(
    () =>
      calculateCloudTransitionCoordinates(verticalCloudTransitions, timeline),
    [verticalCloudTransitions, timeline],
  );

  // Local Ground Elevation calculation (in km ASL)
  const locElevationMeters = location?.elevation ?? 0;
  const locElevationKm = Math.max(0, locElevationMeters / 1000.0);
  const maxAltitudeKm = 12.0;

  const getAltitudeY = (altKm: number) => {
    const usableHeight = combinedPlotHeight - 10;
    const clampedAlt = Math.max(0, Math.min(maxAltitudeKm, altKm));
    return (
      combinedPlotTop +
      combinedPlotHeight -
      (clampedAlt / maxAltitudeKm) * usableHeight
    );
  };

  const groundY = getAltitudeY(locElevationKm);

  // Daily min and max temperature calculations (real temperature only)
  const dailyExtremes = useMemo(
    () =>
      calculateDailyTemperatureExtremes({
        dayGroups,
        timestamps,
        tempValues,
        minTemp,
        maxTemp,
        tempHeight,
        tempTop,
        paddingLeft,
        paddingRight,
        svgWidth,
        timeline,
        getX,
      }),
    [
      dayGroups,
      tempValues,
      minTemp,
      maxTemp,
      tempHeight,
      tempTop,
      paddingLeft,
      paddingRight,
      svgWidth,
      timestamps,
      timeline,
      getX,
    ],
  );

  const detailRows = useMemo(
    () =>
      buildFullscreenDetailRows({
        hoverTimestamp,
        hoverData,
        accumulatedPrecip,
        resolvedTimezone,
      }),
    [hoverTimestamp, hoverData, accumulatedPrecip, resolvedTimezone],
  );

  const renderSvgContent = (instance: MeteogramRenderMode) => {
    const layout = getMeteogramLayout({
      mode: instance,
      ...(instance === "embedded" ? embeddedDimensions : fullscreenDimensions),
      viewBoxHeight: totalSvgHeight,
    });
    const windIcons = windIconsByMode[instance] || [];
    const temperatureClipId = `temperature-clip-${chartInstanceId}-${instance}`;
    const combinedClipId = `combined-clip-${chartInstanceId}-${instance}`;
    const windClipId = `wind-clip-${chartInstanceId}-${instance}`;
    const probabilityClipId = `precipitation-probability-clip-${chartInstanceId}-${instance}`;
    const convectiveClipId = `convective-clip-${chartInstanceId}-${instance}`;
    const lpiClipId = `lpi-clip-${chartInstanceId}-${instance}`;
    const temperatureGradientId = `temperature-gradient-${chartInstanceId}-${instance}`;

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
          <clipPath id={temperatureClipId}>
            <rect
              x={outerLeftX}
              y={tempTop}
              width={graphWidth}
              height={tempHeight}
            />
          </clipPath>
          <clipPath id={combinedClipId}>
            <rect
              x={outerLeftX}
              y={combinedPlotTop}
              width={graphWidth}
              height={combinedPlotHeight}
            />
          </clipPath>
          <clipPath id={probabilityClipId}>
            <rect
              x={outerLeftX}
              y={combinedPlotTop}
              width={graphWidth}
              height={combinedPlotHeight}
            />
          </clipPath>
          <clipPath id={windClipId}>
            <rect
              x={outerLeftX}
              y={windTop}
              width={graphWidth}
              height={windHeight}
            />
          </clipPath>
          <clipPath id={convectiveClipId}>
            <rect
              x={outerLeftX}
              y={convectiveTop}
              width={graphWidth}
              height={convectiveHalfHeight * 2}
            />
          </clipPath>
          <clipPath id={lpiClipId}>
            <rect
              x={outerLeftX}
              y={convectiveTop}
              width={graphWidth}
              height={convectiveHalfHeight}
            />
          </clipPath>
        </defs>

        {/* Model Segments Row (Above Day Labels) */}
        {modelSegments.map((seg, idx) => {
          if (zeroSpanModelNames.has(seg.modelName.toLowerCase())) return null;
          const spanWidth = seg.endX - seg.startX;
          if (spanWidth <= 0) return null;
          const badgeX = seg.startX;
          const badgeWidth = spanWidth;
          const badgeY = modelHeaderBoxTop;
          const badgeHeight = modelHeaderBoxHeight;
          const badgeBottom = modelHeaderBoxBottom;
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
              key={`model-seg-${idx}-${seg.modelName}`}
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
                  layout.textScaleX,
                )}
                fill="#0f172a"
                fontSize={
                  badgeWidth < 40 ? "7" : badgeWidth < 70 ? "8.5" : "10"
                }
                fontWeight="800"
                textAnchor="middle"
              >
                {seg.modelName}
              </text>
            </g>
          );
        })}

        {/* Daylight Stripes (Sunrise to Sunset) */}
        {daylightSpans.map((span, idx) => (
          <g
            key={`daylight-stripe-${span.dayKey || idx}`}
            className="daylight-stripe-group"
          >
            {/* Area 1: Temperature area */}
            <rect
              x={span.x}
              y={dayHeaderBottom}
              width={span.width}
              height={tempBottom - dayHeaderBottom}
              fill="#fef08a"
              opacity="0.45"
              pointerEvents="none"
              data-testid="daylight-stripe"
            />
            {/* Area 2: Precipitation / cloud area */}
            <rect
              x={span.x}
              y={combinedPlotTop}
              width={span.width}
              height={combinedPlotHeight}
              fill="#fef08a"
              opacity="0.45"
              pointerEvents="none"
              data-testid="daylight-stripe"
            />
            {/* Area 3: Wind area */}
            <rect
              x={span.x}
              y={windTop}
              width={span.width}
              height={windHeight}
              fill="#fef08a"
              opacity="0.45"
              pointerEvents="none"
              data-testid="daylight-stripe"
            />
            <rect
              x={span.x}
              y={convectiveTop}
              width={span.width}
              height={convectiveHalfHeight * 2}
              fill="#fef08a"
              opacity="0.45"
              pointerEvents="none"
              data-testid="daylight-stripe"
            />
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
          tempBottom={tempBottom}
          combinedPlotTop={combinedPlotTop}
          combinedPlotBottom={combinedPlotBottom}
          combinedPlotHeight={combinedPlotHeight}
          windTop={windTop}
          windBottom={windBottom}
          windHeight={windHeight}
          convectiveTop={convectiveTop}
          convectiveBottom={convectiveBottom}
          convectiveHalfHeight={convectiveHalfHeight}
          outerLeftX={outerLeftX}
          outerRightX={outerRightX}
          paddingLeft={paddingLeft}
          paddingRight={paddingRight}
          svgWidth={svgWidth}
          modelHeaderBoxBottom={modelHeaderBoxBottom}
          hasDetailedCloud={hasDetailedCloud}
          locElevationKm={locElevationKm}
          groundY={groundY}
          graphWidth={graphWidth}
          locationName={location?.name}
          timeline={timeline}
          separatorStroke={SEPARATOR_STROKE}
          separatorStrokeWidth={SEPARATOR_STROKE_WIDTH}
          separatorOpacity={SEPARATOR_OPACITY}
          textScaleX={layout.textScaleX}
        />

        {/* PANEL 1: TEMPERATURE & WEATHER ICONS */}
        <TemperatureArea
          paddingLeft={paddingLeft}
          paddingRight={paddingRight}
          svgWidth={svgWidth}
          tempTop={tempTop}
          tempHeight={tempHeight}
          minTemp={minTemp}
          maxTemp={maxTemp}
          temperatureClipId={temperatureClipId}
          apparentTempPath={buildPath(
            apparentTempValues,
            minTemp,
            maxTemp,
            tempTop,
            tempHeight,
            22,
            10,
          )}
          tempPath={buildPath(
            tempValues,
            minTemp,
            maxTemp,
            tempTop,
            tempHeight,
            22,
            10,
          )}
          dailyExtremes={dailyExtremes}
          separatorStroke={SEPARATOR_STROKE}
          separatorStrokeWidth={SEPARATOR_STROKE_WIDTH}
          separatorOpacity={SEPARATOR_OPACITY}
          textScaleX={layout.textScaleX}
        />

        {/* COMBINED PANEL: DETAILED CLOUDS, PRECIPITATION & PRECIPITATION PROBABILITY */}
        <PrecipitationCloudArea
          paddingLeft={paddingLeft}
          paddingRight={paddingRight}
          svgWidth={svgWidth}
          combinedPlotTop={combinedPlotTop}
          combinedPlotHeight={combinedPlotHeight}
          combinedPlotBottom={combinedPlotBottom}
          hasDetailedCloud={hasDetailedCloud}
          maxAltitudeKm={maxAltitudeKm}
          combinedClipId={combinedClipId}
          probabilityClipId={probabilityClipId}
          timestamps={timestamps}
          timeline={timeline}
          vcloudMap={vcloudMap}
          getAltitudeY={getAltitudeY}
          draggedCloudX={draggedCloudX}
          cloudTransitionXs={cloudTransitionXs}
          precipValues={precipValues}
          precipAxisMax={precipAxisMax}
          precipitationProbabilityPath={buildPrecipitationProbabilityPath()}
          thunderstormIcons={thunderstormIconsByMode[instance]}
          layout={layout}
          instance={instance}
          getX={getX}
        />

        {/* PANEL 4: WIND SPEED, GUSTS & WIND DIRECTION */}
        <WindArea
          paddingLeft={paddingLeft}
          windTop={windTop}
          windHeight={windHeight}
          windBottom={windBottom}
          maxWind={maxWind}
          windClipId={windClipId}
          windSpeedPath={buildPath(
            windValues,
            0,
            maxWind,
            windTop,
            windHeight,
            25,
            0,
          )}
          windGustsPath={buildPath(
            gustValues,
            0,
            maxWind,
            windTop,
            windHeight,
            25,
            0,
          )}
          windIcons={windIcons}
          layout={layout}
          instance={instance}
        />

        {/* PANEL 5: CONVECTIVE */}
        <ConvectionArea
          paddingLeft={paddingLeft}
          outerLeftX={outerLeftX}
          outerRightX={outerRightX}
          convectiveTop={convectiveTop}
          convectiveZero={convectiveZero}
          convectiveBottom={convectiveBottom}
          convectiveHalfHeight={convectiveHalfHeight}
          capeMax={capeMax}
          cinMax={cinMax}
          convectiveClipId={convectiveClipId}
          lpiClipId={lpiClipId}
          timestamps={timestamps}
          timeline={timeline}
          capeValues={capeValues}
          cinValues={cinValues}
          lpiSegments={lpiSegments}
          textScaleX={layout.textScaleX}
        />

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
              y2={convectiveBottom}
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
              y2={convectiveBottom}
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
        <OpenMeteoAttribution
          className="meteogram-footer-attribution"
          testId="meteogram-footer-attribution"
        />
      </div>

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
        lpiValue={hoverTimestamp ? lpiAt(hoverTimestamp)?.value : null}
      />

      {/* Dedicated Full-Screen View Portal */}
      {isFullscreen &&
        createPortal(
          <div
            className="fullscreen-meteogram-overlay"
            data-testid="fullscreen-meteogram-overlay"
            onDoubleClick={handleDoubleClick}
          >
            <OpenMeteoAttribution
              className="fullscreen-header-attribution"
              testId="fullscreen-header-attribution"
            />
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
