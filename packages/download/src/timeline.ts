// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Canonical timestamps and forecast-window helpers.
 *
 * All forecast joins use UTC instants. Open-Meteo is requested in GMT, so a
 * timestamp without offset is UTC unless a caller names another IANA time
 * zone explicitly.
 *
 * Forecast horizons are half-open intervals: `[start, start + horizon)`.
 * Hourly values are start-stamped, so a 24 hour horizon contains samples at
 * hours 0 through 23 and its model boundary is exactly hour 24.
 */

export const HOUR_MS = 60 * 60 * 1000;

export type TimestampValue = string | number | Date;

/** Raised when timestamps cannot safely take part in timeline joins. */
export class TimelineIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineIntegrityError";
  }
}

export interface TimelineSpacingAnomaly {
  previousMs: number;
  currentMs: number;
  actualMs: number;
  expectedMs: number;
}

const EXPLICIT_ZONE_PATTERN = /T.*(?:Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?)?$/;
const UTC_ALIASES = new Set(["UTC", "GMT", "ETC/UTC", "ETC/GMT", "Z"]);

/**
 * Resolve a time zone name to a valid IANA name. UTC and GMT aliases ("UTC",
 * "GMT", "Etc/UTC", "Etc/GMT", "Z", any case, surrounding whitespace) resolve
 * to "UTC". Unknown names throw a {@link TimelineIntegrityError}.
 */
export function resolveTimezone(value: string): string {
  if (typeof value !== "string") {
    throw new TimelineIntegrityError(`Invalid timezone: ${String(value)}`);
  }
  const normalized = value.trim();
  if (!normalized) throw new TimelineIntegrityError("Invalid empty timezone");
  if (UTC_ALIASES.has(normalized.toUpperCase())) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: normalized }).resolvedOptions().timeZone;
  } catch {
    throw new TimelineIntegrityError(`Invalid default timezone: ${JSON.stringify(value)}`);
  }
}

/** IANA name of the runtime's local time zone (browser or Node), "UTC" as fallback. */
export function getUserTimezone(): string {
  try {
    const name = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return name ? resolveTimezone(name) : "UTC";
  } catch {
    return "UTC";
  }
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      era: "short",
    });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset of `timeZone` from UTC at the instant `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  if (timeZone === "UTC") return 0;
  const parts: Record<string, string> = {};
  for (const part of offsetFormatter(timeZone).formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  let year = Number(parts.year);
  if (parts.era === "BC" || parts.era === "B") year = 1 - year;
  const wallMs = Date.UTC(
    year,
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const wholeSecondMs = ms - (((ms % 1000) + 1000) % 1000);
  return wallMs - wholeSecondMs;
}

/**
 * Convert a wall-clock time (given as if it were UTC) in `timeZone` to a UTC
 * instant. Ambiguous times (clock set back) resolve to the earlier instant,
 * non-existent times (clock set forward) use the offset before the change.
 */
function wallTimeToUtc(wallMs: number, timeZone: string): number {
  if (timeZone === "UTC") return wallMs;
  const before = zoneOffsetMs(wallMs - 12 * HOUR_MS, timeZone);
  const after = zoneOffsetMs(wallMs + 12 * HOUR_MS, timeZone);
  const valid = [before, after].filter(
    (offset) => zoneOffsetMs(wallMs - offset, timeZone) === offset,
  );
  if (valid.length === 0) return wallMs - before;
  return wallMs - Math.max(...valid);
}

/**
 * Convert a timestamp to Unix milliseconds. Strings with "Z" or an offset keep
 * their instant. A date alone means midnight, and strings without offset are
 * read in `defaultTimezone` (UTC unless given), never in the runtime's zone.
 */
export function normalizeTimestamp(value: TimestampValue, defaultTimezone = "UTC"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TimelineIntegrityError(`Invalid timestamp: ${String(value)}`);
    return value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) throw new TimelineIntegrityError(`Invalid timestamp: ${String(value)}`);
    return time;
  }

  if (typeof value !== "string") {
    throw new TimelineIntegrityError(`Invalid timestamp: ${String(value)}`);
  }

  const trimmed = value.trim();
  if (EXPLICIT_ZONE_PATTERN.test(trimmed)) {
    const time = Date.parse(trimmed);
    if (!Number.isFinite(time)) throw new TimelineIntegrityError(`Invalid timestamp: ${JSON.stringify(value)}`);
    return time;
  }

  const match = LOCAL_PATTERN.exec(trimmed);
  if (!match) throw new TimelineIntegrityError(`Invalid timestamp: ${JSON.stringify(value)}`);
  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = ""] = match;
  const wallMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0").slice(0, 3)),
  );
  // Date.UTC rolls over invalid fields such as month 13; reject them.
  const check = new Date(wallMs);
  if (
    !Number.isFinite(wallMs) ||
    check.getUTCFullYear() !== Number(year) ||
    check.getUTCMonth() !== Number(month) - 1 ||
    check.getUTCDate() !== Number(day) ||
    check.getUTCHours() !== Number(hour) ||
    check.getUTCMinutes() !== Number(minute) ||
    check.getUTCSeconds() !== Number(second)
  ) {
    throw new TimelineIntegrityError(`Invalid timestamp: ${JSON.stringify(value)}`);
  }
  return wallTimeToUtc(wallMs, resolveTimezone(defaultTimezone));
}

/**
 * Serialize a timestamp as an explicit UTC ISO 8601 instant, e.g.
 * "2026-09-14T13:00:00Z". Milliseconds appear only when they are not zero.
 */
export function canonicalTimestamp(value: TimestampValue, defaultTimezone = "UTC"): string {
  const iso = new Date(normalizeTimestamp(value, defaultTimezone)).toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}Z` : iso;
}

