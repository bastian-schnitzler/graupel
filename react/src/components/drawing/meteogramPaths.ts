import type { SunPeriod } from "../../types";
import type { TimelineScale } from "../../utils/timeline";
import { getZonedDateParts, normalizeTimestamp } from "../../utils/timeline";

/**
 * Builds an SVG path string for a line chart with breaks/gaps across null or missing values.
 */
export function buildSvgLinePath(
  values: (number | null)[],
  minY: number,
  maxY: number,
  panelTop: number,
  panelHeight: number,
  timestamps: (number | string)[],
  getX: (ts: number | string) => number,
  paddingTop = 10,
  paddingBottom = 10,
): string {
  const usableHeight = panelHeight - paddingTop - paddingBottom;
  const range = maxY - minY || 1;

  let path = "";
  let isDrawing = false;

  values.forEach((val, idx) => {
    if (val === null || val === undefined || isNaN(val)) {
      isDrawing = false;
      return;
    }

    const x = getX(timestamps[idx]);
    const normalized = (val - minY) / range;
    const y =
      panelTop + panelHeight - paddingBottom - normalized * usableHeight;

    if (!isDrawing) {
      path += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      isDrawing = true;
    } else {
      path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  });

  return path;
}

/**
 * Builds an SVG path string for the precipitation probability curve in Panel 2.
 */
export function buildPrecipitationProbabilityPath(
  precipProbValues: (number | null)[],
  timestamps: (number | string)[],
  combinedPlotBottom: number,
  combinedPlotHeight: number,
  getX: (ts: number | string) => number,
): string {
  let path = "";
  let isDrawing = false;

  precipProbValues.forEach((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      isDrawing = false;
      return;
    }

    const clampedProbability = Math.max(0, Math.min(100, value));
    const x = getX(timestamps[index]);
    const y =
      combinedPlotBottom - (clampedProbability / 100) * combinedPlotHeight;

    if (!isDrawing) {
      path += `M ${x} ${y}`;
      isDrawing = true;
    } else {
      path += ` L ${x} ${y}`;
    }
  });

  return path;
}

/**
 * Calculates daylight visual spans (sunrise to sunset) positioned along the timeline.
 */
export function calculateDaylightSpans(
  sunPhases: SunPeriod[] | undefined,
  timeline: TimelineScale | null,
): { dayKey: string; x: number; width: number }[] {
  if (!sunPhases || sunPhases.length === 0 || !timeline) return [];

  const spans: { dayKey: string; x: number; width: number }[] = [];

  for (const phase of sunPhases) {
    if (!phase.sunrise || !phase.sunset) continue;
    const tRise = normalizeTimestamp(phase.sunrise);
    const tSet = normalizeTimestamp(phase.sunset);
    if (isNaN(tRise) || isNaN(tSet) || tSet <= tRise) continue;

    // Skip if daylight period is completely out of chart range
    if (tSet < timeline.startMs || tRise > timeline.endMs) continue;

    const clampedRise = Math.max(timeline.startMs, tRise);
    const clampedSet = Math.min(timeline.endMs, tSet);
    if (clampedSet <= clampedRise) continue;

    const x1 = timeline.timestampToX(clampedRise);
    const x2 = timeline.timestampToX(clampedSet);
    const width = Math.max(0.5, x2 - x1);

    spans.push({
      dayKey: phase.day,
      x: x1,
      width,
    });
  }

  return spans;
}

/**
 * Calculates X positions of 12:00 local noon markers for all visible day groups.
 */
export function calculateNoonPositions(
  visibleDayGroups: { dayKey: string; indices: number[] }[],
  timestamps: number[],
  resolvedTimezone: string,
  timeline: TimelineScale | null,
): { dayKey: string; x: number }[] {
  if (timestamps.length < 2 || !timeline) return [];
  const positions: { dayKey: string; x: number }[] = [];

  for (const group of visibleDayGroups) {
    const noonTimestamp = group.indices
      .map((index) => timestamps[index])
      .find(
        (timestamp) =>
          getZonedDateParts(timestamp, resolvedTimezone).hour === "12",
      );

    if (noonTimestamp !== undefined && timeline.contains(noonTimestamp)) {
      positions.push({
        dayKey: group.dayKey,
        x: timeline.timestampToX(noonTimestamp),
      });
    }
  }

  return positions;
}

/**
 * Calculates the Y coordinate of the 0°C freezing level reference line in the temperature panel.
 */
export function calculateFreezingZeroY(
  tempTop: number,
  tempHeight: number,
  minTemp: number,
  maxTemp: number,
): number {
  const tempUsableHeight = tempHeight - 22 - 10;
  const tempRange = maxTemp - minTemp || 1;
  return (
    tempTop + tempHeight - 10 - ((0 - minTemp) / tempRange) * tempUsableHeight
  );
}
