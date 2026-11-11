// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Model chain selection, shared by the whole page (REQ-435). `auto` follows the auto chain of the selected place
 * (`createResolver` of `@graupel/download` over `@graupel/model-data`); `manual` keeps a chain set with `setChain`,
 * on the website the auto chain with the boundaries the user moved in the chain cards (REQ-481). A newly loaded place
 * starts again from its auto chain. The meteogram downloads what `models` and `cloudModels` say. The interface is
 * documented in `apps/web/README.md`; keep it stable.
 */
import {
  MIN_CLOUD_PRESSURE_LEVELS,
  catalogueModels,
  catalogueWeatherModel,
  createResolver,
  hasCloudValues,
  normalizeTimestamp,
  type AutoChainResolution,
  type AutoChainResolver,
  type ForecastResult,
  type ModelCatalogue,
  type WeatherModel,
} from "@graupel/download";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { catalogue as bundledCatalogue, loadModelData, type ModelData } from "../services/modelData.ts";
import type { Place } from "../config/index.ts";
import { useLocation } from "./location.tsx";
import { samePlace } from "./place.ts";

export type ChainMode = "auto" | "manual";

/**
 * Chain entry for `setChain`: a catalogue id (catalogue horizon) or a model with its own horizon
 * (`max_forecast_horizon_hours`), found by `id`, else by `name`.
 */
export type ChainEntry = string | WeatherModel | (Partial<WeatherModel> & { id: string });

export interface ChainSelection {
  /** `auto`: the auto chain of the selected place; `manual`: the chain set with `setChain`. */
  mode: ChainMode;
  /** Catalogue ids of the main chain in hand-over order (in auto mode empty while the regions load). */
  chain: string[];
  /** Catalogue ids of the cloud chain; `undefined` when the cloud chain is switched off. */
  cloudChain?: string[];
  /** Main chain with each model's end in hours after now (`max_forecast_horizon_hours`), ready for `downloadChain`. */
  models: WeatherModel[];
  /** Cloud chain like `models`; empty when switched off. */
  cloudModels: WeatherModel[];
  /** Auto chain of the selected place (region and reason), also in manual mode; null until the data is loaded. */
  resolved: AutoChainResolution | null;
  /** Loading state of the model data. */
  status: "loading" | "ready" | "error";
  /** Catalogue models by id (catalogue horizons) with their links, for pickers, labels and the info popover. */
  available: Readonly<Record<string, ModelMeta>>;
  /** The loaded model data (catalogue, registry, domains, regions), null until the regions are loaded. */
  data: ModelData | null;
  /**
   * Switches to manual mode with this main chain. `cloudChain`: `undefined` keeps the current cloud chain (from
   * auto mode the auto cloud chain, which then still follows the place), `null` switches it off. Entries that
   * are not in the catalogue are dropped.
   */
  setChain: (chain: readonly ChainEntry[], cloudChain?: readonly ChainEntry[] | null) => void;
  /** Back to the auto chain of the place. */
  setAuto: () => void;
}

/**
 * A weather model with the links of its catalogue entry (REQ-687): the model's documentation (`documentation_url`)
 * and the publisher's homepage (`provider_url`). Missing in older catalogues, for an entry without a valid https link
 * and for models the catalogue does not know.
 */
export interface ModelMeta extends WeatherModel {
  documentation_url?: string;
  provider_url?: string;
}

/** The URL when it is an absolute https link, else undefined: only such links are shown (REQ-687). */
export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Active catalogue models by id, horizon = catalogue horizon, with the catalogue's links (REQ-687). */
export function availableModels(catalogue: ModelCatalogue | null | undefined): Record<string, ModelMeta> {
  const result: Record<string, ModelMeta> = {};
  for (const model of catalogueModels(catalogue)) {
    if (!model.id || model.active === false) continue;
    const meta: ModelMeta = catalogueWeatherModel(model);
    const documentation = httpsUrl(model.documentation_url);
    const provider = httpsUrl(model.provider_url);
    if (documentation) meta.documentation_url = documentation;
    if (provider) meta.provider_url = provider;
    result[model.id] = meta;
  }
  return result;
}

