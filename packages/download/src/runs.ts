// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Model runs: latest run per model from `meta.json`, the runs a series is
 * composed of (Single Runs API) and the ensemble behind the precipitation
 * probability.
 *
 * An outage of the Single Runs API (5xx, timeout, network error) ends the run
 * search with {@link SingleRunsUnavailableError}; a missing run (4xx, empty
 * answer) does not (REQ-633).
 */

import { ensembleMetaPath, isServiceFailure, type ApiError, type OpenMeteoClient, type OpenMeteoMeta, type RequestOptions } from "./client";
import { findCatalogueModel, type ModelCatalogue } from "./quantities";
import { canonicalTimestamp, normalizeTimestamp, HOUR_MS } from "./timeline";
import type { EnsembleRunInfo, Location, RunSegment } from "./types";

/** Hours requested when probing a run newer than the model metadata names. */
export const SINGLE_RUN_PROBE_HOURS = 400;
/** Older runs searched backwards for the end of a series. */
export const MAX_OLDER_RUNS = 8;

/** Latest run of a model as `meta.json` names it (or as a probe corrected it). */
export interface RunInfo {
  /** Run initialisation, UTC ISO. */
  init: string | null;
  /** When the run became available, UTC ISO (null for a probed run). */
  available: string | null;
  initEpoch?: number;
  /** Exclusive end of the newest run's data (Unix seconds). */
  dataEndEpoch?: number;
  intervalSeconds?: number;
  resolutionSeconds?: number;
}

function epochToTimestamp(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? canonicalTimestamp(value * 1000) : null;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rethrowAbort(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) throw error;
}

/**
 * The Single Runs API failed as a service (REQ-633): a 5xx answer, a timeout or
 * a network error. `cause` is the {@link ApiError} of the failing request.
 */
export class SingleRunsUnavailableError extends Error {
  /** HTTP status; null for network errors and timeouts. */
  readonly status: number | null;

  constructor(cause: ApiError) {
    super(`Single Runs API unavailable: ${cause.message}`, { cause });
    this.name = "SingleRunsUnavailableError";
    this.status = cause.status;
  }
}

/** Abort first, then an outage as {@link SingleRunsUnavailableError}; anything else is a missing run. */
function rethrowAbortOrOutage(error: unknown, signal?: AbortSignal): void {
  rethrowAbort(error, signal);
  if (isServiceFailure(error)) throw new SingleRunsUnavailableError(error);
}

/** Request options of a Single Runs request: the context's signal and its outage callback. */
function singleRunOptions(context: RunSegmentContext) {
  const { signal, onOutage } = context;
  return {
    signal,
    onUnavailable: onOutage ? (error: ApiError) => onOutage(new SingleRunsUnavailableError(error)) : undefined,
  };
}

/** Run info from a `meta.json` document. */
export function runInfoFromMeta(meta: OpenMeteoMeta): RunInfo {
  const info: RunInfo = {
    init: epochToTimestamp(meta.last_run_initialisation_time),
    available: epochToTimestamp(meta.last_run_availability_time),
  };
  const initEpoch = finite(meta.last_run_initialisation_time);
  const dataEndEpoch = finite(meta.data_end_time);
  const intervalSeconds = finite(meta.update_interval_seconds);
  const resolutionSeconds = finite(meta.temporal_resolution_seconds);
  if (initEpoch !== undefined) info.initEpoch = initEpoch;
  if (dataEndEpoch !== undefined) info.dataEndEpoch = dataEndEpoch;
  if (intervalSeconds !== undefined) info.intervalSeconds = intervalSeconds;
  if (resolutionSeconds !== undefined) info.resolutionSeconds = resolutionSeconds;
  return info;
}

/**
 * Latest run per model id from its `meta.json` (catalogue `meta_path` first).
 * A failing request leaves the model without run info and is reported.
 */
export async function fetchRunInfo(
  client: OpenMeteoClient,
  modelIds: Iterable<string>,
  data: { catalogue?: ModelCatalogue | null } = {},
  options: RequestOptions & { onWarning?: (message: string) => void } = {},
): Promise<Map<string, RunInfo>> {
  const ids = [...new Set(modelIds)];
  const entries = await Promise.all(
    ids.map(async (modelId): Promise<[string, RunInfo]> => {
      let meta: OpenMeteoMeta = {};
      try {
        meta = await client.fetchModelMeta(modelId, {
          signal: options.signal,
          metaPath: findCatalogueModel(modelId, data.catalogue)?.meta_path ?? null,
        });
      } catch (error) {
        rethrowAbort(error, options.signal);
        options.onWarning?.(`Failed to fetch run metadata for '${modelId}': ${(error as Error)?.message ?? error}`);
      }
      return [modelId, runInfoFromMeta(meta)];
    }),
  );
  return new Map(entries);
}

