/**
 * Derived ("virtual") quantities (system.md §5.1): computed from `precipitation`
 * and `snowfall` when the meteogram is drawn, never fetched or archived.
 */
import type { DataPoint } from "../types";
import { normalizeTimestamp } from "../utils/timeline";
import { getQuantity } from "./registry";

export const PRECIPITATION_RAIN_SNOW = "precipitation_rain_snow";
export const SNOWFALL_WITH_RAIN = "snowfall_with_rain";

/**
 * Snow equivalent of water (Open-Meteo convention, Q6): 1 mm water ≈ 0.7 cm
 * snow.
 */
export const SNOW_CM_PER_WATER_MM = 0.7;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function isDerivedQuantity(id: string): boolean {
  return getQuantity(id)?.source === "derived";
}

/**
 * Snow and rain part of an hour, both in snow-equivalent cm. Rain is the
 * precipitation the snowfall does not explain:
 * `rain_mm = max(0, precipitation − snowfall / 0.7)`, drawn as `rain_mm × 0.7`.
 * A missing source value gives `null` (gap).
 */
export function splitRainSnow(
  precipitationMm: number | null | undefined,
  snowfallCm: number | null | undefined,
): { snowCm: number; rainCm: number } | null {
  if (!isNumber(precipitationMm) || !isNumber(snowfallCm)) return null;
  const snowCm = Math.max(0, snowfallCm);
  const rainMm = Math.max(0, precipitationMm - snowCm / SNOW_CM_PER_WATER_MM);
  return { snowCm, rainCm: rainMm * SNOW_CM_PER_WATER_MM };
}

/**
 * Drawn value of a derived quantity (bar height), `null` for a gap.
 * Precipitation bars only need precipitation: without snowfall they are
 * drawn like plain precipitation (as with `snowFrom`), so a model that
 * rejects snowfall keeps its bars.
 */
export function deriveValue(
  id: string,
  precipitationMm: number | null | undefined,
  snowfallCm: number | null | undefined,
): number | null {
  if (id === PRECIPITATION_RAIN_SNOW) {
    return isNumber(precipitationMm) ? precipitationMm : null;
  }
  if (id === SNOWFALL_WITH_RAIN) {
    const parts = splitRainSnow(precipitationMm, snowfallCm);
    return parts ? parts.snowCm + parts.rainCm : null;
  }
  return null;
}

const DERIVED_UNITS: Record<string, string> = {
  [PRECIPITATION_RAIN_SNOW]: "mm",
  [SNOWFALL_WITH_RAIN]: "cm",
};

/**
 * Points plus the derived quantities per timestamp and model, so the chart
 * reads, scales and hovers them like fetched quantities. Hours without a
 * value (see `deriveValue`) get no derived point.
 */
export function withDerivedPoints(points: DataPoint[]): DataPoint[] {
  const sources = new Map<
    string,
    {
      timestamp: string;
      model: string;
      precipitation?: number | null;
      snowfall?: number | null;
    }
  >();
  for (const point of points) {
    if (point.variable !== "precipitation" && point.variable !== "snowfall") {
      continue;
    }
    const key = `${normalizeTimestamp(point.timestamp)}|${point.model}`;
    const entry = sources.get(key) ?? {
      timestamp: point.timestamp,
      model: point.model,
    };
    entry[point.variable] = point.value;
    sources.set(key, entry);
  }
  if (sources.size === 0) return points;

  const derived: DataPoint[] = [];
  for (const entry of sources.values()) {
    for (const id of Object.keys(DERIVED_UNITS)) {
      const value = deriveValue(id, entry.precipitation, entry.snowfall);
      if (value === null) continue;
      derived.push({
        timestamp: entry.timestamp,
        model: entry.model,
        variable: id,
        value,
        unit: DERIVED_UNITS[id],
      });
    }
  }
  return derived.length > 0 ? [...points, ...derived] : points;
}

/**
 * Sources of the drawn derived quantities that a model delivers no value for
 * at all, for the model card warning. Without snowfall,
 * `precipitation_rain_snow` still draws (plain) bars, but cannot mark snow.
 */
export function missingDerivedSources(
  drawnQuantities: Iterable<string>,
  points: DataPoint[] | undefined,
): string[] {
  const needed = new Set(
    [...drawnQuantities].flatMap((id) =>
      id in DERIVED_UNITS ? ["precipitation", "snowfall"] : [],
    ),
  );
  if (needed.size === 0 || !points) return [];
  const delivered = new Set(
    points
      .filter((point) => needed.has(point.variable) && isNumber(point.value))
      .map((point) => point.variable),
  );
  return [...needed].filter((id) => !delivered.has(id));
}
