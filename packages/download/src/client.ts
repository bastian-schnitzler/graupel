// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Open-Meteo client: forecast, `meta.json`, ensemble metadata, Single Runs
 * and sun times.
 *
 * Every request goes through the global `fetch` (or an injected one), is
 * limited to a number of parallel requests, retried on 500–504 and network
 * errors with exponential backoff, and can be aborted with an `AbortSignal`.
 * Single Runs requests are never retried: an outage of that API must not hold
 * up the forecast (REQ-633). All time series are requested with `timezone=GMT`.
 */

import { createMemoryCache, type ForecastCache } from "./cache";
import { canonicalTimestamp } from "./timeline";
import type { ForecastResult, SunPeriod } from "./types";

export const DEFAULT_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const DEFAULT_SINGLE_RUNS_URL = "https://single-runs-api.open-meteo.com/v1/forecast";
/** Base of the static run metadata: `<metaUrl>/<path>/static/meta.json`. */
export const DEFAULT_META_URL = "https://api.open-meteo.com/data";

export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([500, 502, 503, 504]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  forecastUrl?: string;
  singleRunsUrl?: string;
  metaUrl?: string;
  /** Commercial API key, sent as `apikey` with forecast and Single Runs requests. */
  apiKey?: string;
  /** Timeout of a single attempt in milliseconds (default 60 000). */
  timeoutMs?: number;
  /**
   * Retries after the first attempt on 500–504 and network errors (default 2).
   * Forecast and `meta.json` requests only; Single Runs requests are never
   * retried (REQ-633).
   */
  maxRetries?: number;
  /** Base delay of the exponential backoff in milliseconds (default 500). */
  retryBackoffMs?: number;
  /** Maximum number of requests in flight (default 4). */
  concurrency?: number;
  /** Cache of `downloadChain` results (default: in memory, see `createMemoryCache`); null switches it off. */
  cache?: ForecastCache<ForecastResult> | null;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface SingleRunOptions extends RequestOptions {
  /**
   * Called when the request fails with 5xx, a timeout or a network error,
   * before the next queued request may start: a caller can abort its other
   * Single Runs requests before any of them is sent (REQ-633).
   */
  onUnavailable?: (error: ApiError) => void;
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/** Raw `/v1/forecast` answer, as far as the library reads it. */
export interface OpenMeteoResponse {
  latitude?: number | null;
  longitude?: number | null;
  elevation?: number | null;
  generationtime_ms?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  timezone_abbreviation?: string;
  hourly?: Record<string, unknown[]> & { time?: string[] };
  hourly_units?: Record<string, string>;
  daily?: Record<string, unknown[]> & { time?: string[] };
  daily_units?: Record<string, string>;
  [key: string]: unknown;
}

/** Run metadata from `meta.json`; times are Unix seconds. */
export interface OpenMeteoMeta {
  last_run_initialisation_time?: number;
  last_run_modification_time?: number;
  last_run_availability_time?: number;
  data_end_time?: number;
  update_interval_seconds?: number;
  temporal_resolution_seconds?: number;
  [key: string]: unknown;
}

export interface ForecastRequest {
  latitude: number;
  longitude: number;
  /** Open-Meteo model ids; empty or missing means `best_match`. */
  models?: string | readonly string[];
  /** Open-Meteo hourly variable names. */
  hourly?: readonly string[];
  daily?: readonly string[];
  forecastHours?: number;
  pastHours?: number;
  forecastDays?: number;
  pastDays?: number;
}

export interface SingleRunRequest {
  model: string;
  /** Run initialisation, e.g. `2026-10-26T06:00` (UTC). */
  run: string;
  latitude: number;
  longitude: number;
  forecastHours: number;
  /** Hourly variables (default `temperature_2m`). */
  hourly?: readonly string[];
}

export interface SunPhasesRequest {
  latitude: number;
  longitude: number;
  /** Days ahead, clamped to 1–16 (default 16). */
  forecastDays?: number;
}

/** An answer of Open-Meteo that is not a success, or a request that failed for good. */
export class ApiError extends Error {
  /** HTTP status; null for network errors and timeouts. */
  readonly status: number | null;
  /** `reason` from the error body of Open-Meteo, if any. */
  readonly reason: string | null;
  readonly url: string;

  constructor(
    message: string,
    details: { status: number | null; reason?: string | null; url: string; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ApiError";
    this.status = details.status;
    this.reason = details.reason ?? null;
    this.url = details.url;
  }
}

/** A failure of the service itself: 5xx, timeout or network error (status null), not a rejected request. */
export function isServiceFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === null || error.status >= 500);
}

/** Open-Meteo has no data of the model at this location ("No data is available …"). */
export class OutOfDomainError extends ApiError {
  constructor(
    message: string,
    details: { status: number | null; reason?: string | null; url: string; cause?: unknown },
  ) {
    super(message, details);
    this.name = "OutOfDomainError";
  }
}

/** Every model of a chain failed; `errors` holds the error per model. */
export class AllModelsFailedError extends Error {
  readonly errors: Record<string, unknown>;

  constructor(errors: Record<string, unknown>, message?: string) {
    const first = Object.values(errors)[0];
    super(
      message ??
        `All models failed${first instanceof Error ? `: ${first.message}` : ""}`,
      first === undefined ? undefined : { cause: first },
    );
    this.name = "AllModelsFailedError";
    this.errors = errors;
  }
}

/** Parse a JSON body; repairs the unquoted `nan` Open-Meteo sends outside a regional model's area. */
export function parseOpenMeteoJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const cleaned = text.replace(/([:[,]\s*)-?nan\b/gi, "$1null");
    if (cleaned === text) throw error;
    return JSON.parse(cleaned);
  }
}

