// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Forecast of the selected place (REQ-436): loads the model chain with `@graupel/download` whenever the place or the
 * chain selection changes, aborts the previous request and keeps the last result while the next one loads. The page's
 * client keeps the Open-Meteo answers of the place in memory, so a moved boundary rebuilds the chain at once (REQ-497).
 *
 * REQ-504: a place is loaded once. The "now" of its requests is the moment the place (or a reload) started and stays so
 * for every chain of that place, so the requests of the models do not change when the hour turns; the answers stay
 * in memory until the next place or a reload. While a boundary is dragged, `setPreview` hands the provisional chain
 * over: the forecast is rebuilt from memory at every hour step and shown as `ready`, the previous result standing
 * until the new one is there.
 *
 * REQ-637, REQ-638: `reload` loads the place's forecast completely anew from Open-Meteo, for the refresh button of the
 * desktop and the pull to refresh of the phone: past the cache of whole results, the answers in memory and the
 * browser's HTTP cache (the page has no service worker). Place, chain and day selection stay; `refreshing` tells while
 * that load runs.
 */
import {
  createClient,
  createMemoryCache,
  downloadChain,
  type ChainModelInput,
  type DownloadChainRequest,
  type FetchLike,
  type ForecastResult,
  type OpenMeteoClient,
  type WeatherModel,
} from "@graupel/download";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadModelData } from "../services/modelData.ts";
import { createResponseMemory, type ResponseMemoryOptions } from "../services/responseMemory.ts";
import { useChainSelection } from "./chain.ts";
import { useLocation } from "./location.tsx";
import { placeKey } from "./place.ts";

export type ForecastStatus = "idle" | "loading" | "ready" | "error";

export interface ForecastState {
  /** `idle`: nothing to load (manual mode without models); `loading` keeps the previous `result`. */
  status: ForecastStatus;
  /** The latest result; while loading the previous place's, after an error none. */
  result?: ForecastResult;
  /** Why the last load failed (status `error`). */
  error?: unknown;
  /**
   * Loads the forecast of the current place completely anew (REQ-637, REQ-638): with a new "now", past every cache
   * (results, answers in memory, the browser's HTTP cache). Place, chain and day selection stay.
   */
  reload: () => void;
  /** Whether the load that `reload` started still runs (REQ-637); `status` is `loading` meanwhile. */
  refreshing?: boolean;
  /**
   * Whether another place's forecast loads while `result` is still the previous place's (REQ-751): on a phone and a
   * tablet the place field says so instead of a message over the meteogram. Not at the first load, which has no result.
   */
  placeChanging?: boolean;
  /**
   * Provisional chain while a boundary is dragged (REQ-504), `null` when the drag ends. The forecast follows it from
   * the answers in memory; hour steps that come faster than a rebuild are merged into the latest one.
   */
  setPreview: (preview: ChainPreview | null) => void;
  /** Whether the forecast shows (or is rebuilding) a provisional chain. */
  previewing?: boolean;
  /** Whether that provisional chain comes from a moved boundary of the cloud chain (REQ-523). */
  previewingCloud?: boolean;
  /**
   * When the forecast of `result` was fetched (epoch ms): the "now" its place or reload pinned (REQ-504), the same for
   * every chain rebuilt from that fetch. The archive of the installed app keeps one entry per fetch by it (REQ-684);
   * an archived fetch shown instead of the current one carries its own time.
   */
  fetchedAt?: number;
  /** Whether `result` is an archived fetch of the installed app instead of the current forecast (REQ-684). */
  archived?: boolean;
}

/** A provisional chain (REQ-504): weather and cloud chain as `useChainSelection()` has them, with moved boundaries. */
export interface ChainPreview {
  models: readonly WeatherModel[];
  cloudModels: readonly WeatherModel[];
  /** The chain whose boundary is dragged; the meteogram shows the cloud-chain boundaries only then (REQ-523). */
  moving?: "main" | "cloud";
}

