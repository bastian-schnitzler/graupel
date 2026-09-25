import type {
  DataPoint,
  DetailedCloudForecast,
  VerticalCloudProfile,
} from "../../types";
import {
  HOUR_MS,
  getZonedDateParts,
  normalizeTimestamp,
} from "../../utils/timeline";
import {
  buildIconSlots,
  aggregateThunderstorms,
} from "../../utils/thunderstormIcons";
import { WIND_ICON_FOOTPRINT_PX } from "./meteogramLayout";
import type { DayGroupRenderItem } from "./TimelineOverlay";

export const SEPARATOR_STROKE = "#cbd5e1";
export const SEPARATOR_STROKE_WIDTH = 1.2;
export const SEPARATOR_OPACITY = 1;

/**
 * Builds a Map of timestamps (ms) to a record of weather variables and their DataPoints.
 */
export function buildDataPointTimeMap(
  data: DataPoint[],
): Map<number, Record<string, DataPoint>> {
  const map = new Map<number, Record<string, DataPoint>>();
  data.forEach((pt) => {
    const timeMs = normalizeTimestamp(pt.timestamp);
    if (!map.has(timeMs)) {
      map.set(timeMs, {});
    }
    map.get(timeMs)![pt.variable] = pt;
  });
  return map;
}

/**
 * Extracts wind direction values from the time map for valid numeric timestamps.
 */
export function extractWindDirectionSamples(
  timestamps: number[],
  timeMap: Map<number, Record<string, DataPoint>>,
): Array<{ timeMs: number; direction: number; model: string }> {
  return timestamps.flatMap((timestamp) => {
    const direction = timeMap.get(timestamp)?.["wind_direction"]?.value;
    return typeof direction === "number" && Number.isFinite(direction)
      ? [
          {
            timeMs: timestamp,
            direction,
            model: timeMap.get(timestamp)?.["wind_direction"]?.model || "",
          },
        ]
      : [];
  });
}

/**
 * Builds a Map of timestamps (ms) to vertical cloud profiles.
 */
export function buildVerticalCloudMap(
  verticalCloudForecast?: DetailedCloudForecast | null,
): Map<number, VerticalCloudProfile> {
  const map = new Map<number, VerticalCloudProfile>();
  if (verticalCloudForecast?.profiles) {
    verticalCloudForecast.profiles.forEach((p) => {
      if (p && p.timestamp) {
        map.set(normalizeTimestamp(p.timestamp), p);
      }
    });
  }
  return map;
}

export interface CalculateIconSlotsParams {
  dayGroups: Array<{ dayKey: string; indices: number[] }>;
  timestamps: number[];
  timeline: { startMs: number; endMs: number; leftX: number; rightX: number };
  embeddedWidth?: number;
  fullscreenWidth?: number;
  svgWidth: number;
}

/**
 * Calculates icon placement slots for both embedded and fullscreen chart view modes.
 */
export function calculateIconSlotsByMode(params: CalculateIconSlotsParams) {
  const days = params.dayGroups.map((group, index) => ({
    id: group.dayKey,
    start: params.timestamps[group.indices[0]],
    end: params.dayGroups[index + 1]
      ? params.timestamps[params.dayGroups[index + 1].indices[0]]
      : params.timeline.endMs,
  }));
  const calculateSlots = (width: number) =>
    buildIconSlots(
      days,
      params.timeline.startMs,
      params.timeline.endMs,
      ((params.timeline.rightX - params.timeline.leftX) * width) /
        params.svgWidth /
        (params.timeline.endMs - params.timeline.startMs),
      WIND_ICON_FOOTPRINT_PX,
    );
  return {
    embedded: calculateSlots(params.embeddedWidth || params.svgWidth),
    fullscreen: calculateSlots(params.fullscreenWidth || params.svgWidth),
  };
}

/**
 * Aggregates thunderstorm icons per mode based on slot layouts and forecast data.
 */
export function calculateThunderstormIconsByMode(
  iconSlotsByMode: { embedded: any[]; fullscreen: any[] },
  data: DataPoint[],
) {
  return {
    embedded: aggregateThunderstorms(iconSlotsByMode.embedded, data),
    fullscreen: aggregateThunderstorms(iconSlotsByMode.fullscreen, data),
  };
}

export interface PrepareRenderDayGroupsParams {
  visibleDayGroups: Array<{
    dayKey: string;
    indices: number[];
    dateLabel: string;
    weekdayLabel: string;
  }>;
  dayGroups: Array<{ dayKey: string; indices: number[] }>;
  timestamps: number[];
  getX: (ts: number | string) => number;
  outerLeftX: number;
  outerRightX: number;
  resolvedTimezone: string;
}

/**
 * Prepares and clamps visible day group rendering parameters, day labels, and boundary lines.
 */
export function prepareRenderDayGroups({
  visibleDayGroups,
  dayGroups,
  timestamps,
  getX,
  outerLeftX,
  outerRightX,
  resolvedTimezone,
}: PrepareRenderDayGroupsParams): DayGroupRenderItem[] {
  return visibleDayGroups
    .map((group) => {
      const rawFirstX = getX(timestamps[group.indices[0]]);
      const fullIndex = dayGroups.findIndex((g) => g.dayKey === group.dayKey);
      const nextGroup = dayGroups[fullIndex + 1];
      const rawRightX = nextGroup
        ? getX(timestamps[nextGroup.indices[0]])
        : getX(timestamps[group.indices[group.indices.length - 1]] + HOUR_MS);
      const firstX = Math.max(outerLeftX, rawFirstX);
      const rightX = Math.min(outerRightX, rawRightX);
      if (rightX <= firstX) return null;
      const blockWidth = rightX - firstX;
      const isEven = fullIndex % 2 === 0;

      const isDayStart =
        group.indices.length > 0 &&
        getZonedDateParts(timestamps[group.indices[0]], resolvedTimezone)
          .hour === "00";
      const isBoundaryVisible =
        isDayStart &&
        rawFirstX >= outerLeftX - 0.5 &&
        rawFirstX <= outerRightX + 0.5;
      const boundaryX = Math.max(outerLeftX, Math.min(outerRightX, rawFirstX));

      return {
        dayKey: group.dayKey,
        firstX,
        rightX,
        blockWidth,
        isEven,
        isBoundaryVisible,
        boundaryX,
        dateLabel: group.dateLabel,
        weekdayLabel: group.weekdayLabel,
      };
    })
    .filter(Boolean) as DayGroupRenderItem[];
}