/** Query string with comma-joined lists; null and undefined values are left out. */
export function buildQuery(params: QueryParams): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const text = Array.isArray(value) ? value.join(",") : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text).replace(/%2C/gi, ",")}`);
  }
  return parts.join("&");
}

function withQuery(url: string, params: QueryParams): string {
  const query = buildQuery(params);
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Counting semaphore limiting requests in flight. */
class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        this.active += 1;
        resolve();
      };
      const onAbort = () => {
        const index = this.queue.indexOf(grant);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortReason(signal as AbortSignal));
      };
      this.queue.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

class RetryableError extends Error {
  constructor(readonly failure: ApiError) {
    super(failure.message);
  }
}

function errorFromResponse(url: string, status: number, statusText: string, body: string, model: string | null): ApiError {
  let reason: string | null = null;
  try {
    const data = parseOpenMeteoJson(body) as { reason?: unknown } | null;
    if (data && typeof data === "object" && typeof data.reason === "string" && data.reason) {
      reason = data.reason;
    }
  } catch {
    // Body without JSON: keep the HTTP status only.
  }
  const modelText = model ?? "";
  if (reason && reason.toLowerCase().includes("no data is available")) {
    return new OutOfDomainError(
      `Open-Meteo API Error: ${reason} for model '${modelText}'. The location is outside this model's geographic coverage.`,
      { status, reason, url },
    );
  }
  if (reason) {
    return new ApiError(`Open-Meteo API Error: ${reason} (model: ${modelText})`, { status, reason, url });
  }
  return new ApiError(`Open-Meteo API Error: HTTP ${status}${statusText ? ` ${statusText}` : ""}`, {
    status,
    url,
  });
}

/** Metadata paths of models whose data path differs from the API model id. */
export const MODEL_META_PATH_ALIASES: Readonly<Record<string, string>> = {
  icon_global: "dwd_icon",
  icon_eu: "dwd_icon_eu",
  icon_d2: "dwd_icon_d2",
  ncep_gfs_global: "ncep_gfs013",
  gfs_global: "ncep_gfs013",
  meteofrance_arpege_world: "meteofrance_arpege_world025",
  meteofrance_arome_france: "meteofrance_arome_france0025",
  metno_nordic: "metno_nordic_pp",
};

