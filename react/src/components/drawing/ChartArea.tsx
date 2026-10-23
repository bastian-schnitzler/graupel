import React from "react";
import type { VerticalCloudProfile } from "../../types";
import type { ResolvedSeries } from "../../layouts/types";
import {
  getSeriesColor,
  getSeriesPreset,
  quantitySlug,
} from "../../layouts/seriesPresets";
import { getQuantity } from "../../quantities/registry";
import {
  PRECIPITATION_RAIN_SNOW,
  SNOWFALL_WITH_RAIN,
  splitRainSnow,
} from "../../quantities/derivedQuantities";
import { canonicalTimestamp, HOUR_MS } from "../../utils/timeline";
import type { DailyExtremeItem } from "../../utils/meteogramExtremes";
import {
  SUN_TIME_FONT_SIZE,
  type SunTimeLabel,
} from "../../utils/meteogramSunTimes";
import {
  valueToOffset,
  valueToY,
  type AreaGeometry,
  type AreaScales,
  type ValueScale,
} from "./chartGeometry";
import { DrawingArea } from "./DrawingArea";
import {
  buildHeldSegments,
  buildScaledLinePath,
  buildSvgLinePath,
} from "./meteogramPaths";
import { getTextTransform, type MeteogramLayout } from "./meteogramLayout";
import type { MeteogramRenderMode } from "./meteogramLayout";
import {
  CloudProfileBackground,
  type CloudTransitionX,
} from "./CloudProfileBackground";
import { ThunderstormIconLayer, type ThunderstormIcon } from "./ThunderstormIconLayer";
import { WindArrowIcons, type WindIconItem } from "./WindArrowIcons";

export type { CloudTransitionX, ThunderstormIcon, WindIconItem };

/** Everything a series renderer needs besides the area itself. */
export interface ChartAreaContext {
  chartId: string;
  instance: MeteogramRenderMode;
  pixelLayout: MeteogramLayout;
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  outerLeftX: number;
  outerRightX: number;
  graphWidth: number;
  timestamps: number[];
  timeline: {
    endMs: number;
    intervalToGeometry: (ts: number) => { x: number; width: number } | null;
    xToTimestamp: (x: number) => number;
  };
  getX: (ts: number | string) => number;
  valuesOf: (quantity: string) => (number | null)[];
  /** Indices getting a `|`: early stops and restarts after a gap. */
  curveMarkersOf: (values: (number | null)[]) => Set<number>;
  /** Point of an interval line (only from models supporting it). */
  heldPointAt: (
    quantity: string,
    ts: number,
  ) => { value: number | null; model: string } | null;
  dailyExtremesOf: (
    series: ResolvedSeries,
    scale: ValueScale,
    geometry: AreaGeometry,
  ) => DailyExtremeItem[];
  /** Sunrise / sunset labels of an area with `sunTimes` (#171). */
  sunTimeLabelsOf: (geometry: AreaGeometry, textScaleX: number) => SunTimeLabel[];
  windIconsOf: (series: ResolvedSeries) => WindIconItem[];
  thunderstormIconsOf: (series: ResolvedSeries) => ThunderstormIcon[];
  vcloudMap: Map<number, VerticalCloudProfile>;
  draggedCloudX: number | null;
  cloudTransitionXs: CloudTransitionX[];
  separatorStroke: string;
  separatorStrokeWidth: number;
  separatorOpacity: number;
}

// Panel classes the fixed chart had; custom areas get `panel-<name>`.
const PANEL_IDS: Record<string, string> = {
  precipitation: "panel-combined-precip-clouds",
};

const unitOf = (scale: ValueScale) =>
  scale.axis?.label ?? getQuantity(scale.quantity)?.unit ?? "";
const withUnit = (value: string | number, unit: string) =>
  unit === "" ? `${value}` : unit.startsWith("°") ? `${value}${unit}` : `${value} ${unit}`;

function clipIdFor(
  context: Pick<ChartAreaContext, "chartId" | "instance">,
  name: string,
): string {
  return `${name}-clip-${context.chartId}-${context.instance}`;
}

interface SeriesEntry {
  series: ResolvedSeries;
  scale: ValueScale | null;
  index: number;
}