/** Loads a forecast; the request carries the abort signal. */
export type ForecastLoader = (request: DownloadChainRequest) => Promise<ForecastResult>;

export interface ForecastLoaderOptions extends Pick<ResponseMemoryOptions, "ttlMs" | "maxEntries"> {
  /** Most whole results kept for the current place (default 64); the oldest goes first. */
  maxResults?: number;
  /** Own client (tests); then nothing is kept besides the client's own cache. */
  client?: OpenMeteoClient;
  /** Network access of the default client (default the global `fetch`). */
  fetch?: FetchLike;
}

/**
 * Loader on `downloadChain` with the documents of `@graupel/model-data`. The default client keeps whole results in its
 * memory cache and, below it, every Open-Meteo answer by URL (`createResponseMemory`, REQ-497): moving a boundary
 * changes the result's key but not the requests, so the chain is rebuilt from memory. Both hold one place only
 * (REQ-504): a request for another point, and `refresh`, forget them. While a `refresh` load runs, its requests also
 * pass the browser's HTTP cache (`cache: "reload"`, REQ-637): the run metadata (`meta.json`) comes with
 * `Last-Modified`, which a browser may otherwise answer from its cache for a while.
 */
export function createForecastLoader(options: ForecastLoaderOptions = {}): ForecastLoader {
  if (options.client) {
    const { client } = options;
    return async (request) => downloadChain(client, request, await loadModelData());
  }
  const { fetch: network = (input, init) => fetch(input, init), ttlMs, maxEntries, maxResults = 64 } = options;
  // Refresh loads running; while there is one, every request goes past the HTTP cache (REQ-637).
  let refreshing = 0;
  const bypass: FetchLike = (input, init) => network(input, refreshing > 0 ? { ...init, cache: "reload" } : init);
  const memory = createResponseMemory({ fetch: bypass, ttlMs, maxEntries });
  const results = createMemoryCache<ForecastResult>({ maxEntries: maxResults });
  const client = createClient({ fetch: memory.fetch, cache: results });
  let point: string | null = null;
  return async (request) => {
    const { latitude, longitude } = request.location;
    const next = `${latitude},${longitude}`;
    if (request.refresh || next !== point) {
      memory.clear();
      void results.clear?.();
    }
    point = next;
    if (!request.refresh) return downloadChain(client, request, await loadModelData());
    refreshing += 1;
    try {
      return await downloadChain(client, request, await loadModelData());
    } finally {
      refreshing -= 1;
    }
  };
}

let defaultLoader: ForecastLoader | null = null;
// One client for the page, so its memory (results and answers) survives remounts.
const pageLoader: ForecastLoader = (request) => (defaultLoader ??= createForecastLoader())(request);

const ForecastContext = createContext<ForecastState | null>(null);

export interface ForecastProviderProps {
  /** Loader of the forecast; default `downloadChain` with a shared client. */
  loader?: ForecastLoader;
  children?: ReactNode;
}

/** Outcome of the load with the given key. */
interface Settled {
  key: string;
  /** The point of the load (`placeKey`). */
  point: string;
  /** The reloads counted when it started (REQ-637). */
  reloads: number;
  /** The "now" of its requests (REQ-504): when the place's forecast was fetched (REQ-684). */
  now: number;
  result?: ForecastResult;
  error?: unknown;
}

/** What a load depends on; its JSON is the load's key. */
interface LoadParams {
  point: string;
  /** Manual chain (catalogue id and end of each slice); null in auto mode. */
  chain: ChainModelInput[] | null;
  /** Manual cloud chain; null in auto mode or when it is switched off. */
  cloudChain: ChainModelInput[] | null;
  reloads: number;
}

/** Catalogue id and end of the slice of each model: what `downloadChain` needs of a manual chain. */
function chainInput(models: readonly WeatherModel[]): ChainModelInput[] {
  return models.map((model) => ({
    id: model.id ?? model.name,
    max_forecast_horizon_hours: model.max_forecast_horizon_hours,
  }));
}

