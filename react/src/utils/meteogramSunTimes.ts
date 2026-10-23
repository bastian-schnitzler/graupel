import type { SunPeriod } from "../types";
import { addLocalDays, getPreviousLocalMidnight } from "./meteogramZoom";
import { getZonedDateParts, normalizeTimestamp } from "./timeline";

/** Sunrise or sunset time label (system.md §16.8, #171). */
export interface SunTimeLabel {
  kind: "sunrise" | "sunset";
  dayKey: string;
  x: number;
  y: number;
  text: string;
}

/** Font size of the labels (viewBox units), as the daily extremes. */
export const SUN_TIME_FONT_SIZE = 9.5;
// Average glyph width and the height of digits above the baseline,
// relative to the font size.
const CHAR_WIDTH = 0.6;
const ASCENT = 0.72;

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
  const days =
    complete.length === 1
      ? [complete[0]]
      : [complete[0], complete[complete.length - 1]];

  const labels: SunTimeLabel[] = [];
  for (const day of days) {
    const left = getX(day.dayStart);
    const right = getX(day.dayEnd);
    for (const [kind, instant, y] of [
      // Sunrise just below the top edge, sunset just above the bottom edge.
      ["sunrise", day.sunrise, top + SUN_TIME_FONT_SIZE * ASCENT + 1],
      ["sunset", day.sunset, bottom - 3],
    ] as const) {
      const text = formatTime(instant, timeZone);
      const half =
        (text.length * CHAR_WIDTH * SUN_TIME_FONT_SIZE * textScaleX) / 2;
      // Inside the day; centred when the day is narrower than the text.
      const x =
        right - left < 2 * half
          ? (left + right) / 2
          : Math.min(right - half, Math.max(left + half, getX(instant)));
      labels.push({ kind, dayKey: day.phase.day, x, y, text });
    }
  }
  return labels;
}
