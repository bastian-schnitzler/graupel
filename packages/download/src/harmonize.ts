// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Harmonization: raw Open-Meteo series → `DataPoint`s with quantity ids,
 * target units and canonical UTC timestamps.
 */

import { ApiError, OutOfDomainError, toOpenMeteoModel, type OpenMeteoClient, type RequestOptions } from "./client";
import {
  catalogueModels,
  createQuantityRegistry,
  modelHourlyVariables,
  normalizeVariable,
  retryWithoutNames,
  type ModelCatalogue,
  type QuantityRegistryInput,
} from "./quantities";
import { canonicalTimestamp, validateTimestampSequence, HOUR_MS } from "./timeline";
import type { DataPoint, RawForecastData } from "./types";

export interface HarmonizeOptions {
  /** Receives warnings about gaps and length mismatches (the series is harmonized anyway). */
  onWarning?: (message: string) => void;
}

const KELVIN = new Set(["k", "kelvin"]);
const FAHRENHEIT = new Set(["°f", "f", "fahrenheit"]);
const METRES_PER_SECOND = new Set(["m/s", "ms"]);
const MILES_PER_HOUR = new Set(["mph"]);
const KNOTS = new Set(["kn", "knots", "kt"]);
const TEMPERATURES = new Set(["temperature", "apparent_temperature"]);
const WIND_SPEEDS = new Set(["wind_speed", "wind_gusts"]);

