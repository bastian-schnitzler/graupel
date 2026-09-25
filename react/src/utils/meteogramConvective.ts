import type { DataPoint, WeatherModel } from "../types";
import { HOUR_MS } from "./timeline";

export interface LpiSegment {
  path: string;
  model: string;
  endTime: number;
  lastY: number;
}

/**
 * Calculates convective Y-axis limits for CAPE and CIN with a 10% safety margin.
 */
export function calculateConvectiveExtremes(
  modelForecasts: Record<string, DataPoint[]> | undefined,
  data: DataPoint[],
): { capeMax: number; cinMax: number } {
  let capeMaximum = 1;
  let cinMaximum = 1;
  const datasets = modelForecasts
    ? [...Object.values(modelForecasts), data]
    : [data];
  for (const points of datasets) {
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (point.value === null || !Number.isFinite(point.value)) continue;
      if (point.variable === "cape")
        capeMaximum = Math.max(capeMaximum, Math.max(0, point.value));
      if (point.variable === "convective_inhibition")
        cinMaximum = Math.max(cinMaximum, Math.abs(point.value));
    }
  }
  return {
    capeMax: Math.ceil(capeMaximum * 1.1),
    cinMax: Math.ceil(cinMaximum * 1.1),
  };
}

/**
 * Checks whether the given weather model supports the lightning potential index (LPI).
 */
export function isLpiSupportedByModel(
  modelName: string | undefined,
  modelChain: WeatherModel[],
  availableModels?: Record<string, any>,
): boolean {
  if (!modelName) return false;
  const normalize = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const chainModel = modelChain.find((m) =>
    [m.name, m.id].some((n) => n && normalize(n) === normalize(modelName)),
  );
  const metadata =
    Object.entries(availableModels || {}).find(([key, m]) =>
      [key, m.name, m.id].some(
        (n) =>
          n &&
          [modelName, chainModel?.id, chainModel?.name].some(
            (id) => id && normalize(n) === normalize(id),
          ),
      ),
    )?.[1] || chainModel;
  return (
    metadata?.supported_variables?.includes("lightning_potential") === true
  );
}

/**
 * Retrieves valid LPI data point for a specific timestamp.
 */
export function getLpiAtTimestamp(
  ts: number,
  timeMap: Map<number, Record<string, DataPoint>>,
  modelChain: WeatherModel[],
  availableModels?: Record<string, any>,
): DataPoint | null {
  const fields = timeMap.get(ts);
  const point = fields?.["lightning_potential"];
  const activeModel =
    fields?.["cape"]?.model ||
    fields?.["convective_inhibition"]?.model ||
    fields?.["temperature"]?.model ||
    point?.model;
  return point &&
    point.model === activeModel &&
    isLpiSupportedByModel(activeModel, modelChain, availableModels) &&
    point.value !== null &&
    Number.isFinite(point.value)
    ? point
    : null;
}

/**
 * Assembles stepped LPI svg paths segmented by weather model.
 */
export function buildLpiSegments(
  timestamps: number[],
  timeMap: Map<number, Record<string, DataPoint>>,
  modelChain: WeatherModel[],
  availableModels: Record<string, any> | undefined,
  convectiveZero: number,
  convectiveHalfHeight: number,
  getX: (ts: number) => number,
  timelineEndMs: number,
): LpiSegment[] {
  const lpiSegments: LpiSegment[] = [];
  let previousLpiTime: number | null = null;

  timestamps.forEach((ts) => {
    const point = getLpiAtTimestamp(ts, timeMap, modelChain, availableModels);
    if (!point) {
      previousLpiTime = null;
      return;
    }
    const x = getX(ts);
    const y =
      convectiveZero -
      (Math.max(0, Math.min(point.value!, 30)) / 30) * convectiveHalfHeight;
    const previous = lpiSegments[lpiSegments.length - 1];
    if (
      previous &&
      previousLpiTime !== null &&
      ts - previousLpiTime === HOUR_MS &&
      previous.model === point.model
    ) {
      previous.path += ` L ${x} ${y}`;
    } else {
      lpiSegments.push({
        path: `M ${x} ${y}`,
        model: point.model,
        endTime: ts + HOUR_MS,
        lastY: y,
      });
    }
    const segment = lpiSegments[lpiSegments.length - 1];
    segment.endTime = ts + HOUR_MS;
    segment.lastY = y;
    previousLpiTime = ts;
  });

  for (const segment of lpiSegments) {
    // The final observation occupies its start-stamped hour up to handover.
    segment.path += ` L ${getX(Math.min(segment.endTime, timelineEndMs))} ${segment.lastY}`;
  }

  return lpiSegments;
}

export interface ConvectiveBarGeometry {
  y: number;
  height: number;
  fill: string;
}

/**
 * Calculates bar vertical positioning, height, and fill color for CAPE and CIN bars.
 */
export function calculateConvectiveBarGeometry(
  value: number,
  isCape: boolean,
  capeMax: number,
  cinMax: number,
  convectiveZero: number,
  convectiveHalfHeight: number,
): ConvectiveBarGeometry {
  const height =
    (isCape ? Math.max(0, value) / capeMax : Math.abs(value) / cinMax) *
    convectiveHalfHeight;
  const y = isCape ? convectiveZero - height : convectiveZero;
  const fill = isCape ? "#f59e0b" : "#0284c7";
  return { y, height, fill };
}