/** `YYYY-MM-DDTHH:MM` (UTC), the run label of the Single Runs API. */
export function runLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export interface RunSegmentContext {
  modelId: string;
  location: Pick<Location, "latitude" | "longitude">;
  catalogue?: ModelCatalogue | null;
  signal?: AbortSignal;
  onWarning?: (message: string) => void;
  /**
   * Called at the first sign of an outage of the Single Runs API, before any
   * queued Single Runs request starts; `downloadChain` aborts every search of
   * the download from here (REQ-633). The search itself rejects as well.
   */
  onOutage?: (error: SingleRunsUnavailableError) => void;
}

/** Valid (non-null) sample times of the first variable of a Single Runs answer, in ms. */
function validSampleTimes(raw: unknown): number[] {
  const hourly = (raw && typeof raw === "object" ? (raw as { hourly?: Record<string, unknown> }).hourly : null) ?? {};
  const times = Array.isArray(hourly.time) ? (hourly.time as unknown[]) : [];
  const key = Object.keys(hourly).find((k) => k !== "time");
  const values = key && Array.isArray(hourly[key]) ? (hourly[key] as unknown[]) : [];
  const count = Math.min(times.length, values.length);
  const result: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (values[i] !== null && values[i] !== undefined) result.push(normalizeTimestamp(String(times[i])));
  }
  return result;
}

/**
 * Newest run after the metadata run that already has data. Probes run init
 * times one update interval apart until a run is missing or lies in the
 * future. Returns [run init, exclusive end of its data] in ms, or null.
 * Throws {@link SingleRunsUnavailableError} when the API is down.
 */
export async function probeNewerRun(
  client: OpenMeteoClient,
  context: RunSegmentContext,
  info: RunInfo,
  nowMs: number,
  maxProbes = 4,
): Promise<[number, number] | null> {
  if (info.initEpoch === undefined || info.intervalSeconds === undefined || info.intervalSeconds <= 0) return null;
  const interval = Math.trunc(info.intervalSeconds) * 1000;
  let run = info.initEpoch * 1000 + interval;
  let newest: [number, number] | null = null;
  for (let probe = 0; probe < maxProbes; probe += 1) {
    if (run > nowMs) break;
    let raw: unknown;
    try {
      raw = await client.fetchSingleRun(
        {
          model: context.modelId,
          run: runLabel(run),
          latitude: context.location.latitude,
          longitude: context.location.longitude,
          forecastHours: SINGLE_RUN_PROBE_HOURS,
        },
        singleRunOptions(context),
      );
    } catch (error) {
      rethrowAbortOrOutage(error, context.signal);
      break; // Not published yet (Open-Meteo answers 400).
    }
    const valid = validSampleTimes(raw);
    if (!valid.length) break;
    newest = [run, Math.max(...valid) + HOUR_MS];
    run += interval;
  }
  return newest;
}

/**
 * Run segments from the newest run in `info` backwards, and how far those
 * runs reach in ms (null when unknown). A missing older run is reported and
 * skipped; an outage of the Single Runs API throws
 * {@link SingleRunsUnavailableError} and ends the search.
 */
