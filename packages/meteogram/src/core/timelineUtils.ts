// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type {
  ModelInfo,
  RunSegment,
  WeatherModel,
  VerticalCloudTransition,
} from './types';
import type { TimelineScale } from "./timeline";
import {
  HOUR_MS,
  getBoundaryTimestamp,
  getZonedDateParts,
  normalizeTimestamp,
} from "./timeline";
import { getPreviousLocalMidnight, type TimeRange } from "./zoom";
import { getMetaForModel } from "./models";
import { DEFAULT_LOCALE, formatWeekdayShort } from "./texts";

export interface DayGroupItem {
  dayKey: string;
  dateLabel: string;
  weekdayLabel: string;
  indices: number[];
}

export interface HeaderModelSegment {
  modelName: string;
  /** Catalogue id of the model, when the chain names one. */
  modelId?: string;
  /** Header text: model name plus run, e.g. "ECMWF IFS (06 Z06)" (REQ-695). */
  label: string;
  /** Same with the catalogue nickname (`short_name`); null without one. */
  shortLabel: string | null;
  /** Run of a split series ("06 Z06", or "31/10" by REQ-697); absent for an unsplit model. */
  runLabel?: string;
  startX: number;
  endX: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Basic form of a run start: day, a space, Z and hour in UTC, e.g. "07 Z06"
 * (REQ-695, DEC-072). The only place that spells it.
 */
const runDayHour = (date: Date) => `${pad2(date.getUTCDate())} Z${pad2(date.getUTCHours())}`;

/** Separator of day and month in a run shown by its date alone, e.g. "31/10" (REQ-697). */
const RUN_DATE_SEPARATOR = "/";

/** A run start as a date; null when it cannot be read. */
function parseRunInitTime(runInitTime: string): Date | null {
  try {
    return new Date(normalizeTimestamp(runInitTime));
  } catch {
    return null;
  }
}

/** Formats a run start in the basic form, day and hour in UTC: "07 Z06" (REQ-695). */
export function formatRunLabel(runInitTime: string): string | null {
  const date = parseRunInitTime(runInitTime);
  return date ? runDayHour(date) : null;
}

const monthFirstByLocale = new Map<string, boolean>();

/** Whether the locale writes the month before the day ("10/31" in en-US, "31.10." in de). */
function isMonthFirst(locale: string): boolean {
  let monthFirst = monthFirstByLocale.get(locale);
  if (monthFirst === undefined) {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).formatToParts(0);
    } catch {
      // An invalid locale tag: the order of the default locale.
      parts = new Intl.DateTimeFormat(DEFAULT_LOCALE, { day: "2-digit", month: "2-digit", timeZone: "UTC" })
        .formatToParts(0);
    }
    const types = parts.map((part) => part.type);
    monthFirst = types.indexOf("month") < types.indexOf("day");
    monthFirstByLocale.set(locale, monthFirst);
  }
  return monthFirst;
}

/**
 * A run start as its UTC date alone, day and month in the order of the
 * locale, e.g. "31/10" (de) or "10/31" (en-US) (REQ-697).
 */
function formatRunDate(date: Date, locale: string): string {
  const day = pad2(date.getUTCDate());
  const month = pad2(date.getUTCMonth() + 1);
  return isMonthFirst(locale)
    ? `${month}${RUN_DATE_SEPARATOR}${day}`
    : `${day}${RUN_DATE_SEPARATOR}${month}`;
}

/**
 * Labels of all runs one header of a split model shows, in the given order
 * (REQ-695, REQ-697). The form depends on all of them, days in UTC:
 * - every run on a day of its own: the date alone, "31/10" and "01/11"
 *   (order of day and month by `locale`);
 * - runs in different months with several on one day: a day with a single run
 *   as its date ("31/10"), the runs of a day with several in the basic form
 *   ("01 Z06", "01 Z12");
 * - otherwise the basic form "07 Z06" for all.
 * A single run keeps the basic form; an unreadable time gives null.
 */
export function formatRunLabels(
  runInitTimes: readonly string[],
  locale: string = DEFAULT_LOCALE,
): (string | null)[] {
  const dates = runInitTimes.map(parseRunInitTime);
  const valid = dates.filter((date): date is Date => date !== null);
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const runsPerDay = new Map<string, number>();
  for (const date of valid) runsPerDay.set(dayKey(date), (runsPerDay.get(dayKey(date)) ?? 0) + 1);
  const months = new Set(valid.map((date) => dayKey(date).slice(0, 7)));
  const allOnOwnDays = valid.length > 1 && runsPerDay.size === valid.length;
  const acrossMonths = months.size > 1;
  return dates.map((date) => {
    if (!date) return null;
    const alone = runsPerDay.get(dayKey(date)) === 1;
    if (allOnOwnDays || (acrossMonths && alone)) return formatRunDate(date, locale);
    return runDayHour(date);
  });
}