/** Whether a model has enough pressure levels for the cloud profile (as the resolver requires). */
export function isCloudCapable(model: WeatherModel | undefined): boolean {
  return (model?.pressure_levels_hpa?.length ?? 0) >= MIN_CLOUD_PRESSURE_LEVELS;
}

/** Chain entries as weather models with catalogue metadata; unknown ids are dropped. */
export function toChainModels(
  entries: readonly ChainEntry[],
  available: Readonly<Record<string, WeatherModel>>,
): WeatherModel[] {
  const models: WeatherModel[] = [];
  const byName = (name: string | undefined) => Object.values(available).find((model) => model.name === name);
  for (const entry of entries) {
    const base = typeof entry === "string" ? available[entry] : (entry.id ? available[entry.id] : byName(entry.name));
    if (!base?.id) continue;
    const id = base.id;
    if (typeof entry === "string") {
      models.push({ ...base });
      continue;
    }
    const hours = entry.max_forecast_horizon_hours;
    models.push({
      ...base,
      ...entry,
      id,
      name: base.name,
      max_forecast_horizon_hours:
        typeof hours === "number" && Number.isFinite(hours) ? hours : base.max_forecast_horizon_hours,
    });
  }
  return models;
}

function ids(models: readonly WeatherModel[]): string[] {
  return models.map((model) => model.id ?? model.name);
}

interface ManualChain {
  main: readonly ChainEntry[];
  /** null: no cloud chain; "auto": the cloud chain of the auto chain. */
  cloud: readonly ChainEntry[] | null | "auto";
}

const ChainContext = createContext<ChainSelection | null>(null);

export interface ChainProviderProps {
  /**
   * Loads the model data; default `loadModelData` (regions fetched once per page). Tests pass their own. Until it
   * resolves, the bundled catalogue serves manual chains.
   */
  loadData?: () => Promise<ModelData>;
  children?: ReactNode;
}

function safeResolver(data: ModelData | null): AutoChainResolver | null {
  if (!data) return null;
  try {
    return createResolver(data);
  } catch {
    return null;
  }
}

/** Hours of a slice after the forecast start (`timeline.now` of the result): `start` inclusive, `end` exclusive. */
export interface HourSpan {
  start: number;
  end: number;
}

const HOUR_MS = 3_600_000;

function time(timestamp: string): number {
  try {
    return normalizeTimestamp(timestamp);
  } catch {
    return Number.NaN;
  }
}

/** Adds the hour of `timestamp` (after `now`) to the span of `model`; past hours are left out. */
function addHour(spans: Record<string, HourSpan>, model: string, timestamp: string, now: number): void {
  const at = time(timestamp);
  if (!model || !Number.isFinite(at) || at < now) return;
  const hour = Math.floor((at - now) / HOUR_MS);
  const span = spans[model];
  if (!span) spans[model] = { start: hour, end: hour + 1 };
  else {
    span.start = Math.min(span.start, hour);
    span.end = Math.max(span.end, hour + 1);
  }
}

/**
 * Time span of the data each model actually delivered in a forecast (REQ-448), by model name: from the first to the
 * last hour after the forecast start in which the stitched result holds a value of that model (main chain: any
 * quantity of `combined`; cloud chain: a profile of `cloud` with a cloud cover). A model that delivered nothing in
 * its slice is missing. Unlike the boundaries of the chain, this follows what came back: a run that ends early, a
 * failed model, a model the auto chain dropped.
 */
export function deliveredSpans(result: ForecastResult, chain: "main" | "cloud"): Record<string, HourSpan> {
  const spans: Record<string, HourSpan> = {};
  const now = time(result.timeline.now);
  if (!Number.isFinite(now)) return spans;
  if (chain === "main") {
    for (const point of result.combined) {
      if (point.value !== null && !Number.isNaN(point.value)) addHour(spans, point.model, point.timestamp, now);
    }
    return spans;
  }
  for (const profile of result.cloud?.profiles ?? []) {
    if (hasCloudValues(profile)) addHour(spans, profile.source_model_name ?? profile.source_model_id, profile.timestamp, now);
  }
  return spans;
}