export async function buildRunSegments(
  client: OpenMeteoClient,
  context: RunSegmentContext,
  info: RunInfo,
  dataEndMs: number,
): Promise<[RunSegment[], number | null]> {
  if (info.initEpoch === undefined) return [[], null];
  const nativeHours = Math.max(1, Math.floor((info.resolutionSeconds || 3600) / 3600));
  // Coarser models are padded to hourly at the end: round down.
  const runLength = (runStart: number, lastSample: number): number => {
    const hours = Math.floor((lastSample - runStart) / HOUR_MS);
    return hours - (hours % nativeHours);
  };

  const newestInit = info.initEpoch * 1000;
  const newest: RunSegment = {
    run_init_time: canonicalTimestamp(newestInit),
    valid_from: null,
    valid_until: null,
    run_length_hours: null,
  };
  if (info.dataEndEpoch === undefined) return [[newest], null];
  const newestEnd = info.dataEndEpoch * 1000;
  newest.run_length_hours = runLength(newestInit, newestEnd - HOUR_MS);
  if (dataEndMs <= newestEnd) return [[newest], newestEnd];
  newest.valid_until = canonicalTimestamp(newestEnd);
  const segments: RunSegment[] = [newest];
  let coveredEnd = newestEnd;
  const interval = Math.trunc(info.intervalSeconds || 21600) * 1000;
  // An older run never reaches further than a newer run of the longest run
  // length, so the search stops at the first such run.
  const longestRun = findCatalogueModel(context.modelId, context.catalogue)?.max_forecast_hours ?? null;

  for (let k = 1; k <= MAX_OLDER_RUNS; k += 1) {
    const run = newestInit - k * interval;
    const hours = Math.floor((dataEndMs - run) / HOUR_MS) + 1;
    let raw: unknown;
    try {
      raw = await client.fetchSingleRun(
        {
          model: context.modelId,
          run: runLabel(run),
          latitude: context.location.latitude,
          longitude: context.location.longitude,
          forecastHours: hours,
        },
        singleRunOptions(context),
      );
    } catch (error) {
      rethrowAbortOrOutage(error, context.signal);
      context.onWarning?.(
        `Failed to fetch run ${runLabel(run)} of '${context.modelId}': ${(error as Error)?.message ?? error}`,
      );
      continue;
    }
    const valid = validSampleTimes(raw);
    if (!valid.length) continue;
    const lastSample = Math.max(...valid);
    const runEnd = lastSample + HOUR_MS;
    if (runEnd <= coveredEnd) continue;
    const segmentEnd = Math.min(runEnd, dataEndMs);
    segments.push({
      run_init_time: canonicalTimestamp(run),
      valid_from: canonicalTimestamp(coveredEnd),
      valid_until: segmentEnd >= dataEndMs ? null : canonicalTimestamp(segmentEnd),
      run_length_hours: runLength(run, lastSample),
    });
    coveredEnd = segmentEnd;
    if (coveredEnd >= dataEndMs) break;
    if (longestRun && runLength(run, lastSample) >= longestRun) break;
  }
  return [segments, coveredEnd];
}

/**
 * Split a model series ending at `dataEndMs` into the runs it comes from,
 * newest first. Open-Meteo overwrites only the hours a new run computes, so
 * when the newest run is shorter, later hours come from earlier runs; each
 * hour belongs to the most recent run covering it. Returns [] without run
 * metadata.
 *
 * `meta.json` can lag behind the served data. Only when the runs it names
 * cannot explain where the data ends are newer runs probed; a newer run
 * found replaces the metadata run in `info` (`available` becomes null) once
 * its segments are complete.
 *
 * Rejects with {@link SingleRunsUnavailableError} when the Single Runs API is
 * down (5xx, timeout, network error); `info` then stays unchanged (REQ-633).
 */
export async function resolveRunSegments(
  client: OpenMeteoClient,
  context: RunSegmentContext,
  info: RunInfo,
  dataEndMs: number,
  nowMs: number,
): Promise<RunSegment[]> {
  const [segments, coveredEnd] = await buildRunSegments(client, context, info, dataEndMs);
  if (coveredEnd === null || coveredEnd >= dataEndMs) return segments;
  const newer = await probeNewerRun(client, context, info, nowMs);
  if (newer === null) return segments;
  const [runInit, runEnd] = newer;
  const probed: RunInfo = {
    ...info,
    init: canonicalTimestamp(runInit),
    available: null, // Unknown for a run the metadata does not list.
    initEpoch: Math.floor(runInit / 1000),
    dataEndEpoch: Math.floor(runEnd / 1000),
  };
  const [probedSegments] = await buildRunSegments(client, context, probed, dataEndMs);
  Object.assign(info, probed);
  return probedSegments;
}

/** Newest run of the ensemble behind the model's precipitation probability, or null. */
export async function fetchEnsembleInfo(
  client: OpenMeteoClient,
  modelId: string,
  data: { catalogue?: ModelCatalogue | null } = {},
  options: RequestOptions & { onWarning?: (message: string) => void } = {},
): Promise<EnsembleRunInfo | null> {
  const path = ensembleMetaPath(modelId, findCatalogueModel(modelId, data.catalogue)?.ensemble_meta_path ?? null);
  if (path === null) return null;
  let meta: OpenMeteoMeta;
  try {
    meta = await client.fetchMeta(path, { signal: options.signal });
  } catch (error) {
    rethrowAbort(error, options.signal);
    options.onWarning?.(`Failed to fetch ensemble metadata for '${modelId}': ${(error as Error)?.message ?? error}`);
    return null;
  }
  if (!meta || !Object.keys(meta).length) return null;
  const interval = finite(meta.update_interval_seconds);
  return {
    model_id: path,
    run_init_time: epochToTimestamp(meta.last_run_initialisation_time),
    run_availability_time: epochToTimestamp(meta.last_run_availability_time),
    data_end_time: epochToTimestamp(meta.data_end_time),
    update_interval_hours: interval === undefined ? null : interval / 3600,
  };
}
