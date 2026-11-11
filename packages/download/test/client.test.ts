// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Open-Meteo client. No network: fetch is mocked.
import { describe, expect, it, vi } from "vitest";
import {
  AllModelsFailedError,
  ApiError,
  OutOfDomainError,
  buildQuery,
  canonicalModelId,
  createClient,
  ensembleMetaPath,
  extractSunPeriods,
  modelMetaPath,
  parseOpenMeteoJson,
  toOpenMeteoModel,
  type FetchLike,
} from "../src/index";

type Reply = Response | Error | ((url: string, init?: RequestInit) => Promise<Response>);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

/** fetch mock answering with the given replies in order; the last one repeats. */
function mockFetch(...replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(url, init);
    return (reply as Response).clone();
  });
  return { fn, calls };
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

const berlin = { latitude: 52.52, longitude: 13.405 };

const sampleResponse = {
  latitude: 52.52,
  longitude: 13.405,
  hourly: {
    time: ["2024-01-01T00:00", "2024-01-01T01:00"],
    temperature_2m: [2.5, 2.7],
  },
};

describe("forecast requests (test_open_meteo.py)", () => {
  it("fetches data of a model chain in GMT", async () => {
    const { fn, calls } = mockFetch(json(sampleResponse));
    const client = createClient({ fetch: fn });

    const result = await client.fetchForecast({
      ...berlin,
      models: ["ICON-D2", "ICON-EU"].map((name) => toOpenMeteoModel(name)),
      hourly: ["temperature_2m"],
    });

    expect(result.latitude).toBe(52.52);
    expect(result.hourly?.temperature_2m).toEqual([2.5, 2.7]);
    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url.startsWith("https://api.open-meteo.com/v1/forecast?")).toBe(true);
    expect(params(url).get("models")).toBe("icon_d2,icon_eu");
    expect(params(url).get("timezone")).toBe("GMT");
    expect(params(url).get("hourly")).toBe("temperature_2m");
    expect(params(url).has("apikey")).toBe(false);
  });

  it("raises on a server error without retries", async () => {
    const { fn, calls } = mockFetch(text("Internal Server Error", 500));
    const client = createClient({ fetch: fn, maxRetries: 0 });

    const error = await client.fetchForecast({ ...berlin, models: "icon_d2" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect(calls).toHaveLength(1);
  });

  it("retries a temporary server error", async () => {
    const { fn, calls } = mockFetch(
      text("Service Unavailable", 503),
      json({ ...berlin, hourly: { time: ["2024-01-01T00:00"], temperature_2m: [2.5] } }),
    );
    const client = createClient({ fetch: fn, maxRetries: 1, retryBackoffMs: 0 });

    const result = await client.fetchForecast({ ...berlin, models: "icon_d2", hourly: ["temperature_2m"] });

    expect(calls).toHaveLength(2);
    expect(result.hourly?.temperature_2m).toEqual([2.5]);
  });

  it("reads an unquoted nan as null", async () => {
    const { fn } = mockFetch(text('{"latitude":nan,"longitude":nan,"generationtime_ms":0.004}'));
    const client = createClient({ fetch: fn });

    const result = await client.fetchForecast({ ...berlin, models: "italia_meteo_arpae_icon_2i" });
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });
});

describe("model name mapping (test_open_meteo.py)", () => {
  it.each([
    ["ICON-D2", ["icon_d2"]],
    ["ICON-EU", ["icon_eu"]],
    ["GFS", ["gfs_seamless", "ncep_gfs_seamless"]],
    ["ECMWF-IFS", ["ecmwf_ifs"]],
    ["icon_d2", ["icon_d2"]],
  ])("maps %s", (name, apiNames) => {
    expect(apiNames).toContain(toOpenMeteoModel(name));
  });

  it("prefers catalogue ids and names", () => {
    const catalogue = [
      { id: "meteoswiss_icon_ch1", name: "ICON-CH1-EPS" },
      { id: "ecmwf_ifs025", name: "ECMWF IFS 0.25°" },
    ];
    expect(toOpenMeteoModel("ICON-CH1-EPS", catalogue)).toBe("meteoswiss_icon_ch1");
    expect(toOpenMeteoModel("ecmwf ifs 0.25°", catalogue)).toBe("ecmwf_ifs025");
    expect(toOpenMeteoModel("Some New Model", catalogue)).toBe("some_new_model");
  });

  it("canonicalises former ids and names", () => {
    expect(canonicalModelId("ICON_CH1")).toBe("meteoswiss_icon_ch1");
    expect(canonicalModelId(null, "GFS Global")).toBe("ncep_gfs_global");
    expect(canonicalModelId(null, null)).toBe("unknown_model");
  });
});

describe("retries, errors and limits", () => {
  it("retries network errors with exponential backoff and gives up with an ApiError", async () => {
    vi.useFakeTimers();
    try {
      const { fn, calls } = mockFetch(new TypeError("fetch failed"));
      const client = createClient({ fetch: fn, maxRetries: 2, retryBackoffMs: 100 });
      const pending = client.fetchForecast({ ...berlin }).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(99);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(199);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(3);

      const error = await pending;
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBeNull();
      expect((error as ApiError).cause).toBeInstanceOf(TypeError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a rejected request and reports Open-Meteo's reason", async () => {
    const { fn, calls } = mockFetch(json({ error: true, reason: "Cannot initialize WeatherVariable" }, 400));
    const client = createClient({ fetch: fn, retryBackoffMs: 0 });

    const error = await client.fetchForecast({ ...berlin, models: "icon_d2" }).catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(OutOfDomainError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).reason).toBe("Cannot initialize WeatherVariable");
    expect((error as ApiError).message).toBe(
      "Open-Meteo API Error: Cannot initialize WeatherVariable (model: icon_d2)",
    );
  });

  it("raises OutOfDomainError when the model has no data at the location", async () => {
    const { fn } = mockFetch(json({ error: true, reason: "No data is available for this location" }, 400));
    const client = createClient({ fetch: fn });

    const error = await client.fetchForecast({ ...berlin, models: "meteoswiss_icon_ch1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OutOfDomainError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as Error).message).toContain("for model 'meteoswiss_icon_ch1'");
  });

  it("times out a hanging attempt and retries it", async () => {
    let first = true;
    const hanging = (_url: string, init?: RequestInit) => {
      if (!first) return Promise.resolve(json(sampleResponse));
      first = false;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    };
    const { fn, calls } = mockFetch(hanging);
    const client = createClient({ fetch: fn, timeoutMs: 20, retryBackoffMs: 0 });

    const result = await client.fetchForecast({ ...berlin });
    expect(calls).toHaveLength(2);
    expect(result.latitude).toBe(52.52);
  });

  it("stops at once when the caller aborts", async () => {
    const controller = new AbortController();
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const { fn, calls } = mockFetch(hanging);
    const client = createClient({ fetch: fn, retryBackoffMs: 0 });

    const pending = client.fetchForecast({ ...berlin }, { signal: controller.signal }).catch((e: unknown) => e);
    await Promise.resolve();
    controller.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(calls).toHaveLength(1);
  });

  it("does not start a request with an aborted signal", async () => {
    const { fn, calls } = mockFetch(json(sampleResponse));
    const client = createClient({ fetch: fn });
    const controller = new AbortController();
    controller.abort();
    await expect(client.fetchForecast({ ...berlin }, { signal: controller.signal })).rejects.toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("limits the number of parallel requests", async () => {
    let active = 0;
    let peak = 0;
    const slow = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return json(sampleResponse);
    };
    const { fn, calls } = mockFetch(slow);
    const client = createClient({ fetch: fn, concurrency: 2 });

    await Promise.all(Array.from({ length: 6 }, () => client.fetchForecast({ ...berlin })));
    expect(calls).toHaveLength(6);
    expect(peak).toBe(2);
  });

  it("sends the API key to customer URLs", async () => {
    const { fn, calls } = mockFetch(json(sampleResponse));
    const client = createClient({
      fetch: fn,
      apiKey: "secret",
      forecastUrl: "https://customer-api.open-meteo.com/v1/forecast",
    });

    await client.fetchForecast({ ...berlin });
    expect(calls[0]!.url.startsWith("https://customer-api.open-meteo.com/v1/forecast?")).toBe(true);
    expect(params(calls[0]!.url).get("apikey")).toBe("secret");
  });

  it("uses the global fetch by default", async () => {
    const { fn, calls } = mockFetch(json(sampleResponse));
    vi.stubGlobal("fetch", fn);
    try {
      await createClient().fetchForecast({ ...berlin });
      expect(calls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("collects the errors of all failed models", () => {
    const error = new AllModelsFailedError({ "ICON-D2": new Error("boom"), "ICON-EU": new Error("bang") });
    expect(error.message).toBe("All models failed: boom");
    expect(Object.keys(error.errors)).toEqual(["ICON-D2", "ICON-EU"]);
  });
});

describe("request parameters", () => {
  it("passes hours and the model's variables", async () => {
    const { fn, calls } = mockFetch(json(sampleResponse));
    const client = createClient({ fetch: fn });

    await client.fetchForecast({
      ...berlin,
      models: "icon_d2",
      hourly: ["temperature_2m", "precipitation", "wind_speed_10m"],
      forecastHours: 48,
      pastHours: 37,
    });
    const query = params(calls[0]!.url);
    expect(query.get("hourly")).toBe("temperature_2m,precipitation,wind_speed_10m");
    expect(query.get("forecast_hours")).toBe("48");
    expect(query.get("past_hours")).toBe("37");
    expect(query.get("latitude")).toBe("52.52");
    expect(query.get("longitude")).toBe("13.405");
    expect(query.has("daily")).toBe(false);
    expect(calls[0]!.url).toContain("hourly=temperature_2m,precipitation,wind_speed_10m");
  });

  it("uses best_match without models", async () => {
    const { fn, calls } = mockFetch(json(sampleResponse));
    await createClient({ fetch: fn }).fetchForecast({ ...berlin, models: [] });
    expect(params(calls[0]!.url).get("models")).toBe("best_match");
  });

  it("builds query strings without empty values", () => {
    expect(buildQuery({ a: 1, b: null, c: undefined, d: ["x", "y z"], e: true })).toBe("a=1&d=x,y%20z&e=true");
  });
});

describe("meta.json", () => {
  const meta = {
    last_run_initialisation_time: 1_761_458_400,
    last_run_availability_time: 1_761_465_600,
    data_end_time: 1_761_631_200,
    update_interval_seconds: 10_800,
    temporal_resolution_seconds: 3600,
  };

  it("fetches the run metadata under the model's data path", async () => {
    const { fn, calls } = mockFetch(json(meta));
    const result = await createClient({ fetch: fn }).fetchModelMeta("icon_d2");
    expect(calls[0]!.url).toBe("https://api.open-meteo.com/data/dwd_icon_d2/static/meta.json");
    expect(result.last_run_initialisation_time).toBe(meta.last_run_initialisation_time);
  });

  it("prefers the catalogue's meta path", async () => {
    const { fn, calls } = mockFetch(json(meta));
    await createClient({ fetch: fn, metaUrl: "https://example.org/data/" }).fetchModelMeta("icon_d2", {
      metaPath: "dwd_icon_d2_v2",
    });
    expect(calls[0]!.url).toBe("https://example.org/data/dwd_icon_d2_v2/static/meta.json");
  });

  it("returns nothing for blends without a request", async () => {
    const { fn, calls } = mockFetch(json(meta));
    const client = createClient({ fetch: fn });
    expect(await client.fetchModelMeta("best_match")).toEqual({});
    expect(await client.fetchModelMeta("icon_seamless")).toEqual({});
    expect(await client.fetchEnsembleMeta("meteofrance_arome_france")).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("returns nothing for an unknown path", async () => {
    const { fn } = mockFetch(text("Not Found", 404));
    expect(await createClient({ fetch: fn }).fetchModelMeta("some_model")).toEqual({});
  });

  it("fetches the ensemble behind the precipitation probability", async () => {
    const { fn, calls } = mockFetch(json(meta));
    const client = createClient({ fetch: fn });
    await client.fetchEnsembleMeta("icon_eu");
    await client.fetchEnsembleMeta("x", { ensembleMetaPath: "custom_ensemble" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.open-meteo.com/data/dwd_icon_eu_eps_native/static/meta.json",
      "https://api.open-meteo.com/data/custom_ensemble/static/meta.json",
    ]);
  });

  it("maps model ids to metadata paths", () => {
    expect(modelMetaPath("ICON_EU")).toBe("dwd_icon_eu");
    expect(modelMetaPath("ecmwf_ifs025")).toBe("ecmwf_ifs025");
    expect(modelMetaPath("ncep_gfs_seamless")).toBeNull();
    expect(modelMetaPath("")).toBeNull();
    expect(ensembleMetaPath("ecmwf_ifs")).toBe("ecmwf_ifs025_ensemble");
    expect(ensembleMetaPath("jma_msm")).toBeNull();
  });
});

describe("Single Runs API", () => {
  it("requests one run in GMT", async () => {
    const run = {
      hourly: { time: ["2026-10-26T06:00", "2026-10-26T07:00"], temperature_2m: [8.1, null] },
    };
    const { fn, calls } = mockFetch(json(run));
    const client = createClient({ fetch: fn, apiKey: "k" });

    const result = await client.fetchSingleRun({
      model: "icon_eu",
      run: "2026-10-26T06:00",
      ...berlin,
      forecastHours: 3,
    });
    expect(result.hourly?.temperature_2m).toEqual([8.1, null]);
    const url = calls[0]!.url;
    expect(url.startsWith("https://single-runs-api.open-meteo.com/v1/forecast?")).toBe(true);
    const query = params(url);
    expect(query.get("models")).toBe("icon_eu");
    expect(query.get("run")).toBe("2026-10-26T06:00");
    expect(query.get("hourly")).toBe("temperature_2m");
    expect(query.get("forecast_hours")).toBe("3");
    expect(query.get("timezone")).toBe("GMT");
    expect(query.get("apikey")).toBe("k");
  });

  it("raises when a run is not published yet", async () => {
    const { fn } = mockFetch(json({ error: true, reason: "Run not available" }, 400));
    const error = await createClient({ fetch: fn })
      .fetchSingleRun({ model: "icon_eu", run: "2026-10-26T09:00", ...berlin, forecastHours: 3 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
  });

  it("does not retry a server error, a network error or a timeout (REQ-633)", async () => {
    const run = { model: "icon_eu", run: "2026-10-26T09:00", ...berlin, forecastHours: 3 };
    const ok = json({ hourly: { time: ["2026-10-26T09:00"], temperature_2m: [1] } });
    const hang: Reply = (_url, init) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    for (const [failure, status] of [
      [json({ error: true, reason: "The service is overloaded" }, 503), 503],
      [new TypeError("fetch failed"), null],
      [hang, null],
    ] as const) {
      const { fn, calls } = mockFetch(failure, ok);
      const client = createClient({ fetch: fn, maxRetries: 2, retryBackoffMs: 0, timeoutMs: 20 });
      const error = await client.fetchSingleRun(run).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect(calls).toHaveLength(1);
    }
  });

  it("reports an outage through onUnavailable before a queued request starts, a rejected run not", async () => {
    const run = { model: "icon_eu", run: "2026-10-26T09:00", ...berlin, forecastHours: 3 };
    const { fn, calls } = mockFetch(json({ error: true, reason: "The service is overloaded" }, 503));
    const client = createClient({ fetch: fn, concurrency: 1 });
    const stop = new AbortController();
    const seen: (number | null)[] = [];
    const first = client.fetchSingleRun(run, { signal: stop.signal, onUnavailable: (e) => (seen.push(e.status), stop.abort()) });
    const queued = client.fetchSingleRun(run, { signal: stop.signal });
    await expect(first).rejects.toBeInstanceOf(ApiError);
    await expect(queued).rejects.toBeDefined();
    expect(seen).toEqual([503]);
    expect(calls).toHaveLength(1);

    const rejected = mockFetch(json({ error: true, reason: "Run not available" }, 400));
    const onUnavailable = vi.fn();
    await createClient({ fetch: rejected.fn }).fetchSingleRun(run, { onUnavailable }).catch(() => undefined);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("leaves the retries of forecast and meta.json requests as they are", async () => {
    const overloaded = json({ error: true, reason: "The service is overloaded" }, 503);
    const { fn, calls } = mockFetch(overloaded, overloaded, json({ last_run_initialisation_time: 1 }));
    const client = createClient({ fetch: fn, maxRetries: 2, retryBackoffMs: 0 });
    expect(await client.fetchModelMeta("icon_eu")).toEqual({ last_run_initialisation_time: 1 });
    expect(calls).toHaveLength(3);
  });
});

describe("sun phases", () => {
  it("requests yesterday and the coming days and returns UTC instants", async () => {
    const answer = {
      timezone: "GMT",
      daily: {
        time: ["2026-10-24", "2026-10-25", "2026-10-26"],
        sunrise: ["2026-10-24T05:57", "2026-10-25T06:59", null],
        sunset: ["2026-10-24T15:58", "2026-10-25T15:56", "2026-10-26T15:54"],
      },
    };
    const { fn, calls } = mockFetch(json(answer));
    const phases = await createClient({ fetch: fn }).fetchSunPhases({ ...berlin, forecastDays: 40 });

    const query = params(calls[0]!.url);
    expect(query.get("daily")).toBe("sunrise,sunset");
    expect(query.get("past_days")).toBe("2");
    expect(query.get("forecast_days")).toBe("16");
    expect(query.get("models")).toBe("best_match");
    expect(query.get("timezone")).toBe("GMT");
    expect(query.has("hourly")).toBe(false);
    expect(phases).toEqual([
      { day: "2026-10-24", sunrise: "2026-10-24T05:57:00Z", sunset: "2026-10-24T15:58:00Z" },
      { day: "2026-10-25", sunrise: "2026-10-25T06:59:00Z", sunset: "2026-10-25T15:56:00Z" },
    ]);
  });

  it("reads local sun times in the answer's time zone", () => {
    expect(
      extractSunPeriods({
        timezone: "Europe/Berlin",
        daily: { time: ["2026-10-24"], sunrise: ["2026-10-24T07:57"], sunset: ["2026-10-24T17:58"] },
      }),
    ).toEqual([{ day: "2026-10-24", sunrise: "2026-10-24T05:57:00Z", sunset: "2026-10-24T15:58:00Z" }]);
  });

  it("clamps forecast days to at least one", async () => {
    const { fn, calls } = mockFetch(json({ daily: {} }));
    expect(await createClient({ fetch: fn }).fetchSunPhases({ ...berlin, forecastDays: 0 })).toEqual([]);
    expect(params(calls[0]!.url).get("forecast_days")).toBe("1");
  });
});

describe("nan repair", () => {
  it("repairs nan in objects and arrays only when needed", () => {
    expect(parseOpenMeteoJson('{"a":nan,"b":[1,nan, NaN],"c":"nan"}')).toEqual({ a: null, b: [1, null, null], c: "nan" });
    expect(parseOpenMeteoJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseOpenMeteoJson("not json")).toThrow(SyntaxError);
  });

  it("raises an ApiError on an unreadable body", async () => {
    const { fn } = mockFetch(text("<html>oops</html>"));
    await expect(createClient({ fetch: fn }).fetchForecast({ ...berlin })).rejects.toBeInstanceOf(ApiError);
  });
});
