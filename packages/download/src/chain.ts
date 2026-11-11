// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Download a model chain and an optional cloud chain and stitch them into
 * one hourly timeline.
 *
 * - The timeline runs from yesterday 00:00 in the given time zone to the end
 *   of the chain; `now` is the current full hour, model slices count from it.
 * - Every model is fetched over its whole capability up to the chain end, so
 *   a boundary moved later still shows the model's own data.
 * - A slice ends where the model's latest run ends (`meta.json` and the data
 *   itself: the last hour with a temperature, REQ-630); the next model takes
 *   over there. Gaps inside a slice stay null:
 *   no model ever fills another model's hours.
 * - A failing model only empties its own slice; when every model fails,
 *   {@link AllModelsFailedError} is thrown.
 * - A main chain model that answers but delivers no current data (no value
 *   from now on, e.g. a discontinued model) is replaced by a fine model with
 *   current data at the place, which takes its slice up to its own data end
 *   (REQ-767, {@link replacementCandidates}); its chain entry names the
 *   replaced model (`replaces`).
 * - Run segments come from the Single Runs API. Its first outage (5xx,
 *   timeout, network error) stops the run search of the whole download: the
 *   result keeps the segments known by then, every other model is left as with
 *   `runSegments: false`, and one warning names the outage (REQ-633).
 */

import { AllModelsFailedError, toOpenMeteoModel, type OpenMeteoClient } from "./client";
import {
  DOMAIN_MARGIN_DEG,
  FALLBACK_EXCLUDED,
  FALLBACK_MAX_RESOLUTION_KM,
  catalogueWeatherModel,
  createResolver,
  type AutoChainResolution,
  type AutoChainResolver,
  type ResolverData,
} from "./autoChain";
import { fetchCloudModelForecast, hasCloudValues, mergeVerticalCloudSegments } from "./clouds";
import { fetchModelDatasets, harmonize } from "./harmonize";
import {
  catalogueModels,
  createQuantityRegistry,
  findCatalogueModel,
  hourlyFetchSet,
  mainRunExcludedQuantities,
  normalizeVariable,
  optionalQuantities,
  type ModelCatalogue,
  type QuantityRegistryInput,
} from "./quantities";
import { SingleRunsUnavailableError, fetchEnsembleInfo, fetchRunInfo, resolveRunSegments } from "./runs";
import {
  buildHourlyTimeline,
  canonicalTimestamp,
  getUserTimezone,
  getZonedDateParts,
  normalizeTimestamp,
  resolveTimezone,
  uniqueSortedTimestamps,
  validateTimestampSequence,
  HOUR_MS,
  type TimestampValue,
} from "./timeline";
import type {
  AutoChainInfo,
  ChainModelResult,
  DataAttribution,
  DataPoint,
  DetailedCloudForecast,
  ForecastResult,
  HarmonizedForecastResponse,
  Location,
  ModelAvailability,
  ModelTimelineDiagnostics,
  RawForecastData,
  ReplacedModel,
  RunSegment,
  VariableTimelineCoverage,
  WeatherModel,
} from "./types";

/** Default cloud model without a configured cloud chain. */
export const DEFAULT_CLOUD_MODEL_ID = "ecmwf_ifs025";

/** A chain entry: catalogue id or name, or a model with its own horizon. */
export type ChainModelInput =
  | string
  | (Partial<WeatherModel> & { name?: string; id?: string; max_forecast_horizon_hours?: number });

export type LocationInput = Omit<Location, "name"> & { name?: string };

export interface DownloadChainRequest {
  location: LocationInput;
  /** Main chain in hand-over order; slices end at each model's horizon (hours after now). */
  chain?: readonly ChainModelInput[];
  /** Resolve the chains from the location (needs `domains` and `regions`); models without data are dropped. */
  auto?: boolean;
  /**
   * Cloud chain. Missing: the auto chain's cloud chain, else ECMWF IFS 0.25°
   * over the main chain's length; empty or null: no cloud profile.
   */
  cloudChain?: readonly ChainModelInput[] | null;
  /** Quantity ids (or Open-Meteo names) to download; default: the hourly fetch set of the registry. */
  quantities?: readonly string[];
  /** Reference time (default: now). */
  now?: TimestampValue;
  /** IANA time zone that defines "yesterday 00:00" (default: the runtime's zone). */
  timezone?: string;
  /**
   * Load run segments through the Single Runs API (default true, REQ-414).
   * When that API is down, the result comes without waiting for it: models
   * whose segments were not known yet are left as with `false` (REQ-633).
   */
  runSegments?: boolean;
  /** Skip the cache lookup (the new result is still stored). */
  refresh?: boolean;
  signal?: AbortSignal;
  /** Receives every warning as it happens (also collected in `warnings`). */
  onWarning?: (message: string) => void;
}

/** Documents of `@graupel/model-data` (parsed JSON). `domains` and `regions` are only needed with `auto`. */
export interface DownloadData {
  catalogue: ModelCatalogue;
  registry: QuantityRegistryInput;
  domains?: ResolverData["domains"];
  regions?: ResolverData["regions"];
}

// --- time window ----------------------------------------------------------

/** UTC instant (ms) of 00:00 local time on the calendar day before `now` in `timeZone`. */
export function yesterdayMidnightUtc(now: TimestampValue, timeZone = "UTC"): number {
  const zone = resolveTimezone(timeZone);
  const parts = getZonedDateParts(now, zone);
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1));
  return normalizeTimestamp(`${day.toISOString().slice(0, 10)}T00:00`, zone);
}

/** `past_hours` that reach back to yesterday 00:00 local time (at least 24, two hours margin). */
export function pastHoursForYesterday(now: TimestampValue, timeZone = "UTC"): number {
  const nowMs = normalizeTimestamp(now);
  const elapsed = (nowMs - yesterdayMidnightUtc(nowMs, timeZone)) / HOUR_MS;
  return Math.max(24, Math.ceil(elapsed) + 2);
}

