// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Forecast state (REQ-436): what `ForecastProvider` asks the loader for, aborting on a place change, manual chains,
 * the default loader with @graupel/download and the model data; the page's colour mode for the meteogram.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE } from "../src/config/index.ts";
import { usePageTheme } from "../src/state/pageTheme.ts";
import { catalogue, domains, fetchRegions, registry, resetModelData } from "../src/services/modelData.ts";
import {
  ChainProvider,
  ForecastProvider,
  LocationProvider,
  createForecastLoader,
  useChainSelection,
  useForecast,
  useLocation,
  type ForecastLoader,
  type ForecastState,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  // The place shown is remembered for the next start (REQ-599); each test starts at the configured place.
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

interface Deferred {
  resolve: (result: ForecastResult) => void;
  reject: (error: unknown) => void;
}

/** A loader whose calls stay pending until the test settles them. */
function pendingLoader() {
  const pending: Deferred[] = [];
  const loader = vi.fn<ForecastLoader>(
    () => new Promise<ForecastResult>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return { loader, pending };
}

let state: ForecastState;
let api: { location: ReturnType<typeof useLocation>; chain: ReturnType<typeof useChainSelection> };

function Probe() {
  const forecast = useForecast();
  const location = useLocation();
  const chain = useChainSelection();
  useEffect(() => {
    state = forecast;
    api = { location, chain };
  });
  return <p data-testid="status">{forecast.status}</p>;
}

function renderForecast(loader: ForecastLoader, children: ReactNode = <Probe />) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <LocationProvider>
        <ChainProvider>
          <ForecastProvider loader={loader}>{children}</ForecastProvider>
        </ChainProvider>
      </LocationProvider>
    </ConfigProvider>,
  );
}

const status = () => screen.getByTestId("status").textContent;