/** Ensemble behind each model's `precipitation_probability`. */
export const ENSEMBLE_META_PATHS: Readonly<Record<string, string>> = {
  meteoswiss_icon_ch1: "meteoswiss_icon_ch1_ensemble",
  meteoswiss_icon_ch2: "meteoswiss_icon_ch2_ensemble",
  // Since 2026-10-06 Open-Meteo keeps the DWD EPS only on the native
  // icosahedral grid (open-meteo/open-meteo#2194).
  icon_global: "dwd_icon_global_eps_native",
  icon_eu: "dwd_icon_eu_eps_native",
  icon_d2: "dwd_icon_d2_eps_native",
  ecmwf_ifs: "ecmwf_ifs025_ensemble",
  ecmwf_ifs025: "ecmwf_ifs025_ensemble",
  ncep_gfs_global: "ncep_gefs05",
  gfs_global: "ncep_gefs05",
  cmc_gem_gdps: "cmc_gem_geps",
  ukmo_global_deterministic_10km: "ukmo_global_ensemble_20km",
  ukmo_uk_deterministic_2km: "ukmo_uk_ensemble_2km",
};

/**
 * Metadata path of a model, or null for blends (`best_match`, `*seamless*`).
 * A catalogue `meta_path` takes precedence over the built-in aliases.
 */
export function modelMetaPath(modelId: string | null | undefined, cataloguePath?: string | null): string | null {
  const id = (modelId ?? "").toLowerCase();
  if (!id || id === "best_match" || id.includes("seamless")) return null;
  if (cataloguePath) return cataloguePath;
  return MODEL_META_PATH_ALIASES[id] ?? id;
}

/**
 * Metadata path of the ensemble behind the model's precipitation
 * probability, or null if there is none. A catalogue `ensemble_meta_path`
 * takes precedence over the built-in table.
 */
export function ensembleMetaPath(modelId: string | null | undefined, cataloguePath?: string | null): string | null {
  if (cataloguePath) return cataloguePath;
  return ENSEMBLE_META_PATHS[(modelId ?? "").toLowerCase()] ?? null;
}

const MODEL_TO_OPENMETEO: Readonly<Record<string, string>> = {
  "ICON-D2": "icon_d2",
  "ICON-EU": "icon_eu",
  GFS: "ncep_gfs_seamless",
  "ECMWF-IFS": "ecmwf_ifs",
  "ECMWF IFS": "ecmwf_ifs",
  "ECMWF IFS HRES": "ecmwf_ifs",
  "ECMWF IFS HRES 9 KM": "ecmwf_ifs",
  "ECMWF IFS HRES 9KM": "ecmwf_ifs",
  "ECMWF IFS 0.4°": "ecmwf_ifs",
};