/** A preview with the point it was made for. */
interface PointPreview extends ChainPreview {
  point: string;
}

/** Hands previews on one at a time (REQ-504): while a preview load runs, only the latest new one waits for it. */
interface PreviewGate {
  /** The current point, for new previews. */
  setPoint: (point: string) => void;
  /** A new preview (or `null`: the drag ended, nothing waits any more). */
  offer: (preview: ChainPreview | null) => void;
  /** A preview load starts. */
  begin: () => void;
  /** It ended; a waiting preview goes on. */
  end: () => void;
}

function createPreviewGate(apply: (preview: PointPreview | null) => void): PreviewGate {
  let busy = false;
  let queued: PointPreview | null = null;
  let point = "";
  return {
    setPoint: (next) => {
      point = next;
    },
    offer: (next) => {
      if (!next) {
        queued = null;
        apply(null);
        return;
      }
      const entry: PointPreview = {
        models: next.models,
        cloudModels: next.cloudModels,
        ...(next.moving ? { moving: next.moving } : {}),
        point,
      };
      if (busy) queued = entry;
      else apply(entry);
    },
    begin: () => {
      busy = true;
    },
    end: () => {
      busy = false;
      const waiting = queued;
      queued = null;
      if (waiting) apply(waiting);
    },
  };
}