describe("ForecastProvider", () => {
  it("loads the auto chain at the start place and reports the result", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    expect(status()).toBe("loading");
    expect(loader).toHaveBeenCalledOnce();
    const request = loader.mock.calls[0]![0];
    expect(request).toMatchObject({
      auto: true,
      location: {
        name: DEFAULT_PLACE.name,
        latitude: DEFAULT_PLACE.lat,
        longitude: DEFAULT_PLACE.lon,
        elevation: DEFAULT_PLACE.elevation,
      },
    });
    expect(request.chain).toBeUndefined();
    expect(request.refresh).toBeUndefined();
    expect(request.signal).toBeInstanceOf(AbortSignal);
    const result = forecastFixture();
    await act(async () => pending[0]!.resolve(result));
    expect(status()).toBe("ready");
    expect(state.result).toBe(result);
  });

  it("aborts the running load when the place changes and keeps the last result meanwhile", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    const first = forecastFixture();
    await act(async () => pending[0]!.resolve(first));
    act(() => api.location.setLocation({ name: "Innsbruck", lat: 47.2627, lon: 11.3945 }));
    expect(status()).toBe("loading");
    expect(state.result).toBe(first);
    const second = loader.mock.calls[1]![0];
    expect(second.location).toMatchObject({ name: "Innsbruck", latitude: 47.2627, longitude: 11.3945 });
    act(() => api.location.setLocation({ name: "Bozen", lat: 46.4983, lon: 11.3548 }));
    expect(second.signal!.aborted).toBe(true);
    expect(loader).toHaveBeenCalledTimes(3);
    // A late answer of the aborted load is ignored.
    await act(async () => pending[1]!.resolve(forecastFixture({ name: "Innsbruck" })));
    expect(status()).toBe("loading");
    const third = forecastFixture({ name: "Bozen" });
    await act(async () => pending[2]!.resolve(third));
    expect(state.result).toBe(third);
  });

  it("does not load again when only the name or the elevation of the place changes", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    await act(async () => pending[0]!.resolve(forecastFixture()));
    act(() => api.location.setLocation({ ...DEFAULT_PLACE, elevation: 4800 }));
    expect(loader).toHaveBeenCalledOnce();
    expect(status()).toBe("ready");
  });

  it("loads a manual chain and is idle without models", async () => {
    const { loader } = pendingLoader();
    renderForecast(loader);
    act(() => api.chain.setChain(["icon_d2", "ecmwf_ifs025"], ["icon_d2"]));
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[0]![0].signal!.aborted).toBe(true);
    // Each model with the end of its slice (catalogue horizons here; dragged boundaries in the model chain block).
    expect(loader.mock.calls[1]![0]).toMatchObject({
      chain: [
        { id: "icon_d2", max_forecast_horizon_hours: 48 },
        { id: "ecmwf_ifs025", max_forecast_horizon_hours: 360 },
      ],
      cloudChain: [{ id: "icon_d2", max_forecast_horizon_hours: 48 }],
    });
    expect(loader.mock.calls[1]![0].auto).toBeUndefined();
    act(() => api.chain.setChain([]));
    expect(status()).toBe("idle");
    expect(loader).toHaveBeenCalledTimes(2);
    act(() => api.chain.setAuto());
    expect(loader.mock.calls[2]![0].auto).toBe(true);
  });

  it("reports an error and loads again, bypassing the cache, on reload", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    const error = new Error("offline");
    await act(async () => pending[0]!.reject(error));
    expect(status()).toBe("error");
    expect(state.error).toBe(error);
    expect(state.result).toBeUndefined();
    act(() => state.reload());
    expect(status()).toBe("loading");
    expect(loader.mock.calls[1]![0].refresh).toBe(true);
    await act(async () => pending[1]!.resolve(forecastFixture()));
    expect(status()).toBe("ready");
    // The next place loads from the cache again.
    act(() => api.location.setLocation({ name: "Innsbruck", lat: 47.2627, lon: 11.3945 }));
    expect(loader.mock.calls[2]![0].refresh).toBeUndefined();
  });

  it("tells while a reload runs, keeps the result meanwhile and not for other loads (REQ-637)", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    expect(state.refreshing).toBeUndefined();
    const first = forecastFixture();
    await act(async () => pending[0]!.resolve(first));
    // Another chain loads without a refresh.
    act(() => api.chain.setChain(["icon_d2", "ecmwf_ifs025"]));
    expect(status()).toBe("loading");
    expect(state.refreshing).toBeUndefined();
    await act(async () => pending[1]!.resolve(first));
    // The reload: the same place and chain, past the cache, the last result standing until the new one is there.
    act(() => state.reload());
    expect(status()).toBe("loading");
    expect(state.refreshing).toBe(true);
    expect(state.result).toBe(first);
    expect(loader.mock.calls[2]![0].refresh).toBe(true);
    expect(loader.mock.calls[2]![0].chain).toEqual(loader.mock.calls[1]![0].chain);
    expect(loader.mock.calls[2]![0].location).toEqual(loader.mock.calls[1]![0].location);
    const fresh = forecastFixture();
    await act(async () => pending[2]!.resolve(fresh));
    expect(status()).toBe("ready");
    expect(state.refreshing).toBeUndefined();
    expect(state.result).toBe(fresh);
    // A failed reload ends it too.
    act(() => state.reload());
    expect(state.refreshing).toBe(true);
    await act(async () => pending[3]!.reject(new Error("offline")));
    expect(status()).toBe("error");
    expect(state.refreshing).toBeUndefined();
  });

  it("tells while another place loads with the previous place's result, not at the first load or a reload (REQ-751)", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    // The first load has no previous result.
    expect(status()).toBe("loading");
    expect(state.placeChanging).toBeUndefined();
    const first = forecastFixture();
    await act(async () => pending[0]!.resolve(first));
    expect(state.placeChanging).toBeUndefined();
    // Another chain of the same place is no change of place.
    act(() => api.chain.setChain(["icon_d2", "ecmwf_ifs025"]));
    expect(state.placeChanging).toBeUndefined();
    await act(async () => pending[1]!.resolve(first));
    // Nor is a reload.
    act(() => state.reload());
    expect(state.refreshing).toBe(true);
    expect(state.placeChanging).toBeUndefined();
    await act(async () => pending[2]!.resolve(first));
    // Another place: loading, the previous place's result standing.
    act(() => api.location.setLocation({ name: "Innsbruck", lat: 47.2627, lon: 11.3945 }));
    expect(status()).toBe("loading");
    expect(state.placeChanging).toBe(true);
    expect(state.result).toBe(first);
    const innsbruck = forecastFixture({ name: "Innsbruck" });
    await act(async () => pending[3]!.resolve(innsbruck));
    expect(status()).toBe("ready");
    expect(state.placeChanging).toBeUndefined();
    // A failed load of another place ends it too; after it the next place loads without a previous result.
    act(() => api.location.setLocation({ name: "Bozen", lat: 46.4983, lon: 11.3548 }));
    expect(state.placeChanging).toBe(true);
    await act(async () => pending[4]!.reject(new Error("offline")));
    expect(status()).toBe("error");
    expect(state.placeChanging).toBeUndefined();
    act(() => api.location.setLocation({ name: "Innsbruck", lat: 47.2627, lon: 11.3945 }));
    expect(status()).toBe("loading");
    expect(state.placeChanging).toBeUndefined();
  });

  it("keeps the 'now' of a place for every chain of it and takes a new one for a new place or a reload (REQ-504)", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 29, 9, 40));
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    const loadedAt = Date.UTC(2026, 9, 29, 9, 40);
    expect(loader.mock.calls[0]![0].now).toBe(loadedAt);
    await act(async () => pending[0]!.resolve(forecastFixture()));
    // The hour turns; a moved boundary still asks with the time the place was loaded.
    clock.mockReturnValue(Date.UTC(2026, 9, 29, 11, 5));
    act(() => api.chain.setChain(["icon_d2", "ecmwf_ifs025"]));
    expect(loader.mock.calls[1]![0].now).toBe(loadedAt);
    act(() => state.reload());
    expect(loader.mock.calls[2]![0].now).toBe(Date.UTC(2026, 9, 29, 11, 5));
    clock.mockReturnValue(Date.UTC(2026, 9, 29, 12, 0));
    act(() => api.chain.setAuto());
    expect(loader.mock.calls[3]![0].now).toBe(Date.UTC(2026, 9, 29, 11, 5));
    act(() => api.location.setLocation({ name: "Innsbruck", lat: 47.2627, lon: 11.3945 }));
    expect(loader.mock.calls[4]![0].now).toBe(Date.UTC(2026, 9, 29, 12, 0));
  });

  it("follows a dragged chain as ready, keeps the last result meanwhile and loads nothing again on release (REQ-504)", async () => {
    const { loader, pending } = pendingLoader();
    renderForecast(loader);
    act(() => api.chain.setChain(["icon_d2", "ecmwf_ifs025"], ["icon_d2"]));
    const first = forecastFixture();
    await act(async () => pending[1]!.resolve(first));
    loader.mockClear();
    pending.length = 0;
    const { models, cloudModels } = api.chain;
    const moved = (hours: number) => [{ ...models[0]!, max_forecast_horizon_hours: hours }, ...models.slice(1)];

    act(() => state.setPreview({ models: moved(20), cloudModels }));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0]![0].chain![0]).toMatchObject({ id: "icon_d2", max_forecast_horizon_hours: 20 });
    // The previous result stands as ready (no "updating" message) until the rebuilt one is there.
    expect(status()).toBe("ready");
    expect(state.result).toBe(first);
    expect(state.previewing).toBe(true);

    // Hour steps during a running rebuild wait; only the latest goes on afterwards.
    act(() => state.setPreview({ models: moved(19), cloudModels }));
    act(() => state.setPreview({ models: moved(18), cloudModels }));
    expect(loader).toHaveBeenCalledTimes(1);
    const second = forecastFixture({ name: "20 h" });
    await act(async () => pending[0]!.resolve(second));
    expect(state.result).toBe(second);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].chain![0]).toMatchObject({ max_forecast_horizon_hours: 18 });

    // The release hands the same chain to the selection: the running rebuild goes on, nothing is loaded again.
    act(() => {
      api.chain.setChain(moved(18), cloudModels);
      state.setPreview(null);
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].signal!.aborted).toBe(false);
    const third = forecastFixture({ name: "18 h" });
    await act(async () => pending[1]!.resolve(third));
    expect(status()).toBe("ready");
    expect(state.result).toBe(third);
    expect(state.previewing).toBeUndefined();
  });

  it("tells whether the dragged boundary belongs to the cloud chain (REQ-523)", async () => {
    // Each load answers at once, so no preview waits for a running one.
    renderForecast(vi.fn<ForecastLoader>(async () => forecastFixture()));
    await act(async () => api.chain.setChain(["icon_d2", "ecmwf_ifs025"], ["icon_d2", "ecmwf_ifs025"]));
    const { models, cloudModels } = api.chain;
    const moved = [{ ...cloudModels[0]!, max_forecast_horizon_hours: 20 }, ...cloudModels.slice(1)];

    await act(async () => state.setPreview({ models, cloudModels: moved, moving: "cloud" }));
    expect(state.previewing).toBe(true);
    expect(state.previewingCloud).toBe(true);
    await act(async () => state.setPreview({ models, cloudModels, moving: "main" }));
    expect(state.previewing).toBe(true);
    expect(state.previewingCloud).toBeUndefined();
    await act(async () => state.setPreview({ models, cloudModels: moved, moving: "cloud" }));
    await act(async () => state.setPreview(null));
    expect(state.previewing).toBeUndefined();
    expect(state.previewingCloud).toBeUndefined();
  });

  it("is idle outside a provider", () => {
    const { result } = renderHook(() => useForecast());
    expect(result.current.status).toBe("idle");
  });
});

