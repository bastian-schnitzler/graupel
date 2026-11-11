// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Memory of Open-Meteo answers (REQ-497, REQ-504): the page's loader rebuilds a chain with a moved boundary from the
 * answers it already has, without a new request, also after the hour turned (the page keeps the "now" of the place);
 * answers do not expire by default; another place, a reload and errors go to the network again.
 */
import type { ChainModelInput, ForecastResult } from "@graupel/download";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetModelData } from "../src/services/modelData.ts";
import { createResponseMemory } from "../src/services/responseMemory.ts";
import { createForecastLoader } from "../src/state/forecast.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const HOUR_MS = 3_600_000;
const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** A small fake Open-Meteo: hourly data for every requested variable, an empty `meta.json`, no sun times. */
function fakeOpenMeteo() {
  const requests: string[] = [];
  const fetch = vi.fn(async (input: string) => {
    requests.push(input);
    const url = new URL(input);
    if (url.pathname.endsWith("meta.json")) return Response.json({});
    const params = url.searchParams;
    if (params.has("daily")) return Response.json({ timezone: "GMT", daily: { time: [], sunrise: [], sunset: [] } });
    const variables = (params.get("hourly") ?? "").split(",").filter(Boolean);
    const past = Number(params.get("past_hours") ?? 0);
    const ahead = Number(params.get("forecast_hours") ?? 24);
    const nowHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const times = Array.from({ length: past + ahead }, (_, i) => nowHour + (i - past) * HOUR_MS);
    const hourly: Record<string, unknown> = { time: times.map(gmt) };
    for (const variable of variables) hourly[variable] = times.map((_, i) => i % 10);
    return Response.json({ timezone: "GMT", hourly });
  });
  return { fetch, requests };
}

const LOCATION = { name: "Chamonix", latitude: 45.92, longitude: 6.87 };
const chain = (first: number): ChainModelInput[] => [
  { id: "icon_d2", max_forecast_horizon_hours: first },
  { id: "ecmwf_ifs025", max_forecast_horizon_hours: 240 },
];
/** End of each model's slice in a result, by catalogue id. */
const slices = (result: ForecastResult) =>
  result.chain.map((model) => [model.id ?? model.model, model.sliceEndHours]);

describe("createForecastLoader with the response memory", () => {
  it("rebuilds a chain with a moved boundary without a new request; a reload loads again", async () => {
    // Regions of the model data come from the global fetch, Open-Meteo from the fake.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ type: "FeatureCollection", features: [] })));
    resetModelData();
    const openMeteo = fakeOpenMeteo();
    const load = createForecastLoader({ fetch: openMeteo.fetch });
    const cloudChain: ChainModelInput[] = [{ id: "icon_d2", max_forecast_horizon_hours: 48 }];

    const first = await load({ location: LOCATION, chain: chain(36), cloudChain });
    expect(slices(first)).toEqual([
      ["icon_d2", 36],
      ["ecmwf_ifs025", 240],
    ]);
    const requests = openMeteo.requests.length;
    expect(requests).toBeGreaterThan(0);

    // The boundary moves: a new split from the same answers.
    const moved = await load({ location: LOCATION, chain: chain(24), cloudChain });
    expect(openMeteo.requests.length).toBe(requests);
    expect(slices(moved)).toEqual([
      ["icon_d2", 24],
      ["ecmwf_ifs025", 240],
    ]);
    expect(moved.byModel).toEqual(first.byModel);

    // A reload forgets the answers.
    await load({ location: LOCATION, chain: chain(24), cloudChain, refresh: true });
    expect(openMeteo.requests.length).toBe(2 * requests);
  });
});

describe("createForecastLoader on a reload (REQ-637)", () => {
  it("sends every request of a reload past the browser's HTTP cache, the other loads as usual", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ type: "FeatureCollection", features: [] })));
    resetModelData();
    const openMeteo = fakeOpenMeteo();
    const load = createForecastLoader({ fetch: openMeteo.fetch });
    const modes = () => openMeteo.fetch.mock.calls.map((call) => (call as unknown[] as [string, RequestInit?])[1]?.cache);

    await load({ location: LOCATION, chain: chain(36) });
    const requests = openMeteo.requests.length;
    expect(requests).toBeGreaterThan(0);
    expect(modes().every((mode) => mode === undefined)).toBe(true);

    // The reload asks Open-Meteo for everything again, each request with `cache: "reload"`, meta.json too.
    await load({ location: LOCATION, chain: chain(36), refresh: true });
    expect(openMeteo.requests.length).toBe(2 * requests);
    expect(modes().slice(requests)).toEqual(Array.from({ length: requests }, () => "reload"));
    expect(openMeteo.requests.slice(requests).some((url) => url.endsWith("meta.json"))).toBe(true);

    // A chain of the same place after it: the answers of the reload from memory, a new model as usual.
    await load({ location: LOCATION, chain: [{ id: "icon_eu", max_forecast_horizon_hours: 120 }, ...chain(36)] });
    expect(openMeteo.requests.length).toBeGreaterThan(2 * requests);
    expect(modes().slice(2 * requests).every((mode) => mode === undefined)).toBe(true);
  });
});

