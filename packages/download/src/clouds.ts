// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Vertical cloud profiles from pressure levels: one request per cloud model
 * and the stitched cloud chain.
 */

import { MIN_CLOUD_PRESSURE_LEVELS } from "./autoChain";
import { toOpenMeteoModel, type OpenMeteoClient, type RequestOptions } from "./client";
import { catalogueModels, createQuantityRegistry, type ModelCatalogue, type QuantityRegistryInput } from "./quantities";
import { canonicalTimestamp, normalizeTimestamp, uniqueSortedTimestamps, validateTimestampSequence, HOUR_MS } from "./timeline";
import type {
  DetailedCloudForecast,
  Location,
  VerticalCloudLevel,
  VerticalCloudProfile,
  VerticalCloudTransition,
  WeatherModel,
} from "./types";

/** Levels requested when a model lists none. */
export const DEFAULT_PRESSURE_LEVELS: readonly number[] = [
  1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100,
];

/** Altitude in metres above sea level from pressure (standard barometric formula), one decimal. */
export function estimateAltitudeMAsl(pressureHpa: number): number {
  return Math.round(44330 * (1 - (pressureHpa / 1013.25) ** 0.1903) * 10) / 10;
}

/** Whether a model can serve the cloud chain: at least {@link MIN_CLOUD_PRESSURE_LEVELS} pressure levels. */
export function isCloudCompatibleModel(model: { pressure_levels_hpa?: readonly number[] | null }): boolean {
  return (model.pressure_levels_hpa ?? []).length >= MIN_CLOUD_PRESSURE_LEVELS;
}

/** True when a profile carries at least one cloud cover value (Open-Meteo sends null rows after a run ends). */
export function hasCloudValues(profile: VerticalCloudProfile | null | undefined): boolean {
  return Boolean(
    profile?.levels?.some((level) => level.cloud_cover_percent !== null && level.cloud_cover_percent !== undefined),
  );
}

export interface CloudModelRequest {
  location: Location;
  model: WeatherModel;
  /** Hours after now; default the model's horizon. */
  forecastHours?: number;
  pastHours?: number;
}

