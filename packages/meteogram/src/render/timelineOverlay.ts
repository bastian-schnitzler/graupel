// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { DAY_HEADER_FONT_SIZE } from "../core/chartGeometry";
import type { DayGroupRenderItem, NoonPositionItem } from "../core/drawingTypes";
import { LIGHT_THEME, type MeteogramTheme } from "../core/theme";
import { canonicalTimestamp } from "../core/timeline";
import { getTextTransform } from "../core/viewLayout";
import { h, type VInput } from "./vnode";
import { labelHalo, withHalo } from "./halo";

export interface ModelSegmentItem {
  modelName?: string;
  name?: string;
  startX: number;
  endX?: number;
}

/** Vertical band of one drawing area (top/bottom in viewBox units). */
export interface OverlayArea {
  name: string;
  top: number;
  bottom: number;
}

export interface TerrainMaskItem {
  groundY: number;
  bottom: number;
  elevationKm: number;
}

export interface TimelineOverlayProps {
  dayGroups: DayGroupRenderItem[];
  noonPositions: NoonPositionItem[];
  modelSegments: ModelSegmentItem[];
  dayHeaderTop: number;
  dayHeaderBottom: number;
  dayHeaderHeight: number;
  /** Drawing areas from top to bottom (at least one). */
  areas: OverlayArea[];
  outerLeftX: number;
  outerRightX: number;
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  modelHeaderBoxBottom: number;
  /** Model boundaries of the weather chain, thin solid lines (layout `showModelHeaders`, REQ-524). */
  showModelBoundaries?: boolean;
  /** Day label cells and texts (layout `showDayHeader`). */
  showDayHeader?: boolean;
  terrainMask?: TerrainMaskItem | null;
  graphWidth: number;
  timeline: {
    xToTimestamp: (x: number) => number;
  };
  separatorStroke?: string;
  separatorStrokeWidth?: number;
  separatorOpacity?: number;
  textScaleX?: number;
  /** Colours and font sizes (default `light`). */
  theme?: MeteogramTheme;
}

/**
 * Time grid of the chart: day blocks with alternating tint and day labels,
 * day separators, noon grid lines, area borders, terrain mask and model
 * boundaries. The terrain line and its elevation label are drawn separately
 * (`terrainMaskLabel`), above the areas.
 */
