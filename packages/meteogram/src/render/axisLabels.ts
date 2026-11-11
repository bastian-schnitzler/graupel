// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/** Text of the axis labels and cloud altitudes (option `axisLabels` of the scene). */
import { DIGIT_ASCENT } from "../core/sunTimes";
import type { MeteogramTheme } from "../core/theme";
import { type Halo, labelHalo } from "./halo";

/** Value with its unit in one line; a degree sign follows the value directly. */
export const withUnit = (value: string | number, unit: string) =>
  unit === "" ? `${value}` : unit.startsWith("°") ? `${value}${unit}` : `${value} ${unit}`;

/** Distance of two lines of a two-line axis label, relative to its font size. */
export const AXIS_LABEL_LINE_HEIGHT = 1.1;

/** Distance of two lines of a two-line axis label in viewBox units (rounded as the `dy` of its second line). */
export const axisLabelLineHeight = (fontSize: number) =>
  Math.round(fontSize * AXIS_LABEL_LINE_HEIGHT * 100) / 100;

/**
 * Lines of an axis label: value and unit in one line, or (`unitBelow`) the unit in a line below the value. A degree
 * sign stays with its value (`19°`), a label without unit has one line.
 */
export function axisLabelLines(
  value: string | number,
  unit: string,
  unitBelow: boolean,
  compact = false,
): string[] {
  // REQ-696: compact labels show the value without its unit; a degree sign stays with it ("-35°").
  if (compact) return [unit.startsWith("°") ? withUnit(value, unit) : `${value}`];
  if (!unitBelow || unit === "" || unit.startsWith("°")) return [withUnit(value, unit)];
  return [`${value}`, unit];
}

/**
 * Unit of an axis with compact labels (`axisLabels.compact`, REQ-696), written once below its drawing area: null for an
 * axis without unit or with a degree sign, which stays with each value.
 */
export function compactAxisUnit(unit: string): string | null {
  return unit === "" || unit.startsWith("°") ? null : unit;
}

/**
 * Length of one screen pixel in viewBox units vertically (REQ-696): the vertical scale of the rendered chart
 * (`MeteogramLayout.windIconScaleY`, viewBox units per CSS pixel); 1 without a usable scale.
 */
export const verticalPixel = (windIconScaleY: number) =>
  Number.isFinite(windIconScaleY) && windIconScaleY > 0 ? windIconScaleY : 1;

/** Share of the font size a character of an axis label is wide at most (digits, minus, degree sign; estimate). */
export const AXIS_LABEL_CHAR_WIDTH = 0.6;

/** Estimated width (viewBox units) of an axis label `text` in `fontSize`, stretched by `textScaleX`. */
export const axisLabelWidth = (text: string, fontSize: number, textScaleX = 1) =>
  text.length * AXIS_LABEL_CHAR_WIDTH * fontSize * textScaleX;

/** x of the left axis labels over the plot (`axisLabels.align` "inside"): 1 unit off the chart's edge (REQ-602). */
export const INSIDE_LEFT_LABEL_X = 1;

/**
 * Distance of the right labels over the plot (`axisLabels.align` "inside": right axis, cloud altitudes) from the
 * chart's right edge: they end at x = width − 1, as far off the edge as the left ones (REQ-622).
 */
export const INSIDE_RIGHT_LABEL_INSET = 1;

/** End x of the right labels over the plot (`axisLabels.align` "inside") in a chart `svgWidth` wide (REQ-622). */
export const insideRightLabelX = (svgWidth: number) => svgWidth - INSIDE_RIGHT_LABEL_INSET;

/** Halo of a label over the plot (`axisLabels.align` "inside"): a stroke in the background colour behind the text. */
export const axisLabelHalo = (theme: MeteogramTheme): Halo => labelHalo(theme.background);

/** Vertical extent of a label (viewBox y). */
export interface AxisLabelBox {
  top: number;
  bottom: number;
}

/**
 * Height of an axis label of `lines` lines: from the top edge of the first line's digits (`DIGIT_ASCENT` times the font
 * size above its baseline, as the sun times measure theirs) to the baseline of the last line.
 */
export const axisLabelHeight = (lines: number, fontSize: number) =>
  DIGIT_ASCENT * fontSize + axisLabelLineHeight(fontSize) * (lines - 1);

/**
 * Box of an axis label whose `y` is the baseline of its first line (`from` "top", hanging down) or of its last line
 * (`from` "bottom", standing on it), as `valueLabel` in `chartArea` places them.
 */
export function axisLabelBox(
  y: number,
  lines: number,
  fontSize: number,
  from: "top" | "bottom",
): AxisLabelBox {
  const height = axisLabelHeight(lines, fontSize);
  const top = from === "top" ? y - DIGIT_ASCENT * fontSize : y - height;
  return { top, bottom: top + height };
}

/**
 * Share of a label's height the zero line's label may cover before the label is left out (REQ-603): up to 20 % both
 * stay, above that only the zero label.
 */
export const ZERO_LABEL_MAX_OVERLAP = 0.2;

/** The zero line's label covers more than `ZERO_LABEL_MAX_OVERLAP` of `label`'s height. */
export function zeroLabelCovers(zero: AxisLabelBox, label: AxisLabelBox): boolean {
  const overlap = Math.min(zero.bottom, label.bottom) - Math.max(zero.top, label.top);
  // A tolerance keeps an overlap of exactly 20 % (up to rounding) on the side of "both stay".
  return overlap > ZERO_LABEL_MAX_OVERLAP * (label.bottom - label.top) + 1e-9;
}

/** Least room (viewBox units) between the label of the guide line at half the axis and the maximum or minimum. */
export const MID_LABEL_GAP = 1;

/**
 * The label of the guide line at half the axis (`midLine`, REQ-653) comes too close to `label` (the zero line's): their
 * boxes overlap or keep less than `MID_LABEL_GAP` apart. It is then left out; the line stays. Against the maximum and
 * minimum it must lie between them, `MID_LABEL_GAP` off each.
 */
export function midLabelCrowds(mid: AxisLabelBox, label: AxisLabelBox): boolean {
  return mid.top < label.bottom + MID_LABEL_GAP && label.top < mid.bottom + MID_LABEL_GAP;
}