/**
 * Whether `next` is a newly loaded place rather than `previous` completed with its elevation (which arrives later for
 * places from the search).
 */
export function isNewPlace(previous: Place, next: Place): boolean {
  if (previous === next) return false;
  const elevationAdded = previous.elevation === undefined && next.elevation !== undefined;
  return !(elevationAdded && previous.name === next.name && samePlace(previous, next));
}

/** Holds the chain selection; put it inside the `LocationProvider`. */
export function ChainProvider({ loadData = loadModelData, children }: ChainProviderProps) {
  const { place } = useLocation();
  const [data, setData] = useState<ModelData | null>(null);
  const [failed, setFailed] = useState(false);
  const [manual, setManual] = useState<ManualChain | null>(null);
  // REQ-481: loading a place (also the same one again) drops the moved boundaries; it starts from its auto chain.
  const [shownPlace, setShownPlace] = useState(place);
  if (shownPlace !== place) {
    setShownPlace(place);
    if (manual && isNewPlace(shownPlace, place)) setManual(null);
  }

  useEffect(() => {
    let alive = true;
    loadData().then(
      (loaded) => {
        if (!alive) return;
        setData(loaded);
        setFailed(false);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [loadData]);

  const resolver = useMemo(() => safeResolver(data), [data]);
  const available = useMemo(() => availableModels(data ? data.catalogue : bundledCatalogue), [data]);
  const resolved = useMemo(() => {
    if (!resolver) return null;
    try {
      return resolver.resolve(place.lat, place.lon);
    } catch {
      return null;
    }
  }, [resolver, place.lat, place.lon]);

  const models = useMemo(
    () => (manual ? toChainModels(manual.main, available) : (resolved?.main_model_chain ?? [])),
    [manual, available, resolved],
  );
  const cloudModels = useMemo(() => {
    if (!manual || manual.cloud === "auto") return resolved?.cloud_model_chain ?? [];
    return manual.cloud ? toChainModels(manual.cloud, available) : [];
  }, [manual, available, resolved]);
  const cloudOff = manual !== null && manual.cloud === null;

  // Without a cloud chain `setChain` keeps the current one; coming from auto it stays the auto cloud chain.
  const setChain = useCallback<ChainSelection["setChain"]>((chain, cloudChain) => {
    setManual((previous) => ({
      main: [...chain],
      cloud: cloudChain === undefined ? (previous ? previous.cloud : "auto") : cloudChain && [...cloudChain],
    }));
  }, []);
  const setAuto = useCallback(() => setManual(null), []);

  const status: ChainSelection["status"] = data && resolver ? "ready" : failed || data ? "error" : "loading";
  const value = useMemo<ChainSelection>(
    () => ({
      mode: manual ? "manual" : "auto",
      chain: ids(models),
      ...(cloudOff ? {} : { cloudChain: ids(cloudModels) }),
      models,
      cloudModels,
      resolved,
      status,
      available,
      data,
      setChain,
      setAuto,
    }),
    [manual, models, cloudModels, cloudOff, resolved, status, available, data, setChain, setAuto],
  );
  return createElement(ChainContext.Provider, { value }, children);
}

/** The chain selection, or null outside a `ChainProvider` (e.g. model chain block switched off in a test). */
export function useOptionalChainSelection(): ChainSelection | null {
  return useContext(ChainContext);
}

const FALLBACK: ChainSelection = {
  mode: "auto",
  chain: [],
  cloudChain: [],
  models: [],
  cloudModels: [],
  resolved: null,
  status: "loading",
  available: {},
  data: null,
  setChain: () => {},
  setAuto: () => {},
};

/** The chain selection; outside a `ChainProvider` an empty auto selection that never loads. */
export function useChainSelection(): ChainSelection {
  return useContext(ChainContext) ?? FALLBACK;
}