export function timelineOverlay({
  dayGroups,
  noonPositions,
  modelSegments,
  dayHeaderTop,
  dayHeaderBottom,
  dayHeaderHeight,
  areas,
  outerLeftX,
  outerRightX,
  paddingLeft,
  paddingRight,
  svgWidth,
  modelHeaderBoxBottom,
  showModelBoundaries = true,
  showDayHeader = true,
  terrainMask,
  graphWidth,
  timeline,
  theme = LIGHT_THEME,
  separatorStroke = theme.grid.line,
  separatorStrokeWidth = 1.2,
  separatorOpacity = 1,
  textScaleX = 1,
}: TimelineOverlayProps): VInput[] {
  const firstArea = areas[0];
  const plotBottom = areas[areas.length - 1]?.bottom ?? dayHeaderBottom;
  // The first area joins the day header: its day separators and right edge
  // start at the header top, its tint and noon lines at the header bottom.
  const tintBands = areas.map((area, index) =>
    index === 0
      ? { name: area.name, top: dayHeaderBottom, bottom: area.bottom }
      : area,
  );
  const separatorBands = areas.map((area, index) =>
    index === 0 ? { name: area.name, top: dayHeaderTop, bottom: area.bottom } : area,
  );
  const borders = [
    { y: dayHeaderTop, edge: "date-header-top" },
    ...areas.flatMap((area, index) =>
      index === 0
        ? [
            // The first area is closed at the top as well (REQ-594).
            { y: area.top, edge: `${area.name}-top` },
            { y: area.bottom, edge: `${area.name}-bottom` },
          ]
        : [
            { y: area.top, edge: `${area.name}-top` },
            { y: area.bottom, edge: `${area.name}-bottom` },
          ],
    ),
  ];

  return [
    // Day groups: alternating tint, day label cells and separators
    dayGroups.map((group) =>
      h(
        "g",
        { key: group.dayKey, class: "day-group-block" },
        group.isEven
          ? tintBands.map((band) =>
              h("rect", {
                key: band.name,
                x: group.firstX,
                y: band.top,
                width: group.blockWidth,
                height: band.bottom - band.top,
                fill: theme.grid.dayTint,
              }),
            )
          : firstArea &&
              h("rect", {
                x: group.firstX,
                y: dayHeaderBottom,
                width: group.blockWidth,
                height: firstArea.bottom - dayHeaderBottom,
                fill: "transparent",
              }),
        showDayHeader &&
          h("rect", {
            x: group.firstX,
            y: dayHeaderTop,
            width: group.blockWidth,
            height: dayHeaderHeight,
            fill: theme.dayHeader.background,
            "data-testid": "day-label-cell",
          }),
        // Day-boundary lines stopping at white separators
        group.isBoundaryVisible &&
          separatorBands.map((band) =>
            h("line", {
              key: band.name,
              x1: group.boundaryX,
              y1: band.top,
              x2: group.boundaryX,
              y2: band.bottom,
              stroke: separatorStroke,
              "stroke-width": separatorStrokeWidth,
              opacity: separatorOpacity,
              class: "chart-separator-line",
              "data-testid": "day-separator-line",
            }),
          ),
        showDayHeader && dayLabelText(group, dayHeaderTop, textScaleX, theme),
      ),
    ),

    // Noon dotted grid lines (12:00 local time per day)
    noonPositions.map((noon) =>
      h(
        "g",
        { key: `noon-grid-${noon.dayKey}`, class: "noon-grid-group" },
        tintBands.map((band) =>
          h("line", {
            key: band.name,
            x1: noon.x,
            y1: band.top,
            x2: noon.x,
            y2: band.bottom,
            stroke: theme.grid.noon,
            "stroke-dasharray": "2 3",
            class: "chart-separator-line",
            "data-testid": "noon-grid-line",
          }),
        ),
      ),
    ),

    // Shared grey grid borders
    h(
      "g",
      { class: "chart-area-separator-borders" },
      borders.map(({ y, edge }) =>
        h("line", {
          key: edge,
          x1: outerLeftX,
          y1: y,
          x2: outerRightX,
          y2: y,
          stroke: separatorStroke,
          "stroke-width": separatorStrokeWidth,
          opacity: separatorOpacity,
          class: "chart-separator-line",
          "data-testid": "chart-area-horizontal-border",
          "data-edge": edge,
        }),
      ),
      separatorBands.map(({ top, bottom, name }) =>
        h("line", {
          key: name,
          x1: outerRightX,
          y1: top,
          x2: outerRightX,
          y2: bottom,
          stroke: separatorStroke,
          "stroke-width": separatorStrokeWidth,
          opacity: separatorOpacity,
          class: "chart-separator-line",
          "data-testid": "outer-right-day-separator-line",
          "data-area": name,
        }),
      ),
    ),

    // Terrain / elevation overlay
    terrainMask &&
      terrainMask.elevationKm > 0 &&
      h(
        "g",
        { class: "terrain-mask-group", "data-testid": "terrain-mask" },
        h("rect", {
          x: paddingLeft,
          y: terrainMask.groundY,
          width: graphWidth,
          height: terrainMask.bottom - terrainMask.groundY,
          fill: theme.terrain.fill,
          opacity: "0.8",
        }),
      ),

    // Model transition boundary lines
    showModelBoundaries &&
      modelSegments.slice(1).map((seg, idx) => {
        if (seg.startX <= paddingLeft + 1 || seg.startX >= svgWidth - paddingRight - 1) {
          return null;
        }
        return h(
          "g",
          { key: `model-boundary-${idx}`, class: "model-boundary-group" },
          h("line", {
            x1: seg.startX,
            y1: modelHeaderBoxBottom,
            x2: seg.startX,
            y2: plotBottom,
            stroke: theme.modelHeader.boundary,
            "stroke-width": "1",
            opacity: String(theme.modelHeader.boundaryOpacity),
            "data-testid": "model-boundary-line",
            "data-timestamp": canonicalTimestamp(timeline.xToTimestamp(seg.startX)),
          }),
        );
      }),
  ];
}

/** Average glyph width of the bold day label, relative to the font size. */
export const DAY_LABEL_CHAR_WIDTH = 0.62;
/** Width of a space or a period in the day label, relative to the font size. */
export const DAY_LABEL_NARROW_CHAR_WIDTH = 0.3;
/** Free space a day label keeps to each edge of its day (viewBox units, REQ-669). */
export const DAY_LABEL_PADDING = 2;

export interface DayLabel {
  text: string;
  fontSize: number;
}