/** Former ids and display names → current Open-Meteo model id. */
export const MODEL_ALIAS_MAP: Readonly<Record<string, string>> = {
  gfs: "ncep_gfs_seamless",
  "gfs seamless": "ncep_gfs_seamless",
  gfs_seamless: "ncep_gfs_seamless",
  gfs_global: "ncep_gfs_global",
  "gfs global": "ncep_gfs_global",
  gfs_hrrr: "ncep_hrrr_conus",
  gfs_graphcast025: "ncep_gfs_graphcast025",
  gem: "cmc_gem_seamless",
  gem_seamless: "cmc_gem_seamless",
  gem_global: "cmc_gem_gdps",
  gem_regional: "cmc_gem_rdps",
  gem_hrdps: "cmc_gem_hrdps",
  icon: "icon_seamless",
  "icon-d2": "icon_d2",
  "icon-eu": "icon_eu",
  "icon global": "icon_global",
  "icon-global": "icon_global",
  "ecmwf-ifs": "ecmwf_ifs",
  "ecmwf ifs": "ecmwf_ifs",
  "ecmwf ifs hres": "ecmwf_ifs",
  "ecmwf ifs hres 9km": "ecmwf_ifs",
  "ecmwf ifs hres 9 km": "ecmwf_ifs",
  ecmwf_ifs_hres: "ecmwf_ifs",
  ecmwf_ifs_hres_9km: "ecmwf_ifs",
  "ecmwf-ifs 0.4°": "ecmwf_ifs",
  "ecmwf ifs 0.4°": "ecmwf_ifs",
  ecmwf_aifs025: "ecmwf_aifs025_single",
  icon_ch1: "meteoswiss_icon_ch1",
  icon_ch2: "meteoswiss_icon_ch2",
  meteoswiss_icon_ch1_hd: "meteoswiss_icon_ch1",
  meteoswiss_icon_ch2_hd: "meteoswiss_icon_ch2",
  meteofrance_arome_hd: "meteofrance_arome_france_hd",
  ukmo_global_qpe1km: "ukmo_global_deterministic_10km",
};

/** Canonical model id from a raw id or, without one, from a name. */
export function canonicalModelId(rawId?: string | null, rawName?: string | null): string {
  if (rawId) {
    const id = rawId.trim().toLowerCase();
    return MODEL_ALIAS_MAP[id] ?? id;
  }
  if (rawName) {
    const name = rawName.trim().toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
    return MODEL_ALIAS_MAP[name] ?? name;
  }
  return "unknown_model";
}

/** Translate a model label (catalogue id, name or former alias) to an Open-Meteo model id. */
export function toOpenMeteoModel(
  modelName: string,
  catalogue: readonly { id?: string | null; name: string }[] = [],
): string {
  const clean = modelName.trim().toLowerCase();
  for (const model of catalogue) {
    if (model.id && model.id.toLowerCase() === clean) return model.id;
    if (model.name.toLowerCase() === clean) return model.id || model.name;
  }
  const alias = MODEL_ALIAS_MAP[clean];
  if (alias) return alias;
  const normalized = clean.replace(/-/g, "_").replace(/ /g, "_");
  const normalizedAlias = MODEL_ALIAS_MAP[normalized];
  if (normalizedAlias) return normalizedAlias;
  for (const model of catalogue) {
    if (model.id && model.name.toLowerCase().replace(/-/g, "_").replace(/ /g, "_") === normalized) {
      return model.id;
    }
  }
  return MODEL_TO_OPENMETEO[modelName.trim().toUpperCase()] ?? normalized;
}

/** Sunrise and sunset per day from a `daily=sunrise,sunset` answer, as UTC instants. */
export function extractSunPeriods(raw: OpenMeteoResponse): SunPeriod[] {
  const daily = raw.daily ?? {};
  const days = (daily.time ?? []) as unknown[];
  const sunrises = (daily.sunrise ?? []) as unknown[];
  const sunsets = (daily.sunset ?? []) as unknown[];
  const responseTimezone = typeof raw.timezone === "string" && raw.timezone ? raw.timezone : "UTC";
  const periods: SunPeriod[] = [];
  const count = Math.min(days.length, sunrises.length, sunsets.length);
  for (let i = 0; i < count; i += 1) {
    const sunrise = sunrises[i];
    const sunset = sunsets[i];
    if (typeof sunrise !== "string" || !sunrise || typeof sunset !== "string" || !sunset) continue;
    periods.push({
      day: String(days[i]),
      sunrise: canonicalTimestamp(sunrise, responseTimezone),
      sunset: canonicalTimestamp(sunset, responseTimezone),
    });
  }
  return periods;
}