describe("default loader", () => {
  it("fetches regions.geojson and parses it as JSON", async () => {
    const fetchMock = vi.fn(async () => new Response('{"type":"FeatureCollection","features":[]}'));
    await expect(fetchRegions(fetchMock as unknown as typeof fetch, "/regions.geojson")).resolves.toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(fetchMock).toHaveBeenCalledWith("/regions.geojson");
    await expect(
      fetchRegions((async () => new Response("", { status: 404 })) as unknown as typeof fetch, "/x"),
    ).rejects.toThrow("404");
  });

  it("bundles catalogue, registry and domains of @graupel/model-data", () => {
    const models = Array.isArray(catalogue) ? catalogue : (catalogue as { models: unknown[] }).models;
    expect(models.length).toBeGreaterThan(10);
    expect(registry).toHaveProperty("quantities");
    expect(domains).toBeTruthy();
  });

  it("passes the request to downloadChain with the client and auto data", async () => {
    // Regions from the test's fetch; the client's own fetch answers every Open-Meteo request with an error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"type":"FeatureCollection","features":[]}')),
    );
    // Pages rendered before started a regions request that the test fetch never answers.
    resetModelData();
    const requests: string[] = [];
    const { createClient } = await import("@graupel/download");
    const client = createClient({
      maxRetries: 0,
      cache: null,
      fetch: async (url) => {
        requests.push(url);
        return new Response(JSON.stringify({ error: true, reason: "test" }), { status: 400 });
      },
    });
    const load = createForecastLoader({ client });
    await expect(
      load({ location: { name: "Mont Blanc", latitude: 45.8326, longitude: 6.8652 }, auto: true, runSegments: false }),
    ).rejects.toThrow();
    expect(requests.some((url) => url.startsWith("https://api.open-meteo.com/v1/forecast"))).toBe(true);
  });
});

describe("usePageTheme", () => {
  it("follows data-theme on <html>", async () => {
    const { result } = renderHook(() => usePageTheme());
    expect(result.current).toBe("light");
    await act(async () => {
      document.documentElement.dataset.theme = "dark";
    });
    expect(result.current).toBe("dark");
    await act(async () => {
      document.documentElement.dataset.theme = "light";
    });
    expect(result.current).toBe("light");
  });

  it("follows the system preference without data-theme", () => {
    const listeners: (() => void)[] = [];
    let dark = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return dark;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        removeEventListener: () => {},
      })),
    );
    const { result } = renderHook(() => usePageTheme());
    expect(result.current).toBe("dark");
    dark = false;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe("light");
  });
});
