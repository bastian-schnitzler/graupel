import type { WeatherModel, VerticalCloudTransition } from '../types';
import type { TimelineScale } from './timeline';
import {
  HOUR_MS,
  getBoundaryTimestamp,
  getZonedDateParts,
  normalizeTimestamp,
} from './timeline';
import { getPreviousLocalMidnight, type TimeRange } from './meteogramZoom';

export interface DayGroupItem {
  dayKey: string;
  dateLabel: string;
  weekdayLabel: string;
  indices: number[];
}

export interface HeaderModelSegment {
  modelName: string;
  startX: number;
  endX: number;
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
 * Calculates startX and endX coordinates for each active weather model in the header row.
 */
export function calculateModelSegments(
  modelChain: WeatherModel[],
  forecastStartTime: string | undefined,
  timeline: TimelineScale,
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
      segments.push({
        modelName: model.name,
        startX: timeline.timestampToX(segmentStartMs),
        endX: timeline.timestampToX(segmentEndMs),
      });
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

