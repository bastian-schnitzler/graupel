// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Text of an orange model header (system.md §16.7): always the catalogue nickname
 * (`short_name`) when the model has one, else the full name. The font size
 * follows the header box width. A part of a split series (one header per
 * run) whose name with run does not fit its box shows the run alone, without
 * brackets, e.g. "29 Z06" (REQ-515, form of REQ-695/REQ-697).
 */

/** Font size the header box width allows (viewBox units). */
export function getModelHeaderFontSize(boxWidth: number): number {
  if (boxWidth < 40) return 7;
  if (boxWidth < 70) return 8.5;
  return 10;
}

/** Average glyph width of the bold header text, relative to the font size. */
export const MODEL_HEADER_CHAR_WIDTH = 0.62;
/** Free space the label keeps to each edge of its box (viewBox units). */
export const MODEL_HEADER_LABEL_PADDING = 2;

/**
 * Estimated width of a header label in viewBox units, without a DOM:
 * characters times average glyph width, stretched by the horizontal text
 * scale of the view (`textScaleX`).
 */
export function estimateModelHeaderLabelWidth(text: string, fontSize: number, textScaleX = 1): number {
  return text.length * MODEL_HEADER_CHAR_WIDTH * fontSize * textScaleX;
}

export interface ModelHeaderLabel {
  text: string;
  fontSize: number;
  /** The nickname or the run alone is shown instead of the full name. */
  shortened: boolean;
  /** Only the run is shown (split series, name with run too wide). */
  runOnly?: boolean;
}

export interface ModelHeaderLabelOptions {
  /** Run of a split series ("06 Z06"); without it the label is never cut down to the run. */
  runLabel?: string | null;
  /** Horizontal text scale of the view (`pixelLayout.textScaleX`); default 1. */
  textScaleX?: number;
}

export function chooseModelHeaderLabel(
  fullLabel: string,
  shortLabel: string | null | undefined,
  boxWidth: number,
  options: ModelHeaderLabelOptions = {},
): ModelHeaderLabel {
  const fontSize = getModelHeaderFontSize(boxWidth);
  const label: ModelHeaderLabel = shortLabel
    ? { text: shortLabel, fontSize, shortened: shortLabel !== fullLabel }
    : { text: fullLabel, fontSize, shortened: false };
  const { runLabel, textScaleX = 1 } = options;
  if (!runLabel || label.text === runLabel) return label;
  const available = boxWidth - 2 * MODEL_HEADER_LABEL_PADDING;
  if (estimateModelHeaderLabelWidth(label.text, fontSize, textScaleX) <= available) return label;
  // Too narrow for name and run: the run alone; narrower still, it overflows
  // like any other label (there is no further shortening).
  return { text: runLabel, fontSize, shortened: true, runOnly: true };
}
