import type {
  ModelMetadata,
  RunSegment,
  WeatherModel,
  VerticalCloudTransition,
} from '../types';
import type { TimelineScale } from './timeline';
import {
  HOUR_MS,
  getBoundaryTimestamp,
  getZonedDateParts,
  normalizeTimestamp,
} from './timeline';
import { getPreviousLocalMidnight, type TimeRange } from './meteogramZoom';
import { getMetaForModel } from '../components/modelChain/modelChainBuilderUtils';

export interface DayGroupItem {
  dayKey: string;
  dateLabel: string;
  weekdayLabel: string;
  indices: number[];
}

export interface HeaderModelSegment {
  modelName: string;
  /** Header text: model name plus run, e.g. "ECMWF IFS (10/06Z06)". */
  label: string;
  /** Same with the catalogue nickname (`short_name`); null without one. */
  shortLabel: string | null;
  startX: number;
  endX: number;
}

/** Formats a run start as UTC "MM/DDZhh", e.g. "10/06Z06". */
export function formatRunLabel(runInitTime: string): string | null {
  const ms = normalizeTimestamp(runInitTime);
  if (isNaN(ms)) return null;
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}Z${pad(date.getUTCHours())}`;
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
 * Groups timestamps into days based on the local timezone.
 */
export function groupTimestampsByDay(
  timestamps: number[],
  resolvedTimezone: string,
): DayGroupItem[] {
  const groups: DayGroupItem[] = [];
  timestamps.forEach((ts, idx) => {
    const parts = getZonedDateParts(ts, resolvedTimezone);
    const { dayKey } = parts;
    const weekdayLabel = parts.weekday;
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
    const groupStartMs = timestamps[group.indices[0]];
    const nextGroup = dayGroups[index + 1];
    const groupEndMs = nextGroup
      ? timestamps[nextGroup.indices[0]]
      : timestamps[group.indices[group.indices.length - 1]] + HOUR_MS;
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
 */
export function calculateModelSegments(
  modelChain: WeatherModel[],
  forecastStartTime: string | undefined,
  timeline: TimelineScale,
  runSegmentsByModel?: Record<string, RunSegment[] | undefined>,
  availableModels?: Record<string, ModelMetadata>,
): HeaderModelSegment[] {
  const segments: HeaderModelSegment[] = [];

  const activeChain = modelChain.filter((m, idx) => {
    const prevH =
      idx > 0 ? modelChain[idx - 1].max_forecast_horizon_hours : 0;
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
      for (const piece of pieces) {
        const runLabel =
          isSplit && piece.run ? formatRunLabel(piece.run) : null;
        segments.push({
          modelName: model.name,
          label: runLabel ? `${model.name} (${runLabel})` : model.name,
          shortLabel: shortName
            ? runLabel
              ? `${shortName} (${runLabel})`
              : shortName
            : null,
          startX: timeline.timestampToX(startMs),
          endX: timeline.timestampToX(piece.endMs),
        });
        startMs = piece.endMs;
      }
    }
    segmentStartMs = Math.max(segmentStartMs, segmentEndMs);
    if (segmentStartMs >= timeline.endMs) break;
  }

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

