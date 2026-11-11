// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import {
  valueToOffset,
  valueToY,
  type AreaGeometry,
  type AreaScales,
  type ValueScale,
} from "../core/chartGeometry";
import type { DailyExtremeItem } from "../core/extremes";
import {
  themeAxisLabelColor,
  themeHalfAxisLabelColor,
  type MeteogramTheme,
} from "../core/theme";
import {
  anchoredDashPieces,
  buildHeldSegments,
  buildScaledLinePath,
  buildSvgLinePath,
} from "../core/paths";
import type { SpreadStretch } from "../core/spread";
import {
  DIGIT_ASCENT,
  SUN_TIME_FONT_SIZE,
  sunriseBaselineY,
  sunTimeLabelWidth,
  type SunTimeLabel,
} from "../core/sunTimes";
import { canonicalTimestamp, HOUR_MS } from "../core/timeline";
import type { VerticalCloudProfile } from "../core/types";
import {
  getTextTransform,
  type MeteogramLayout,
  type MeteogramRenderMode,
} from "../core/viewLayout";
import type { WindIconItem } from "../core/wind";
import {
  getSeriesColor,
  getSeriesDashArray,
  getSeriesPreset,
  quantitySlug,
} from "../layouts/seriesPresets";
import { guideShare } from "../layouts/resolution";
import type { ResolvedSeries } from "../layouts/types";
import {
  PRECIPITATION_RAIN_SNOW,
  SNOWFALL_WITH_RAIN,
  splitRainSnow,
} from "../quantities/derived";
import type { QuantityRegistry } from "../quantities/registry";
import {
  cloudProfileBackground,
  type CloudTransitionX,
} from "./cloudProfileBackground";
import {
  axisLabelBox,
  type AxisLabelBox,
  axisLabelHalo,
  axisLabelHeight,
  axisLabelLineHeight,
  axisLabelLines,
  axisLabelWidth,
  compactAxisUnit,
  INSIDE_LEFT_LABEL_X,
  insideRightLabelX,
  MID_LABEL_GAP,
  midLabelCrowds,
  verticalPixel,
  zeroLabelCovers,
} from "./axisLabels";
import { drawingArea } from "./drawingArea";
import {
  thunderstormIconLayer,
  type ThunderstormIcon,
} from "./thunderstormIconLayer";
import { h, type Attrs, type VInput, type VNode } from "./vnode";
import { labelHalo, withHalo } from "./halo";
import { windArrowIcons } from "./windArrowIcons";

export type { CloudTransitionX, ThunderstormIcon, WindIconItem };

/** Everything a series renderer needs besides the area itself. */
export interface ChartAreaContext {
  chartId: string;
  instance: MeteogramRenderMode;
  pixelLayout: MeteogramLayout;
  /** Registry for units, labels and interval quantities. */
  quantities: QuantityRegistry;
  paddingLeft: number;
  paddingRight: number;
  /** Option `axisLabels` of the scene: unit inline or below the value, labels next to the plot or at the edges. */
  axisLabels: { unit: "inline" | "below"; align: "plot" | "edge" | "inside"; compact?: boolean };
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
  /** Sunrise / sunset labels of an area with `sunTimes`. */
  sunTimeLabelsOf: (geometry: AreaGeometry, textScaleX: number) => SunTimeLabel[];
  windIconsOf: (series: ResolvedSeries) => WindIconItem[];
  thunderstormIconsOf: (series: ResolvedSeries) => ThunderstormIcon[];
  /** Stretches where a spread series (`fillTo`, dew point) is drawn (REQ-595); empty: not drawn. */
  spreadStretchesOf: (series: ResolvedSeries) => SpreadStretch[];
  vcloudMap: Map<number, VerticalCloudProfile>;
  draggedCloudX: number | null;
  cloudTransitionXs: CloudTransitionX[];
  separatorStroke: string;
  separatorStrokeWidth: number;
  separatorOpacity: number;
  /** Colours and font sizes. */
  theme: MeteogramTheme;
}

/** Dash pattern of the guide line at half an axis (`midLine`, REQ-653). */
export const MID_LINE_DASH_ARRAY = "4 3";

/** Rounds a label position to 1/100 unit, so computed baselines stay short in the SVG. */
const round2 = (value: number) => Math.round(value * 100) / 100;

// Panel classes the fixed chart had; custom areas get `panel-<name>`.
const PANEL_IDS: Record<string, string> = {
  precipitation: "panel-combined-precip-clouds",
};

/** A guide line of a left axis at its value on the scale drawn (`guides`, REQ-663). */
interface GuideLine {
  /** "mid" for the first, "guide-2", "guide-3" … for the others (test ids, keys). */
  id: string;
  value: number;
  dashed: boolean;
  label: boolean;
}

/** Guide lines of a scale's axis inside its range, in layout order; a share `"n%"` is `min + n % · (max − min)`. */
export function guideLines(scale: ValueScale): GuideLine[] {
  const guides = scale.axis?.guides ?? [];
  const lines: GuideLine[] = [];
  for (const guide of guides) {
    const share = guideShare(guide.at);
    const value =
      share !== null ? scale.min + share * (scale.max - scale.min) : typeof guide.at === "number" ? guide.at : null;
    if (value === null || !Number.isFinite(value) || value < scale.min || value > scale.max) continue;
    lines.push({
      id: lines.length === 0 ? "mid" : `guide-${lines.length + 1}`,
      value,
      dashed: guide.dashed,
      label: guide.label,
    });
  }
  return lines;
}