export interface OpenMeteoClient {
  readonly forecastUrl: string;
  readonly singleRunsUrl: string;
  readonly metaUrl: string;
  /** Cache of `downloadChain` results, or null. */
  readonly cache: ForecastCache<ForecastResult> | null;
  /**
   * GET a JSON document with retries (`maxRetries`), timeout, parallelism limit and `nan`
   * repair. Throws {@link ApiError} (or {@link OutOfDomainError}) when it fails
   * for good; an aborted signal rejects with the signal's reason.
   */
  getJson(url: string, params?: QueryParams, options?: RequestOptions): Promise<unknown>;
  /** One `/v1/forecast` request with `timezone=GMT`. */
  fetchForecast(request: ForecastRequest, options?: RequestOptions): Promise<OpenMeteoResponse>;
  /** `meta.json` under a data path; `{}` for a null path or a 404. */
  fetchMeta(path: string | null | undefined, options?: RequestOptions): Promise<OpenMeteoMeta>;
  /** `meta.json` of the model's run (`{}` for blends and unknown paths). */
  fetchModelMeta(modelId: string, options?: RequestOptions & { metaPath?: string | null }): Promise<OpenMeteoMeta>;
  /** `meta.json` of the ensemble behind the model's precipitation probability (`{}` if none). */
  fetchEnsembleMeta(
    modelId: string,
    options?: RequestOptions & { ensembleMetaPath?: string | null },
  ): Promise<OpenMeteoMeta>;
  /**
   * One specific run from the Single Runs API. Unlike the other requests it is
   * not retried on 500–504, network errors or timeouts (REQ-633).
   */
  fetchSingleRun(request: SingleRunRequest, options?: SingleRunOptions): Promise<OpenMeteoResponse>;
  /** Sunrise and sunset from two days back up to `forecastDays` ahead (best match). */
  fetchSunPhases(request: SunPhasesRequest, options?: RequestOptions): Promise<SunPeriod[]>;
}

