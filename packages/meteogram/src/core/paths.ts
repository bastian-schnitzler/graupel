// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { SunPeriod } from "./types";
import type { TimelineScale } from "./timeline";
import {
  getBoundaryTimestamp,
  getZonedDateParts,
  HOUR_MS,
  normalizeTimestamp,
} from "./timeline";

/** Half height (viewBox units) of the `|` drawn where a curve stops early or resumes. */
export const CURVE_STOP_HALF_HEIGHT = 4;

/** Short vertical bar marking that a curve stops or resumes at (x, y). */
function curveStopMarker(x: number, y: number, digits?: number): string {
  const fmt = (v: number) => (digits === undefined ? `${v}` : v.toFixed(digits));
  return ` M ${fmt(x)} ${fmt(y - CURVE_STOP_HALF_HEIGHT)} L ${fmt(x)} ${fmt(y + CURVE_STOP_HALF_HEIGHT)}`;
}

const isValidValue = (v: number | null | undefined) =>
  v !== null && v !== undefined && Number.isFinite(v);

/**
 * Ends (epoch ms) of the active model slices of a chain, ascending. A model
 * slice is covered by the model's run(s): the displayed chain is capped to
 * the hours the runs deliver.
 */
export function calculateModelSliceEnds(
  modelChain: { max_forecast_horizon_hours: number }[],
  forecastStartMs: number,
): number[] {
  const ends: number[] = [];
  let previous = 0;
  for (const model of modelChain) {
    const horizon = model.max_forecast_horizon_hours;
    if (!Number.isFinite(horizon) || horizon <= previous) continue;
    ends.push(getBoundaryTimestamp(forecastStartMs, horizon));
    previous = horizon;
  }
  return ends;
}

/**
 * Indices where a curve stops although the model slice containing the point
 * still covers the next hour: the value is valid, the next one is missing and
 * the next timestamp lies before the slice end. A curve ending at a slice
 * boundary or at the end of the timeline is not a stop.
 */
export function findCurveStops(
  values: (number | null | undefined)[],
  timestamps: number[],
  sliceEndsMs: number[],
): Set<number> {
  const stops = new Set<number>();
  const isValid = (v: number | null | undefined) =>
    v !== null && v !== undefined && Number.isFinite(v);
  for (let idx = 0; idx < values.length - 1; idx++) {
    if (!isValid(values[idx]) || isValid(values[idx + 1])) continue;
    const sliceEnd = sliceEndsMs.find((end) => end > timestamps[idx]!);
    if (sliceEnd !== undefined && timestamps[idx + 1]! < sliceEnd) {
      stops.add(idx);
    }
  }
  return stops;
}

/**
 * Indices where a curve resumes after a gap: the value is valid and the
 * previous one is missing. A curve starting at the beginning of the timeline
 * is not a start; a curve continuing across a model boundary has no gap.
 */
export function findCurveStarts(values: (number | null | undefined)[]): Set<number> {
  const starts = new Set<number>();
  const isValid = (v: number | null | undefined) =>
    v !== null && v !== undefined && Number.isFinite(v);
  for (let idx = 1; idx < values.length; idx++) {
    if (isValid(values[idx]) && !isValid(values[idx - 1])) starts.add(idx);
  }
  return starts;
}

/** Stop and start markers of a curve (see findCurveStops, findCurveStarts). */
export function findCurveMarkers(
  values: (number | null | undefined)[],
  timestamps: number[],
  sliceEndsMs: number[],
): Set<number> {
  const markers = findCurveStops(values, timestamps, sliceEndsMs);
  findCurveStarts(values).forEach((idx) => markers.add(idx));
  return markers;
}

/**
 * Builds an SVG path string for a line chart with breaks/gaps across null or missing values.
 * Indices in `stops` get a short vertical bar marking an early end or a
 * restart after a gap.
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
  stops?: Set<number>,
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

    const x = getX(timestamps[idx]!);
    const normalized = (val - minY) / range;
    const y =
      panelTop + panelHeight - paddingBottom - normalized * usableHeight;

    if (!isDrawing) {
      path += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      isDrawing = true;
    } else {
      path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    if (stops?.has(idx)) {
      path += curveStopMarker(x, y, 1);
      isDrawing = isValidValue(values[idx + 1]);
      if (isDrawing) path += ` M ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  });

  return path;
}

/**
 * Builds an SVG path through `toY` at full coordinate precision (fixed,
 * clamped scales), with gaps at missing values and `|` at `stops` (stop
 * and start markers).
 */