/** Start of the hour containing `now`. */
export function floorToHour(now: TimestampValue): number {
  const ms = normalizeTimestamp(now);
  return ms - (((ms % HOUR_MS) + HOUR_MS) % HOUR_MS);
}

// --- chain helpers ----------------------------------------------------------

/**
 * Hours to request for a chain model: up to its catalogue capability, never
 * past the chain end, never less than its configured horizon.
 */
export function getFetchHorizon(
  model: WeatherModel,
  chainMaxHorizon: number,
  catalogue?: ModelCatalogue | null,
): number {
  const configured = model.max_forecast_horizon_hours;
  const capable = findCatalogueModel(model.id || model.name, catalogue)?.max_forecast_hours ?? configured;
  return Math.max(configured, Math.min(capable, chainMaxHorizon));
}

/**
 * Hours from `tNow` through the last valid sample (start-stamped), and the
 * end instant. [null, null] when the data reaches the end of the fetched
 * window (the run does not limit the range) and when there is no data at
 * all (a failed model keeps its slice, which stays visibly empty).
 */
export function computeAvailableHours(
  validTimes: readonly number[],
  tNow: number,
  fetchedHours: number,
): [number | null, string | null] {
  if (!validTimes.length) return [null, null];
  const future = validTimes.filter((t) => t >= tNow);
  if (!future.length) return [0, canonicalTimestamp(tNow)];
  const hours = Math.floor((Math.max(...future) - tNow) / HOUR_MS) + 1;
  if (hours >= fetchedHours) return [null, null];
  return [hours, canonicalTimestamp(tNow + hours * HOUR_MS)];
}

/**
 * Quantity whose last delivered hour ends a model's slice in the main chain
 * (REQ-630); models without it fall back to all main-run quantities.
 */
export const SLICE_END_QUANTITY = "temperature";

/** Move each boundary to the hours the model's latest run delivers; boundaries stay non-decreasing. */
export function capChainToAvailability(
  chain: readonly WeatherModel[],
  availability: Readonly<Record<string, ModelAvailability>>,
): WeatherModel[] {
  let previous = 0;
  return chain.map((model) => {
    let horizon = model.max_forecast_horizon_hours;
    const hours = availability[model.name]?.available_hours;
    if (hours !== null && hours !== undefined) horizon = Math.min(horizon, hours);
    horizon = Math.max(horizon, previous);
    previous = horizon;
    return { ...model, max_forecast_horizon_hours: horizon };
  });
}

/** Models whose slice is not empty; all of them when every slice is empty. */
export function activeChain(chain: readonly WeatherModel[]): WeatherModel[] {
  const active = chain.filter(
    (m, idx) => m.max_forecast_horizon_hours > (idx > 0 ? (chain[idx - 1] as WeatherModel).max_forecast_horizon_hours : 0),
  );
  return active.length ? active : [...chain];
}

/** True when a model delivered any main-run value (not optional, not from the ensemble). */
export function hasCoreValues(points: readonly DataPoint[], registry: QuantityRegistryInput): boolean {
  const excluded = new Set(mainRunExcludedQuantities(registry));
  return points.some((p) => p.value !== null && !excluded.has(p.variable));
}

/** True when a model delivered a main-run value at or after `tNow` (REQ-767). */
export function hasCurrentValues(points: readonly DataPoint[], registry: QuantityRegistryInput, tNow: number): boolean {
  const excluded = new Set(mainRunExcludedQuantities(registry));
  return points.some((p) => p.value !== null && !excluded.has(p.variable) && normalizeTimestamp(p.timestamp) >= tNow);
}

/** A replacement may be this much coarser than the model it replaces when it comes from the cloud chain (REQ-767). */
export const REPLACEMENT_RESOLUTION_SLACK_KM = 2.5;
/** Candidates fetched at most for one model without current data (REQ-767). */
export const MAX_REPLACEMENT_ATTEMPTS = 3;

/**
 * Models that may take the slice of a main chain model without current data, in the order they are tried (REQ-767):
 *
 * 1. The models of the region's own cloud chain (`resolution.cloud_chain_ids`), in their order, that are not coarser
 *    than the failed model plus {@link REPLACEMENT_RESOLUTION_SLACK_KM}; for Austria ICON-D2.
 * 2. Then the finest catalogue models covering the place (`resolver.fallbackCandidates`, within one resolution the
 *    longest horizon first).
 *
 * Every candidate covers the place with {@link DOMAIN_MARGIN_DEG}, is active, no blend (`seamless`, `best_match`),
 * no ensemble, not in {@link FALLBACK_EXCLUDED}, finer than {@link FALLBACK_MAX_RESOLUTION_KM} and not in the main
 * chain already (`chainIds`). Whether it has current data shows only once it is fetched: the caller takes the first
 * one that has.
 */
export function replacementCandidates(
  failedId: string,
  chainIds: readonly string[],
  resolution: Pick<AutoChainResolution, "cloud_chain_ids">,
  resolver: AutoChainResolver,
  catalogue: ModelCatalogue | null | undefined,
  location: Pick<Location, "latitude" | "longitude">,
): string[] {
  const { latitude: lat, longitude: lon } = location;
  const taken = new Set([failedId, ...chainIds]);
  const resolutionOf = (id: string) => findCatalogueModel(id, catalogue)?.spatial_resolution_km;
  const eligible = (id: string) => {
    const model = findCatalogueModel(id, catalogue);
    const km = model?.spatial_resolution_km;
    return (
      model !== null &&
      model.id === id &&
      !taken.has(id) &&
      model.active !== false &&
      !id.includes("seamless") &&
      !id.includes("ensemble") &&
      !FALLBACK_EXCLUDED.has(id) &&
      typeof km === "number" &&
      km > 0 &&
      km < FALLBACK_MAX_RESOLUTION_KM &&
      resolver.domainContains(id, lat, lon, DOMAIN_MARGIN_DEG) === true
    );
  };
  const failedKm = resolutionOf(failedId);
  const limit = typeof failedKm === "number" ? failedKm + REPLACEMENT_RESOLUTION_SLACK_KM : FALLBACK_MAX_RESOLUTION_KM;
  const fromCloud = resolution.cloud_chain_ids.filter((id) => eligible(id) && (resolutionOf(id) as number) <= limit);
  const finest = resolver.fallbackCandidates(lat, lon).filter((id) => eligible(id) && !fromCloud.includes(id));
  return [...fromCloud, ...finest];
}