function asObject<T>(data: unknown): T {
  return (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as T;
}

export function createClient(options: ClientOptions = {}): OpenMeteoClient {
  const fetchImpl: FetchLike | undefined =
    options.fetch ?? (typeof fetch === "function" ? (input, init) => fetch(input, init) : undefined);
  const forecastUrl = options.forecastUrl ?? DEFAULT_FORECAST_URL;
  const singleRunsUrl = options.singleRunsUrl ?? DEFAULT_SINGLE_RUNS_URL;
  const metaUrl = (options.metaUrl ?? DEFAULT_META_URL).replace(/\/+$/, "");
  const apiKey = options.apiKey || undefined;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
  const retryBackoffMs = Math.max(0, options.retryBackoffMs ?? 500);
  const limiter = new Limiter(Math.max(1, Math.floor(options.concurrency ?? 4)));
  const cache = options.cache === undefined ? createMemoryCache<ForecastResult>() : options.cache;

  async function attempt(
    url: string,
    model: string | null,
    allowNotFound: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!fetchImpl) throw new Error("No fetch implementation available");
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(abortReason(signal as AbortSignal));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer =
      timeoutMs > 0 && Number.isFinite(timeoutMs)
        ? setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException("Open-Meteo request timed out", "TimeoutError"));
          }, timeoutMs)
        : undefined;
    try {
      let response: Response;
      let text: string;
      try {
        response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        text = await response.text();
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        const message = timedOut ? `Open-Meteo request timed out after ${timeoutMs} ms` : "Open-Meteo request failed";
        throw new RetryableError(new ApiError(message, { status: null, url, cause: error }));
      }
      if (allowNotFound && response.status === 404) return {};
      if (!response.ok) {
        const failure = errorFromResponse(url, response.status, response.statusText, text, model);
        if (RETRYABLE_STATUS_CODES.has(response.status)) throw new RetryableError(failure);
        throw failure;
      }
      try {
        return parseOpenMeteoJson(text);
      } catch (error) {
        throw new ApiError("Open-Meteo answered with invalid JSON", { status: response.status, url, cause: error });
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function request(
    url: string,
    params: QueryParams,
    signal: AbortSignal | undefined,
    allowNotFound = false,
    retries = maxRetries,
    onUnavailable?: (error: ApiError) => void,
  ): Promise<unknown> {
    const fullUrl = withQuery(url, params);
    const model = typeof params.models === "string" ? params.models : Array.isArray(params.models) ? params.models.join(",") : null;
    for (let n = 0; ; n += 1) {
      const last = n >= retries;
      const task = async () => {
        try {
          return await attempt(fullUrl, model, allowNotFound, signal);
        } catch (error) {
          // Still inside the slot of the limiter: no queued request has started yet.
          const failure = error instanceof RetryableError ? error.failure : error;
          if (onUnavailable && !signal?.aborted && (last || !(error instanceof RetryableError)) && isServiceFailure(failure)) {
            onUnavailable(failure);
          }
          throw error;
        }
      };
      try {
        return await limiter.run(task, signal);
      } catch (error) {
        if (!(error instanceof RetryableError)) throw error;
        if (n >= retries) throw error.failure;
      }
      await sleep(retryBackoffMs * 2 ** n, signal);
    }
  }

  const client: OpenMeteoClient = {
    forecastUrl,
    singleRunsUrl,
    metaUrl,
    cache,

    getJson(url, params = {}, requestOptions = {}) {
      return request(url, params, requestOptions.signal);
    },

    async fetchForecast(req, requestOptions = {}) {
      const models = typeof req.models === "string" ? req.models : (req.models ?? []).join(",");
      const params: QueryParams = {
        latitude: req.latitude,
        longitude: req.longitude,
        hourly: req.hourly && req.hourly.length ? req.hourly : undefined,
        daily: req.daily && req.daily.length ? req.daily : undefined,
        models: models || "best_match",
        forecast_hours: req.forecastHours,
        past_hours: req.pastHours,
        forecast_days: req.forecastDays,
        past_days: req.pastDays,
        // Transport absolute UTC instants; the location's time zone is for display only.
        timezone: "GMT",
        apikey: apiKey,
      };
      return asObject<OpenMeteoResponse>(await request(forecastUrl, params, requestOptions.signal));
    },

    async fetchMeta(path, requestOptions = {}) {
      if (!path) return {};
      const url = `${metaUrl}/${path}/static/meta.json`;
      return asObject<OpenMeteoMeta>(await request(url, {}, requestOptions.signal, true));
    },

    fetchModelMeta(modelId, requestOptions = {}) {
      return client.fetchMeta(modelMetaPath(modelId, requestOptions.metaPath), requestOptions);
    },

    fetchEnsembleMeta(modelId, requestOptions = {}) {
      return client.fetchMeta(ensembleMetaPath(modelId, requestOptions.ensembleMetaPath), requestOptions);
    },

    async fetchSingleRun(req, requestOptions = {}) {
      const params: QueryParams = {
        latitude: req.latitude,
        longitude: req.longitude,
        models: req.model,
        run: req.run,
        hourly: req.hourly && req.hourly.length ? req.hourly : ["temperature_2m"],
        forecast_hours: req.forecastHours,
        timezone: "GMT",
        apikey: apiKey,
      };
      // No retries: a failing Single Runs API stops the run search instead (REQ-633).
      return asObject<OpenMeteoResponse>(
        await request(singleRunsUrl, params, requestOptions.signal, false, 0, requestOptions.onUnavailable),
      );
    },

    async fetchSunPhases(req, requestOptions = {}) {
      const raw = await client.fetchForecast(
        {
          latitude: req.latitude,
          longitude: req.longitude,
          daily: ["sunrise", "sunset"],
          // Two UTC past days also cover yesterday in every location time zone.
          pastDays: 2,
          forecastDays: Math.min(16, Math.max(1, Math.round(req.forecastDays ?? 16))),
          models: "best_match",
        },
        requestOptions,
      );
      return extractSunPeriods(raw);
    },
  };
  return client;
}