/** Unix milliseconds of a timestamp, for stable map keys and comparisons. */
export function canonicalTimestampKey(value: TimestampValue, defaultTimezone = "UTC"): number {
  return normalizeTimestamp(value, defaultTimezone);
}

/** Normalize a sequence without changing its order or filling gaps. */
export function normalizeTimestampValues(
  values: Iterable<TimestampValue>,
  defaultTimezone = "UTC",
): string[] {
  return Array.from(values, (value) => canonicalTimestamp(value, defaultTimezone));
}

/** Exclusive end instant (Unix ms) of a horizon starting at `forecastStart`. */
export function getBoundaryTimestamp(forecastStart: TimestampValue, horizonHours: number): number {
  if (!Number.isFinite(horizonHours)) throw new TimelineIntegrityError(`Invalid horizon: ${horizonHours}`);
  return normalizeTimestamp(forecastStart) + horizonHours * HOUR_MS;
}

/** Exclusive end instant of a model horizon as canonical timestamp. */
export function modelEndTimestamp(start: TimestampValue, horizonHours: number): string {
  return canonicalTimestamp(getBoundaryTimestamp(start, horizonHours));
}

export function uniqueSortedTimestamps(values: Iterable<TimestampValue>): number[] {
  return Array.from(new Set(Array.from(values, (value) => normalizeTimestamp(value)))).sort(
    (a, b) => a - b,
  );
}

/** Half-open hourly timeline `[start, end)` as Unix milliseconds. */
export function buildHourlyTimeline(start: TimestampValue, end: TimestampValue): number[] {
  const startMs = normalizeTimestamp(start);
  const endMs = normalizeTimestamp(end);
  const result: number[] = [];
  for (let timestampMs = startMs; timestampMs < endMs; timestampMs += HOUR_MS) {
    result.push(timestampMs);
  }
  return result;
}

/**
 * Check that timestamps increase strictly (otherwise throw) and report, but
 * do not fill, gaps that differ from `expectedSpacingMs` (null: no check).
 */
export function validateTimestampSequence(
  values: readonly TimestampValue[],
  expectedSpacingMs: number | null = HOUR_MS,
  datasetName = "dataset",
): TimelineSpacingAnomaly[] {
  const timestamps = values.map((value) => normalizeTimestamp(value));
  const anomalies: TimelineSpacingAnomaly[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const previousMs = timestamps[index - 1] as number;
    const currentMs = timestamps[index] as number;
    const actualMs = currentMs - previousMs;
    if (actualMs <= 0) {
      throw new TimelineIntegrityError(
        `${datasetName}: timestamps must be strictly increasing; ` +
          `index ${index - 1}=${JSON.stringify(values[index - 1])}, ` +
          `index ${index}=${JSON.stringify(values[index])}`,
      );
    }
    if (expectedSpacingMs !== null && actualMs !== expectedSpacingMs) {
      anomalies.push({ previousMs, currentMs, actualMs, expectedMs: expectedSpacingMs });
    }
  }
  return anomalies;
}

/** Map records by their timestamp (Unix ms); duplicate timestamps throw. */
export function indexByTimestamp<T extends { timestamp: string }>(values: readonly T[]): Map<number, T> {
  const sorted = [...values].sort(
    (left, right) => normalizeTimestamp(left.timestamp) - normalizeTimestamp(right.timestamp),
  );
  validateTimestampSequence(
    sorted.map((value) => value.timestamp),
    null,
  );
  return new Map(sorted.map((value) => [normalizeTimestamp(value.timestamp), value]));
}

export function findNearestTimestamp(sortedTimestamps: readonly number[], targetMs: number): number | null {
  if (sortedTimestamps.length === 0) return null;
  let low = 0;
  let high = sortedTimestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sortedTimestamps[middle] as number) < targetMs) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return sortedTimestamps[0] as number;
  if (low === sortedTimestamps.length) return sortedTimestamps[sortedTimestamps.length - 1] as number;
  const previous = sortedTimestamps[low - 1] as number;
  const next = sortedTimestamps[low] as number;
  return targetMs - previous <= next - targetMs ? previous : next;
}

/** Start timestamp of the data interval containing `targetMs`. */
export function findTimestampAtOrBefore(
  sortedTimestamps: readonly number[],
  targetMs: number,
): number | null {
  if (sortedTimestamps.length === 0) return null;
  let low = 0;
  let high = sortedTimestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sortedTimestamps[middle] as number) <= targetMs) low = middle + 1;
    else high = middle;
  }
  return sortedTimestamps[Math.max(0, low - 1)] as number;
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

/** Calendar parts of an instant in `timeZone` ("auto", empty or invalid: UTC). */
export function getZonedDateParts(timestamp: TimestampValue, timeZone = "UTC"): ZonedDateParts {
  let resolvedTz: string;
  try {
    resolvedTz = !timeZone || timeZone === "auto" ? "UTC" : resolveTimezone(timeZone);
  } catch {
    resolvedTz = "UTC";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(normalizeTimestamp(timestamp)))) {
    parts[part.type] = part.value;
  }
  const { year = "", month = "", day = "", hour = "", minute = "", weekday = "" } = parts;
  return { year, month, day, hour, minute, weekday, dayKey: `${year}-${month}-${day}` };
}