export interface CloudTransitionWithX extends VerticalCloudTransition {
  timestampMs: number;
  x: number;
}

interface CalculateMeteogramMaximumRangeParams {
  resolvedTimelineStart?: number;
  resolvedTimelineEnd?: number;
  effectiveNow: number;
  resolvedTimezone: string;
}

/**
 * Calculates the total permissible time range bounding the meteogram display.
 */
export function calculateMeteogramMaximumRange({
  resolvedTimelineStart,
  resolvedTimelineEnd,
  effectiveNow,
  resolvedTimezone,
}: CalculateMeteogramMaximumRangeParams): TimeRange | null {
  if (
    resolvedTimelineStart === undefined ||
    resolvedTimelineEnd === undefined
  ) {
    return null;
  }

  const maximumEnd = resolvedTimelineEnd;
  const previousMidnight = getPreviousLocalMidnight(
    effectiveNow,
    resolvedTimezone,
  );
  const isCurrentForecast =
    effectiveNow >= resolvedTimelineStart && effectiveNow <= maximumEnd;
  const hasForecastSizedWindow =
    maximumEnd - resolvedTimelineStart >= 24 * HOUR_MS;

  let maximumStart = resolvedTimelineStart;
  if (isCurrentForecast && hasForecastSizedWindow) {
    if (
      resolvedTimelineStart <= previousMidnight &&
      previousMidnight - resolvedTimelineStart <= 24 * HOUR_MS
    ) {
      maximumStart = previousMidnight;
    }
  }
  return maximumEnd > maximumStart
    ? { start: maximumStart, end: maximumEnd }
    : null;
}

/**
 * Groups timestamps into days based on the local timezone; weekday names in
 * the given locale (default `en-US`).
 */
export function groupTimestampsByDay(
  timestamps: number[],
  resolvedTimezone: string,
  locale: string = DEFAULT_LOCALE,
): DayGroupItem[] {
  const groups: DayGroupItem[] = [];
  timestamps.forEach((ts, idx) => {
    const parts = getZonedDateParts(ts, resolvedTimezone);
    const { dayKey } = parts;
    const lastDay = groups[groups.length - 1];
    const weekdayLabel =
      locale === DEFAULT_LOCALE || lastDay?.dayKey === dayKey
        ? parts.weekday
        : formatWeekdayShort(ts, resolvedTimezone, locale);
    const dateLabel = `${parts.day}.${parts.month}`;

    let lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.dayKey !== dayKey) {
      lastGroup = { dayKey, dateLabel, weekdayLabel, indices: [] };
      groups.push(lastGroup);
    }
    lastGroup.indices.push(idx);
  });
  return groups;
}

/**
 * Filters day groups to only those that intersect the visible timeline range.
 */
export function filterVisibleDayGroups(
  dayGroups: DayGroupItem[],
  timestamps: number[],
  timeline: TimelineScale | null,
): DayGroupItem[] {
  if (!timeline) return dayGroups;
  return dayGroups.filter((group, index) => {
    const groupStartMs = timestamps[group.indices[0]!]!;
    const nextGroup = dayGroups[index + 1];
    const groupEndMs = nextGroup
      ? timestamps[nextGroup.indices[0]!]!
      : timestamps[group.indices[group.indices.length - 1]!]! + HOUR_MS;
    return groupEndMs > timeline.startMs && groupStartMs < timeline.endMs;
  });
}

/**
 * Finds models in the chain that have zero forecast horizon span (resized to 0 hours).
 */
export function calculateZeroSpanModelNames(
  modelChain: WeatherModel[],
): Set<string> {
  const zeroSet = new Set<string>();
  let prevH = 0;
  for (const m of modelChain) {
    const span = Math.max(0, m.max_forecast_horizon_hours - prevH);
    if (span === 0) {
      if (m.name) zeroSet.add(m.name.toLowerCase());
      if (m.id) zeroSet.add(m.id.toLowerCase());
    }
    prevH = Math.max(prevH, m.max_forecast_horizon_hours);
  }
  return zeroSet;
}

/**
 * Returns the run that delivers a model's value at `timestampMs`: each hour
 * belongs to the run segment covering it (newest first, open ends null).
 */
export function findRunAt(
  runSegments: RunSegment[] | undefined,
  timestampMs: number,
): RunSegment | undefined {
  return runSegments?.find(
    (run) =>
      (!run.valid_from || normalizeTimestamp(run.valid_from) <= timestampMs) &&
      (!run.valid_until || timestampMs < normalizeTimestamp(run.valid_until)),
  );
}

