// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-861: a load of the forecast always ends, at the same place, without choosing another one. Open-Meteo answers
 * 429 when it is overloaded ("Too many concurrent requests"); the error card with the reason and "Try again" come at
 * once, also when other requests of the load hang meanwhile (before: only after the client's time limit of each hung
 * request, 3 minutes and more, so that only a new place ended the loading message). A load that hangs as a whole fails
 * after `LOAD_TIMEOUT_MS`; each attempt of a request ends after `REQUEST_TIMEOUT_MS`, a hung regions request after
 * `REGIONS_TIMEOUT_MS`. "Try again" loads anew. Fixed clock (fake timers), fake `fetch`.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE } from "../src/config/index.ts";
import { I18nProvider, translate } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  REGIONS_TIMEOUT_MS,
  REGIONS_URL,
  fetchRegions,
  loadModelData,
  resetModelData,
} from "../src/services/modelData.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  ForecastTimeoutError,
  LOAD_TIMEOUT_MS,
  LocationProvider,
  OVERLOAD_GRACE_MS,
  REQUEST_TIMEOUT_MS,
  createForecastLoader,
  forecastFailure,
  useDaySlider,
  useLocation,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
const HOUR_MS = 3_600_000;
const MODEL_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../model-data");
const REGIONS = readFileSync(resolve(MODEL_DATA_DIR, "regions.geojson"), "utf8");
const CONCURRENT = "Too many concurrent requests";

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
  window.localStorage.clear();
  // The regions document of the auto chain; every other request of the page's own fetch stays unanswered.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === REGIONS_URL ? new Response(REGIONS) : new Response("", { status: 404 }))),
  );
  resetModelData();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetModelData();
});

/** How the fake Open-Meteo answers a request. */
type Reply = "answer" | "429" | "hang";

/** `YYYY-MM-DDTHH:MM` like Open-Meteo with `timezone=GMT`. */
const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** An hourly answer for every requested variable (as e2e/openMeteo.ts), an empty `meta.json`, no sun times. */
function answer(url: string): Response {
  if (!url.includes("/v1/forecast")) return Response.json({});
  const params = new URL(url).searchParams;
  if (params.has("daily")) return Response.json({ timezone: "GMT", daily: { time: [], sunrise: [], sunset: [] } });
  const variables = (params.get("hourly") ?? "").split(",").filter(Boolean);
  const past = Number(params.get("past_hours") ?? 0);
  const ahead = Number(params.get("forecast_hours") ?? 24);
  const times = Array.from({ length: past + ahead }, (_, i) => FIXED_NOW + (i - past) * HOUR_MS);
  const hourly: Record<string, unknown> = { time: times.map(gmt) };
  for (const variable of variables) hourly[variable] = times.map((_, i) => (variable.includes("temp") ? 5 : i % 50));
  return Response.json({ timezone: "GMT", hourly });
}