/**
 * Stitch the chain: each hour belongs to the first model whose (capped)
 * horizon lies beyond it, past hours to the first model. A model only ever
 * shows its own data inside its slice; missing hours stay null instead of
 * borrowing another model's values;
 * `fallbackUnits` gives null points of a model without the quantity a unit.
 */
export function mergeForecastSegments(
  modelChain: WeatherModel[],
  modelForecasts: Record<string, DataPoint[]>,
  targetVariables: string[],
  forecastStartTime?: string,
  timelineStart?: string,
  timelineEnd?: string,
  fallbackUnits: Readonly<Record<string, string>> = {},
): DataPoint[] {
  if (!modelChain || modelChain.length === 0) return [];

  const allTimestampValues: string[] = [];
  for (const pts of Object.values(modelForecasts || {})) {
    if (!Array.isArray(pts)) continue;
    for (const pt of pts) if (pt && pt.timestamp) allTimestampValues.push(pt.timestamp);
  }

  const sourceTimes = uniqueSortedTimestamps(allTimestampValues);
  if (sourceTimes.length === 0) return [];

  let tNow = sourceTimes[0] as number;
  if (forecastStartTime) tNow = normalizeTimestamp(forecastStartTime);
  const sortedTimes = timelineStart && timelineEnd ? buildHourlyTimeline(timelineStart, timelineEnd) : sourceTimes;
  const merged: DataPoint[] = [];
  const effectiveChain = activeChain(modelChain);

  const lookupByModel = new Map<string, Map<number, Map<string, DataPoint>>>();
  for (const model of effectiveChain) {
    const byTime = new Map<number, Map<string, DataPoint>>();
    for (const point of (modelForecasts && modelForecasts[model.name]) || []) {
      if (!point || !point.timestamp) continue;
      const timeMs = normalizeTimestamp(point.timestamp);
      const byVariable = byTime.get(timeMs) || new Map<string, DataPoint>();
      byVariable.set(point.variable, point);
      byTime.set(timeMs, byVariable);
    }
    lookupByModel.set(model.name, byTime);
  }

  for (const tsTime of sortedTimes) {
    const ts = canonicalTimestamp(tsTime);
    let primaryModel: WeatherModel | undefined;
    if (tsTime < tNow) {
      primaryModel = effectiveChain[0];
    } else {
      const hoursFromNow = (tsTime - tNow) / HOUR_MS;
      primaryModel =
        effectiveChain.find((m) => hoursFromNow < m.max_forecast_horizon_hours) ??
        effectiveChain[effectiveChain.length - 1];
    }

    for (const variable of targetVariables) {
      const ptInPrimary = primaryModel ? lookupByModel.get(primaryModel.name)?.get(tsTime)?.get(variable) : undefined;
      const chosen: DataPoint =
        ptInPrimary && ptInPrimary.value !== null && ptInPrimary.value !== undefined && !Number.isNaN(ptInPrimary.value)
          ? ptInPrimary
          : {
              timestamp: ts,
              variable,
              value: null,
              unit: ptInPrimary?.unit || fallbackUnits[variable] || "",
              model: primaryModel ? primaryModel.name : "",
            };
      merged.push({ ...chosen, timestamp: ts });
    }
  }
  return merged;
}

/** Chain entries as weather models with id, name and horizon from the catalogue where missing. */
export function resolveChainModels(
  chain: readonly ChainModelInput[],
  catalogue?: ModelCatalogue | null,
): WeatherModel[] {
  const models = catalogueModels(catalogue);
  return chain.map((entry) => {
    const spec = typeof entry === "string" ? { name: entry } : entry;
    const label = spec.id || spec.name;
    if (!label) throw new TypeError("Chain model without id or name");
    const found = findCatalogueModel(label, catalogue);
    const horizon = spec.max_forecast_horizon_hours ?? found?.max_forecast_hours ?? undefined;
    if (horizon === undefined || horizon === null || !Number.isFinite(horizon)) {
      throw new TypeError(`Chain model '${label}' has no horizon and is not in the catalogue`);
    }
    const model: WeatherModel = { ...spec, name: spec.name || found?.name || label, max_forecast_horizon_hours: horizon };
    const id = spec.id || found?.id || toOpenMeteoModel(label, models);
    if (id) model.id = id;
    if (model.short_name === undefined && found && found.short_name !== undefined) model.short_name = found.short_name;
    if (!model.supported_variables && found?.supported_variables) model.supported_variables = [...found.supported_variables];
    if (!model.pressure_levels_hpa && found?.pressure_levels_hpa) model.pressure_levels_hpa = [...found.pressure_levels_hpa];
    if (model.max_forecast_hours === undefined && found?.max_forecast_hours != null) {
      model.max_forecast_hours = found.max_forecast_hours;
    }
    return model;
  });
}

function modelId(model: WeatherModel, catalogue?: ModelCatalogue | null): string {
  return model.id || toOpenMeteoModel(model.name, catalogueModels(catalogue));
}