/** Clip region of a series: its half, its own hidden scale, or the area. */
function seriesClipName(geometry: AreaGeometry, series: ResolvedSeries) {
  if (series.half) return `${geometry.name}-${series.half}`;
  if (series.axis === "hidden") return quantitySlug(series.quantity);
  return geometry.name;
}

export interface ChartAreaProps {
  geometry: AreaGeometry;
  scales: AreaScales;
  context: ChartAreaContext;
}

export const ChartArea: React.FC<ChartAreaProps> = ({
  geometry,
  scales,
  context,
}) => {
  const { area, name, top, height, bottom, zeroY } = geometry;
  const {
    paddingLeft,
    outerLeftX,
    outerRightX,
    graphWidth,
    timestamps,
    timeline,
    getX,
    pixelLayout,
  } = context;
  const textScaleX = pixelLayout.textScaleX;
  const areaClipId = clipIdFor(context, name);

  const drawn: SeriesEntry[] = area.series
    .map((series, index) => ({ series, scale: scales.bySeries[index], index }))
    .filter(({ series }) => series.style !== "tooltip");

  // Clip rectangles: the area plus every half / hidden-scale series region.
  const clips = new Map<string, { y: number; height: number }>();
  clips.set(name, { y: top, height });
  for (const { series } of drawn) {
    // Only lines and probability-like layers clip to their own region.
    if (series.style !== "line") continue;
    const clipName = seriesClipName(geometry, series);
    if (clips.has(clipName)) continue;
    if (series.half && zeroY !== null) {
      clips.set(
        clipName,
        series.half === "upper"
          ? { y: top, height: zeroY - top }
          : { y: zeroY, height: bottom - zeroY },
      );
    } else {
      clips.set(clipName, { y: top, height });
    }
  }

  const label = (
    key: string,
    x: number,
    y: number,
    text: string,
    props: React.SVGProps<SVGTextElement>,
  ) => (
    <text
      key={key}
      x={x}
      y={y}
      transform={getTextTransform(x, y, textScaleX)}
      {...props}
    >
      {text}
    </text>
  );

  // Left axis labels of the shared scale.
  const leftLabels: React.ReactNode[] = [];
  const left = scales.left;
  if (left && left.axis?.showLabels !== false) {
    const unit = unitOf(left);
    const maxText = left.preset.formatMax
      ? left.preset.formatMax(left.max)
      : `${left.max}`;
    const common = {
      fill: left.preset.labelColor,
      fontSize: "9",
      textAnchor: "end" as const,
    };
    leftLabels.push(
      label("axis-max", paddingLeft - 8, top + 14, withUnit(maxText, unit), common),
      label(
        "axis-min",
        paddingLeft - 8,
        bottom - left.preset.minLabelOffset,
        withUnit(left.min, unit),
        common,
      ),
    );
  }

  // Half scales (CAPE upwards, CIN downwards) share the zero label.
  const halfLabels: React.ReactNode[] = [];
  const halves = drawn.filter(
    ({ series, scale }) =>
      series.half && series.axis === "left" && scale && series.style !== "line",
  );
  if (zeroY !== null && halves.length > 0) {
    const halfLabel = ({ series, scale }: SeriesEntry) => {
      const unit = unitOf(scale!);
      const color = scale!.preset.halfLabelColor ?? scale!.preset.labelColor;
      const upper = series.half === "upper";
      const y = upper ? top + 12 : bottom - 3;
      return [
        label(
          `${series.quantity}-max`,
          paddingLeft - 8,
          y,
          withUnit(upper ? scale!.max : `−${scale!.max}`, unit),
          { fill: color, fontSize: "8", textAnchor: "end" },
        ),
        label(
          `${series.quantity}-name`,
          paddingLeft + 4,
          y,
          getQuantity(series.quantity)?.label ?? series.quantity,
          { fill: color, fontSize: "9" },
        ),
      ];
    };
    halfLabels.push(
      ...halves
        .filter(({ series }) => series.half === "upper")
        .flatMap(halfLabel),
      label("zero", paddingLeft - 8, zeroY + 3, withUnit(0, unitOf(halves[0].scale!)), {
        fill: "#334155",
        fontSize: "9",
        textAnchor: "end",
      }),
      ...halves
        .filter(({ series }) => series.half === "lower")
        .flatMap(halfLabel),
    );
  }

  const rightAxisLabels = (scale: ValueScale, quantity: string) => {
    const unit = unitOf(scale);
    const common = { fill: scale.preset.labelColor, fontSize: "7" };
    return [
      label(
        "right-name",
        outerRightX + 4,
        scale.top + 9,
        getQuantity(quantity)?.label ?? quantity,
        common,
      ),
      label("right-max", outerRightX + 4, scale.top + 18, withUnit(scale.max, unit), common),
      label("right-min", outerRightX + 4, scale.bottom - 2, `${scale.min}`, common),
    ];
  };
  const firstRightIndex = drawn.find(
    ({ series }) => series.axis === "right",
  )?.index;

  const renderLine = (entry: SeriesEntry, clipId: string) => {
    const { series, scale } = entry;
    if (!scale) return null;
    const preset = getSeriesPreset(series.quantity);
    const color = getSeriesColor(series.quantity, series.color);
    const strokeWidth = series.strokeWidth ?? preset.strokeWidth ?? 1.5;
    const dashArray =
      series.dashed === false
        ? undefined
        : (preset.dashArray ?? (series.dashed ? "4 2" : undefined));
    const testId = preset.testId ?? `${quantitySlug(series.quantity)}-path`;
    const values = context.valuesOf(series.quantity);

    if (getQuantity(series.quantity)?.kind === "interval") {
      const segments = buildHeldSegments(
        timestamps,
        (ts) => context.heldPointAt(series.quantity, ts),
        (value) => valueToY(scale, value),
        getX,
        timeline.endMs,
        HOUR_MS,
      );
      return segments.map((segment, index) => (
        <path
          key={index}
          d={segment.path}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
          clipPath={`url(#${clipId})`}
          data-testid={testId}
          data-model={segment.model}
          data-scale-min={scale.min}
          data-scale-max={scale.max}
          data-scale-top={scale.top}
          data-scale-bottom={scale.bottom}
        />
      ));
    }

    const stops = series.curveStops ? context.curveMarkersOf(values) : undefined;
    const pathOf = (pathValues: (number | null)[], pathStops?: Set<number>) =>
      scale.clamped
        ? buildScaledLinePath(
            pathValues,
            timestamps,
            getX,
            (value) => valueToY(scale, value),
            pathStops,
          )
        : buildSvgLinePath(
            pathValues,
            scale.min,
            scale.max,
            scale.top,
            scale.bottom - scale.top,
            timestamps,
            getX,
            scale.paddingTop,
            scale.paddingBottom,
            pathStops,
          );
    // SVG restarts the dash pattern per subpath, which would break an
    // in-path "|": dashed curves draw their stop/start markers separately.
    const separateStops = Boolean(dashArray) && stops && stops.size > 0;
    return (
      <React.Fragment key={series.quantity}>
        <path
          d={pathOf(values, dashArray ? undefined : stops)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dashArray}
          strokeLinecap={preset.lineCap}
          clipPath={`url(#${clipId})`}
          data-testid={testId}
          data-scale-top={scale.clamped ? scale.top : undefined}
          data-scale-bottom={scale.clamped ? scale.bottom : undefined}
        />
        {separateStops && (
          <path
            d={pathOf(
              values.map((value, idx) => (stops!.has(idx) ? value : null)),
              stops,
            )}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            clipPath={`url(#${clipId})`}
            data-testid={preset.stopsTestId ?? `${testId}-stops`}
          />
        )}
      </React.Fragment>
    );
  };

  const renderBars = ({ series, scale }: SeriesEntry) => {
    if (!scale) return null;
    const preset = getSeriesPreset(series.quantity);
    const color = getSeriesColor(series.quantity, series.color);
    const testId = preset.testId ?? `${quantitySlug(series.quantity)}-bar`;
    const values = context.valuesOf(series.quantity);
    // Snow hours of precipitation bars: `snowFrom` or the derived quantity.
    const snowSource =
      series.snowFrom ??
      (series.quantity === PRECIPITATION_RAIN_SNOW ? "snowfall" : null);
    const snowValues = snowSource ? context.valuesOf(snowSource) : null;
    const withRain = series.quantity === SNOWFALL_WITH_RAIN;
    const precipValues = withRain ? context.valuesOf("precipitation") : null;
    const snowfallValues = withRain ? context.valuesOf("snowfall") : null;
    const baseY = scale.bottom - scale.paddingBottom;
    return values.map((value, idx) => {
      if (value === null || value <= 0) return null;
      const geometry = timeline.intervalToGeometry(timestamps[idx]);
      if (!geometry) return null;
      const timestamp = canonicalTimestamp(timestamps[idx]);
      if (withRain) {
        // Snow at the bottom, the rain part (snow-equivalent cm) on top.
        const parts = splitRainSnow(precipValues![idx], snowfallValues![idx]);
        if (!parts) return null;
        const snowHeight =
          parts.snowCm > 0
            ? Math.max(1.5, valueToOffset(scale, parts.snowCm))
            : 0;
        const rainHeight =
          parts.rainCm > 0
            ? Math.max(1.5, valueToOffset(scale, parts.rainCm))
            : 0;
        return (
          <React.Fragment key={`${series.quantity}-bar-${idx}`}>
            {snowHeight > 0 && (
              <rect
                x={geometry.x}
                y={baseY - snowHeight}
                width={geometry.width}
                height={snowHeight}
                fill={color}
                stroke={preset.outline ?? "none"}
                strokeWidth={preset.outline ? 1 : 0}
                opacity={preset.opacity ?? 1}
                data-testid={testId}
                data-timestamp={timestamp}
              />
            )}
            {rainHeight > 0 && (
              <rect
                x={geometry.x}
                y={baseY - snowHeight - rainHeight}
                width={geometry.width}
                height={rainHeight}
                fill={getSeriesColor("precipitation", null)}
                opacity={getSeriesPreset("precipitation").opacity ?? 0.85}
                data-testid={`${testId}-rain`}
                data-timestamp={timestamp}
              />
            )}
          </React.Fragment>
        );
      }
      const isSnow = (snowValues?.[idx] ?? 0) > 0;
      const outline = isSnow ? "#475569" : preset.outline;
      const barHeight = Math.max(1.5, valueToOffset(scale, value));
      return (
        <rect
          key={`${series.quantity}-bar-${idx}`}
          x={geometry.x}
          y={baseY - barHeight}
          width={geometry.width}
          height={barHeight}
          fill={isSnow ? "#ffffff" : color}
          stroke={outline ?? "none"}
          strokeWidth={outline ? 1 : 0}
          opacity={isSnow ? 1 : (preset.opacity ?? 0.85)}
          data-testid={testId}
          data-timestamp={timestamp}
        />
      );
    });
  };

  const renderAreaBars = ({ series, scale }: SeriesEntry) => {
    if (!scale) return null;
    const preset = getSeriesPreset(series.quantity);
    const color = getSeriesColor(series.quantity, series.color);
    const testId = preset.testId ?? `${quantitySlug(series.quantity)}-bar`;
    const lower = series.half === "lower";
    return context.valuesOf(series.quantity).map((value, index) => {
      if (value === null || value === 0) return null;
      const geometry = timeline.intervalToGeometry(timestamps[index]);
      if (!geometry) return null;
      const barHeight = valueToOffset(
        scale,
        series.half === "upper" ? Math.max(0, value) : value,
      );
      const baseY = lower ? scale.top : scale.bottom - scale.paddingBottom;
      return (
        <rect
          key={`${series.quantity}-${index}`}
          x={geometry.x}
          width={geometry.width}
          y={lower ? baseY : baseY - barHeight}
          height={barHeight}
          fill={color}
          opacity={`${preset.opacity ?? 0.75}`}
          data-testid={testId}
          data-zero-y={zeroY ?? undefined}
          data-timestamp={canonicalTimestamp(timestamps[index])}
        />
      );
    });
  };

  const renderSeries = (entry: SeriesEntry, clipId: string) => {
    switch (entry.series.style) {
      case "line":
        return renderLine(entry, clipId);
      case "bars":
        return renderBars(entry);
      case "area":
        return renderAreaBars(entry);
      case "arrows":
        return (
          <WindArrowIcons
            key={entry.series.quantity}
            icons={context.windIconsOf(entry.series)}
            y={top + 14}
            layout={pixelLayout}
            instance={context.instance}
          />
        );
      case "icons":
        return (
          <ThunderstormIconLayer
            key={entry.series.quantity}
            icons={context.thunderstormIconsOf(entry.series)}
            top={top}
            getX={getX}
            layout={pixelLayout}
            instance={context.instance}
          />
        );
      default:
        return null;
    }
  };

  // Layered series get their own group; consecutive plain series share the
  // clipped plot group of the area.
  const zeroLineAxis = scales.left?.axis?.zeroLine ? scales.left : null;
  const zeroReference =
    zeroLineAxis && zeroLineAxis.min <= 0 && zeroLineAxis.max >= 0 ? (
      <g key="freezing-reference-group" className="freezing-reference-group">
        <line
          x1={paddingLeft}
          y1={valueToY(zeroLineAxis, 0)}
          x2={context.svgWidth - context.paddingRight}
          y2={valueToY(zeroLineAxis, 0)}
          stroke={context.separatorStroke}
          strokeWidth={context.separatorStrokeWidth}
          opacity={context.separatorOpacity}
          clipPath={`url(#${areaClipId})`}
          data-testid="freezing-line"
        />
      </g>
    ) : null;
  let zeroReferencePending = zeroReference !== null;

  const halfZeroLine =
    zeroY !== null ? (
      <line
        key="half-zero-line"
        x1={outerLeftX}
        x2={outerRightX}
        y1={zeroY}
        y2={zeroY}
        stroke="#334155"
        strokeWidth="1.5"
        data-testid="convective-zero-line"
      />
    ) : null;
  let halfZeroPending = halfZeroLine !== null;

  const blocks: React.ReactNode[] = [];
  let chunk: SeriesEntry[] = [];
  const flushChunk = () => {
    if (chunk.length === 0) return;
    const entries = chunk;
    chunk = [];
    const extremes = entries.flatMap((entry) =>
      entry.series.style === "line" && entry.series.extremeLabels && entry.scale
        ? context.dailyExtremesOf(entry.series, entry.scale, geometry)
        : [],
    );
    const withHalfArea = entries.some(
      ({ series }) => series.half && series.style !== "line",
    );
    blocks.push(
      <DrawingArea
        key={`plot-${entries[0].index}`}
        bounds={{ top, height, left: paddingLeft, width: graphWidth }}
        clipId={areaClipId}
        className={`${name}-plot-area`}
        testId={`${name}-plot-area`}
      >
        {zeroReferencePending && zeroReference}
        {entries.map((entry) =>
          renderSeries(entry, clipIdFor(context, seriesClipName(geometry, entry.series))),
        )}
        {extremes.length > 0 && (
          <DailyExtremeLabels items={extremes} textScaleX={textScaleX} />
        )}
      </DrawingArea>,
    );
    zeroReferencePending = false;
    if (withHalfArea && halfZeroPending) {
      blocks.push(halfZeroLine);
      halfZeroPending = false;
    }
  };

  for (const entry of drawn) {
    const preset = getSeriesPreset(entry.series.quantity);
    if (!preset.layerTestId) {
      chunk.push(entry);
      continue;
    }
    flushChunk();
    const clipId = clipIdFor(context, seriesClipName(geometry, entry.series));
    const rendered = renderSeries(entry, clipId);
    const hasAxisLabels =
      entry.index === firstRightIndex && entry.scale !== null;
    if (hasAxisLabels) {
      // Axis and line only exist where a model delivers the quantity.
      if (!Array.isArray(rendered) || rendered.length === 0) continue;
      blocks.push(
        <g key={`layer-${entry.index}`} data-testid={preset.layerTestId}>
          {rightAxisLabels(entry.scale!, entry.series.quantity)}
          {rendered}
        </g>,
      );
      continue;
    }
    blocks.push(
      <g
        key={`layer-${entry.index}`}
        className={preset.layerTestId}
        data-testid={preset.layerTestId}
        clipPath={`url(#${entry.series.style === "bars" || entry.series.style === "icons" ? areaClipId : clipId})`}
        pointerEvents={entry.series.style === "icons" ? "none" : undefined}
      >
        {rendered}
      </g>,
    );
  }
  flushChunk();
  if (area.sunTimes) {
    const sunLabels = context.sunTimeLabelsOf(geometry, textScaleX ?? 1);
    if (sunLabels.length > 0) {
      // Background: behind the curves and the daily min/max labels.
      blocks.unshift(
        <SunTimeLabels
          key="sun-times"
          labels={sunLabels}
          textScaleX={textScaleX}
          separatorStroke={context.separatorStroke}
        />,
      );
    }
  }
  if (zeroReferencePending) blocks.unshift(zeroReference);
  if (halfZeroPending) blocks.push(halfZeroLine);

  const rightScale = scales.right;
  const plainRightLabels =
    rightScale &&
    rightScale.axis?.showLabels !== false &&
    firstRightIndex !== undefined &&
    !getSeriesPreset(area.series[firstRightIndex].quantity).layerTestId
      ? rightAxisLabels(rightScale, area.series[firstRightIndex].quantity)
      : null;

  return (
    <g
      className={`panel ${PANEL_IDS[name] ?? `panel-${name}`}`}
      data-testid={PANEL_IDS[name] ?? `panel-${name}`}
      data-area-id={area.id}
    >
      <defs>
        {[...clips].map(([clipName, rect]) => (
          <clipPath key={clipName} id={clipIdFor(context, clipName)}>
            <rect
              x={outerLeftX}
              y={rect.y}
              width={graphWidth}
              height={rect.height}
            />
          </clipPath>
        ))}
      </defs>
      {leftLabels}
      {halfLabels}
      {plainRightLabels}
      {area.background && (
        <CloudProfileBackground
          geometry={geometry}
          background={area.background}
          hasData={geometry.hasBackground}
          context={context}
          clipId={areaClipId}
        />
      )}
      {blocks}
    </g>
  );
};