/**
 * Calculates startX and endX coordinates for each active weather model in the header row.
 * The last segment always ends at the right edge of the timeline. The runs of
 * a split model are labelled by `formatRunLabels` in `locale` (REQ-695, REQ-697).
 */
export function calculateModelSegments(
  modelChain: WeatherModel[],
  forecastStartTime: string | undefined,
  timeline: TimelineScale,
  runSegmentsByModel?: Record<string, RunSegment[] | undefined>,
  availableModels?: Record<string, ModelInfo>,
  locale: string = DEFAULT_LOCALE,
): HeaderModelSegment[] {
  const segments: HeaderModelSegment[] = [];

  const activeChain = modelChain.filter((m, idx) => {
    const prevH =
      idx > 0 ? modelChain[idx - 1]!.max_forecast_horizon_hours : 0;
    return m.max_forecast_horizon_hours > prevH;
  });
  const effectiveChain = activeChain.length > 0 ? activeChain : modelChain;
  if (effectiveChain.length === 0) return segments;
  const forecastStartMs = forecastStartTime
    ? normalizeTimestamp(forecastStartTime)
    : timeline.startMs;
  let segmentStartMs = timeline.startMs;

  for (const model of effectiveChain) {
    const configuredEndMs = getBoundaryTimestamp(
      forecastStartMs,
      model.max_forecast_horizon_hours,
    );
    const segmentEndMs = Math.min(timeline.endMs, configuredEndMs);
    if (segmentEndMs > segmentStartMs) {
      // Open-Meteo mixes runs: one header (and boundary line) per run.
      const runs = runSegmentsByModel?.[model.name] ?? [];
      let pieceStartMs = segmentStartMs;
      const pieces: { endMs: number; run?: string }[] = [];
      runs.forEach((run, idx) => {
        const runEndMs =
          run.valid_until && idx < runs.length - 1
            ? normalizeTimestamp(run.valid_until)
            : Infinity;
        const pieceEndMs = Math.min(segmentEndMs, runEndMs);
        if (pieceEndMs > pieceStartMs) {
          pieces.push({ endMs: pieceEndMs, run: run.run_init_time });
          pieceStartMs = pieceEndMs;
        }
      });
      if (pieces.length === 0 || pieceStartMs < segmentEndMs) {
        pieces.push({ endMs: segmentEndMs });
      }
      let startMs = segmentStartMs;
      // Only split series name their runs; a single run stays plain.
      const isSplit = pieces.filter((piece) => piece.run).length > 1;
      const shortName =
        model.short_name ?? getMetaForModel(model, availableModels)?.short_name;
      // The labels depend on all runs of this header (REQ-697).
      const runLabels = isSplit
        ? formatRunLabels(
            pieces.flatMap((piece) => (piece.run ? [piece.run] : [])),
            locale,
          )
        : [];
      let runIndex = 0;
      for (const piece of pieces) {
        const runLabel =
          isSplit && piece.run ? (runLabels[runIndex++] ?? null) : null;
        segments.push({
          modelName: model.name,
          ...(model.id !== undefined ? { modelId: model.id } : {}),
          label: runLabel ? `${model.name} (${runLabel})` : model.name,
          shortLabel: shortName
            ? runLabel
              ? `${shortName} (${runLabel})`
              : shortName
            : null,
          ...(runLabel ? { runLabel } : {}),
          startX: timeline.timestampToX(startMs),
          endX: timeline.timestampToX(piece.endMs),
        });
        startMs = piece.endMs;
      }
    }
    segmentStartMs = Math.max(segmentStartMs, segmentEndMs);
    if (segmentStartMs >= timeline.endMs) break;
  }

  // The last header reaches the right edge of the drawing area, even when
  // the last model's series ends before it (REQ-466).
  const last = segments[segments.length - 1];
  if (last) last.endX = Math.max(last.endX, timeline.timestampToX(timeline.endMs));

  return segments;
}

/**
 * Maps vertical cloud transitions to their pixel X coordinates on the active timeline scale.
 */
export function calculateCloudTransitionCoordinates(
  verticalCloudTransitions: VerticalCloudTransition[],
  timeline: TimelineScale,
): CloudTransitionWithX[] {
  return verticalCloudTransitions.flatMap((transition) => {
    const timestampMs = normalizeTimestamp(transition.timestamp);
    return timeline.contains(timestampMs)
      ? [
          {
            ...transition,
            timestampMs,
            x: timeline.timestampToX(timestampMs),
          },
        ]
      : [];
  });
}

