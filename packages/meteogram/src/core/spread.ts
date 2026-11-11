// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Dew point and spread (REQ-595, REQ-604, REQ-620): whether and where a spread series (a line with `fillTo`, in the
 * built-in layouts the dew point below the temperature) is drawn, and how far it lowers its axis. Pure functions on the
 * hourly values of the chart's timeline.
 */
import type { TimeRange } from "./zoom";

/**
 * Visibility of the spread series (render option `dewPoint`, default `"off"`): `"on"` everywhere, `"off"` nowhere,
 * `"auto"` as `"on"` when, in the displayed range, the spread is at most `SPREAD_AUTO_MAX_K` or the dew point reaches
 * `DEW_POINT_AUTO_MIN_C` somewhere (REQ-604) and the temperature reaches `TEMPERATURE_AUTO_MIN_C` somewhere
 * (REQ-620), else as `"off"`.
 */
export type DewPointMode = "auto" | "on" | "off";

export const DEW_POINT_MODES: readonly DewPointMode[] = ["auto", "on", "off"];

/** Auto: shown when the spread (upper line minus the series) is at most this many kelvin somewhere … */
export const SPREAD_AUTO_MAX_K = 5;
/** … or when the series (dew point) reaches this value (°C) somewhere, … */
export const DEW_POINT_AUTO_MIN_C = 15;
/** … and only when the upper line (temperature) reaches this value (°C) somewhere (REQ-620). */
export const TEMPERATURE_AUTO_MIN_C = 5;
/** A visible spread series lowers its axis so far that a spread of this many kelvin is visible. */
export const SPREAD_AXIS_K = 5;

export function isDewPointMode(value: unknown): value is DewPointMode {
  return typeof value === "string" && (DEW_POINT_MODES as readonly string[]).includes(value);
}

/** A point of a stretch: time (epoch ms), value of the upper line (temperature) and of the series (dew point). */
export interface SpreadPoint {
  time: number;
  upper: number;
  lower: number;
}

/** Consecutive hours of the timeline that have both values; the series is drawn along them. */
export type SpreadStretch = SpreadPoint[];

// Tolerance for values on a threshold (e.g. 14.1 − 9.1 is not exactly 5 in floating point).
const EPSILON = 1e-9;

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The spread condition of Auto at one point: spread at most 5 K or dew point at least 15 °C (REQ-604). */
const spreadConditionAt = ([upper, lower]: readonly number[]) =>
  upper! - lower! <= SPREAD_AUTO_MAX_K + EPSILON || lower! >= DEW_POINT_AUTO_MIN_C - EPSILON;

/** The temperature condition of Auto at one point: the upper line at least 5 °C (REQ-620). */
const temperatureConditionAt = ([upper]: readonly number[]) => upper! >= TEMPERATURE_AUTO_MIN_C - EPSILON;

/**
 * Whether `condition` holds anywhere in `range` (default: everywhere) on the lines `lines` (one value per entry of
 * `timestamps` each): at an hour where every line has a value or between two such hours, linearly interpolated. Each
 * condition is linear between two hours (or an "or" of linear ones), so it holds somewhere on the part of the lines
 * inside `range` exactly when it holds at one end of that part.
 */
function holdsSomewhere(
  timestamps: readonly number[],
  lines: readonly (readonly (number | null | undefined)[])[],
  range: TimeRange | null | undefined,
  condition: (values: readonly number[]) => boolean,
): boolean {
  const start = range?.start ?? -Infinity;
  const end = range?.end ?? Infinity;
  const valuesAt = (index: number): number[] | null => {
    const values: number[] = [];
    for (const line of lines) {
      const value = line[index];
      if (!isFiniteNumber(value)) return null;
      values.push(value);
    }
    return values;
  };
  for (let index = 0; index < timestamps.length; index++) {
    const t0 = timestamps[index]!;
    const v0 = valuesAt(index);
    if (!v0) continue;
    if (t0 >= start && t0 <= end && condition(v0)) return true;
    const t1 = timestamps[index + 1];
    if (t1 === undefined || !(t1 > t0)) continue;
    const v1 = valuesAt(index + 1);
    if (!v1) continue;
    // The part of the lines from this hour to the next that lies in the range, checked at its ends.
    const from = Math.max(t0, start);
    const to = Math.min(t1, end);
    if (from > to) continue;
    for (const time of [from, to]) {
      const t = (time - t0) / (t1 - t0);
      if (condition(v0.map((value, line) => value + t * (v1[line]! - value)))) return true;
    }
  }
  return false;
}