describe("createForecastLoader for one place (REQ-504)", () => {
  it("rebuilds from memory after the hour turned with the place's 'now' and forgets the answers for another place", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ type: "FeatureCollection", features: [] })));
    resetModelData();
    const openMeteo = fakeOpenMeteo();
    const load = createForecastLoader({ fetch: openMeteo.fetch });
    const loadedAt = Date.UTC(2026, 9, 29, 9, 40);
    const clock = vi.spyOn(Date, "now").mockReturnValue(loadedAt);
    await load({ location: LOCATION, chain: chain(36), now: loadedAt });
    const requests = openMeteo.requests.length;

    // Two hours and a day later the place's requests are the same: nothing is loaded again, nothing has expired.
    clock.mockReturnValue(loadedAt + 26 * HOUR_MS);
    const moved = await load({ location: LOCATION, chain: chain(12), now: loadedAt });
    expect(openMeteo.requests.length).toBe(requests);
    expect(Date.parse(moved.timeline.now)).toBe(Date.UTC(2026, 9, 29, 9));

    // Another place loads its own answers and forgets the old ones: coming back loads again.
    const other = { name: "Innsbruck", latitude: 47.26, longitude: 11.39 };
    await load({ location: other, chain: chain(36), now: loadedAt });
    expect(openMeteo.requests.length).toBe(2 * requests);
    await load({ location: LOCATION, chain: chain(36), now: loadedAt });
    expect(openMeteo.requests.length).toBe(3 * requests);
  });
});

describe("createResponseMemory", () => {
  it("answers a known GET from memory with a fresh body each time", async () => {
    const network = vi.fn(async () => new Response('{"a":1}', { headers: { "content-type": "application/json" } }));
    const memory = createResponseMemory({ fetch: network });
    const first = await memory.fetch("https://x.test/a");
    const second = await memory.fetch("https://x.test/a");
    expect(await first.text()).toBe('{"a":1}');
    expect(await second.text()).toBe('{"a":1}');
    expect(second.headers.get("content-type")).toBe("application/json");
    expect(network).toHaveBeenCalledOnce();
    expect(memory.size).toBe(1);
    memory.clear();
    await memory.fetch("https://x.test/a");
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("keeps answers without a time limit by default, and a missing meta.json", async () => {
    let time = 0;
    const network = vi.fn(async (url: string) =>
      url.endsWith("meta.json") ? new Response("", { status: 404 }) : new Response("{}"),
    );
    const memory = createResponseMemory({ fetch: network, now: () => time });
    await memory.fetch("https://x.test/a");
    expect((await memory.fetch("https://x.test/icon_d2/static/meta.json")).status).toBe(404);
    time = 7 * 24 * 3_600_000;
    await memory.fetch("https://x.test/a");
    expect((await memory.fetch("https://x.test/icon_d2/static/meta.json")).status).toBe(404);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("does not keep errors and forgets answers after their time", async () => {
    let status = 500;
    let time = 0;
    const network = vi.fn(async () => new Response("{}", { status }));
    const memory = createResponseMemory({ fetch: network, ttlMs: 1000, now: () => time });
    expect((await memory.fetch("https://x.test/a")).status).toBe(500);
    status = 200;
    expect((await memory.fetch("https://x.test/a")).status).toBe(200);
    await memory.fetch("https://x.test/a");
    expect(network).toHaveBeenCalledTimes(2);
    time = 1001;
    await memory.fetch("https://x.test/a");
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("keeps at most maxEntries answers, dropping the oldest, and rejects an aborted request", async () => {
    const network = vi.fn(async () => new Response("{}"));
    const memory = createResponseMemory({ fetch: network, maxEntries: 2 });
    await memory.fetch("https://x.test/1");
    await memory.fetch("https://x.test/2");
    await memory.fetch("https://x.test/3");
    expect(memory.size).toBe(2);
    await memory.fetch("https://x.test/3");
    expect(network).toHaveBeenCalledTimes(3);
    await memory.fetch("https://x.test/1");
    expect(network).toHaveBeenCalledTimes(4);
    const controller = new AbortController();
    controller.abort();
    await expect(memory.fetch("https://x.test/3", { signal: controller.signal })).rejects.toThrow();
  });
});