export function clipIdFor(
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

/** One drawing area: clip paths, axis labels, background and its series. */
export function chartArea({ geometry, scales, context }: ChartAreaProps): VNode {
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
    quantities,
    theme,
  } = context;
  const { fontSizes } = theme;
  const textScaleX = pixelLayout.textScaleX;
  const areaClipId = clipIdFor(context, name);
  const quantityLabel = (quantity: string) => quantities.get(quantity)?.label ?? quantity;
  const unitOf = (scale: ValueScale) =>
    scale.axis?.label ?? quantities.get(scale.quantity)?.unit ?? "";
  const seriesColor = (series: ResolvedSeries) =>
    getSeriesColor(series.quantity, series.color, quantities, theme);

  const drawn: SeriesEntry[] = area.series
    .map((series, index) => ({ series, scale: scales.bySeries[index] ?? null, index }))
    .filter(({ series }) => series.style !== "tooltip");

  // Clip rectangles: the area plus every half / hidden-scale series region.
  const clips = new Map<string, { y: number; height: number }>();
  clips.set(name, { y: top, height });
  for (const { series } of drawn) {
    // Only lines clip to their own region.
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

  // Over the plot (`axisLabels.align` "inside") a halo in the background colour keeps the labels readable on the data,
  // drawn as its own element behind the text (REQ-747).
  const inside = context.axisLabels.align === "inside";
  const halo = inside ? axisLabelHalo(theme) : null;
  const label = (key: string, x: number, y: number, text: string, attrs: Attrs) =>
    withHalo(h("text", { key, x, y, transform: getTextTransform(x, y, textScaleX), ...attrs }, text), halo);

  // Value labels of the axes (option `axisLabels`): at the left or right edge of the chart instead of next to the
  // plot, and the unit in a second line. `y` is the baseline of the value's line for a label hanging down from the
  // top ("top"), the baseline of the last line for one standing on the bottom ("bottom"). Over the plot the left
  // labels keep 1 unit off the chart's edge (REQ-602), the right ones as well (REQ-622).
  const unitBelow = context.axisLabels.unit === "below";
  // Compact labels (REQ-696): values without unit, the unit once below the area, maximum and minimum in its corners
  // 1 px off its edges (1 px: the vertical viewBox length of a CSS pixel of the rendered chart).
  const compact = context.axisLabels.compact === true;
  // Two-line labels (value, unit below it, REQ-738) stand in the corners like compact ones: the maximum hangs 1 px
  // below the area's top edge, the minimum (its unit line) stands 1 px above its bottom edge.
  const cornered = compact || unitBelow;
  const onePx = verticalPixel(pixelLayout.windIconScaleY);
  const atEdge = context.axisLabels.align === "edge" || inside;
  const leftX = inside ? INSIDE_LEFT_LABEL_X : atEdge ? 0 : paddingLeft - 8;
  const leftAnchor = atEdge ? "start" : "end";
  const rightX = inside ? insideRightLabelX(context.svgWidth) : atEdge ? context.svgWidth : outerRightX + 4;
  const rightAnchor = atEdge ? { "text-anchor": "end" } : {};
  const rightSide = atEdge ? "end" : "start";
  const valueLabel = (
    key: string,
    x: number,
    y: number,
    value: string | number,
    unit: string,
    from: "top" | "bottom",
    attrs: Attrs,
  ): VNode => {
    const lines = axisLabelLines(value, unit, unitBelow, compact);
    if (lines.length === 1) return label(key, x, y, lines[0]!, attrs);
    const lineHeight = axisLabelLineHeight(Number(attrs["font-size"] ?? fontSizes.axis));
    const top = from === "top" ? y : y - lineHeight * (lines.length - 1);
    return withHalo(
      h(
        "text",
        {
          key,
          x,
          y: top,
          transform: getTextTransform(x, top, textScaleX),
          "data-lines": lines.length,
          ...attrs,
        },
        lines.map((line, index) => h("tspan", { key: index, x, ...(index > 0 ? { dy: lineHeight } : {}) }, line)),
      ),
      halo,
    );
  };

  // Over the plot in an area with sun times the maximum hangs 1 unit below the sunrise row (REQ-602): the top edge
  // of its digits 1 unit below the row's bottom edge (the sunrise baseline). Beside the plot it cannot touch them.
  const belowSunrise = inside && area.sunTimes;
  const underSunriseY = (fontSize: number) => round2(sunriseBaselineY(top) + 1 + DIGIT_ASCENT * fontSize);

  // Compact labels (REQ-696): baseline of a label hanging in the upper corner (top edge of its digits 1 px below the
  // area's top edge) and of one standing in the lower corner (its bottom edge 1 px above the area's bottom edge).
  const cornerTopY = (fontSize: number) => round2(top + onePx + DIGIT_ASCENT * fontSize);
  const cornerBottomY = round2(bottom - onePx);
  // Over the plot the sunrise row lies in the upper corner as well (REQ-602): a maximum in the corner (compact or two
  // lines, REQ-738) hangs below it only where a sunrise time stands above the label (estimated widths).
  // A sunrise time over the maximum of the left axis (estimated widths) moves right of its line instead (REQ-734):
  // anchored at its start, at the line or just after the label, and kept inside its day.
  const leftMaxSpan = leftAxisMaxSpan(scales.left, {
    x: leftX,
    anchor: leftAnchor,
    fontSize: fontSizes.axis,
    textScaleX: textScaleX ?? 1,
    unit: scales.left ? unitOf(scales.left) : "",
    unitBelow,
    compact,
  });
  const sunLabels = moveSunriseOffAxisLabel(
    area.sunTimes ? context.sunTimeLabelsOf(geometry, textScaleX ?? 1) : [],
    leftMaxSpan,
    textScaleX ?? 1,
  );
  const sunriseAbove = (text: string, x: number, anchor: "start" | "end", fontSize: number) => {
    const width = axisLabelWidth(text, fontSize, textScaleX ?? 1);
    const [from, to] = anchor === "start" ? [x, x + width] : [x - width, x];
    return sunLabels.some((sun) => {
      if (sun.kind !== "sunrise") return false;
      const [sunFrom, sunTo] = sunTimeLabelSpan(sun, textScaleX ?? 1);
      return sunFrom < to && from < sunTo;
    });
  };
  /**
   * Place of a maximum `text` at `x` (`y` its baseline): compact or in two lines (REQ-738) in the corner or below the
   * sunrise row, else as before. `underSunrise`: it hangs below the sunrise row.
   */
  const maxLabelPlace = (text: string, x: number, anchor: "start" | "end", fontSize: number) => {
    const underSunrise = belowSunrise && (!cornered || sunriseAbove(text, x, anchor, fontSize));
    const y = underSunrise ? underSunriseY(fontSize) : cornered ? cornerTopY(fontSize) : top + 14;
    return { y, underSunrise };
  };
  /**
   * Unit of an axis with compact labels (REQ-696), once below the area: the top edge of its letters 1 px below the
   * area's bottom edge, in the gap to the next area (or the room below the last one), on the axis' side, without halo.
   */
  const unitLabel = (key: string, x: number, unit: string, attrs: Attrs): VNode | null => {
    const text = compactAxisUnit(unit);
    if (text === null) return null;
    const fontSize = Number(attrs["font-size"] ?? fontSizes.axis);
    const y = round2(bottom + onePx + DIGIT_ASCENT * fontSize);
    return h(
      "text",
      { key, x, y, transform: getTextTransform(x, y, textScaleX), ...attrs, "data-testid": key },
      text,
    );
  };

  // Guide lines of the left axis (`guides`, REQ-663; `midLine` is the one at half the axis, REQ-653): their values on
  // the scale drawn (for the zero-based wind axis half its maximum), so they follow the axis. The first keeps the test
  // ids of the half-axis line ("axis-mid", "<area>-mid-line"), further ones are numbered from 2.
  const left = scales.left;
  const guides = left && left.max > left.min ? guideLines(left) : [];

  // Left axis labels of the shared scale: maximum, minimum, the label of the zero line and of the guide line.
  const leftLabels: VNode[] = [];
  if (left && left.axis?.showLabels !== false) {
    const unit = unitOf(left);
    const fontSize = fontSizes.axis;
    const common = {
      fill: themeAxisLabelColor(theme, left.quantity),
      "font-size": fontSize,
      "text-anchor": leftAnchor,
    };
    const lineCount = (value: string | number) => axisLabelLines(value, unit, unitBelow, compact).length;
    const maxText = left.preset.formatMax ? left.preset.formatMax(left.max) : `${left.max}`;
    const maxPlace = maxLabelPlace(axisLabelLines(maxText, unit, unitBelow, compact)[0]!, leftX, leftAnchor, fontSize);
    const maxY = maxPlace.y;
    // REQ-696, REQ-738: compact or in two lines, the minimum (the temperature's as well) stands in the lower corner.
    const minY = cornered ? cornerBottomY : bottom - left.preset.minLabelOffset;
    const maxBox = axisLabelBox(maxY, lineCount(maxText), fontSize, "top");
    const minBox = axisLabelBox(minY, lineCount(left.min), fontSize, "bottom");

    // Label of the zero line (REQ-603): "0" with the unit in the line's colour, centred on the line and kept inside
    // the area (over the plot also below the sunrise row, where the maximum starts). It wins over a maximum or minimum
    // it covers by more than 20 % of their height, and over one that reads 0 itself (0 °C at the top or bottom edge).
    let zeroLabel: VNode | null = null;
    let zeroBox: AxisLabelBox | null = null;
    let showMax = true;
    let showMin = true;
    if (left.axis?.zeroLine && left.min <= 0 && left.max >= 0) {
      const height = axisLabelHeight(lineCount(0), fontSize);
      const upper = maxPlace.underSunrise ? maxBox.top : top;
      const centred = valueToY(left, 0) - height / 2;
      const boxTop = Math.max(upper, Math.min(bottom - height, centred));
      zeroBox = { top: boxTop, bottom: boxTop + height };
      zeroLabel = valueLabel("axis-zero", leftX, round2(boxTop + DIGIT_ASCENT * fontSize), 0, unit, "top", {
        ...common,
        fill: theme.grid.freezingLine,
        "data-testid": "axis-zero",
      });
      showMax = left.max !== 0 && !zeroLabelCovers(zeroBox, maxBox);
      showMin = left.min !== 0 && !zeroLabelCovers(zeroBox, minBox);
    }
    if (showMax) leftLabels.push(valueLabel("axis-max", leftX, maxY, maxText, unit, "top", common));
    if (showMin) leftLabels.push(valueLabel("axis-min", leftX, minY, left.min, unit, "bottom", common));

    // Label of the guide line at half the axis (REQ-653, DEC-060): its value rounded to a whole number like the other
    // labels ("38 km/h" on a line at 37.5 km/h), a step fainter, centred on the line. It must fit between the
    // maximum and the minimum, at least `MID_LABEL_GAP` off each, inside the area and clear of the zero line's label;
    // else (a short area) it is left out and the line stays.
    for (const guide of guides) {
      if (!guide.label) continue;
      const midValue = guide.value;
      const text = Math.round(midValue);
      const height = axisLabelHeight(lineCount(text), fontSize);
      const boxTop = valueToY(left, midValue) - height / 2;
      const midBox = { top: boxTop, bottom: boxTop + height };
      const upper = showMax ? maxBox.bottom + MID_LABEL_GAP : top;
      const lower = showMin ? minBox.top - MID_LABEL_GAP : bottom;
      const fits = midBox.top >= upper && midBox.bottom <= lower && !(zeroBox && midLabelCrowds(midBox, zeroBox));
      if (fits) {
        leftLabels.push(
          valueLabel(`axis-${guide.id}`, leftX, round2(boxTop + DIGIT_ASCENT * fontSize), text, unit, "top", {
            ...common,
            fill: theme.axis.midLabel,
            "data-testid": `axis-${guide.id}`,
          }),
        );
      }
    }
    // Drawn last: over a maximum or minimum it may cover by up to 20 %.
    if (zeroLabel) leftLabels.push(zeroLabel);
    // REQ-696: compact, the unit once below the area.
    const unitNode = compact ? unitLabel("axis-unit", leftX, unit, common) : null;
    if (unitNode) leftLabels.push(unitNode);
  }

  // Half scales (CAPE upwards, CIN downwards) share the zero label.
  const halfLabels: VNode[] = [];
  const halves = drawn.filter(
    ({ series, scale }) =>
      series.half && series.axis === "left" && scale && series.style !== "line",
  );
  if (zeroY !== null && halves.length > 0) {
    const halfLabel = ({ series, scale }: SeriesEntry) => {
      const unit = unitOf(scale!);
      const color = themeHalfAxisLabelColor(theme, scale!.quantity);
      const upper = series.half === "upper";
      // REQ-696, REQ-738: compact or in two lines, the upper maximum in the upper corner, the lower one in the lower
      // corner.
      const y = cornered ? (upper ? cornerTopY(fontSizes.axisHalf) : cornerBottomY) : upper ? top + 12 : bottom - 3;
      return [
        valueLabel(
          `${series.quantity}-max`,
          leftX,
          y,
          upper ? scale!.max : `−${scale!.max}`,
          unit,
          upper ? "top" : "bottom",
          { fill: color, "font-size": fontSizes.axisHalf, "text-anchor": leftAnchor },
        ),
        label(`${series.quantity}-name`, paddingLeft + 4, y, quantityLabel(series.quantity), {
          fill: color,
          "font-size": fontSizes.axis,
        }),
      ];
    };
    halfLabels.push(
      ...halves.filter(({ series }) => series.half === "upper").flatMap(halfLabel),
      valueLabel("zero", leftX, zeroY + 3, 0, unitOf(halves[0]!.scale!), "top", {
        fill: theme.axis.zero,
        "font-size": fontSizes.axis,
        "text-anchor": leftAnchor,
      }),
      ...halves.filter(({ series }) => series.half === "lower").flatMap(halfLabel),
    );
    // REQ-696: compact, the unit of the half axes once below the area (each different unit once).
    if (compact) {
      const units = [...new Set(halves.map(({ scale }) => unitOf(scale!)).filter((unit) => compactAxisUnit(unit)))];
      const unitNode = unitLabel("half-unit", leftX, units.join(" · "), {
        fill: themeHalfAxisLabelColor(theme, halves[0]!.scale!.quantity),
        "font-size": fontSizes.axisHalf,
        "text-anchor": leftAnchor,
      });
      if (unitNode) halfLabels.push(unitNode);
    }
  }

  const rightAxisLabels = (scale: ValueScale, series: ResolvedSeries) => {
    const unit = unitOf(scale);
    if (scale.preset.unnamedRightLabels) {
      // Relative humidity (REQ-649): "100 %" and "0 %" in the line's colour, level with the left axis' labels.
      const fontSize = fontSizes.axis;
      const attrs = { fill: seriesColor(series), "font-size": fontSize, ...rightAnchor };
      const maxText = axisLabelLines(scale.max, unit, unitBelow, compact)[0]!;
      // REQ-696: compact, maximum and minimum in the corners and the unit once below the area; in two lines in the
      // corners as well (REQ-738).
      const maxY = maxLabelPlace(maxText, rightX, rightSide, fontSize).y;
      const minY = cornered ? cornerBottomY : bottom - scale.preset.minLabelOffset;
      return [
        valueLabel("right-max", rightX, maxY, scale.max, unit, "top", attrs),
        valueLabel("right-min", rightX, minY, scale.min, unit, "bottom", attrs),
        compact && unitLabel("right-unit", rightX, unit, attrs),
      ];
    }
    const common = {
      fill: themeAxisLabelColor(theme, scale.quantity),
      "font-size": fontSizes.axisRight,
      ...rightAnchor,
    };
    if (compact) {
      // REQ-696: the maximum in the upper corner, the name of the quantity one line below it, the minimum in the lower
      // corner, the unit once below the area.
      const maxY = cornerTopY(fontSizes.axisRight);
      const nameGap = axisLabelLineHeight(fontSizes.axisRight);
      return [
        valueLabel("right-max", rightX, maxY, scale.max, unit, "top", common),
        label("right-name", rightX, round2(maxY + nameGap), quantityLabel(series.quantity), common),
        label("right-min", rightX, cornerBottomY, `${scale.min}`, common),
        unitLabel("right-unit", rightX, unit, common),
      ];
    }
    if (unitBelow) {
      // REQ-738: in two lines, the maximum in the upper corner with its unit below it, the name of the quantity one
      // line below the unit, the minimum in the lower corner.
      const maxY = cornerTopY(fontSizes.axisRight);
      const lineHeight = axisLabelLineHeight(fontSizes.axisRight);
      const maxLines = axisLabelLines(scale.max, unit, unitBelow, compact).length;
      return [
        valueLabel("right-max", rightX, maxY, scale.max, unit, "top", common),
        label("right-name", rightX, round2(maxY + lineHeight * maxLines), quantityLabel(series.quantity), common),
        label("right-min", rightX, cornerBottomY, `${scale.min}`, common),
      ];
    }
    return [
      label("right-name", rightX, scale.top + 9, quantityLabel(series.quantity), common),
      valueLabel("right-max", rightX, scale.top + 18, scale.max, unit, "top", common),
      label("right-min", rightX, scale.bottom - 2, `${scale.min}`, common),
    ];
  };
  const firstRightIndex = drawn.find(({ series }) => series.axis === "right")?.index;

  // Width of one hour on the time axis: how far apart the anchors of a dashed line are (REQ-579).
  const hourWidth = timestamps.length > 0 ? getX(timestamps[0]! + HOUR_MS) - getX(timestamps[0]!) : 0;

  // Spread series (dew point, REQ-595): per stretch the fill between the series and its `fillTo` line, then the line,
  // both clipped to the area, so a dew point below the axis is cut off at its bottom. Nothing without stretches.
  const renderSpread = (entry: SeriesEntry, clipId: string): VNode[] => {
    const { series, scale } = entry;
    const stretches = context.spreadStretchesOf(series);
    if (!scale || stretches.length === 0) return [];
    const preset = getSeriesPreset(series.quantity);
    const slug = quantitySlug(series.quantity);
    const color = seriesColor(series);
    const strokeWidth = series.strokeWidth ?? preset.strokeWidth ?? 1.5;
    const dashArray = getSeriesDashArray(series.quantity, series.dashed);
    const point = (time: number, value: number) =>
      `${getX(time).toFixed(1)} ${valueToY(scale, value).toFixed(1)}`;
    const ends = (stretch: SpreadStretch) => ({
      "data-start": new Date(Math.round(stretch[0]!.time)).toISOString(),
      "data-end": new Date(Math.round(stretch[stretch.length - 1]!.time)).toISOString(),
    });
    const fills = stretches.map((stretch) => {
      const upper = stretch.map(({ time, upper: value }) => point(time, value));
      const lower = stretch.map(({ time, lower: value }) => point(time, value)).reverse();
      return h("path", {
        d: `M ${upper.join(" L ")} L ${lower.join(" L ")} Z`,
        fill: color,
        "fill-opacity": series.fillOpacity,
        stroke: "none",
        "clip-path": `url(#${clipId})`,
        "data-testid": preset.fillTestId ?? `${slug}-fill`,
        ...ends(stretch),
      });
    });
    // A dashed dew point line keeps its dashes at their time like the other lines (REQ-579).
    const lines = stretches.flatMap((stretch) => {
      const d = `M ${stretch.map(({ time, lower }) => point(time, lower)).join(" L ")}`;
      const attrs = {
        fill: "none",
        stroke: color,
        "stroke-width": strokeWidth,
        "stroke-dasharray": dashArray,
        "stroke-linecap": dashArray ? undefined : preset.lineCap,
        "clip-path": `url(#${clipId})`,
        "data-testid": preset.testId ?? `${slug}-path`,
        ...ends(stretch),
      };
      const pieces = dashArray ? anchoredDashPieces(d, dashArray, hourWidth, timeline.xToTimestamp) : null;
      if (!pieces) return [h("path", { d, ...attrs })];
      return pieces.map((piece) => h("path", { d: piece.d, pathLength: piece.pathLength, ...attrs }));
    });
    // The fills lie behind every line of the area, also behind the series' own.
    return [...fills, ...lines];
  };

  const renderLine = (entry: SeriesEntry, clipId: string): VNode[] => {
    const { series, scale } = entry;
    if (!scale) return [];
    if (series.fillTo) return renderSpread(entry, clipId);
    const preset = getSeriesPreset(series.quantity);
    const color = seriesColor(series);
    const strokeWidth = series.strokeWidth ?? preset.strokeWidth ?? 1.5;
    const dashArray = getSeriesDashArray(series.quantity, series.dashed);
    const testId = preset.testId ?? `${quantitySlug(series.quantity)}-path`;
    const values = context.valuesOf(series.quantity);
    // A dashed line is drawn in pieces between anchor times, each stretched to a whole number of dash periods
    // (`pathLength`): the pattern stays even, also where an hour is narrower than one period, and its dashes stay at
    // their time when another piece changes (REQ-572, REQ-579). Pieces outside the visible window are left out.
    const linePaths = (d: string, attrs: Attrs): VNode[] => {
      const pieces = dashArray ? anchoredDashPieces(d, dashArray, hourWidth, timeline.xToTimestamp) : null;
      if (!pieces) return [h("path", { d, ...attrs })];
      return pieces
        .filter((piece) => piece.maxX >= outerLeftX - strokeWidth && piece.minX <= outerRightX + strokeWidth)
        .map((piece) => h("path", { d: piece.d, pathLength: piece.pathLength, ...attrs }));
    };

    if (quantities.get(series.quantity)?.kind === "interval") {
      const segments = buildHeldSegments(
        timestamps,
        (ts) => context.heldPointAt(series.quantity, ts),
        (value) => valueToY(scale, value),
        getX,
        timeline.endMs,
        HOUR_MS,
      );
      return segments.flatMap((segment, index) =>
        linePaths(segment.path, {
          key: index,
          fill: "none",
          stroke: color,
          "stroke-width": strokeWidth,
          "stroke-dasharray": dashArray,
          "clip-path": `url(#${clipId})`,
          "data-testid": testId,
          "data-model": segment.model,
          "data-scale-min": scale.min,
          "data-scale-max": scale.max,
          "data-scale-top": scale.top,
          "data-scale-bottom": scale.bottom,
        }),
      );
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
    const paths = linePaths(dashArray ? pathOf(values) : pathOf(values, stops), {
      fill: "none",
      stroke: color,
      "stroke-width": strokeWidth,
      "stroke-dasharray": dashArray,
      // Round caps would close the gaps of a fine dash.
      "stroke-linecap": dashArray ? undefined : preset.lineCap,
      "clip-path": `url(#${clipId})`,
      "data-testid": testId,
      "data-scale-top": scale.clamped ? scale.top : undefined,
      "data-scale-bottom": scale.clamped ? scale.bottom : undefined,
    });
    if (separateStops) {
      paths.push(
        h("path", {
          d: pathOf(
            values.map((value, idx) => (stops!.has(idx) ? value : null)),
            stops,
          ),
          fill: "none",
          stroke: color,
          "stroke-width": strokeWidth,
          "clip-path": `url(#${clipId})`,
          "data-testid": preset.stopsTestId ?? `${testId}-stops`,
        }),
      );
    }
    return paths;
  };

  const renderBars = ({ series, scale }: SeriesEntry): VInput[] => {
    if (!scale) return [];
    const preset = getSeriesPreset(series.quantity);
    const color = seriesColor(series);
    const testId = preset.testId ?? `${quantitySlug(series.quantity)}-bar`;
    const values = context.valuesOf(series.quantity);
    // Snow hours of precipitation bars: `snowFrom` or the derived quantity.
    const snowSource =
      series.snowFrom ?? (series.quantity === PRECIPITATION_RAIN_SNOW ? "snowfall" : null);
    const snowValues = snowSource ? context.valuesOf(snowSource) : null;
    const withRain = series.quantity === SNOWFALL_WITH_RAIN;
    const precipValues = withRain ? context.valuesOf("precipitation") : null;
    const snowfallValues = withRain ? context.valuesOf("snowfall") : null;
    const baseY = scale.bottom - scale.paddingBottom;
    return values.map((value, idx) => {
      if (value === null || value <= 0) return null;
      const cell = timeline.intervalToGeometry(timestamps[idx]!);
      if (!cell) return null;
      const timestamp = canonicalTimestamp(timestamps[idx]!);
      if (withRain) {
        // Snow at the bottom, the rain part (snow-equivalent cm) on top.
        const parts = splitRainSnow(precipValues![idx], snowfallValues![idx]);
        if (!parts) return null;
        const snowHeight =
          parts.snowCm > 0 ? Math.max(1.5, valueToOffset(scale, parts.snowCm)) : 0;
        const rainHeight =
          parts.rainCm > 0 ? Math.max(1.5, valueToOffset(scale, parts.rainCm)) : 0;
        return [
          snowHeight > 0 &&
            h("rect", {
              x: cell.x,
              y: baseY - snowHeight,
              width: cell.width,
              height: snowHeight,
              fill: color,
              stroke: preset.outlined ? theme.snow.outline : "none",
              "stroke-width": preset.outlined ? 1 : 0,
              opacity: preset.opacity ?? 1,
              "data-testid": testId,
              "data-timestamp": timestamp,
            }),
          rainHeight > 0 &&
            h("rect", {
              x: cell.x,
              y: baseY - snowHeight - rainHeight,
              width: cell.width,
              height: rainHeight,
              fill: getSeriesColor("precipitation", null, quantities, theme),
              opacity: getSeriesPreset("precipitation").opacity ?? 0.85,
              "data-testid": `${testId}-rain`,
              "data-timestamp": timestamp,
            }),
        ];
      }
      const isSnow = (snowValues?.[idx] ?? 0) > 0;
      const outline = isSnow || preset.outlined ? theme.snow.outline : undefined;
      const barHeight = Math.max(1.5, valueToOffset(scale, value));
      return h("rect", {
        key: `${series.quantity}-bar-${idx}`,
        x: cell.x,
        y: baseY - barHeight,
        width: cell.width,
        height: barHeight,
        fill: isSnow ? theme.snow.fill : color,
        stroke: outline ?? "none",
        "stroke-width": outline ? 1 : 0,
        opacity: isSnow ? 1 : (preset.opacity ?? 0.85),
        "data-testid": testId,
        "data-timestamp": timestamp,
      });
    });
  };

  const renderAreaBars = ({ series, scale }: SeriesEntry): VInput[] => {
    if (!scale) return [];
    const preset = getSeriesPreset(series.quantity);
    const color = seriesColor(series);
    const testId = preset.testId ?? `${quantitySlug(series.quantity)}-bar`;
    const lower = series.half === "lower";
    return context.valuesOf(series.quantity).map((value, index) => {
      if (value === null || value === 0) return null;
      const cell = timeline.intervalToGeometry(timestamps[index]!);
      if (!cell) return null;
      const barHeight = valueToOffset(
        scale,
        series.half === "upper" ? Math.max(0, value) : value,
      );
      const baseY = lower ? scale.top : scale.bottom - scale.paddingBottom;
      return h("rect", {
        key: `${series.quantity}-${index}`,
        x: cell.x,
        width: cell.width,
        y: lower ? baseY : baseY - barHeight,
        height: barHeight,
        fill: color,
        opacity: `${preset.opacity ?? 0.75}`,
        "data-testid": testId,
        "data-zero-y": zeroY ?? undefined,
        "data-timestamp": canonicalTimestamp(timestamps[index]!),
      });
    });
  };

  /** Drawn nodes of a series; `null` when the style draws nothing. */
  const renderSeries = (entry: SeriesEntry, clipId: string): VInput[] | null => {
    switch (entry.series.style) {
      case "line":
        return renderLine(entry, clipId);
      case "bars":
        return renderBars(entry);
      case "area":
        return renderAreaBars(entry);
      case "arrows":
        return windArrowIcons({
          icons: context.windIconsOf(entry.series),
          y: top + 14,
          layout: pixelLayout,
          instance: context.instance,
          theme,
        });
      case "icons":
        return thunderstormIconLayer({
          icons: context.thunderstormIconsOf(entry.series),
          top,
          getX,
          layout: pixelLayout,
          instance: context.instance,
          theme,
        });
      default:
        return null;
    }
  };

  // Layered series get their own group; consecutive plain series share the
  // clipped plot group of the area.
  const zeroLineAxis = scales.left?.axis?.zeroLine ? scales.left : null;
  const zeroReference =
    zeroLineAxis && zeroLineAxis.min <= 0 && zeroLineAxis.max >= 0
      ? h(
          "g",
          { key: "freezing-reference-group", class: "freezing-reference-group" },
          h("line", {
            x1: paddingLeft,
            y1: valueToY(zeroLineAxis, 0),
            x2: context.svgWidth - context.paddingRight,
            y2: valueToY(zeroLineAxis, 0),
            stroke: theme.grid.freezingLine,
            "stroke-width": context.separatorStrokeWidth,
            "clip-path": `url(#${areaClipId})`,
            "data-testid": "freezing-line",
          }),
        )
      : null;
  let zeroReferencePending = zeroReference !== null;

  const halfZeroLine =
    zeroY !== null
      ? h("line", {
          key: "half-zero-line",
          x1: outerLeftX,
          x2: outerRightX,
          y1: zeroY,
          y2: zeroY,
          stroke: theme.axis.zero,
          "stroke-width": "1.5",
          "data-testid": "convective-zero-line",
        })
      : null;
  let halfZeroPending = halfZeroLine !== null;

  const blocks: VInput[] = [];
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
    const withHalfArea = entries.some(({ series }) => series.half && series.style !== "line");
    blocks.push(
      drawingArea(
        {
          bounds: { top, height, left: paddingLeft, width: graphWidth },
          clipId: areaClipId,
          className: `${name}-plot-area`,
          testId: `${name}-plot-area`,
        },
        [
          zeroReferencePending && zeroReference,
          entries.map((entry) =>
            renderSeries(entry, clipIdFor(context, seriesClipName(geometry, entry.series))),
          ),
          extremes.length > 0 && dailyExtremeLabels(extremes, theme, textScaleX),
        ],
      ),
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
    const hasAxisLabels = entry.index === firstRightIndex && entry.scale !== null;
    if (hasAxisLabels) {
      // Axis and line only exist where a model delivers the quantity. Only
      // list-drawn series (bars, areas, interval lines)
      // carry the right axis labels in a layer.
      const listDrawn =
        entry.series.style === "bars" ||
        entry.series.style === "area" ||
        (entry.series.style === "line" &&
          quantities.get(entry.series.quantity)?.kind === "interval");
      if (!listDrawn || !rendered || rendered.length === 0) continue;
      blocks.push(
        h(
          "g",
          { key: `layer-${entry.index}`, "data-testid": preset.layerTestId },
          entry.scale!.axis?.showLabels !== false &&
            rightAxisLabels(entry.scale!, entry.series),
          rendered,
        ),
      );
      continue;
    }
    blocks.push(
      h(
        "g",
        {
          key: `layer-${entry.index}`,
          class: preset.layerTestId,
          "data-testid": preset.layerTestId,
          "clip-path": `url(#${
            entry.series.style === "bars" || entry.series.style === "icons"
              ? areaClipId
              : clipId
          })`,
          "pointer-events": entry.series.style === "icons" ? "none" : undefined,
        },
        rendered,
      ),
    );
  }
  flushChunk();
  if (area.sunTimes) {
    if (sunLabels.length > 0) {
      // Background: behind the curves and the daily min/max labels.
      blocks.unshift(sunTimeLabels(sunLabels, theme.sunTimes, textScaleX));
    }
  }
  if (zeroReferencePending) blocks.unshift(zeroReference);
  if (halfZeroPending) blocks.push(halfZeroLine);
  // Guide line at half the left axis (REQ-653): thin, dashed, in the grid colour, behind the series and the arrows.
  if (left) {
    for (const guide of [...guides].reverse()) {
      const y = round2(valueToY(left, guide.value));
      blocks.unshift(
        h("line", {
          key: `${guide.id}-line`,
          x1: paddingLeft,
          y1: y,
          x2: context.svgWidth - context.paddingRight,
          y2: y,
          stroke: theme.grid.line,
          "stroke-width": 1,
          "stroke-dasharray": guide.dashed ? MID_LINE_DASH_ARRAY : undefined,
          "clip-path": `url(#${areaClipId})`,
          "pointer-events": "none",
          "data-testid": `${name}-${guide.id}-line`,
          "data-value": guide.value,
        }),
      );
    }
  }

  const rightScale = scales.right;
  const plainRightLabels =
    rightScale &&
    rightScale.axis?.showLabels !== false &&
    firstRightIndex !== undefined &&
    !getSeriesPreset(area.series[firstRightIndex]!.quantity).layerTestId
      ? rightAxisLabels(rightScale, area.series[firstRightIndex]!)
      : null;

  const background =
    area.background &&
    cloudProfileBackground({
      geometry,
      background: area.background,
      hasData: geometry.hasBackground,
      context,
      clipId: areaClipId,
    });
  return h(
    "g",
    {
      key: area.id,
      class: `panel ${PANEL_IDS[name] ?? `panel-${name}`}`,
      "data-testid": PANEL_IDS[name] ?? `panel-${name}`,
      "data-area-id": area.id,
    },
    h(
      "defs",
      null,
      [...clips].map(([clipName, rect]) =>
        h(
          "clipPath",
          { key: clipName, id: clipIdFor(context, clipName) },
          h("rect", { x: outerLeftX, y: rect.y, width: graphWidth, height: rect.height }),
        ),
      ),
    ),
    !inside && [leftLabels, halfLabels, plainRightLabels],
    !inside && background,
    inside && background?.slice(1),
    blocks,
    // Labels over the plot come after the data, the cloud altitudes among them.
    inside && [background?.[0], leftLabels, halfLabels, plainRightLabels],
  );
}

/** Horizontal extent [from, to] of a sun time label (estimated width) as drawn with its anchor. */
export function sunTimeLabelSpan(label: SunTimeLabel, textScaleX = 1): [number, number] {
  const width = sunTimeLabelWidth(label.text, textScaleX);
  return label.anchor === "start" ? [label.x, label.x + width] : [label.x - width / 2, label.x + width / 2];
}

/**
 * Horizontal extent [from, to] of the maximum label of the left axis `scale` (first line, estimated width), or null
 * without labels.
 */
function leftAxisMaxSpan(
  scale: ValueScale | null | undefined,
  options: {
    x: number;
    anchor: "start" | "end";
    fontSize: number;
    textScaleX: number;
    unit: string;
    unitBelow: boolean;
    compact: boolean;
  },
): [number, number] | null {
  if (!scale || scale.axis?.showLabels === false) return null;
  const maxText = scale.preset.formatMax ? scale.preset.formatMax(scale.max) : `${scale.max}`;
  const text = axisLabelLines(maxText, options.unit, options.unitBelow, options.compact)[0]!;
  const width = axisLabelWidth(text, options.fontSize, options.textScaleX);
  return options.anchor === "start" ? [options.x, options.x + width] : [options.x - width, options.x];
}

/** Gap (viewBox units) between an axis label and a sunrise time moved right of it (REQ-734). */
const SUNRISE_AXIS_GAP = 2;

/**
 * Sunrise times that would stand over the left axis' maximum (`span`, estimated widths) move right of their line
 * (REQ-734): anchored at their start, at the line or `SUNRISE_AXIS_GAP` after the label, whichever is further right,
 * and kept inside their day. Other labels stay as they are.
 */
export function moveSunriseOffAxisLabel(
  labels: SunTimeLabel[],
  span: [number, number] | null,
  textScaleX = 1,
): SunTimeLabel[] {
  if (!span) return labels;
  const [from, to] = span;
  return labels.map((label) => {
    if (label.kind !== "sunrise") return label;
    const [labelFrom, labelTo] = sunTimeLabelSpan(label, textScaleX);
    if (!(labelFrom < to && from < labelTo)) return label;
    const width = sunTimeLabelWidth(label.text, textScaleX);
    const start = Math.max(label.lineX ?? label.x, to + SUNRISE_AXIS_GAP);
    const x = label.dayEndX === undefined ? start : Math.min(start, label.dayEndX - width);
    return { ...label, x: Math.round(x * 100) / 100, anchor: "start" };
  });
}

/** Sunrise / sunset times (in the light theme the chart frame grey). */
function sunTimeLabels(
  labels: SunTimeLabel[],
  fill: string,
  textScaleX?: number,
): VNode {
  return h(
    "g",
    { key: "sun-times", class: "sun-time-labels", "pointer-events": "none", "data-testid": "sun-time-labels" },
    labels.map((label) =>
      h(
        "text",
        {
          key: `${label.kind}-${label.dayKey}`,
          x: label.x,
          y: label.y,
          transform: getTextTransform(label.x, label.y, textScaleX),
          fill,
          "font-size": SUN_TIME_FONT_SIZE,
          "font-weight": "600",
          "text-anchor": label.anchor ?? "middle",
          "data-testid": label.kind,
          "data-day": label.dayKey,
        },
        label.text,
      ),
    ),
  );
}

function dailyExtremeLabels(
  items: DailyExtremeItem[],
  theme: MeteogramTheme,
  textScaleX?: number,
): VNode[] {
  // The halo is its own element behind the value (REQ-747).
  const extremeText = (
    point: { x: number; y: number; text: string },
    fill: string,
    testId: string,
  ) =>
    withHalo(
      h(
        "text",
        {
          x: point.x,
          y: point.y,
          transform: getTextTransform(point.x, point.y, textScaleX),
          fill,
          "font-size": theme.fontSizes.extremes,
          "font-weight": "700",
          "text-anchor": "middle",
          "data-testid": testId,
        },
        point.text,
      ),
      labelHalo(theme.extremes.halo),
    );
  return items.map((item) =>
    h(
      "g",
      { key: `daily-temp-${item.dayKey}`, class: "daily-temp-extremes", "pointer-events": "none" },
      item.max.visible && extremeText(item.max, theme.extremes.max, "daily-max-temp"),
      item.min.visible && extremeText(item.min, theme.extremes.min, "daily-min-temp"),
    ),
  );
}
