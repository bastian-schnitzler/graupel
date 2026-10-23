import type { DataPoint, WeatherModel } from "../types";
import { HOUR_MS } from "./timeline";
import { getAxisPreset } from "../layouts/seriesPresets";
import { buildHeldSegments } from "../components/drawing/meteogramPaths";

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
  // Same rule as the CAPE / CIN half scales of the layouts.
  return {
    capeMax: getAxisPreset("cape").zeroBasedMax!(capeMaximum),
    cinMax: getAxisPreset("convective_inhibition").zeroBasedMax!(cinMaximum),
  };
}

/**
 * Checks whether the given weather model lists a quantity in its
 * `supported_variables` (resolved by model name or id, case-insensitive).
 */
export function isQuantitySupportedByModel(
  quantityId: string,
  modelName: string | undefined,
  modelChain: WeatherModel[],
  availableModels?: Record<string, Partial<WeatherModel>>,
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
  return metadata?.supported_variables?.includes(quantityId) === true;
}

/**
 * Checks whether the given weather model supports the lightning potential index (LPI).
 */
export function isLpiSupportedByModel(
  modelName: string | undefined,
  modelChain: WeatherModel[],
  availableModels?: Record<string, Partial<WeatherModel>>,
): boolean {
  return isQuantitySupportedByModel(
    "lightning_potential",
    modelName,
    modelChain,
    availableModels,
  );
}

/**
 * Valid point of an optional catalogued quantity at a timestamp: only from
 * the active main-chain model and only when that model supports it.
 */
export function getSupportedPointAtTimestamp(
  quantityId: string,
  ts: number,
  timeMap: Map<number, Record<string, DataPoint>>,
  modelChain: WeatherModel[],
  availableModels?: Record<string, Partial<WeatherModel>>,
): DataPoint | null {
  const fields = timeMap.get(ts);
  const point = fields?.[quantityId];
  const activeModel =
    fields?.["cape"]?.model ||
    fields?.["convective_inhibition"]?.model ||
    fields?.["temperature"]?.model ||
    point?.model;
  return point &&
    point.model === activeModel &&
    isQuantitySupportedByModel(
      quantityId,
      activeModel,
      modelChain,
      availableModels,
    ) &&
    point.value !== null &&
    Number.isFinite(point.value)
    ? point
    : null;
}

/**
 * Retrieves valid LPI data point for a specific timestamp.
 */
export function getLpiAtTimestamp(
  ts: number,
  timeMap: Map<number, Record<string, DataPoint>>,
  modelChain: WeatherModel[],
  availableModels?: Record<string, Partial<WeatherModel>>,
): DataPoint | null {
  return getSupportedPointAtTimestamp(
    "lightning_potential",
    ts,
    timeMap,
    modelChain,
    availableModels,
  );
}

/**
 * Assembles stepped LPI svg paths segmented by weather model.
 */
export function buildLpiSegments(
  timestamps: number[],
  timeMap: Map<number, Record<string, DataPoint>>,
  modelChain: WeatherModel[],
  availableModels: Record<string, Partial<WeatherModel>> | undefined,
  convectiveZero: number,
  convectiveHalfHeight: number,
  getX: (ts: number) => number,
  timelineEndMs: number,
): LpiSegment[] {
  return buildHeldSegments(
    timestamps,
    (ts) => getLpiAtTimestamp(ts, timeMap, modelChain, availableModels),
    (value) =>
      convectiveZero -
      (Math.max(0, Math.min(value, 30)) / 30) * convectiveHalfHeight,
    getX,
    timelineEndMs,
    HOUR_MS,
  );
}