function chainKey(chain: readonly WeatherModel[] | null): string {
  if (chain === null) return "none";
  return chain.map((m) => `${m.id ?? ""}/${m.name}:${m.max_forecast_horizon_hours}`).join("|");
}

/** Cache key: location (4 decimals), chains, quantities, options and the forecast hour. */
export function forecastCacheKey(parts: {
  location: Pick<Location, "latitude" | "longitude">;
  auto: boolean;
  chain: readonly WeatherModel[];
  cloudChain: readonly WeatherModel[] | null;
  quantities: readonly string[];
  timezone: string;
  tNow: number;
  runSegments: boolean;
  source?: string;
}): string {
  return [
    parts.auto ? "auto" : "chain",
    `${parts.location.latitude.toFixed(4)},${parts.location.longitude.toFixed(4)}`,
    `main=${chainKey(parts.chain)}`,
    `cloud=${chainKey(parts.cloudChain)}`,
    `q=${parts.quantities.join(",")}`,
    `tz=${parts.timezone}`,
    `now=${canonicalTimestamp(parts.tNow)}`,
    `runs=${parts.runSegments ? 1 : 0}`,
    `src=${parts.source ?? ""}`,
  ].join(";");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toChainResult(
  model: WeatherModel,
  configured: WeatherModel | undefined,
  segments?: RunSegment[],
  replaces?: WeatherModel,
): ChainModelResult {
  const entry: ChainModelResult = {
    model: model.name,
    sliceEndHours: model.max_forecast_horizon_hours,
    configuredHours: configured?.max_forecast_horizon_hours ?? model.max_forecast_horizon_hours,
  };
  if (model.id) entry.id = model.id;
  if (model.short_name !== undefined) entry.shortName = model.short_name;
  if (segments) entry.runSegments = segments.map((s) => ({ ...s }));
  if (model.supported_variables) entry.supportedVariables = [...model.supported_variables];
  if (replaces) {
    const replaced: ReplacedModel = { model: replaces.name };
    if (replaces.id) replaced.id = replaces.id;
    if (replaces.short_name !== undefined) replaced.shortName = replaces.short_name;
    entry.replaces = replaced;
  }
  return entry;
}

// --- downloadChain ------------------------------------------------------------

/**
 * Download the main chain (and cloud chain) for a location and stitch them.
 * See the module comment for the rules. Results are cached in
 * `client.cache` per location, chains, quantities, options and forecast hour.
 */
export async function downloadChain(
  client: OpenMeteoClient,
  request: DownloadChainRequest,
  data: DownloadData,
): Promise<ForecastResult> {
  const { signal } = request;
  const warnings: string[] = [];
  const warn = (text: string) => {
    warnings.push(text);
    request.onWarning?.(text);
  };
  const catalogue = data.catalogue;
  const registry = createQuantityRegistry(data.registry);
  const location: Location = { name: "", ...request.location };
  const runSegmentsEnabled = request.runSegments !== false;

  // Chains.
  let autoResolution: AutoChainResolution | null = null;
  let chain: WeatherModel[];
  if (request.auto) {
    if (!data.domains || !data.regions) throw new TypeError("auto chain needs `domains` and `regions`");
    autoResolution = createResolver({ catalogue, domains: data.domains, regions: data.regions }).resolve(
      location.latitude,
      location.longitude,
    );
    chain = autoResolution.main_model_chain;
  } else {
    chain = resolveChainModels(request.chain ?? [], catalogue);
  }
  if (!chain.length) throw new TypeError("The chain contains no forecast models");
  let cloudChain: WeatherModel[];
  if (request.cloudChain === null) cloudChain = [];
  else if (request.cloudChain !== undefined) cloudChain = resolveChainModels(request.cloudChain, catalogue);
  else if (autoResolution) cloudChain = autoResolution.cloud_model_chain;
  else {
    const mainEnd = Math.max(...chain.map((m) => m.max_forecast_horizon_hours));
    const [fallback] = resolveChainModels([DEFAULT_CLOUD_MODEL_ID], catalogue);
    cloudChain = [{ ...(fallback as WeatherModel), max_forecast_horizon_hours: mainEnd }];
  }

  const targetVariables = request.quantities ? [...request.quantities] : hourlyFetchSet(registry);
  const normalizedVars = [...new Set(targetVariables.map((v) => normalizeVariable(v, registry)))];

  const nowMs = normalizeTimestamp(request.now ?? Date.now());
  const timezone = resolveTimezone(request.timezone ?? getUserTimezone());
  const tNow = floorToHour(nowMs);
  const tNowIso = canonicalTimestamp(tNow);
  const timelineStart = yesterdayMidnightUtc(nowMs, timezone);
  const pastHours = pastHoursForYesterday(nowMs, timezone);

  const cacheKey = forecastCacheKey({
    location,
    auto: Boolean(request.auto),
    chain,
    cloudChain: request.cloudChain === undefined && !request.auto ? null : cloudChain,
    quantities: normalizedVars,
    timezone,
    tNow,
    runSegments: runSegmentsEnabled,
    source: client.forecastUrl,
  });
  if (client.cache && !request.refresh) {
    const cached = await client.cache.get(cacheKey);
    if (cached) return cached;
  }

  // 1. Sun times, every main model and every cloud model, in parallel.
  const maxChainHorizonConfigured = Math.max(...chain.map((m) => m.max_forecast_horizon_hours));
  const fetchHorizons = new Map(chain.map((m) => [m.name, getFetchHorizon(m, maxChainHorizonConfigured, catalogue)]));
  const maxCloudHorizon = Math.max(0, ...cloudChain.map((m) => m.max_forecast_horizon_hours));
  const cloudFetchHorizons = new Map(cloudChain.map((m) => [m.name, getFetchHorizon(m, maxCloudHorizon, catalogue)]));

  const sunPromise = client
    .fetchSunPhases({ latitude: location.latitude, longitude: location.longitude, forecastDays: 16 }, { signal })
    .catch((error: unknown) => {
      throwIfAborted(signal);
      warn(`Failed to fetch sun phases: ${message(error)}`);
      return [];
    });
  const fetchMainModel = (model: WeatherModel) =>
    fetchModelDatasets(
      client,
      {
        model: model.id || model.name,
        latitude: location.latitude,
        longitude: location.longitude,
        forecastHours: fetchHorizons.get(model.name) as number,
        pastHours,
        quantities: targetVariables,
        now: nowMs,
      },
      { catalogue, registry },
      { signal },
    );
  const mainPromise = Promise.allSettled(chain.map(fetchMainModel));
  const cloudPromise = Promise.allSettled(
    cloudChain.map((model) =>
      fetchCloudModelForecast(
        client,
        { location, model, forecastHours: cloudFetchHorizons.get(model.name) as number, pastHours },
        { catalogue, registry },
        { signal },
      ),
    ),
  );
  const [sunPhases, mainResults, cloudResults] = await Promise.all([sunPromise, mainPromise, cloudPromise]);
  throwIfAborted(signal);

  // 2. Harmonize; a failing model only loses its own slice.
  let raw: RawForecastData[] = [];
  let byModel: Record<string, DataPoint[]> = {};
  const errors: Record<string, unknown> = {};
  chain.forEach((model, index) => {
    const settled = mainResults[index] as PromiseSettledResult<RawForecastData[]>;
    if (settled.status === "rejected") {
      errors[model.name] = settled.reason;
      warn(`Failed to fetch forecast data for model '${model.name}': ${message(settled.reason)}`);
      byModel[model.name] = [];
      return;
    }
    // Keep the configured name in the series even though the request used the id.
    const datasets = settled.value.map((d) => ({ ...d, model_name: model.name }));
    raw.push(...datasets);
    try {
      byModel[model.name] = datasets.flatMap((d) => harmonize(d, registry, { onWarning: warn }));
    } catch (error) {
      errors[model.name] = error;
      warn(`Failed to harmonize model '${model.name}': ${message(error)}`);
      byModel[model.name] = [];
      raw = raw.filter((d) => d.model_name !== model.name);
    }
  });
  if (Object.keys(errors).length === chain.length && !raw.length) throw new AllModelsFailedError(errors);

  // 2a. A model that answered without current data gives its slice to another model (REQ-767), when some model of
  // the chain has current data (else the cause lies elsewhere). Candidates are tried in the order of
  // `replacementCandidates`; each is fetched like a chain model, and the first with current data takes the slice.
  const replacedBy = new Map<string, WeatherModel>();
  const replacedModels: { model: string; replacement: string }[] = [];
  const current = (name: string) => hasCurrentValues(byModel[name] ?? [], registry, tNow);
  if (data.domains && data.regions && chain.some((m) => current(m.name))) {
    const resolver = createResolver({ catalogue, domains: data.domains, regions: data.regions });
    const resolution = autoResolution ?? resolver.resolve(location.latitude, location.longitude);
    // Only a model with a slice of its own (a model whose slice is empty shows nothing anyway).
    const ownSlice = (m: WeatherModel, i: number) =>
      m.max_forecast_horizon_hours > (i > 0 ? (chain[i - 1] as WeatherModel).max_forecast_horizon_hours : 0);
    const failing = chain.filter((m, i) => ownSlice(m, i) && !errors[m.name] && !current(m.name));
    for (const failed of failing) {
      const chainIds = chain.map((m) => modelId(m, catalogue));
      const failedId = modelId(failed, catalogue);
      const candidates = replacementCandidates(failedId, chainIds, resolution, resolver, catalogue, location);
      for (const candidateId of candidates.slice(0, MAX_REPLACEMENT_ATTEMPTS)) {
        const found = findCatalogueModel(candidateId, catalogue);
        if (!found) continue;
        const replacement: WeatherModel = {
          ...catalogueWeatherModel(found),
          max_forecast_horizon_hours: failed.max_forecast_horizon_hours,
        };
        fetchHorizons.set(replacement.name, getFetchHorizon(replacement, maxChainHorizonConfigured, catalogue));
        let points: DataPoint[];
        let datasets: RawForecastData[];
        try {
          datasets = (await fetchMainModel(replacement)).map((d) => ({ ...d, model_name: replacement.name }));
          points = datasets.flatMap((d) => harmonize(d, registry, { onWarning: warn }));
        } catch (error) {
          throwIfAborted(signal);
          warn(`Failed to fetch forecast data for replacement model '${replacement.name}': ${message(error)}`);
          continue;
        }
        if (!hasCurrentValues(points, registry, tNow)) continue;
        warn(`Model '${failed.name}' delivers no current data; replaced by '${replacement.name}'`);
        chain = chain.map((m) => (m === failed ? replacement : m));
        delete byModel[failed.name];
        byModel[replacement.name] = points;
        raw = [...raw.filter((d) => d.model_name !== failed.name), ...datasets];
        replacedBy.set(replacement.name, failed);
        replacedModels.push({ model: failed.name, replacement: replacement.name });
        break;
      }
    }
  }

  // Auto chain: models without any data for the location are dropped.
  let droppedModels: string[] = [];
  if (autoResolution) {
    droppedModels = chain.filter((m) => !hasCoreValues(byModel[m.name] ?? [], registry)).map((m) => m.name);
    if (droppedModels.length === chain.length) droppedModels = []; // nothing delivers: keep the empty slices
    if (droppedModels.length) {
      const dropped = new Set(droppedModels);
      chain = chain.filter((m) => !dropped.has(m.name));
      byModel = Object.fromEntries(Object.entries(byModel).filter(([name]) => !dropped.has(name)));
      raw = raw.filter((d) => !dropped.has(d.model_name));
    }
  }
  const maxChainHorizon = Math.max(...chain.map((m) => m.max_forecast_horizon_hours));
  const timelineEnd = tNow + maxChainHorizon * HOUR_MS;
  const timeline = buildHourlyTimeline(timelineStart, timelineEnd);
  const timelineStartIso = canonicalTimestamp(timelineStart);
  const timelineEndIso = canonicalTimestamp(timelineEnd);

  // Units for null points: the first harmonized unit per quantity, else the registry's.
  const units: Record<string, string> = {};
  for (const points of Object.values(byModel)) {
    for (const p of points) if (p.unit && !(p.variable in units)) units[p.variable] = p.unit;
  }
  for (const v of normalizedVars) if (!(v in units)) units[v] = registry.targetUnits.get(v) ?? "";

  // 3. Clip each model to its fetched window and record coverage of its configured slice.
  const optional = new Set(optionalQuantities(registry));
  const diagnostics: Record<string, ModelTimelineDiagnostics> = {};
  for (const model of chain) {
    const expectedEnd = tNow + model.max_forecast_horizon_hours * HOUR_MS;
    const fetchedEnd = tNow + (fetchHorizons.get(model.name) as number) * HOUR_MS;
    const fetched = (byModel[model.name] ?? [])
      .map((p) => [normalizeTimestamp(p.timestamp), p] as const)
      .filter(([t]) => timelineStart <= t && t < fetchedEnd)
      .sort((a, b) => a[0] - b[0] || (a[1].variable < b[1].variable ? -1 : a[1].variable > b[1].variable ? 1 : 0));
    byModel[model.name] = fetched.map(([, p]) => p);
    const expectedLast = model.max_forecast_horizon_hours > 0 ? expectedEnd - HOUR_MS : null;
    const variables: Record<string, VariableTimelineCoverage> = {};
    for (const variable of normalizedVars) {
      const points = fetched.filter(([t, p]) => p.variable === variable && t >= tNow && t < expectedEnd);
      const valid = points.filter(([, p]) => p.value !== null);
      const anomalies = validateTimestampSequence(
        points.map(([t]) => t),
        HOUR_MS,
        `${model.name} / ${variable}`,
      ).map((a) => ({
        after_timestamp: canonicalTimestamp(a.previousMs),
        before_timestamp: canonicalTimestamp(a.currentMs),
        actual_seconds: a.actualMs / 1000,
        expected_seconds: a.expectedMs / 1000,
      }));
      const validTimes = new Set(valid.map(([t]) => t));
      const complete =
        expectedLast === null ||
        (validTimes.has(expectedLast) &&
          validTimes.size === Math.max(0, model.max_forecast_horizon_hours) &&
          !anomalies.length);
      const coverage: VariableTimelineCoverage = {
        variable,
        sample_count: points.length,
        valid_sample_count: valid.length,
        first_timestamp: points[0]?.[1].timestamp ?? null,
        last_timestamp: points[points.length - 1]?.[1].timestamp ?? null,
        first_valid_timestamp: valid[0]?.[1].timestamp ?? null,
        last_valid_timestamp: valid[valid.length - 1]?.[1].timestamp ?? null,
        expected_start: tNowIso,
        expected_end_exclusive: canonicalTimestamp(expectedEnd),
        expected_last_timestamp: expectedLast === null ? null : canonicalTimestamp(expectedLast),
        complete,
        spacing_anomalies: anomalies,
      };
      variables[variable] = coverage;
      if (!complete && !optional.has(variable) && !errors[model.name]) {
        warn(
          `${model.name} / ${variable}: expected hourly data through ${coverage.expected_last_timestamp} ` +
            `(model boundary ${coverage.expected_end_exclusive} exclusive), received valid data only through ` +
            `${coverage.last_valid_timestamp}`,
        );
      }
    }
    diagnostics[model.name] = {
      model: model.name,
      expected_start: tNowIso,
      expected_end_exclusive: canonicalTimestamp(expectedEnd),
      variables,
    };
  }

  // 4. Latest runs (meta.json) and the hours each model really delivers.
  const runInfo = await fetchRunInfo(
    client,
    [...chain, ...cloudChain].map((m) => modelId(m, catalogue)),
    { catalogue },
    { signal, onWarning: warn },
  );
  throwIfAborted(signal);
  const availabilityFor = (
    model: WeatherModel,
    chainName: "main" | "cloud",
    validTimes: number[],
    fetchedHours: number,
  ): ModelAvailability => {
    const id = modelId(model, catalogue);
    const [hours, validUntil] = computeAvailableHours(validTimes, tNow, fetchedHours);
    const info = runInfo.get(id);
    return {
      model: model.name,
      model_id: id,
      chain: chainName,
      available_hours: hours,
      valid_until: validUntil,
      last_run_init_time: info?.init ?? null,
      last_run_availability_time: info?.available ?? null,
    };
  };

  // The temperature defines the delivered hours, so a slice ends where its
  // curve ends even when single quantities of a newer run reach further
  // (REQ-630). Without temperature, all main-run quantities count: optional
  // ones may be missing, ensemble ones (probability) end where the ensemble
  // run ends.
  const excluded = new Set(mainRunExcludedQuantities(registry));
  const availability: Record<string, ModelAvailability> = {};
  const withData = new Set<string>();
  for (const model of chain) {
    const corePoints = (byModel[model.name] ?? []).filter((p) => p.value !== null && !excluded.has(p.variable));
    if (corePoints.length) withData.add(`main:${model.name}`);
    const temperaturePoints = corePoints.filter((p) => p.variable === SLICE_END_QUANTITY);
    const sliceTimes = (temperaturePoints.length ? temperaturePoints : corePoints).map((p) =>
      normalizeTimestamp(p.timestamp),
    );
    availability[model.name] = availabilityFor(model, "main", sliceTimes, fetchHorizons.get(model.name) as number);
  }
  const cappedChain = capChainToAvailability(chain, availability);

  // Models without data still get their slice, as nulls.
  for (const model of chain) {
    if ((byModel[model.name] ?? []).length) continue;
    const points: DataPoint[] = [];
    for (const t of timeline) {
      const hours = t < tNow ? 0 : (t - tNow) / HOUR_MS;
      if (hours >= model.max_forecast_horizon_hours) continue;
      const timestamp = canonicalTimestamp(t);
      for (const variable of normalizedVars) {
        points.push({ timestamp, value: null, unit: units[variable] ?? "", variable, model: model.name });
      }
    }
    byModel[model.name] = points;
  }

  // 5. Stitch the main chain.
  const combined = mergeForecastSegments(
    cappedChain,
    byModel,
    normalizedVars,
    tNowIso,
    timelineStartIso,
    timelineEndIso,
    units,
  );

  // 6. Cloud chain: a failing model only loses its own profiles.
  let cloud: DetailedCloudForecast | null = null;
  let cloudTransitions: ForecastResult["cloudTransitions"] = [];
  const cloudByModel: Record<string, DetailedCloudForecast> = {};
  let cloudAvailability: Record<string, ModelAvailability> = {};
  const droppedCloudModels: string[] = [];
  let cappedCloudChain: WeatherModel[] = [];
  if (cloudChain.length && timeline.length) {
    cloudChain.forEach((model, index) => {
      const settled = cloudResults[index] as PromiseSettledResult<DetailedCloudForecast>;
      let forecast: DetailedCloudForecast = { location, profiles: [] };
      if (settled.status === "fulfilled") forecast = settled.value;
      else warn(`Failed to fetch vertical clouds for model '${model.name}': ${message(settled.reason)}`);
      cloudByModel[model.name] = forecast;
      const cloudTimes = forecast.profiles.filter(hasCloudValues).map((p) => normalizeTimestamp(p.timestamp));
      if (cloudTimes.length) withData.add(`cloud:${model.name}`);
      cloudAvailability[model.name] = availabilityFor(
        model,
        "cloud",
        cloudTimes,
        cloudFetchHorizons.get(model.name) as number,
      );
    });
    if (autoResolution) {
      const kept = cloudChain.filter((m) => withData.has(`cloud:${m.name}`));
      if (kept.length && kept.length < cloudChain.length) {
        for (const m of cloudChain) {
          if (kept.includes(m)) continue;
          droppedCloudModels.push(m.name);
          delete cloudAvailability[m.name];
          delete cloudByModel[m.name];
        }
        cloudChain = kept;
        cloudAvailability = Object.fromEntries(cloudChain.map((m) => [m.name, cloudAvailability[m.name]!]));
      }
    }
    cappedCloudChain = capChainToAvailability(cloudChain, cloudAvailability);
    const merged = mergeVerticalCloudSegments(cappedCloudChain, cloudByModel, timeline, tNowIso, location);
    cloud = merged.verticalCloudForecast ?? null;
    cloudTransitions = merged.verticalCloudTransitions;
  }

  // 7. Run segments (Single Runs API) and the ensemble behind the probability.
  // The first outage of the Single Runs API stops every search of this
  // download, running and not yet started ones, through `search` (REQ-633).
  const runSegments: Record<string, RunSegment[]> = {};
  const cloudRunSegments: Record<string, RunSegment[]> = {};
  if (runSegmentsEnabled) {
    const search = new AbortController();
    const forwardAbort = () => search.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    let outage: SingleRunsUnavailableError | null = null;
    let stopped: () => void = () => {};
    const outageSeen = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const stopSearch = (error: SingleRunsUnavailableError) => {
      if (outage || signal?.aborted) return;
      outage = error;
      search.abort(error);
      stopped();
    };
    const searched: [Record<string, RunSegment[]>, string][] = [];
    const segmentCache = new Map<string, Promise<RunSegment[]>>();
    const jobs: Promise<void>[] = [];
    for (const [chainName, availabilities, models, target] of [
      ["main", availability, chain, runSegments],
      ["cloud", cloudAvailability, cloudChain, cloudRunSegments],
    ] as const) {
      const maxHorizon = Math.max(0, ...models.map((m) => m.max_forecast_horizon_hours));
      for (const model of models) {
        const entry = availabilities[model.name];
        if (!entry?.model_id) continue;
        let dataEnd: number;
        if (entry.available_hours !== null && entry.available_hours !== undefined) {
          if (entry.available_hours === 0) continue;
          dataEnd = normalizeTimestamp(entry.valid_until as string);
        } else if (withData.has(`${chainName}:${model.name}`)) {
          dataEnd = tNow + getFetchHorizon(model, maxHorizon, catalogue) * HOUR_MS;
        } else {
          continue;
        }
        const id = entry.model_id;
        let info = runInfo.get(id);
        if (!info) {
          info = { init: null, available: null };
          runInfo.set(id, info);
        }
        const key = `${id}@${dataEnd}`;
        let pending = segmentCache.get(key);
        if (!pending) {
          pending = resolveRunSegments(
            client,
            { modelId: id, location, catalogue, signal: search.signal, onWarning: warn, onOutage: stopSearch },
            info,
            dataEnd,
            nowMs,
          );
          segmentCache.set(key, pending);
        }
        const runInfoEntry = info;
        searched.push([target, model.name]);
        jobs.push(
          pending.then(
            (segments) => {
              if (outage) return; // The result is complete without this model's segments.
              // A newer run than meta.json names may have been found.
              entry.last_run_init_time = runInfoEntry.init;
              entry.last_run_availability_time = runInfoEntry.available;
              entry.run_segments = segments.map((s) => ({ ...s }));
              if (segments.length > 1) entry.data_end_run_init_time = segments[segments.length - 1]!.run_init_time;
              target[model.name] = entry.run_segments;
            },
            (error: unknown) => {
              if (error instanceof SingleRunsUnavailableError) stopSearch(error);
              if (outage) return; // Stopped by the outage (or failing after it).
              throw error;
            },
          ),
        );
      }
    }
    try {
      // On an outage, return at once instead of waiting for the aborted requests to settle.
      await Promise.race([Promise.all(jobs), outageSeen]);
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
    }
    throwIfAborted(signal);
    const failure = outage as SingleRunsUnavailableError | null;
    if (failure) {
      const without = [...new Set(searched.filter(([target, name]) => !target[name]).map(([, name]) => name))];
      warn(
        `${failure.message}. Run segment search stopped` +
          (without.length ? `; no run segments for ${without.map((name) => `'${name}'`).join(", ")}` : ""),
      );
    }
  }

  const ensembleCache = new Map<string, Promise<ModelAvailability["ensemble"]>>();
  await Promise.all(
    chain.map(async (model) => {
      const entry = availability[model.name];
      if (!entry?.model_id) return;
      const probabilityTimes = (byModel[model.name] ?? [])
        .filter((p) => p.value !== null && p.variable === "precipitation_probability")
        .map((p) => normalizeTimestamp(p.timestamp));
      if (probabilityTimes.length) {
        entry.probability_valid_until = canonicalTimestamp(Math.max(...probabilityTimes) + HOUR_MS);
      }
      let pending = ensembleCache.get(entry.model_id);
      if (!pending) {
        pending = fetchEnsembleInfo(client, entry.model_id, { catalogue }, { signal, onWarning: warn });
        ensembleCache.set(entry.model_id, pending);
      }
      const ensemble = await pending;
      if (ensemble) entry.ensemble = { ...ensemble };
    }),
  );
  throwIfAborted(signal);

  // 8. Result.
  const configuredByName = new Map(chain.map((m) => [m.name, m]));
  const configuredCloudByName = new Map(cloudChain.map((m) => [m.name, m]));
  const result: ForecastResult = {
    location,
    timezone,
    timeline: { start: timelineStartIso, now: tNowIso, end: timelineEndIso },
    chain: activeChain(cappedChain).map((m) =>
      toChainResult(m, configuredByName.get(m.name), runSegments[m.name], replacedBy.get(m.name)),
    ),
    cloudChain: cappedCloudChain.length
      ? activeChain(cappedCloudChain).map((m) =>
          toChainResult(m, configuredCloudByName.get(m.name), cloudRunSegments[m.name]),
        )
      : [],
    combined,
    byModel,
    cloud,
    cloudByModel,
    cloudTransitions,
    sunPhases,
    availability,
    cloudAvailability,
    runSegments,
    diagnostics,
    raw,
    errors,
    warnings,
    generatedAt: canonicalTimestamp(Date.now()),
    attribution: { ...OPEN_METEO_ATTRIBUTION },
  };
  if (autoResolution) {
    const info: AutoChainInfo = {
      region_id: autoResolution.region_id,
      region_name: autoResolution.region_name,
      resolution_reason: autoResolution.resolution_reason,
      main_model_chain: chain.map((m) => ({ ...m })),
      cloud_model_chain: cloudChain.map((m) => ({ ...m })),
      dropped_models: droppedModels,
      dropped_cloud_models: droppedCloudModels,
    };
    if (replacedModels.length) info.replaced_models = replacedModels;
    result.autoChain = info;
  }
  if (client.cache) await client.cache.set(cacheKey, result);
  return result;
}

// --- attribution ----------------------------------------------------------------

/**
 * Attribution of the Open-Meteo data (CC BY 4.0) carried by every result.
 * Frozen and shared; spread it to change a field.
 */
export const OPEN_METEO_ATTRIBUTION: Readonly<DataAttribution> = Object.freeze({
  text: "Weather data by Open-Meteo.com",
  url: "https://open-meteo.com/",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  modifications:
    "Data were harmonized (units, timestamps) and combined from several weather models into one timeline.",
});

// --- adapters -------------------------------------------------------------------

/** The result in the snake-case shape of the former backend (`HarmonizedForecastResponse`). */
export function toHarmonizedResponse(result: ForecastResult): HarmonizedForecastResponse {
  return {
    combined_forecast: result.combined,
    model_forecasts: result.byModel,
    raw_data: result.raw,
    vertical_cloud_forecast: result.cloud,
    vertical_cloud_transitions: result.cloudTransitions,
    vertical_cloud_model_forecasts: result.cloudByModel,
    sun_phases: result.sunPhases,
    forecast_start_time: result.timeline.now,
    timeline_start: result.timeline.start,
    timeline_end: result.timeline.end,
    user_timezone: result.timezone,
    timeline_diagnostics: result.diagnostics,
    model_availability: result.availability,
    cloud_model_availability: result.cloudAvailability,
    generated_at: result.generatedAt,
    auto_chain: result.autoChain ?? null,
    attribution: {
      text: result.attribution.text,
      url: result.attribution.url,
      license: result.attribution.license,
      license_url: result.attribution.licenseUrl,
      modifications: result.attribution.modifications,
    },
  };
}

/**
 * The result as input of the meteogram (`MeteogramInput` of
 * `@graupel/meteogram`, structurally; this package does not depend on it).
 */
export function toMeteogramInput(result: ForecastResult) {
  return {
    location: result.location,
    timezone: result.timezone,
    timeline: { ...result.timeline },
    chain: result.chain,
    series: result.combined,
    modelSeries: result.byModel,
    cloudProfile: result.cloud,
    cloudTransitions: result.cloudTransitions,
    sunPhases: result.sunPhases,
    generatedAt: result.generatedAt,
  };
}
