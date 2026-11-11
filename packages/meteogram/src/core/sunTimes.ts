// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { SunPeriod } from "./types";
import { addLocalDays, getPreviousLocalMidnight } from "./zoom";
import { getZonedDateParts, normalizeTimestamp } from "./timeline";

/** Sunrise or sunset time label (system.md §16.8, #171). */
export interface SunTimeLabel {
  kind: "sunrise" | "sunset";
  dayKey: string;
  x: number;
  y: number;
  text: string;
  /** x of the instant itself (the sunrise or sunset line); `x` may be moved off it to stay inside the day. */
  lineX?: number;
  /** x of the end of the label's day: a label anchored at its start keeps its right edge before it (REQ-734). */
  dayEndX?: number;
  /**
   * Anchor of the text at `x`: centred by default; "start" for a sunrise moved right of its line because it would
   * cover an axis label (REQ-734).
   */
  anchor?: "middle" | "start";
}

/** Font size of the labels (viewBox units), as the daily extremes. */
export const SUN_TIME_FONT_SIZE = 9.5;
// Average glyph width relative to the font size.
const CHAR_WIDTH = 0.6;

/** Estimated width of a sun time label `text` (viewBox units) at the horizontal text scale `textScaleX`. */
export const sunTimeLabelWidth = (text: string, textScaleX = 1) => text.length * CHAR_WIDTH * SUN_TIME_FONT_SIZE * textScaleX;
/**
 * Height of digits above the baseline, relative to the font size: the top edge of a label of digits (sun times, axis
 * labels) lies this much times its font size above its baseline, its bottom edge on the baseline.
 */
export const DIGIT_ASCENT = 0.72;

/**
 * Baseline of the sunrise labels in an area whose top edge is at `top`: the top edge of their digits lies 1 unit
 * below the area's top edge. The baseline is the bottom edge of the sunrise row; the left axis maximum over the
 * plot hangs 1 unit below it (REQ-602).
 */
export const sunriseBaselineY = (top: number) => top + SUN_TIME_FONT_SIZE * DIGIT_ASCENT + 1;

interface SunTimeParams {
  sunPhases: SunPeriod[] | undefined;
  /** Visible range (epoch ms). */
  startMs: number;
  endMs: number;
  timeZone: string;
  getX: (ts: number) => number;
  /** Drawing area of the temperature area (viewBox units). */
  top: number;
  bottom: number;
  /** Horizontal text scale of the rendered SVG (`getTextTransform`). */
  textScaleX?: number;
}

const formatTime = (ms: number, timeZone: string) => {
  const parts = getZonedDateParts(ms, timeZone);
  return `${parts.hour}:${parts.minute}`;
};

/**
 * Sunrise (top edge of the area) and sunset (bottom edge) on the first and
 * the last complete local day of the visible range, at the instant's x,
 * kept inside the day. They are never left out: the chart draws them in
 * the background, behind the curves and the daily min/max labels.
 */
export function calculateSunTimeLabels({
  sunPhases,
  startMs,
  endMs,
  timeZone,
  getX,
  top,
  bottom,
  textScaleX = 1,
}: SunTimeParams): SunTimeLabel[] {
  if (!sunPhases?.length) return [];
  const complete = sunPhases
    .map((phase) => {
      const sunrise = normalizeTimestamp(phase.sunrise);
      const sunset = normalizeTimestamp(phase.sunset);
      if (!Number.isFinite(sunrise) || !Number.isFinite(sunset)) return null;
      // 00:00 of the sunrise's local day and of the next day.
      const dayStart = getPreviousLocalMidnight(
        addLocalDays(sunrise, 1, timeZone),
        timeZone,
      );
      const dayEnd = addLocalDays(dayStart, 1, timeZone);
      return { phase, sunrise, sunset, dayStart, dayEnd };
    })
    .filter(
      (day): day is NonNullable<typeof day> =>
        day !== null && day.dayStart >= startMs && day.dayEnd <= endMs,
    )
    .sort((a, b) => a.dayStart - b.dayStart);
  if (complete.length === 0) return [];
  const first = complete[0]!;
  const last = complete[complete.length - 1]!;
  const days = complete.length === 1 ? [first] : [first, last];

  const labels: SunTimeLabel[] = [];
  for (const day of days) {
    const left = getX(day.dayStart);
    const right = getX(day.dayEnd);
    for (const [kind, instant, y] of [
      // Sunrise just below the top edge, sunset just above the bottom edge.
      ["sunrise", day.sunrise, sunriseBaselineY(top)],
      ["sunset", day.sunset, bottom - 3],
    ] as const) {
      const text = formatTime(instant, timeZone);
      const half = sunTimeLabelWidth(text, textScaleX) / 2;
      // Inside the day; centred when the day is narrower than the text.
      const x =
        right - left < 2 * half
          ? (left + right) / 2
          : Math.min(right - half, Math.max(left + half, getX(instant)));
      labels.push({ kind, dayKey: day.phase.day, x, y, text, lineX: getX(instant), dayEndX: right });
    }
  }
  return labels;
}