/** Loads the forecast of `useLocation()` with `useChainSelection()`; put it inside both providers. */
export function ForecastProvider({ loader = pageLoader, children }: ForecastProviderProps) {
  const { place } = useLocation();
  const { mode, models, cloudModels, cloudChain } = useChainSelection();
  const [settled, setSettled] = useState<Settled | null>(null);
  const [reloads, setReloads] = useState(0);
  const handledReloads = useRef(0);
  // REQ-504: the "now" of every request of a place, fixed when the place (or a reload) started.
  const pinned = useRef<{ point: string; reloads: number; now: number } | null>(null);
  const [preview, setPreviewState] = useState<PointPreview | null>(null);
  // While a preview load runs, a newer preview waits for it (the latest one only), so a fast drag still shows steps.
  const [gate] = useState(() => createPreviewGate(setPreviewState));

  // Name and elevation do not change the download (the elevation arrives later for some places): only the point does.
  const latestPlace = useRef(place);
  useLayoutEffect(() => {
    latestPlace.current = place;
  });
  const point = placeKey(place);
  // A preview of another place (the place changed during a drag) counts for nothing.
  const activePreview = preview?.point === point ? preview : null;
  const idle = mode === "manual" && models.length === 0 && !activePreview;
  // The preview's key equals the one `setChain` gives the same chain, so the release loads nothing again.
  const params: LoadParams = activePreview
    ? {
        point,
        chain: chainInput(activePreview.models),
        cloudChain: cloudChain !== undefined ? chainInput(activePreview.cloudModels) : null,
        reloads,
      }
    : {
        point,
        chain: mode === "manual" ? chainInput(models) : null,
        cloudChain: mode === "manual" && cloudChain !== undefined ? chainInput(cloudModels) : null,
        reloads,
      };
  const key = idle ? "" : JSON.stringify(params);
  const previewing = activePreview !== null;
  const previewingCloud = activePreview?.moving === "cloud";
  const latestPreviewing = useRef(previewing);
  useLayoutEffect(() => {
    latestPreviewing.current = previewing;
    gate.setPoint(point);
  });

  useEffect(() => {
    if (!key) return;
    const { point: loadPoint, chain: models, cloudChain: cloud, reloads: reload } = JSON.parse(key) as LoadParams;
    const controller = new AbortController();
    const { name, lat, lon, elevation } = latestPlace.current;
    const location: DownloadChainRequest["location"] = { name, latitude: lat, longitude: lon };
    if (elevation !== undefined) location.elevation = elevation;
    // REQ-504: one "now" per place and reload, so the requests stay the same when the hour turns.
    let now = pinned.current;
    if (!now || now.point !== loadPoint || now.reloads !== reload) {
      now = { point: loadPoint, reloads: reload, now: Date.now() };
      pinned.current = now;
    }
    const request: DownloadChainRequest = { location, signal: controller.signal, now: now.now };
    if (models) {
      request.chain = models;
      // A switched-off cloud chain loads no cloud profile.
      request.cloudChain = cloud;
    } else request.auto = true;
    // Only the load a reload triggers bypasses the cache.
    if (reload !== handledReloads.current) {
      handledReloads.current = reload;
      request.refresh = true;
    }
    // A preview load lets the next preview wait; when it ends, the latest waiting one goes on.
    const isPreview = latestPreviewing.current;
    let busy = isPreview;
    if (busy) gate.begin();
    const done = () => {
      if (!busy) return;
      busy = false;
      gate.end();
    };
    loader(request).then(
      (result) => {
        if (!controller.signal.aborted) setSettled({ key, point: loadPoint, reloads: reload, now: now.now, result });
        done();
      },
      (error: unknown) => {
        // Only the page's own abort is no outcome. Any other failure settles the load, also an AbortError the page did
        // not ask for (e.g. a request the browser cancelled itself): it would else stay loading for good (REQ-760).
        if (!controller.signal.aborted) setSettled({ key, point: loadPoint, reloads: reload, now: now.now, error });
        done();
      },
    );
    return () => {
      controller.abort();
      done();
    };
  }, [loader, key, gate]);

  const reload = useCallback(() => setReloads((count) => count + 1), []);
  // REQ-637: a reload runs until a load with its count has settled (a chain changed meanwhile loads with it).
  const refreshing = key !== "" && settled?.key !== key && (settled?.reloads ?? 0) !== reloads;
  // REQ-751: a load for another place while the previous place's result stands.
  const placeChanging = key !== "" && settled?.key !== key && settled?.result !== undefined && settled.point !== point;
  const value = useMemo<ForecastState>(() => {
    const base = {
      reload,
      ...(refreshing ? { refreshing } : {}),
      ...(placeChanging ? { placeChanging } : {}),
      setPreview: gate.offer,
      ...(previewing ? { previewing } : {}),
      ...(previewingCloud ? { previewingCloud } : {}),
    };
    if (!key) return { status: "idle", ...base };
    if (settled?.key === key) {
      return settled.result
        ? { status: "ready", result: settled.result, fetchedAt: settled.now, ...base }
        : { status: "error", error: settled.error, ...base };
    }
    // REQ-504: while dragging, the last result of the place stands as it is until the rebuilt one is there.
    if (previewing && settled?.result && settled.point === point) {
      return { status: "ready", result: settled.result, fetchedAt: settled.now, ...base };
    }
    // Loading: the previous result stays until the new one arrives.
    return settled?.result
      ? { status: "loading", result: settled.result, fetchedAt: settled.now, ...base }
      : { status: "loading", ...base };
  }, [key, settled, reload, refreshing, placeChanging, gate, previewing, previewingCloud, point]);
  return createElement(ForecastContext.Provider, { value }, children);
}

const FALLBACK: ForecastState = { status: "idle", reload: () => {}, setPreview: () => {} };

/**
 * Hands a changed forecast state to everything inside (REQ-684): the history of the installed app shows an archived
 * fetch in place of the current forecast this way, for the day slider, the meteogram and every other reader.
 */
export function ForecastOverride({ value, children }: { value: ForecastState; children?: ReactNode }) {
  return createElement(ForecastContext.Provider, { value }, children);
}

/** The forecast state; outside a `ForecastProvider` always `idle`. */
export function useForecast(): ForecastState {
  return useContext(ForecastContext) ?? FALLBACK;
}