export function buildScaledLinePath(
  values: (number | null)[],
  timestamps: (number | string)[],
  getX: (ts: number | string) => number,
  toY: (value: number) => number,
  stops?: Set<number>,
): string {
  let path = "";
  let isDrawing = false;

  values.forEach((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      isDrawing = false;
      return;
    }

    const x = getX(timestamps[index]!);
    const y = toY(value);

    if (!isDrawing) {
      path += `M ${x} ${y}`;
      isDrawing = true;
    } else {
      path += ` L ${x} ${y}`;
    }
    if (stops?.has(index)) {
      path += curveStopMarker(x, y);
      isDrawing = isValidValue(values[index + 1]);
      if (isDrawing) path += ` M ${x} ${y}`;
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
  stops?: Set<number>,
): string {
  return buildScaledLinePath(
    precipProbValues,
    timestamps,
    getX,
    (value) =>
      combinedPlotBottom -
      (Math.max(0, Math.min(100, value)) / 100) * combinedPlotHeight,
    stops,
  );
}

export interface HeldSegment {
  path: string;
  model: string;
  /** End of the last interval (before clamping to the timeline end). */
  endTime: number;
  lastY: number;
}

/**
 * Paths of an interval quantity (start-stamped hours, e.g. LPI): one path per
 * run of consecutive hours from the same model; the last value holds until
 * its interval end (or the timeline end).
 */
export function buildHeldSegments(
  timestamps: number[],
  pointAt: (ts: number) => { value: number | null; model: string } | null,
  toY: (value: number) => number,
  getX: (ts: number) => number,
  timelineEndMs: number,
  hourMs: number,
): HeldSegment[] {
  const segments: HeldSegment[] = [];
  let previousTime: number | null = null;

  timestamps.forEach((ts) => {
    const point = pointAt(ts);
    if (!point || point.value === null || !Number.isFinite(point.value)) {
      previousTime = null;
      return;
    }
    const x = getX(ts);
    const y = toY(point.value);
    const previous = segments[segments.length - 1];
    if (
      previous &&
      previousTime !== null &&
      ts - previousTime === hourMs &&
      previous.model === point.model
    ) {
      previous.path += ` L ${x} ${y}`;
    } else {
      segments.push({ path: `M ${x} ${y}`, model: point.model, endTime: 0, lastY: y });
    }
    const segment = segments[segments.length - 1]!;
    segment.endTime = ts + hourMs;
    segment.lastY = y;
    previousTime = ts;
  });

  return segments.map((segment) => ({
    ...segment,
    // The final observation occupies its start-stamped hour up to handover.
    path: `${segment.path} L ${getX(Math.min(segment.endTime, timelineEndMs))} ${segment.lastY}`,
  }));
}

/**
 * Dash periods that at least fit between two anchors of a dashed line
 * (REQ-579): enough that fitting a whole number of them changes
 * the pattern only a little.
 */
export const DASH_PERIODS_PER_ANCHOR = 4;

/**
 * Length of one repetition of a dash pattern such as `"2 2"` (an odd list
 * repeats twice, as in SVG); null when it draws no pattern.
 */
export function dashPatternPeriod(dashArray: string): number | null {
  const values = dashArray.trim().split(/[\s,]+/).map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) return null;
  return values.length % 2 === 0 ? sum : 2 * sum;
}

/**
 * Hours between two anchors of a dashed line: the shortest part of a day (or
 * the fewest whole days) at least DASH_PERIODS_PER_ANCHOR periods wide.
 */
export function dashAnchorHours(hourWidth: number, period: number): number {
  const needed = (DASH_PERIODS_PER_ANCHOR * period) / hourWidth;
  if (!Number.isFinite(needed)) return 24;
  const hours = [1, 2, 3, 4, 6, 8, 12, 24].find((candidate) => candidate >= needed);
  return hours ?? 24 * Math.ceil(needed / 24);
}

/** One piece of a dashed line, drawn as its own path. */
export interface DashPiece {
  /** Path data: a single subpath. */
  d: string;
  /** A whole number of dash periods, for `pathLength`: the pattern is stretched to fit the piece exactly. */
  pathLength: number;
  minX: number;
  maxX: number;
}

/**
 * Splits a dashed line path (`M`/`L` commands, as the builders above write
 * them) into pieces between anchors, each with a whole number of dash periods
 * (REQ-579). A vertex where `blockOf` changes ends one piece and
 * starts the next, so a piece depends only on its own vertices: when another
 * part of the line changes, e.g. at a moved model boundary, its dashes stay
 * where they are (REQ-572). A piece at the start or end of a
 * subpath (start or end of the curve, a gap) shorter than
 * DASH_PERIODS_PER_ANCHOR periods joins its neighbour, so the pattern is
 * stretched by at most 1/8 there too; single points draw nothing and are
 * dropped.
 */
export function splitDashedPath(
  path: string,
  period: number,
  blockOf: (x: number) => number,
): DashPiece[] {
  const subpaths: { xs: string[]; ys: string[] }[] = [];
  for (const [, command, x, y] of path.matchAll(/([ML])\s*([^\sML]+)\s+([^\sML]+)/g)) {
    if (command === "M" || subpaths.length === 0) subpaths.push({ xs: [], ys: [] });
    const current = subpaths[subpaths.length - 1]!;
    current.xs.push(x!);
    current.ys.push(y!);
  }

  const minLength = DASH_PERIODS_PER_ANCHOR * period;
  const pieces: DashPiece[] = [];
  for (const { xs, ys } of subpaths) {
    const x = xs.map(Number);
    const y = ys.map(Number);
    if (x.length < 2) continue;
    // Vertex ranges [start, end]; neighbouring pieces share their boundary vertex.
    const ranges: [number, number][] = [];
    let start = 0;
    let block = blockOf(x[0]!);
    for (let index = 1; index < x.length; index++) {
      const next = blockOf(x[index]!);
      if (next === block) continue;
      ranges.push([start, index]);
      start = index;
      block = next;
    }
    if (start < x.length - 1) ranges.push([start, x.length - 1]);

    const lengthOf = ([from, to]: [number, number]) => {
      let length = 0;
      for (let index = from; index < to; index++) {
        length += Math.hypot(x[index + 1]! - x[index]!, y[index + 1]! - y[index]!);
      }
      return length;
    };
    if (ranges.length > 1 && lengthOf(ranges[0]!) < minLength) {
      ranges.splice(0, 2, [ranges[0]![0], ranges[1]![1]]);
    }
    const last = ranges.length - 1;
    if (ranges.length > 1 && lengthOf(ranges[last]!) < minLength) {
      ranges.splice(last - 1, 2, [ranges[last - 1]![0], ranges[last]![1]]);
    }

    for (const range of ranges) {
      const [from, to] = range;
      let d = `M ${xs[from]} ${ys[from]}`;
      for (let index = from + 1; index <= to; index++) d += ` L ${xs[index]} ${ys[index]}`;
      const periods = Math.max(1, Math.round(lengthOf(range) / period));
      const pieceXs = x.slice(from, to + 1);
      pieces.push({
        d,
        pathLength: Math.round(periods * period * 1e6) / 1e6,
        minX: Math.min(...pieceXs),
        maxX: Math.max(...pieceXs),
      });
    }
  }
  return pieces;
}

/**
 * Pieces of a dashed line whose pattern starts anew at anchor times: every
 * `dashAnchorHours` hours counted from 1970 (not from the visible window, so
 * scrolling moves no dash), stretched to whole periods in between
 * (REQ-579). Null when `dashArray` draws no pattern.
 */
export function anchoredDashPieces(
  path: string,
  dashArray: string,
  hourWidth: number,
  xToTimestamp: (x: number) => number,
): DashPiece[] | null {
  const period = dashPatternPeriod(dashArray);
  if (period === null || !(hourWidth > 0)) return null;
  const hours = dashAnchorHours(hourWidth, period);
  return splitDashedPath(path, period, (x) => Math.floor(Math.round(xToTimestamp(x) / HOUR_MS) / hours));
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
      .map((index) => timestamps[index]!)
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