/**
 * The Auto condition in `range`: the spread condition (REQ-604) somewhere where both lines have values, and the
 * upper line (temperature) at least 5 °C somewhere, with or without a value of the series there (REQ-620).
 */
const autoConditionHolds = (
  timestamps: readonly number[],
  upper: readonly (number | null | undefined)[],
  lower: readonly (number | null | undefined)[],
  range: TimeRange | null | undefined,
) =>
  holdsSomewhere(timestamps, [upper], range, temperatureConditionAt) &&
  holdsSomewhere(timestamps, [upper, lower], range, spreadConditionAt);

/**
 * Stretches where a spread series is drawn, from the hourly values of its upper line (`upper`, temperature) and its
 * own (`lower`, dew point) on `timestamps`. A stretch needs both values; stretches of a single point (nothing to draw)
 * are left out. `"on"` draws wherever both values are. `"auto"` (REQ-604, REQ-620) only decides whether the series
 * appears: when, in `range` (the displayed range, default the whole of `timestamps`; at an hour or between two hours,
 * linearly interpolated), the spread is at most 5 K or the dew point at least 15 °C somewhere and the upper line
 * (temperature) reaches 5 °C somewhere, the result is that of `"on"` over all of `timestamps`, else none, as `"off"`.
 */
export function calculateSpreadStretches(
  timestamps: readonly number[],
  upper: readonly (number | null | undefined)[],
  lower: readonly (number | null | undefined)[],
  mode: DewPointMode,
  range?: TimeRange | null,
): SpreadStretch[] {
  if (mode !== "on" && mode !== "auto") return [];
  if (mode === "auto" && !autoConditionHolds(timestamps, upper, lower, range)) return [];
  const stretches: SpreadStretch[] = [];
  let current: SpreadPoint[] = [];
  const close = () => {
    if (current.length >= 2) stretches.push(current);
    current = [];
  };
  timestamps.forEach((time, index) => {
    const upperValue = upper[index];
    const lowerValue = lower[index];
    if (isFiniteNumber(upperValue) && isFiniteNumber(lowerValue)) {
      current.push({ time, upper: upperValue, lower: lowerValue });
    } else close();
  });
  close();
  return stretches;
}

/**
 * Lowest value the axis of a spread series has to show (REQ-595): the minimum of max(series, upper line − 5 K) over
 * the stretches, so a spread of up to 5 K is visible and a lower dew point is cut off. Null without stretches.
 */
export function spreadAxisFloor(stretches: readonly SpreadStretch[], spreadK: number = SPREAD_AXIS_K): number | null {
  let lowest: number | null = null;
  const consider = (value: number) => {
    lowest = lowest === null ? value : Math.min(lowest, value);
  };
  for (const stretch of stretches) {
    stretch.forEach((point, index) => {
      consider(Math.max(point.lower, point.upper - spreadK));
      const next = stretch[index + 1];
      if (!next) return;
      // Between two points max(series, upper − 5 K) is lowest where both are equal (a spread of 5 K), if it lies there.
      const before = point.upper - point.lower - spreadK;
      const after = next.upper - next.lower - spreadK;
      if ((before < 0 && after > 0) || (before > 0 && after < 0)) {
        const t = before / (before - after);
        consider(point.lower + t * (next.lower - point.lower));
      }
    });
  }
  return lowest;
}