function levelName(template: string | null | undefined, fallback: string, level: number): string {
  return (template ?? fallback).replace("{level}", String(level));
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fetch one model's cloud cover and geopotential height on its pressure
 * levels (the model's `pressure_levels_hpa` or {@link DEFAULT_PRESSURE_LEVELS}).
 * Levels without a height get the barometric estimate; levels are sorted
 * by altitude. Errors (request, timeline) are thrown to the caller.
 */
export async function fetchCloudModelForecast(
  client: OpenMeteoClient,
  request: CloudModelRequest,
  data: { catalogue?: ModelCatalogue | null; registry?: QuantityRegistryInput | null } = {},
  options: RequestOptions = {},
): Promise<DetailedCloudForecast> {
  const { location, model } = request;
  const models = catalogueModels(data.catalogue);
  const modelId = model.id || toOpenMeteoModel(model.name, models);
  const levels = model.pressure_levels_hpa?.length ? model.pressure_levels_hpa : DEFAULT_PRESSURE_LEVELS;
  const reg = data.registry ? createQuantityRegistry(data.registry) : null;
  const coverName = (p: number) =>
    levelName(reg?.byId.get("cloud_cover_pressure_level")?.api_name, "cloud_cover_{level}hPa", p);
  const heightName = (p: number) =>
    levelName(reg?.byId.get("geopotential_height_pressure_level")?.api_name, "geopotential_height_{level}hPa", p);
  const horizon =
    request.forecastHours || model.max_forecast_horizon_hours || model.max_forecast_hours || 72;

  const response = await client.fetchForecast(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      models: toOpenMeteoModel(model.id || model.name, models),
      hourly: levels.flatMap((p) => [coverName(p), heightName(p)]),
      forecastHours: horizon,
      pastHours: request.pastHours,
    },
    options,
  );

  const hourly = response.hourly ?? {};
  const responseTimezone = typeof response.timezone === "string" && response.timezone ? response.timezone : "UTC";
  const timestamps = (hourly.time ?? []).map((t) => canonicalTimestamp(t, responseTimezone));
  validateTimestampSequence(timestamps, null, `${model.name} vertical cloud timeline`);

  const profiles: VerticalCloudProfile[] = timestamps.map((timestamp, index) => {
    const levelObjects: VerticalCloudLevel[] = levels.map((p) => {
      const cover = finiteOrNull((hourly[coverName(p)] ?? [])[index]);
      const height = finiteOrNull((hourly[heightName(p)] ?? [])[index]);
      return {
        pressure_hpa: p,
        altitude_m_asl: height ?? estimateAltitudeMAsl(p),
        cloud_cover_percent: cover,
      };
    });
    levelObjects.sort((a, b) => (a.altitude_m_asl ?? 0) - (b.altitude_m_asl ?? 0));
    return { timestamp, source_model_id: modelId, source_model_name: model.name, levels: levelObjects };
  });
  return { location, profiles };
}

/**
 * Stitch the cloud chain: each hour's profile comes from the model owning
 * the hour (past hours: the first model) and only when that model has
 * cloud values there; hours without stay out. Every change of the source
 * model is a transition.
 */
export function mergeVerticalCloudSegments(
  cloudChain: WeatherModel[],
  verticalCloudModelForecasts?: Record<string, DetailedCloudForecast>,
  timestamps: (string | number)[] = [],
  forecastStartTime?: string,
  location?: Location,
): {
  verticalCloudForecast?: DetailedCloudForecast;
  verticalCloudTransitions: VerticalCloudTransition[];
} {
  if (!cloudChain || cloudChain.length === 0 || !verticalCloudModelForecasts || timestamps.length === 0) {
    return { verticalCloudForecast: undefined, verticalCloudTransitions: [] };
  }

  const activeChain = cloudChain.filter((m, idx) => {
    const prevH = idx > 0 ? (cloudChain[idx - 1] as WeatherModel).max_forecast_horizon_hours : 0;
    return m.max_forecast_horizon_hours > prevH;
  });
  const effectiveChain = activeChain.length > 0 ? activeChain : cloudChain;

  const canonicalTimes = uniqueSortedTimestamps(timestamps);
  let tNow = canonicalTimes[0] as number;
  if (forecastStartTime) tNow = normalizeTimestamp(forecastStartTime);

  const profileLookupByModel = new Map<string, Map<number, VerticalCloudProfile>>();
  for (const [modelKey, forecast] of Object.entries(verticalCloudModelForecasts)) {
    if (!forecast || !Array.isArray(forecast.profiles)) continue;
    const profiles = new Map<number, VerticalCloudProfile>();
    for (const profile of forecast.profiles) {
      if (profile && profile.timestamp) profiles.set(normalizeTimestamp(profile.timestamp), profile);
    }
    profileLookupByModel.set(modelKey, profiles);
  }

  // Open-Meteo returns null rows after the end of a model run.
  const validProfileAt = (model: WeatherModel, timeMs: number): VerticalCloudProfile | undefined => {
    const profile =
      profileLookupByModel.get(model.name)?.get(timeMs) ?? profileLookupByModel.get(model.id || model.name)?.get(timeMs);
    return hasCloudValues(profile) ? profile : undefined;
  };

  const compositeProfiles: VerticalCloudProfile[] = [];
  const transitions: VerticalCloudTransition[] = [];
  let lastModelId: string | null = null;

  for (const currentDt of canonicalTimes) {
    const ts = canonicalTimestamp(currentDt);
    let primaryModel: WeatherModel | undefined;
    if (currentDt < tNow) {
      primaryModel = effectiveChain[0];
    } else {
      const hoursFromNow = (currentDt - tNow) / HOUR_MS;
      primaryModel = effectiveChain.find((m) => hoursFromNow < m.max_forecast_horizon_hours);
    }

    const matchingProf = primaryModel ? validProfileAt(primaryModel, currentDt) : undefined;
    if (primaryModel && matchingProf) {
      const cid = primaryModel.id || primaryModel.name;
      compositeProfiles.push({
        timestamp: ts,
        source_model_id: cid,
        source_model_name: primaryModel.name,
        source_run: matchingProf.source_run,
        levels: matchingProf.levels,
      });
      if (lastModelId !== null && lastModelId !== cid) {
        transitions.push({ timestamp: ts, from_model: lastModelId, to_model: cid });
      }
      lastModelId = cid;
    } else {
      lastModelId = null;
    }
  }

  return {
    verticalCloudForecast: {
      location: location || { name: "Unknown", latitude: 0, longitude: 0 },
      profiles: compositeProfiles,
    },
    verticalCloudTransitions: transitions,
  };
}