/**
 * Estimated width of a day label in viewBox units, without a DOM: its
 * characters times their average glyph width (narrower for space and
 * period), stretched by the horizontal text scale of the view (`textScaleX`).
 */
export function estimateDayLabelWidth(text: string, fontSize: number, textScaleX = 1): number {
  let units = 0;
  for (const char of text) {
    units += char === " " || char === "." ? DAY_LABEL_NARROW_CHAR_WIDTH : DAY_LABEL_CHAR_WIDTH;
  }
  return units * fontSize * textScaleX;
}

/**
 * Text and font size of a day's label. The width of the day picks the form
 * ("Thu 15.10", "Thu 15", "15") and the font size; a form wider than its day
 * (with `DAY_LABEL_PADDING` to each edge) gives way to the next shorter one,
 * and if not even the day number fits, the day has no label (`null`): a
 * label never reaches past its day or the edge of the chart (REQ-669).
 */
export function chooseDayLabel(
  group: Pick<DayGroupRenderItem, "blockWidth" | "dateLabel" | "weekdayLabel">,
  textScaleX = 1,
): DayLabel | null {
  const { blockWidth } = group;
  const day = group.dateLabel.split(".")[0]!;
  const forms = [`${group.weekdayLabel} ${group.dateLabel}`, `${group.weekdayLabel} ${day}`, day];
  const fontSize = blockWidth < 45 ? 8 : blockWidth < 65 ? 9.5 : DAY_HEADER_FONT_SIZE;
  const available = blockWidth - 2 * DAY_LABEL_PADDING;
  const first = blockWidth < 38 ? 2 : blockWidth < 55 ? 1 : 0;
  for (const text of forms.slice(first)) {
    if (estimateDayLabelWidth(text, fontSize, textScaleX) <= available) return { text, fontSize };
  }
  return null;
}

function dayLabelText(
  group: DayGroupRenderItem,
  dayHeaderTop: number,
  textScaleX: number,
  theme: MeteogramTheme,
): VInput {
  const label = chooseDayLabel(group, textScaleX);
  if (!label) return null;
  const x = group.firstX + group.blockWidth / 2;
  const y = dayHeaderTop + 15;
  return h(
    "text",
    {
      x,
      y,
      transform: getTextTransform(x, y, textScaleX),
      fill: theme.dayHeader.text,
      "font-size": label.fontSize,
      "font-weight": "700",
      "text-anchor": "middle",
      // Lets a page style one day's label, e.g. today's (REQ-559).
      class: "day-label-text",
      "data-day": group.dayKey,
    },
    label.text,
  );
}

export interface TerrainMaskLabelProps {
  terrainMask?: TerrainMaskItem | null;
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  textScaleX?: number;
  /** Colours and font sizes (default `light`). */
  theme?: MeteogramTheme;
}

/**
 * The terrain line at the place's elevation and the elevation ("3158 m") at
 * its right end (REQ-510). Drawn after the drawing areas, so the cloud profile
 * (also its grey columns without data) and the series do not cover parts of
 * them: line and label each have one colour throughout (REQ-569). A halo in
 * the background colour keeps the label readable on the cloud shading.
 */
export function terrainMaskLabel({
  terrainMask,
  paddingLeft,
  paddingRight,
  svgWidth,
  textScaleX,
  theme = LIGHT_THEME,
}: TerrainMaskLabelProps): VInput {
  if (!terrainMask || !(terrainMask.elevationKm > 0)) return null;
  const x = svgWidth - paddingRight - 4;
  const y = terrainMask.groundY - 3;
  return h(
    "g",
    { class: "terrain-mask-label-group", "pointer-events": "none" },
    h("line", {
      x1: paddingLeft,
      y1: terrainMask.groundY,
      x2: svgWidth - paddingRight,
      y2: terrainMask.groundY,
      stroke: theme.terrain.line,
      "stroke-width": "1.2",
      "stroke-dasharray": "3 2",
      "data-testid": "terrain-line",
    }),
    // The halo is its own element behind the label (REQ-747).
    withHalo(
      h(
        "text",
        {
          x,
          y,
          transform: getTextTransform(x, y, textScaleX),
          fill: theme.terrain.label,
          "font-size": theme.fontSizes.terrain,
          "font-weight": "700",
          "text-anchor": "end",
          "data-testid": "terrain-mask-label",
        },
        `${Math.round(terrainMask.elevationKm * 1000)} m`,
      ),
      labelHalo(theme.background),
    ),
  );
}