/** A fake Open-Meteo: `reply` decides per URL; a hanging request ends only when it is aborted. */
function fakeOpenMeteo(reply: (url: string) => Reply) {
  const requests: { url: string; signal?: AbortSignal | null }[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    requests.push({ url, signal: init?.signal });
    const kind = reply(url);
    if (kind === "429") return Promise.resolve(Response.json({ error: true, reason: CONCURRENT }, { status: 429 }));
    if (kind === "answer") return Promise.resolve(answer(url));
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  return { fetch, requests };
}

const isCloud = (url: string) => url.includes("geopotential_height");
const isSun = (url: string) => url.includes("daily=");
const isForecast = (url: string) => url.includes("/v1/forecast");

// The place the page shows, copied after each render.
let place: ReturnType<typeof useLocation>["place"] | null = null;
function PlaceProbe() {
  const location = useLocation();
  useEffect(() => {
    place = location.place;
  });
  return null;
}

/** The day slider as the page has it (App.tsx): left out while switched off. */
function DaySliderCard() {
  return useDaySlider().enabled ? <DaySlider /> : null;
}

function renderPage(loader: ForecastLoader) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <NoticesProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <PlaceProbe />
                  <DaySliderCard />
                  <MeteogramPanel />
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const loading = () => screen.getByTestId("day-slider-empty").textContent === translate("en", "forecast.loading");
const busy = () => document.querySelector('[data-region="meteogram"]')?.getAttribute("aria-busy");
const detail = () => screen.queryByTestId("error-card-detail")?.textContent ?? null;
const retry = () => within(screen.getByTestId("forecast-error")).getByRole("button", { name: "Try again" });

/** The error state at the start place: card with `reason`, "No forecast available.", "Try again", no loading. */
function expectError(reason: string) {
  expect(screen.getByTestId("error-card").querySelector(".error-card__text")?.textContent).toBe(
    "The forecast could not be loaded.",
  );
  expect(detail()).toBe(reason);
  expect(retry()).toBeTruthy();
  expect(screen.getByTestId("day-slider-empty").textContent).toBe("No forecast available.");
  expect(busy()).toBe("false");
  expect(place).toMatchObject({ name: DEFAULT_PLACE.name, lat: DEFAULT_PLACE.lat, lon: DEFAULT_PLACE.lon });
}

const CONCURRENT_TEXT = "Open-Meteo is receiving too many concurrent requests. Please try again in a moment.";
const TIMEOUT_TEXT = "Open-Meteo did not answer in time. Please try again in a moment.";

describe("REQ-861: Open-Meteo overloaded (429)", () => {
  it("names too many concurrent requests at once when every forecast request gets 429, at the same place", async () => {
    const api = fakeOpenMeteo((url) => (isForecast(url) ? "429" : "answer"));
    renderPage(createForecastLoader({ fetch: api.fetch }));
    expect(loading()).toBe(true);
    await advance(0);
    expectError(CONCURRENT_TEXT);
    // Every request was for the start place: no other place was loaded.
    const points = new Set(api.requests.filter((r) => isForecast(r.url)).map((r) => new URL(r.url).searchParams.get("latitude")));
    expect([...points]).toEqual([String(DEFAULT_PLACE.lat)]);
  });

  it.each([
    ["the cloud requests", isCloud],
    ["the sun times", isSun],
  ])(
    "does not wait for %s that hang while the models get 429: the error comes at once (REQ-863, REQ-914)",
    async (_, hangs) => {
      // Since @graupel/download 0.3.0 the library gives up as soon as every model has failed (REQ-863), so the error
      // no longer waits OVERLOAD_GRACE_MS for the hung requests (REQ-914).
      const api = fakeOpenMeteo((url) => (!isForecast(url) ? "answer" : hangs(url) ? "hang" : "429"));
      renderPage(createForecastLoader({ fetch: api.fetch }));
      expect(loading()).toBe(true);
      await advance(0);
      expectError(CONCURRENT_TEXT);
      // The hung requests were aborted with the load.
      const hung = api.requests.filter((r) => hangs(r.url));
      expect(hung.length).toBeGreaterThan(0);
      for (const request of hung) expect(request.signal?.aborted).toBe(true);
      // Within the time limit of a request, long before it.
      expect(OVERLOAD_GRACE_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
    },
  );

  it("still shows what a load got when it ends within OVERLOAD_GRACE_MS after a 429 (one model loses its slice)", async () => {
    // The first model of the weather chain gets 429; every other request answers.
    let rejected: string | null = null;
    const api = fakeOpenMeteo((url) => {
      if (!isForecast(url) || isCloud(url) || isSun(url)) return "answer";
      const model = new URL(url).searchParams.get("models");
      rejected ??= model;
      return model === rejected ? "429" : "answer";
    });
    const load = createForecastLoader({ fetch: api.fetch });
    let result: ForecastResult | undefined;
    let failure: unknown;
    load({
      location: { name: DEFAULT_PLACE.name, latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon },
      auto: true,
      now: FIXED_NOW,
    }).then(
      (value) => (result = value),
      (error: unknown) => (failure = error),
    );
    await vi.advanceTimersByTimeAsync(OVERLOAD_GRACE_MS + 1000);
    expect(failure).toBeUndefined();
    expect(rejected).not.toBeNull();
    expect(Object.keys(result?.errors ?? {})).toHaveLength(1);
    expect(result?.combined.length).toBeGreaterThan(0);
  });
});

describe("REQ-861: a load that hangs", () => {
  it("fails after LOAD_TIMEOUT_MS when fetch never answers: error state, the loading message gone", async () => {
    const api = fakeOpenMeteo(() => "hang");
    renderPage(createForecastLoader({ fetch: api.fetch }));
    await advance(LOAD_TIMEOUT_MS - 1);
    expect(loading()).toBe(true);
    expect(busy()).toBe("true");
    expect(screen.queryByTestId("error-card")).toBeNull();
    await advance(1);
    expectError(TIMEOUT_TEXT);
    // Nothing of the load runs on.
    expect(api.requests.length).toBeGreaterThan(0);
    for (const request of api.requests) expect(request.signal?.aborted).toBe(true);
  });

  it("fails after LOAD_TIMEOUT_MS also with a loader whose promise never ends, and 'Try again' loads anew", async () => {
    const outcomes: (ForecastResult | "never")[] = ["never", forecastFixture()];
    const loader = vi.fn<ForecastLoader>(() => {
      const next = outcomes.shift() ?? forecastFixture();
      // A promise that ends neither with an answer nor with the abort.
      return next === "never" ? new Promise<ForecastResult>(() => {}) : Promise.resolve(next);
    });
    renderPage(loader);
    await advance(LOAD_TIMEOUT_MS);
    expectError(TIMEOUT_TEXT);
    expect(loader.mock.calls[0]![0].signal!.aborted).toBe(true);
    expect(loader.mock.calls[0]![0].signal!.reason).toBeInstanceOf(ForecastTimeoutError);

    await act(async () => fireEvent.click(retry()));
    await advance(0);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].refresh).toBe(true);
    expect(loader.mock.calls[1]![0].location).toEqual(loader.mock.calls[0]![0].location);
    expect(screen.queryByTestId("error-card")).toBeNull();
    expect(screen.queryByTestId("forecast-error")).toBeNull();
    expect(busy()).toBe("false");
  });

  it("does not fail a load that ends before LOAD_TIMEOUT_MS, nor later on", async () => {
    let resolve: (result: ForecastResult) => void = () => {};
    renderPage(vi.fn<ForecastLoader>(() => new Promise<ForecastResult>((done) => (resolve = done))));
    await advance(LOAD_TIMEOUT_MS - 1000);
    await act(async () => resolve(forecastFixture()));
    await advance(2 * LOAD_TIMEOUT_MS);
    expect(screen.queryByTestId("error-card")).toBeNull();
    expect(busy()).toBe("false");
  });

  it("gives up a hung request after REQUEST_TIMEOUT_MS and two retries, so the forecast shows without its clouds", async () => {
    const api = fakeOpenMeteo((url) => (isCloud(url) ? "hang" : "answer"));
    const load = createForecastLoader({ fetch: api.fetch });
    let result: ForecastResult | undefined;
    load({
      location: { name: DEFAULT_PLACE.name, latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon },
      auto: true,
      now: FIXED_NOW,
    }).then((value) => (result = value));
    // Three attempts with the client's backoff of 0.5 s and 1 s between them.
    const givenUp = 3 * REQUEST_TIMEOUT_MS + 1500;
    expect(givenUp).toBeLessThan(LOAD_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(givenUp - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeDefined();
    expect(result!.warnings.some((text) => text.includes("timed out after 10000 ms"))).toBe(true);
    expect(result!.combined.length).toBeGreaterThan(0);
  });

  it("names the reason of a load that timed out", () => {
    expect(forecastFailure(new ForecastTimeoutError(LOAD_TIMEOUT_MS))).toBe("timeout");
  });
});

describe("REQ-861: the regions document", () => {
  it("fails a regions request that hangs after REGIONS_TIMEOUT_MS, so the next try fetches anew", async () => {
    let hang = true;
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      hang
        ? new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
          })
        : Promise.resolve(url === REGIONS_URL ? new Response(REGIONS) : new Response("", { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    resetModelData();
    let failure: unknown;
    loadModelData().catch((error: unknown) => (failure = error));
    await vi.advanceTimersByTimeAsync(REGIONS_TIMEOUT_MS - 1);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((failure as DOMException).name).toBe("TimeoutError");
    // Below the time limit of a load, so that "Try again" after it does not wait for the hung request.
    expect(REGIONS_TIMEOUT_MS).toBeLessThan(LOAD_TIMEOUT_MS);
    hang = false;
    const data = await loadModelData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((data.regions as { features: unknown[] }).features.length).toBeGreaterThan(10);
  });

  it("does not limit a regions request that answers in time", async () => {
    const regions = await fetchRegions(
      (async () => new Response('{"type":"FeatureCollection","features":[]}')) as unknown as typeof fetch,
      "/regions.geojson",
    );
    expect(regions).toEqual({ type: "FeatureCollection", features: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
});