/** Round to two decimals like Python's `round(value, 2)`, without a negative zero. */
function round2(value: number): number {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

/**
 * Convert a value to the target unit of a quantity: K and °F → °C for
 * temperatures, m/s, mph and kn → km/h for wind speed and gusts. Other
 * quantities keep their value and get the registry's unit (or `fromUnit` for
 * names the registry does not know).
 */
export function convertValueAndUnit(
  value: number | null | undefined,
  fromUnit: string,
  variable: string,
  registry: QuantityRegistryInput,
): [number | null, string] {
  const target = createQuantityRegistry(registry).targetUnits.get(variable) ?? fromUnit;
  if (value === null || value === undefined) return [null, target];
  const unit = fromUnit.trim().toLowerCase();
  if (TEMPERATURES.has(variable)) {
    if (KELVIN.has(unit)) return [round2(value - 273.15), "°C"];
    if (FAHRENHEIT.has(unit)) return [round2(((value - 32) * 5) / 9), "°C"];
    return [value, "°C"];
  }
  if (WIND_SPEEDS.has(variable)) {
    if (METRES_PER_SECOND.has(unit)) return [round2(value * 3.6), "km/h"];
    if (MILES_PER_HOUR.has(unit)) return [round2(value * 1.60934), "km/h"];
    if (KNOTS.has(unit)) return [round2(value * 1.852), "km/h"];
    return [value, "km/h"];
  }
  return [value, target];
}

/**
 * One raw series as harmonized `DataPoint`s: quantity id, target unit and
 * canonical UTC timestamp. Gaps are reported, never filled; missing values
 * stay null and extra values are ignored. Timestamps that do not increase
 * throw a `TimelineIntegrityError`.
 */
export function harmonize(
  raw: RawForecastData,
  registry: QuantityRegistryInput,
  options: HarmonizeOptions = {},
): DataPoint[] {
  const reg = createQuantityRegistry(registry);
  const variable = normalizeVariable(raw.variable, reg);
  const timestamps = raw.timestamps.map((timestamp) => canonicalTimestamp(timestamp));
  const anomalies = validateTimestampSequence(timestamps, HOUR_MS, `${raw.model_name} / ${variable}`);
  if (anomalies.length) {
    const gaps = anomalies
      .map((a) => `${canonicalTimestamp(a.previousMs)} → ${canonicalTimestamp(a.currentMs)}`)
      .join(", ");
    options.onWarning?.(
      `${raw.model_name} / ${variable} has ${anomalies.length} non-hourly timestamp gap(s): ${gaps}`,
    );
  }
  if (raw.values.length !== timestamps.length && !(raw.values.length === 0 && variable === "weather_code")) {
    options.onWarning?.(
      `${raw.model_name} / ${variable} timestamp/value length mismatch: ${timestamps.length} timestamps, ` +
        `${raw.values.length} values; missing values remain null and extra values are ignored`,
    );
  }
  return timestamps.map((timestamp, index) => {
    const [value, unit] = convertValueAndUnit(raw.values[index] ?? null, raw.unit, variable, reg);
    return { timestamp, value, unit, variable, model: raw.model_name };
  });
}

/** Harmonize several raw series of one or more models. */
export function harmonizeAll(
  raws: readonly RawForecastData[],
  registry: QuantityRegistryInput,
  options: HarmonizeOptions = {},
): DataPoint[] {
  const reg = createQuantityRegistry(registry);
  return raws.flatMap((raw) => harmonize(raw, reg, options));
}

export interface ModelDatasetsRequest {
  /** Model name or id as configured in the chain (catalogue id, name or former alias). */
  model: string;
  latitude: number;
  longitude: number;
  /** Hours to request after now. */
  forecastHours: number;
  /** Hours to request before now (from yesterday 00:00 in the user's time zone). */
  pastHours?: number;
  /** Quantity ids or Open-Meteo names; default: the hourly fetch set. */
  quantities?: readonly string[];
  /** Stamp of `fetch_time` (default: now). */
  now?: Date | number | string;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fetch one model's hourly series. Optional catalogued quantities the model
 * does not list are not requested. When Open-Meteo rejects the request and it
 * contained `retry_without` quantities (snow), it is repeated once without
 * them, so the rest of the model stays available. Every requested variable
 * yields a series, also when the answer omits it (its values are empty).
 */
export async function fetchModelDatasets(
  client: OpenMeteoClient,
  request: ModelDatasetsRequest,
  data: { catalogue: ModelCatalogue | null | undefined; registry: QuantityRegistryInput },
  options: RequestOptions = {},
): Promise<RawForecastData[]> {
  const registry = createQuantityRegistry(data.registry);
  let variables = modelHourlyVariables(request.model, { catalogue: data.catalogue, registry }, request.quantities);
  const forecast = {
    latitude: request.latitude,
    longitude: request.longitude,
    models: toOpenMeteoModel(request.model, catalogueModels(data.catalogue)),
    forecastHours: request.forecastHours,
    pastHours: request.pastHours,
  };
  let response;
  try {
    response = await client.fetchForecast({ ...forecast, hourly: variables }, options);
  } catch (error) {
    const rejectable = retryWithoutNames(registry);
    // Only a rejection can depend on the variables; aborts and "out of domain" cannot.
    if (!(error instanceof ApiError) || error instanceof OutOfDomainError || options.signal?.aborted) throw error;
    if (!variables.some((v) => rejectable.has(v))) throw error;
    variables = variables.filter((v) => !rejectable.has(v));
    response = await client.fetchForecast({ ...forecast, hourly: variables }, options);
  }

  const hourly = response.hourly ?? {};
  const units = response.hourly_units ?? {};
  const responseTimezone = typeof response.timezone === "string" && response.timezone ? response.timezone : "UTC";
  const timestamps = (hourly.time ?? []).map((t) => canonicalTimestamp(t, responseTimezone));
  validateTimestampSequence(timestamps, null, `${request.model} API timeline`);
  const fetchTime = canonicalTimestamp(request.now ?? Date.now());

  return variables.map((variable) => {
    const values = hourly[variable];
    return {
      model_name: request.model,
      fetch_time: fetchTime,
      forecast_run_time: null,
      timestamps,
      values: Array.isArray(values) ? values.map(toNumberOrNull) : [],
      unit: units[variable] ?? "",
      variable,
      max_horizon_hours: request.forecastHours,
    };
  });
}
