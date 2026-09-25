import type { DataPoint } from '../types';

export interface DailyExtremeItem {
  dayKey: string;
  max: {
    x: number;
    y: number;
    text: string;
    rawVal: number;
    visible: boolean;
  };
  min: {
    x: number;
    y: number;
    text: string;
    rawVal: number;
    visible: boolean;
  };
}

/**
 * Calculates the global temperature Y-axis minimum and maximum considering both
 * real temperature and apparent temperature across all model forecasts.
 */
export function calculateTemperatureExtremes(
  modelForecasts: Record<string, DataPoint[]> | undefined,
  tempValues: (number | null)[],
  apparentTempValues: (number | null)[],
): { minTemp: number; maxTemp: number } {
  let globalMin = Infinity;
  let globalMax = -Infinity;

  if (modelForecasts && typeof modelForecasts === 'object') {
    for (const pts of Object.values(modelForecasts)) {
      if (!Array.isArray(pts)) continue;
      for (const pt of pts) {
        if (
          pt &&
          (pt.variable === 'temperature' ||
            pt.variable === 'apparent_temperature') &&
          typeof pt.value === 'number' &&
          !isNaN(pt.value)
        ) {
          if (pt.value < globalMin) globalMin = pt.value;
          if (pt.value > globalMax) globalMax = pt.value;
        }
      }
    }
  }

  for (const v of [...tempValues, ...apparentTempValues]) {
    if (typeof v === 'number' && !isNaN(v)) {
      if (v < globalMin) globalMin = v;
      if (v > globalMax) globalMax = v;
    }
  }

  const rawMin = globalMin !== Infinity ? globalMin : 0;
  const rawMax = globalMax !== -Infinity ? globalMax : 20;

  let min = Math.floor(rawMin - 2);
  let max = Math.ceil(rawMax + 2);

  if (rawMin <= 15 && min > 0) {
    min = 0;
  }
  if (rawMax >= -15 && max < 0) {
    max = 0;
  }

  return { minTemp: min, maxTemp: max };
}

/**
 * Calculates the maximum precipitation across all models to fix the precip Y-axis.
 */
export function calculateMaxPrecipitation(
  maxPrecipitation: number | undefined,
  modelForecasts: Record<string, DataPoint[]> | undefined,
  validPrecip: number[],
): number {
  if (typeof maxPrecipitation === 'number' && maxPrecipitation >= 0) {
    return maxPrecipitation;
  }

  let max = 0;
  if (modelForecasts && typeof modelForecasts === 'object') {
    for (const pts of Object.values(modelForecasts)) {
      if (!Array.isArray(pts)) continue;
      for (const pt of pts) {
        if (
          pt &&
          pt.variable === 'precipitation' &&
          typeof pt.value === 'number' &&
          !isNaN(pt.value) &&
          pt.value > max &&
          pt.value >= 0
        ) {
          max = pt.value;
        }
      }
    }
  }

  for (const val of validPrecip) {
    if (val > max) {
      max = val;
    }
  }

  return max;
}

interface CalculateDailyTemperatureExtremesParams {
  dayGroups: { dayKey: string; indices: number[] }[];
  timestamps: number[];
  tempValues: (number | null)[];
  minTemp: number;
  maxTemp: number;
  tempHeight: number;
  tempTop: number;
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  timeline: { contains: (ts: number) => boolean };
  getX: (ts: number) => number;
}

/**
 * Calculates daily min and max temperature labels and suppresses colliding badges across day borders.
 */
export function calculateDailyTemperatureExtremes({
  dayGroups,
  timestamps,
  tempValues,
  minTemp,
  maxTemp,
  tempHeight,
  tempTop,
  paddingLeft,
  paddingRight,
  svgWidth,
  timeline,
  getX,
}: CalculateDailyTemperatureExtremesParams): DailyExtremeItem[] {
  const tempUsableHeight = tempHeight - 22 - 10;
  const tempRange = maxTemp - minTemp || 1;

  const result = dayGroups
    .map((group) => {
      const validPoints: { idx: number; val: number }[] = [];
      for (const idx of group.indices) {
        if (!timeline.contains(timestamps[idx])) continue;
        const val = tempValues[idx];
        if (typeof val === 'number' && !isNaN(val)) {
          validPoints.push({ idx, val });
        }
      }

      if (validPoints.length === 0) return null;

      let maxVal = -Infinity;
      let minVal = Infinity;
      for (const pt of validPoints) {
        if (pt.val > maxVal) maxVal = pt.val;
        if (pt.val < minVal) minVal = pt.val;
      }

      const maxCandidates = validPoints.filter((pt) => pt.val === maxVal);
      const minCandidates = validPoints.filter((pt) => pt.val === minVal);

      // Pick middle candidate if plateau
      const maxPt = maxCandidates[Math.floor(maxCandidates.length / 2)];
      const minPt = minCandidates[Math.floor(minCandidates.length / 2)];

      const maxX = getX(timestamps[maxPt.idx]);
      const maxNorm = (maxPt.val - minTemp) / tempRange;
      const maxY = tempTop + tempHeight - 10 - maxNorm * tempUsableHeight;

      const minX = getX(timestamps[minPt.idx]);
      const minNorm = (minPt.val - minTemp) / tempRange;
      const minY = tempTop + tempHeight - 10 - minNorm * tempUsableHeight;

      const formatTemp = (v: number) => {
        const rounded = Math.round(v);
        return `${Object.is(rounded, -0) ? 0 : rounded}°C`;
      };

      return {
        dayKey: group.dayKey,
        max: {
          x: Math.max(
            paddingLeft + 14,
            Math.min(svgWidth - paddingRight - 14, maxX),
          ),
          y: Math.max(tempTop + 10, maxY - 6),
          text: formatTemp(maxPt.val),
          rawVal: maxPt.val,
          visible: true,
        },
        min: {
          x: Math.max(
            paddingLeft + 14,
            Math.min(svgWidth - paddingRight - 14, minX),
          ),
          y: Math.min(tempTop + tempHeight - 2, minY + 12),
          text: formatTemp(minPt.val),
          rawVal: minPt.val,
          visible: true,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Collision detection: helper to check if two labels touch
  const labelsTouch = (
    lblA: { x: number; y: number; text: string },
    lblB: { x: number; y: number; text: string },
  ) => {
    const wA = Math.max(22, lblA.text.length * 6.5 + 4);
    const wB = Math.max(22, lblB.text.length * 6.5 + 4);
    const touchThresholdX = Math.max(44, (wA + wB) / 2 + 8); // text bounding box overlap or touching margin
    const touchThresholdY = 26; // font height ~11px + 3px halo + vertical collision buffer

    return (
      Math.abs(lblA.x - lblB.x) < touchThresholdX &&
      Math.abs(lblA.y - lblB.y) < touchThresholdY
    );
  };

  // If two labels touch at the border of a day, show the smaller one
  for (let i = 0; i < result.length - 1; i++) {
    const itemA = result[i];
    const itemB = result[i + 1];

    if (
      itemA.min.visible &&
      itemB.min.visible &&
      labelsTouch(itemA.min, itemB.min)
    ) {
      if (itemA.min.rawVal >= itemB.min.rawVal) {
        itemA.min.visible = false;
      } else {
        itemB.min.visible = false;
      }
    }

    if (
      itemA.max.visible &&
      itemB.max.visible &&
      labelsTouch(itemA.max, itemB.max)
    ) {
      if (itemA.max.rawVal >= itemB.max.rawVal) {
        itemA.max.visible = false;
      } else {
        itemB.max.visible = false;
      }
    }
  }

  return result;
}