/** Sunrise / sunset times (system.md §16.8, #171). */
const SunTimeLabels: React.FC<{
  labels: SunTimeLabel[];
  textScaleX?: number;
  /** Grey of the chart frame (separator lines). */
  separatorStroke: string;
}> = ({ labels, textScaleX, separatorStroke }) => (
  <g className="sun-time-labels" pointerEvents="none" data-testid="sun-time-labels">
    {labels.map((label) => (
      <text
        key={`${label.kind}-${label.dayKey}`}
        x={label.x}
        y={label.y}
        transform={getTextTransform(label.x, label.y, textScaleX)}
        fill={separatorStroke}
        fontSize={SUN_TIME_FONT_SIZE}
        fontWeight="600"
        textAnchor="middle"
        data-testid={label.kind}
        data-day={label.dayKey}
      >
        {label.text}
      </text>
    ))}
  </g>
);

const DailyExtremeLabels: React.FC<{
  items: DailyExtremeItem[];
  textScaleX?: number;
}> = ({ items, textScaleX }) => (
  <>
    {items.map((item) => (
      <g
        key={`daily-temp-${item.dayKey}`}
        className="daily-temp-extremes"
        pointerEvents="none"
      >
        {item.max.visible && (
          <text
            x={item.max.x}
            y={item.max.y}
            transform={getTextTransform(item.max.x, item.max.y, textScaleX)}
            fill="#e11d48"
            stroke="#ffffff"
            strokeWidth="3"
            paintOrder="stroke"
            strokeLinejoin="round"
            fontSize="9.5"
            fontWeight="700"
            textAnchor="middle"
            data-testid="daily-max-temp"
          >
            {item.max.text}
          </text>
        )}
        {item.min.visible && (
          <text
            x={item.min.x}
            y={item.min.y}
            transform={getTextTransform(item.min.x, item.min.y, textScaleX)}
            fill="#0284c7"
            stroke="#ffffff"
            strokeWidth="3"
            paintOrder="stroke"
            strokeLinejoin="round"
            fontSize="9.5"
            fontWeight="700"
            textAnchor="middle"
            data-testid="daily-min-temp"
          >
            {item.min.text}
          </text>
        )}
      </g>
    ))}
  </>
);
