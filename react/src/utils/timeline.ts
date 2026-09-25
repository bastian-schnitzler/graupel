/** Canonical timeline primitives shared by every meteogram layer. */

export const HOUR_MS = 60 * 60 * 1000;
export const TIMELINE_EPSILON_PX = 1e-7;

export type TimestampValue = string | number | Date;

export interface TimelineSpacingAnomaly {
  previousMs: number;
  currentMs: number;
  actualMs: number;
  expectedMs: number;
}

export interface TimelineScale {
  startMs: number;
  endMs: number;
  leftX: number;
  rightX: number;
  timestampToX: (timestamp: TimestampValue, clamp?: boolean) => number;
  xToTimestamp: (x: number, clamp?: boolean) => number;
  intervalToGeometry: (
    timestamp: TimestampValue,
    durationMs?: number,
  ) => { x: number; width: number } | null;
  contains: (timestamp: TimestampValue) => boolean;
}

const EXPLICIT_ZONE_PATTERN = /T.*(?:Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert a timestamp to Unix milliseconds. Strings without an offset are
 * interpreted as UTC, never as the browser timezone. Backend transport uses
 * explicit UTC timestamps; this fallback keeps legacy/offline fixtures stable.
 */
export function normalizeTimestamp(value: TimestampValue): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid timestamp: ${String(value)}`);
    return value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) throw new Error(`Invalid timestamp: ${String(value)}`);
    return time;
  }

  const trimmed = value.trim();
  const normalized = DATE_ONLY_PATTERN.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : EXPLICIT_ZONE_PATTERN.test(trimmed)
      ? trimmed
      : `${trimmed}Z`;
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new Error(`Invalid timestamp: ${JSON.stringify(value)}`);
  return time;
}

export function canonicalTimestamp(value: TimestampValue): string {
  return new Date(normalizeTimestamp(value)).toISOString();
}

export function canonicalTimestampKey(value: TimestampValue): number {
  return normalizeTimestamp(value);
}

export function getBoundaryTimestamp(
  forecastStart: TimestampValue,
  horizonHours: number,
): number {
  if (!Number.isFinite(horizonHours)) throw new Error(`Invalid horizon: ${horizonHours}`);
  return normalizeTimestamp(forecastStart) + horizonHours * HOUR_MS;
}

export function createTimelineScale(
  start: TimestampValue,
  end: TimestampValue,
  leftX: number,
  rightX: number,
): TimelineScale {
  const startMs = normalizeTimestamp(start);
  const endMs = normalizeTimestamp(end);
  if (!(endMs > startMs)) throw new Error('Timeline end must be after timeline start');
  if (!(rightX > leftX)) throw new Error('Timeline right edge must be after left edge');

  const durationMs = endMs - startMs;
  const width = rightX - leftX;

  const timestampToX = (timestamp: TimestampValue, clamp = false) => {
    const timestampMs = normalizeTimestamp(timestamp);
    const ratio = (timestampMs - startMs) / durationMs;
    const resolvedRatio = clamp ? Math.max(0, Math.min(1, ratio)) : ratio;
    return leftX + resolvedRatio * width;
  };

  const xToTimestamp = (x: number, clamp = false) => {
    const ratio = (x - leftX) / width;
    const resolvedRatio = clamp ? Math.max(0, Math.min(1, ratio)) : ratio;
    return startMs + resolvedRatio * durationMs;
  };

  return {
    startMs,
    endMs,
    leftX,
    rightX,
    timestampToX,
    xToTimestamp,
    intervalToGeometry: (timestamp, intervalDurationMs = HOUR_MS) => {
      const intervalStart = normalizeTimestamp(timestamp);
      const intervalEnd = intervalStart + intervalDurationMs;
      const clippedStart = Math.max(startMs, intervalStart);
      const clippedEnd = Math.min(endMs, intervalEnd);
      if (clippedEnd <= clippedStart) return null;
      const x = timestampToX(clippedStart);
      return { x, width: timestampToX(clippedEnd) - x };
    },
    contains: (timestamp) => {
      const timestampMs = normalizeTimestamp(timestamp);
      return timestampMs >= startMs && timestampMs <= endMs;
    },
  };
}

export function uniqueSortedTimestamps(values: Iterable<TimestampValue>): number[] {
  return Array.from(new Set(Array.from(values, normalizeTimestamp))).sort((a, b) => a - b);
}

export function buildHourlyTimeline(start: TimestampValue, end: TimestampValue): number[] {
  const startMs = normalizeTimestamp(start);
  const endMs = normalizeTimestamp(end);
  const result: number[] = [];
  for (let timestampMs = startMs; timestampMs < endMs; timestampMs += HOUR_MS) {
    result.push(timestampMs);
  }
  return result;
}

export function validateTimestampSequence(
  values: TimestampValue[],
  expectedSpacingMs: number | null = HOUR_MS,
): TimelineSpacingAnomaly[] {
  const timestamps = values.map(normalizeTimestamp);
  const anomalies: TimelineSpacingAnomaly[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const actualMs = timestamps[index] - timestamps[index - 1];
    if (actualMs <= 0) {
      throw new Error(
        `Timeline timestamps must be strictly increasing at index ${index}: ` +
        `${timestamps[index - 1]} >= ${timestamps[index]}`,
      );
    }
    if (expectedSpacingMs !== null && actualMs !== expectedSpacingMs) {
      anomalies.push({
        previousMs: timestamps[index - 1],
        currentMs: timestamps[index],
        actualMs,
        expectedMs: expectedSpacingMs,
      });
    }
  }
  return anomalies;
}

export function indexByTimestamp<T extends { timestamp: string }>(
  values: T[],
): Map<number, T> {
  const sorted = [...values].sort(
    (left, right) => normalizeTimestamp(left.timestamp) - normalizeTimestamp(right.timestamp),
  );
  validateTimestampSequence(sorted.map((value) => value.timestamp), null);
  return new Map(sorted.map((value) => [normalizeTimestamp(value.timestamp), value]));
}

export function findNearestTimestamp(sortedTimestamps: number[], targetMs: number): number | null {
  if (sortedTimestamps.length === 0) return null;
  let low = 0;
  let high = sortedTimestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedTimestamps[middle] < targetMs) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return sortedTimestamps[0];
  if (low === sortedTimestamps.length) return sortedTimestamps[sortedTimestamps.length - 1];
  const previous = sortedTimestamps[low - 1];
  const next = sortedTimestamps[low];
  return targetMs - previous <= next - targetMs ? previous : next;
}

/** Resolve a cursor to the start timestamp of the containing data interval. */
export function findTimestampAtOrBefore(
  sortedTimestamps: number[],
  targetMs: number,
): number | null {
  if (sortedTimestamps.length === 0) return null;
  let low = 0;
  let high = sortedTimestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedTimestamps[middle] <= targetMs) low = middle + 1;
    else high = middle;
  }
  return sortedTimestamps[Math.max(0, low - 1)];
}

export function assertSameTimelineX(
  scale: TimelineScale,
  timestamps: TimestampValue[],
  tolerancePx = TIMELINE_EPSILON_PX,
): void {
  if (timestamps.length < 2) return;
  const expected = scale.timestampToX(timestamps[0]);
  for (const timestamp of timestamps.slice(1)) {
    const actual = scale.timestampToX(timestamp);
    if (Math.abs(actual - expected) > tolerancePx) {
      throw new Error(`Cross-layer timeline mismatch: ${expected} !== ${actual}`);
    }
  }
}

export interface ZonedDateParts {
  dayKey: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: string;
}

export function getZonedDateParts(
  timestamp: TimestampValue,
  timeZone = 'UTC',
): ZonedDateParts {
  let resolvedTz = timeZone;
  if (!resolvedTz || resolvedTz === 'auto') {
    resolvedTz = 'UTC';
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(normalizeTimestamp(timestamp))).map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    weekday: parts.weekday,
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}
