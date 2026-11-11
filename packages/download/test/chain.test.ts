// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Model chain download and stitching. Open-Meteo is a fake behind an injected fetch: no network.
import { describe, expect, it } from "vitest";
import {
  AllModelsFailedError,
  HOUR_MS,
  OutOfDomainError,
  canonicalTimestamp,
  createClient,
  createResolver,
  downloadChain,
  findCatalogueModel,
  getFetchHorizon,
  hourlyFetchSet,
  openMeteoName,
  pastHoursForYesterday,
  replacementCandidates,
  toHarmonizedResponse,
  toMeteogramInput,
  yesterdayMidnightUtc,
  type DownloadChainRequest,
  type DownloadData,
  type ForecastResult,
  type WeatherModel,
} from "../src/index";
import { fakeOpenMeteo, hourlyAnswer, json, windowStart, type Call, type FakeApi, type FakeHandlers } from "./fakeOpenMeteo";
import { GATED, catalogue, gatedCatalogue, gatedRegistry, registry, resolverData } from "./modelData";

const TZ = "Europe/Berlin";
/** Mon 2026-09-14 12:30 CEST. */
const NOW = Date.UTC(2026, 8, 14, 10, 30);
const NOW_HOUR = Date.UTC(2026, 8, 14, 10);
/** Sun 2026-09-13 00:00 CEST. */
const START = Date.UTC(2026, 8, 12, 22);
const PAST = (NOW_HOUR - START) / HOUR_MS; // 36 hours before the forecast start
const BERLIN = { name: "Berlin", latitude: 52.52, longitude: 13.405, timezone: TZ };

const at = (hours: number, base = NOW_HOUR) => canonicalTimestamp(base + hours * HOUR_MS);
const hoursOf = (timestamp: string, base = NOW_HOUR) => (Date.parse(timestamp) - base) / HOUR_MS;

function client(api: FakeApi, options: Parameters<typeof createClient>[0] = {}) {
  return createClient({ fetch: api.fetch, retryBackoffMs: 0, cache: null, ...options });
}

function download(
  api: FakeApi,
  request: Partial<DownloadChainRequest>,
  clientOptions = {},
  data: Partial<DownloadData> = {},
): Promise<ForecastResult> {
  return downloadChain(
    client(api, clientOptions),
    { location: BERLIN, now: NOW, timezone: TZ, cloudChain: [], ...request },
    { registry, ...resolverData, ...data },
  );
}

/** Registry and catalogue with an optional catalogued quantity that ICON-D2 lists and ICON-EU does not. */
const GATED_DATA: Partial<DownloadData> = { registry: gatedRegistry, catalogue: gatedCatalogue };

/** Python's MockOpenMeteoClient: one value per hour counted from the timeline start, offset per model. */
function perModel(offsets: Record<string, number>, gaps: Record<string, number[]> = {}): FakeHandlers["forecast"] {
  return (call: Call) => {
    const { start, count } = windowStart(call, NOW_HOUR);
    const gap = new Set(gaps[call.model] ?? []);
    return hourlyAnswer(call.hourly, start, count, (_v, _i, t) =>
      gap.has((t - NOW_HOUR) / HOUR_MS) ? null : (offsets[call.model] ?? 30) + (t - START) / HOUR_MS,
    );
  };
}

const D2_EU: WeatherModel[] = [
  { name: "ICON-D2", max_forecast_horizon_hours: 10 },
  { name: "ICON-EU", max_forecast_horizon_hours: 24 },
];

describe("downloadChain: stitching (test_service.py)", () => {
  it("hands over at the configured horizon and fetches every model up to the chain end", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const result = await download(api, { chain: D2_EU, quantities: ["temperature"] });

    expect(result.timeline).toEqual({ start: at(0, START), now: at(0), end: at(24) });
    // ICON-D2 is fetched up to the chain end (24 h) for dragged boundaries.
    expect(result.byModel["ICON-D2"]).toHaveLength(PAST + 24);
    expect(result.byModel["ICON-D2"]![0]).toMatchObject({ model: "ICON-D2", value: 10 });
    expect(result.byModel["ICON-EU"]).toHaveLength(PAST + 24);
    expect(result.byModel["ICON-EU"]![0]).toMatchObject({ model: "ICON-EU", value: 20 });

    expect(result.combined).toHaveLength(PAST + 24);
    result.combined.forEach((point, i) => {
      if (i < PAST + 10) expect(point).toMatchObject({ model: "ICON-D2", value: 10 + i });
      else expect(point).toMatchObject({ model: "ICON-EU", value: 20 + i });
    });
    expect(api.ofKind("forecast").map((c) => [c.model, c.params.forecast_hours, c.params.timezone])).toEqual([
      ["icon_d2", "24", "GMT"],
      ["icon_eu", "24", "GMT"],
    ]);
  });

  it("skips models with an empty slice", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({}) });
    const result = await download(api, {
      chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 0 },
        { name: "ICON-EU", max_forecast_horizon_hours: 10 },
        { name: "GFS", max_forecast_horizon_hours: 10 },
        { name: "ECMWF", max_forecast_horizon_hours: 24 },
      ],
      quantities: ["temperature"],
    });
    expect(result.combined).toHaveLength(PAST + 24);
    result.combined.forEach((point, i) => expect(point.model).toBe(i < PAST + 10 ? "ICON-EU" : "ECMWF"));
    expect(result.chain.map((m) => m.model)).toEqual(["ICON-EU", "ECMWF"]);
  });

  it("downloads every quantity of the fetch set by default", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const result = await download(api, { chain: D2_EU });
    const expected = new Set([
      "temperature",
      "apparent_temperature",
      "dew_point",
      "relative_humidity",
      "wind_speed",
      "wind_gusts",
      "wind_direction",
      "cloud_cover",
      "precipitation",
      "snowfall",
      "snow_depth",
      "precipitation_probability",
      "weather_code",
    ]);
    expect(new Set(result.byModel["ICON-D2"]!.map((p) => p.variable))).toEqual(expected);
    expect(new Set(result.combined.map((p) => p.variable))).toEqual(expected);
    expect(result.combined).toHaveLength((PAST + 24) * expected.size);
  });

  it("requests the total cloud cover only, without empty query segments", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({}) });
    await download(api, { chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 12 }] });
    const requested = api.ofKind("forecast")[0]!.hourly;
    expect(requested).toContain("cloud_cover");
    for (const layer of ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high"]) expect(requested).not.toContain(layer);
    expect(requested.every((v) => v.trim().length > 0)).toBe(true);
  });

  it("gives the exact model boundary to the next model (half-open slices)", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const result = await download(api, { chain: D2_EU, quantities: ["temperature"] });
    const byTime = new Map(result.combined.map((p) => [p.timestamp, p]));
    expect(byTime.get(at(9))?.model).toBe("ICON-D2");
    expect(byTime.get(at(10))?.model).toBe("ICON-EU");
  });

  it("keeps the slice of an empty model empty instead of borrowing the next model", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) =>
        call.model.includes("icon_ch1")
          ? json({ error: true, reason: "No data is available for this location" }, 400)
          : perModel({ ncep_gfs_seamless: 20 })!(call),
    });
    const result = await download(api, {
      location: { name: "Test Loc", latitude: 50, longitude: 8 },
      chain: [
        { name: "MeteoSwiss ICON-CH1", max_forecast_horizon_hours: 10 },
        { name: "GFS Seamless", max_forecast_horizon_hours: 24 },
      ],
      quantities: ["temperature"],
    });
    expect(result.errors["MeteoSwiss ICON-CH1"]).toBeInstanceOf(OutOfDomainError);
    expect(result.byModel["MeteoSwiss ICON-CH1"]!.every((p) => p.value === null)).toBe(true);
    expect(result.combined).toHaveLength(PAST + 24);
    const ch1 = result.combined.filter((p) => p.model === "MeteoSwiss ICON-CH1");
    expect(ch1).toHaveLength(PAST + 10);
    expect(ch1.every((p) => p.value === null && p.unit === "°C")).toBe(true);
    const gfs = result.combined.filter((p) => p.model === "GFS Seamless");
    expect(gfs).toHaveLength(14);
    expect(gfs.every((p) => p.value !== null)).toBe(true);
  });

  it("throws AllModelsFailedError when every model fails", async () => {
    const api = fakeOpenMeteo({ forecast: () => json({ error: true, reason: "API Offline" }, 400) });
    const error = await download(api, { chain: D2_EU, quantities: ["temperature"] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AllModelsFailedError);
    expect(Object.keys((error as AllModelsFailedError).errors)).toEqual(["ICON-D2", "ICON-EU"]);
    expect((error as Error).message).toContain("API Offline");
  });

  it("throws AllModelsFailedError on network failures after the retries", async () => {
    const api = fakeOpenMeteo({ forecast: () => new TypeError("fetch failed") });
    await expect(download(api, { chain: D2_EU, quantities: ["temperature"] })).rejects.toBeInstanceOf(
      AllModelsFailedError,
    );
    // Two retries per model after the first attempt.
    expect(api.ofKind("forecast")).toHaveLength(6);
  });

  it("leaves a failing later model's slice empty", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) =>
        call.model === "icon_eu" ? json({ error: true, reason: "No data for ICON-EU" }, 400) : perModel({ icon_d2: 15 })!(call),
    });
    const result = await download(api, {
      chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 12 },
        { name: "ICON-EU", max_forecast_horizon_hours: 24 },
      ],
      quantities: ["temperature"],
    });
    const d2 = result.combined.filter((p) => p.model === "ICON-D2");
    const eu = result.combined.filter((p) => p.model === "ICON-EU");
    expect(d2).toHaveLength(PAST + 12);
    expect(d2.every((p) => p.value !== null)).toBe(true);
    expect(eu).toHaveLength(12);
    expect(eu.every((p) => p.value === null)).toBe(true);
  });

  it("hands every quantity over where the model's run ends", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        if (call.model === "geosphere_arome_austria") {
          // GeoSphere only delivers 6 future hours and no probability.
          const past = Number(call.params.past_hours);
          return hourlyAnswer(call.hourly, start, past + 6, (v, i) =>
            v === "precipitation_probability" ? null : 10 + i,
          );
        }
        return hourlyAnswer(call.hourly, start, count, (v, i) => (v === "precipitation_probability" ? 20 + i : 15 + i));
      },
    });
    const result = await download(api, {
      location: { name: "Austria", latitude: 47.3, longitude: 11.4 },
      chain: [
        { name: "GeoSphere AROME Austria", max_forecast_horizon_hours: 10 },
        { name: "ICON-EU", max_forecast_horizon_hours: 20 },
      ],
      quantities: ["temperature", "precipitation_probability"],
    });
    const point = (hours: number, variable: string) =>
      result.combined.find((p) => p.timestamp === at(hours) && p.variable === variable);
    for (let h = 0; h < 6; h += 1) {
      expect(point(h, "temperature")?.model).toBe("GeoSphere AROME Austria");
      expect(point(h, "precipitation_probability")?.model).toBe("GeoSphere AROME Austria");
    }
    for (let h = 6; h < 11; h += 1) {
      expect(point(h, "temperature")?.model).toBe("ICON-EU");
      expect(point(h, "precipitation_probability")?.model).toBe("ICON-EU");
    }
    expect(result.availability["GeoSphere AROME Austria"]?.available_hours).toBe(6);
    expect(result.chain.map((m) => [m.model, m.sliceEndHours, m.configuredHours])).toEqual([
      ["GeoSphere AROME Austria", 6, 10],
      ["ICON-EU", 20, 20],
    ]);
  });

  // REQ-630: a newer run being written can deliver single quantities further than the temperature.
  const aromeWithEarlierTemperature = (temperatureHours: number, otherHours: number, gapHour?: number) =>
    fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        if (call.model === "geosphere_arome_austria") {
          const past = Number(call.params.past_hours);
          return hourlyAnswer(call.hourly, start, past + otherHours, (v, i, t) => {
            const hour = (t - NOW_HOUR) / HOUR_MS;
            if (v !== "temperature_2m") return 1;
            return hour >= temperatureHours || hour === gapHour ? null : 10 + i;
          });
        }
        return hourlyAnswer(call.hourly, start, count, (_v, i) => 15 + i);
      },
    });
  const aromeChain = [
    { name: "GeoSphere AROME Austria", max_forecast_horizon_hours: 12 },
    { name: "ICON-EU", max_forecast_horizon_hours: 20 },
  ];
  const AUSTRIA = { name: "Austria", latitude: 47.3, longitude: 11.4 };

  it("ends a slice after the model's last hour with temperature (REQ-630)", async () => {
    const result = await download(aromeWithEarlierTemperature(6, 10), {
      location: AUSTRIA,
      chain: aromeChain,
      quantities: ["temperature", "precipitation"],
    });
    const point = (hours: number, variable: string) =>
      result.combined.find((p) => p.timestamp === at(hours) && p.variable === variable);
    for (let h = 0; h < 6; h += 1) {
      expect(point(h, "temperature")?.model).toBe("GeoSphere AROME Austria");
      expect(point(h, "precipitation")?.model).toBe("GeoSphere AROME Austria");
    }
    for (let h = 6; h < 12; h += 1) {
      expect(point(h, "temperature")).toMatchObject({ model: "ICON-EU", value: expect.any(Number) });
      expect(point(h, "precipitation")?.model).toBe("ICON-EU");
    }
    expect(result.availability["GeoSphere AROME Austria"]).toMatchObject({ available_hours: 6, valid_until: at(6) });
    expect(result.chain.map((m) => [m.model, m.sliceEndHours])).toEqual([
      ["GeoSphere AROME Austria", 6],
      ["ICON-EU", 20],
    ]);
  });

  it("keeps the old rule for a model without temperature (REQ-630)", async () => {
    const result = await download(aromeWithEarlierTemperature(6, 8), {
      location: AUSTRIA,
      chain: aromeChain,
      quantities: ["precipitation"],
    });
    expect(result.availability["GeoSphere AROME Austria"]?.available_hours).toBe(8);
    expect(result.chain.map((m) => [m.model, m.sliceEndHours])).toEqual([
      ["GeoSphere AROME Austria", 8],
      ["ICON-EU", 20],
    ]);
  });

  it("leaves a temperature gap inside the slice empty (REQ-630)", async () => {
    const result = await download(aromeWithEarlierTemperature(6, 10, 2), {
      location: AUSTRIA,
      chain: aromeChain,
      quantities: ["temperature", "precipitation"],
    });
    const gap = result.combined.find((p) => p.timestamp === at(2) && p.variable === "temperature");
    expect(gap).toMatchObject({ model: "GeoSphere AROME Austria", value: null });
    expect(result.availability["GeoSphere AROME Austria"]?.available_hours).toBe(6);
  });
});

describe("downloadChain: sun times (test_service.py)", () => {
  it("loads sunrise and sunset in GMT as UTC instants", async () => {
    const api = fakeOpenMeteo({
      forecast: perModel({}),
      sun: {
        daily: {
          time: ["2026-09-12", "2026-09-13"],
          sunrise: ["2026-09-12T07:07", "2026-09-13T07:08"],
          sunset: ["2026-09-12T19:49", "2026-09-13T19:47"],
        },
      },
    });
    const result = await download(api, {
      location: { name: "Lausanne", latitude: 46.52, longitude: 6.63, timezone: "Europe/Zurich" },
      chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 24 }],
      quantities: ["temperature"],
    });
    const [sun] = api.ofKind("sun");
    expect(sun?.params).toMatchObject({ timezone: "GMT", daily: "sunrise,sunset", past_days: "2", forecast_days: "16" });
    expect(result.sunPhases).toEqual([
      { day: "2026-09-12", sunrise: "2026-09-12T07:07:00Z", sunset: "2026-09-12T19:49:00Z" },
      { day: "2026-09-13", sunrise: "2026-09-13T07:08:00Z", sunset: "2026-09-13T19:47:00Z" },
    ]);
  });

  it("converts sun times of an answer in a local time zone", async () => {
    const api = fakeOpenMeteo({
      forecast: perModel({}),
      sun: {
        timezone: "Europe/Berlin",
        daily: {
          time: ["2026-09-15", "2026-09-16"],
          sunrise: ["2026-09-15T06:59", "2026-09-16T07:01"],
          sunset: ["2026-09-15T19:40", "2026-09-16T19:38"],
        },
      },
    });
    const result = await download(api, { chain: D2_EU, quantities: ["temperature"] });
    expect(result.sunPhases.map((p) => p.sunrise)).toEqual(["2026-09-15T04:59:00Z", "2026-09-16T05:01:00Z"]);
  });

  it("keeps the forecast when the sun times fail", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({}), sun: () => json({ error: true, reason: "down" }, 400) });
    const result = await download(api, { chain: D2_EU, quantities: ["temperature"] });
    expect(result.sunPhases).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith("Failed to fetch sun phases"))).toBe(true);
    expect(result.combined.some((p) => p.value !== null)).toBe(true);
  });
});

describe("downloadChain: time window (test_service.py)", () => {
  it("anchors past hours at yesterday 00:00 and slices at the forecast start", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const result = await download(api, {
      chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 10 },
        { name: "ICON-EU", max_forecast_horizon_hours: 30 },
      ],
      quantities: ["temperature"],
    });
    const calls = api.ofKind("forecast");
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => Number(c.params.past_hours))).toEqual([
      pastHoursForYesterday(NOW, TZ),
      pastHoursForYesterday(NOW, TZ),
    ]);
    // Fetched up to min(ICON-D2 capability, chain end) for dragged boundaries.
    expect(calls.map((c) => c.params.forecast_hours)).toEqual(["30", "30"]);
    expect(result.timeline.now).toBe(at(0));
    expect(result.combined[0]?.timestamp).toBe("2026-09-12T22:00:00Z");
    const past = result.combined.filter((p) => Date.parse(p.timestamp) < NOW_HOUR);
    expect(past.every((p) => p.model === "ICON-D2")).toBe(true);
    const future = result.combined.filter((p) => Date.parse(p.timestamp) >= NOW_HOUR);
    expect(future.slice(0, 10).every((p) => p.model === "ICON-D2")).toBe(true);
    expect(future[10]?.model).toBe("ICON-EU");
  });

  it("starts at the same instant for every time of the same day", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const chain = [
      { name: "ICON-D2", max_forecast_horizon_hours: 10 },
      { name: "ICON-EU", max_forecast_horizon_hours: 30 },
    ];
    // 00:05, 06:00, 12:00 and 23:59 CEST on Mon 2026-09-14.
    for (const now of ["2026-09-13T22:05:00Z", "2026-09-14T04:00:00Z", "2026-09-14T10:00:00Z", "2026-09-14T21:59:00Z"]) {
      const result = await download(api, { chain, quantities: ["temperature"], now });
      expect(result.timeline.start).toBe("2026-09-12T22:00:00Z");
      const tNow = Date.parse(result.timeline.now);
      const past = result.combined.filter((p) => Date.parse(p.timestamp) < tNow);
      expect(past.length).toBeGreaterThanOrEqual(24);
      expect(past.every((p) => p.model === "ICON-D2")).toBe(true);
      expect(result.combined.find((p) => p.timestamp === at(10, tNow))?.model).toBe("ICON-EU");
      expect(result.timeline.end).toBe(at(30, tNow));
    }
  });

  it("finds yesterday 00:00 across daylight saving changes", () => {
    // Mon 2026-03-30 12:00 CEST → Sun 2026-03-29 00:00 CET.
    expect(canonicalTimestamp(yesterdayMidnightUtc("2026-03-30T10:00:00Z", TZ))).toBe("2026-03-28T23:00:00Z");
    // Mon 2026-10-26 12:00 CET → Sun 2026-10-25 00:00 CEST.
    expect(canonicalTimestamp(yesterdayMidnightUtc("2026-10-26T11:00:00Z", TZ))).toBe("2026-10-24T22:00:00Z");
    expect(pastHoursForYesterday("2026-10-26T11:00:00Z", TZ)).toBe(37 + 2);
  });

  it("covers the 25-hour day before when the clocks went back", async () => {
    const now = Date.UTC(2026, 9, 26, 11, 0); // Mon 2026-10-26 12:00 CET
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, now);
        return hourlyAnswer(call.hourly, start, count, () => 5);
      },
    });
    const result = await download(api, {
      chain: [{ name: "ICON-EU", max_forecast_horizon_hours: 12 }],
      quantities: ["temperature"],
      now,
    });
    expect(result.timeline.start).toBe("2026-10-24T22:00:00Z");
    const past = result.combined.filter((p) => Date.parse(p.timestamp) < now);
    expect(past).toHaveLength(25 + 12);
    expect(past.every((p) => p.value === 5)).toBe(true);
    expect(result.combined).toHaveLength(25 + 12 + 12);
  });

  it("reads answers without offset as UTC", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        return hourlyAnswer(call.hourly, start, count, () => 15);
      },
    });
    const result = await download(api, {
      chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 12 }],
      quantities: ["temperature"],
    });
    expect(result.combined[0]?.value).toBe(15);
    expect(result.combined.every((p) => p.timestamp.endsWith("Z"))).toBe(true);
  });
});

describe("downloadChain: coverage diagnostics (test_service.py)", () => {
  it("reports a shortfall of one quantity in a 384-hour window", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        return hourlyAnswer(call.hourly, start, count, (v, i) =>
          v === "temperature_2m" ? (i < count - 10 ? 1 : null) : v === "precipitation_probability" ? 50 : 0,
        );
      },
    });
    const result = await download(api, {
      chain: [{ name: "GFS Seamless", max_forecast_horizon_hours: 384 }],
      quantities: ["temperature", "precipitation_probability"],
    });
    const call = api.ofKind("forecast")[0]!;
    expect(call.params).toMatchObject({ models: "ncep_gfs_seamless", forecast_hours: "384", timezone: "GMT" });
    expect(result.combined).toHaveLength((PAST + 384) * 2);
    const diagnostics = result.diagnostics["GFS Seamless"]!;
    const temperature = diagnostics.variables.temperature!;
    const probability = diagnostics.variables.precipitation_probability!;
    expect(diagnostics.expected_end_exclusive).toBe(result.timeline.end);
    expect(temperature).toMatchObject({ sample_count: 384, valid_sample_count: 374, complete: false });
    expect(temperature.last_valid_timestamp! < temperature.expected_last_timestamp!).toBe(true);
    expect(probability).toMatchObject({ sample_count: 384, valid_sample_count: 384, complete: true });
    expect(result.warnings.some((w) => w.startsWith("GFS Seamless / temperature: expected hourly data"))).toBe(true);
  });

  it("does not shift later values when a source hour is missing", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        const answer = hourlyAnswer(call.hourly, start, count, (_v, _i, t) => (t - START) / HOUR_MS);
        const hourly = answer.hourly as Record<string, unknown[]>;
        const missing = (hourly.time as string[]).indexOf(at(2).slice(0, 16));
        for (const key of Object.keys(hourly)) hourly[key]!.splice(missing, 1);
        return answer;
      },
    });
    const result = await download(api, {
      chain: [{ name: "ICON-EU", max_forecast_horizon_hours: 6 }],
      quantities: ["temperature"],
    });
    const byTime = new Map(result.combined.map((p) => [p.timestamp, p]));
    expect(byTime.get(at(2))?.value).toBeNull();
    expect(byTime.get(at(3))?.value).toBe(PAST + 3);
    const coverage = result.diagnostics["ICON-EU"]!.variables.temperature!;
    expect(coverage.complete).toBe(false);
    expect(coverage.spacing_anomalies).toEqual([
      { after_timestamp: at(1), before_timestamp: at(3), actual_seconds: 7200, expected_seconds: 3600 },
    ]);
  });
});

describe("downloadChain: quantities per model (test_service.py)", () => {
  it("requests the whole hourly fetch set once per model, optional catalogued quantities only where listed", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    await download(api, { chain: D2_EU }, {}, GATED_DATA);
    const registered = new Set(hourlyFetchSet(gatedRegistry).map((q) => openMeteoName(q, gatedRegistry)));
    expect(registered.has(GATED)).toBe(true);
    const calls = api.ofKind("forecast");
    expect(calls.filter((c) => c.model === "icon_d2").map((c) => new Set(c.hourly))).toEqual([registered]);
    const withoutGated = new Set([...registered].filter((v) => v !== GATED));
    expect(calls.filter((c) => c.model === "icon_eu").map((c) => new Set(c.hourly))).toEqual([withoutGated]);
  });

  it("stitches an optional catalogued quantity with its unit; where it is absent it stays null without warning", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const result = await download(api, { chain: D2_EU }, {}, GATED_DATA);
    const points = result.combined.filter((point) => point.variable === GATED);
    expect(points).toHaveLength(PAST + 24);
    for (const point of points) {
      const expected = hoursOf(point.timestamp) < 10 ? "ICON-D2" : "ICON-EU";
      expect(point.model).toBe(expected);
      expect(point.unit).toBe("J/kg");
      if (expected === "ICON-EU") expect(point.value).toBeNull();
    }
    expect(result.warnings.some((w) => w.includes(GATED))).toBe(false);
    const raw = result.raw.find((r) => r.variable === GATED)!;
    const harmonized = result.byModel["ICON-D2"]!.filter((p) => p.variable === GATED).at(-1)!;
    expect(harmonized.value).toBe(raw.values[raw.timestamps.indexOf(harmonized.timestamp)]);
  });

  it("asks no model for CAPE, CIN or LPI (REQ-453)", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    await download(api, { chain: D2_EU });
    for (const call of api.ofKind("forecast")) {
      for (const name of ["cape", "convective_inhibition", "lightning_potential"]) {
        expect(call.hourly).not.toContain(name);
      }
    }
  });

  it("requests weather codes; missing codes are silent nulls", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const answer = perModel({})!(call) as { hourly: Record<string, unknown[]>; hourly_units: Record<string, string> };
        if (call.model === "icon_d2") answer.hourly.weather_code = answer.hourly.time!.map(() => 95);
        else {
          delete answer.hourly.weather_code;
          delete answer.hourly_units.weather_code;
        }
        return answer;
      },
    });
    const result = await download(api, { chain: D2_EU });
    expect(api.ofKind("forecast").every((c) => c.hourly.includes("weather_code"))).toBe(true);
    const codes = result.combined.filter((p) => p.variable === "weather_code");
    expect(codes.length).toBeGreaterThan(0);
    for (const point of codes) {
      if (hoursOf(point.timestamp) < 10) expect(point).toMatchObject({ model: "ICON-D2", value: 95 });
      else expect(point).toMatchObject({ model: "ICON-EU", value: null });
    }
    expect(result.warnings.some((w) => w.includes("weather_code"))).toBe(false);
  });
});

describe("downloadChain: transport (DL spec)", () => {
  it("retries a 5xx answer", async () => {
    let failures = 1;
    const api = fakeOpenMeteo({
      forecast: (call) => {
        if (call.model === "icon_d2" && failures-- > 0) return json({ error: true, reason: "busy" }, 503);
        return perModel({ icon_d2: 10, icon_eu: 20 })!(call);
      },
    });
    const result = await download(api, { chain: D2_EU, quantities: ["temperature"] });
    expect(api.ofKind("forecast").filter((c) => c.model === "icon_d2")).toHaveLength(2);
    expect(result.errors).toEqual({});
    expect(result.combined.find((p) => p.timestamp === at(0))?.value).toBe(10 + PAST);
  });

  it("reads an unquoted nan as null", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        const answer = hourlyAnswer(call.hourly, start, count, (_v, i) => (i % 2 ? 1 : -999));
        return JSON.stringify(answer).replace(/-999/g, "nan");
      },
    });
    const result = await download(api, {
      chain: [{ name: "ICON-EU", max_forecast_horizon_hours: 6 }],
      quantities: ["temperature"],
    });
    const values = result.byModel["ICON-EU"]!.map((p) => p.value);
    expect(values).toContain(null);
    expect(values).toContain(1);
    expect(values.every((v) => v === null || v === 1)).toBe(true);
  });

  it("serves a repeated request within the hour from the cache; refresh fetches again", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const shared = createClient({ fetch: api.fetch, retryBackoffMs: 0 });
    const request = { location: BERLIN, chain: D2_EU, quantities: ["temperature"], now: NOW, timezone: TZ, cloudChain: [] };
    const first = await downloadChain(shared, request, { catalogue, registry });
    const calls = api.calls.length;
    expect(await downloadChain(shared, { ...request, now: NOW + 20 * 60_000 }, { catalogue, registry })).toBe(first);
    expect(api.calls).toHaveLength(calls);
    const refreshed = await downloadChain(shared, { ...request, refresh: true }, { catalogue, registry });
    expect(refreshed).not.toBe(first);
    expect(api.calls).toHaveLength(2 * calls);
    // Another hour is another timeline: no cache hit.
    await downloadChain(shared, { ...request, now: NOW + HOUR_MS }, { catalogue, registry });
    expect(api.calls).toHaveLength(3 * calls);
  });

  it("stops with the abort reason, not as a model failure", async () => {
    const controller = new AbortController();
    const api = fakeOpenMeteo({
      forecast: () => {
        controller.abort(new DOMException("stop", "AbortError"));
        return new Promise(() => {});
      },
    });
    const error = await download(api, { chain: D2_EU, quantities: ["temperature"], signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });
});

describe("downloadChain: hand-over (test_forecast_archive_and_handover.py)", () => {
  const RUN_END_CHAIN = [
    { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 10 },
    { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 20 },
  ];

  it("fetches up to the catalogue capability, never past the chain end", () => {
    const iconD2 = { name: "ICON-D2", id: "icon_d2", max_forecast_horizon_hours: 24 };
    expect(getFetchHorizon(iconD2, 120, catalogue)).toBe(48);
    expect(getFetchHorizon(iconD2, 30, catalogue)).toBe(30);
    expect(getFetchHorizon({ name: "Unknown Model", max_forecast_horizon_hours: 72 }, 120, catalogue)).toBe(72);
  });

  it("never fills a later slice from an earlier model", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 0, icon_eu: 500 }, { icon_eu: [15] }) });
    const result = await download(api, {
      chain: [
        { name: "ICON-D2", id: "icon_d2", max_forecast_horizon_hours: 10 },
        { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 24 },
      ],
      quantities: ["temperature"],
    });
    const point = result.combined.find((p) => p.timestamp === at(15))!;
    expect(point).toMatchObject({ value: null, model: "ICON-EU" });
    // ICON-D2's own series still reaches into the dragged range.
    expect(result.byModel["ICON-D2"]!.some((p) => p.timestamp === at(15) && p.value !== null)).toBe(true);
  });

  it("does not fill missing hours inside a slice from other models", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({}, { icon_eu: [3] }) });
    const result = await download(api, { chain: RUN_END_CHAIN, quantities: ["temperature"] });
    expect(result.combined.find((p) => p.timestamp === at(3))).toMatchObject({ model: "ICON-EU", value: null });
  });

  /** ICON-EU's latest run ends 3 h before its configured 10 h (null values from +7 h). */
  function runEndForecast(keep: (variable: string) => boolean = () => false): FakeHandlers["forecast"] {
    return (call) => {
      const answer = perModel({})!(call) as { hourly: Record<string, unknown[]> };
      if (call.model !== "icon_eu") return answer;
      const times = answer.hourly.time as string[];
      for (const [key, values] of Object.entries(answer.hourly)) {
        if (key === "time" || keep(key)) continue;
        answer.hourly[key] = values.map((v, i) => (Date.parse(`${times[i]}Z`) >= NOW_HOUR + 7 * HOUR_MS ? null : v));
      }
      return answer;
    };
  }

  it("truncates a slice to the hours the latest run delivers", async () => {
    const api = fakeOpenMeteo({
      forecast: runEndForecast(),
      // 2026-10-06T09:00Z init, available 11:58:41Z
      meta: { dwd_icon_eu: { last_run_initialisation_time: 1791277200, last_run_availability_time: 1791287921 } },
    });
    const result = await download(api, { chain: RUN_END_CHAIN, quantities: ["temperature"] });
    expect(result.availability["ICON-EU"]).toMatchObject({
      model: "ICON-EU",
      model_id: "icon_eu",
      chain: "main",
      available_hours: 7,
      valid_until: at(7),
      last_run_init_time: "2026-10-06T09:00:00Z",
      last_run_availability_time: "2026-10-06T11:58:41Z",
    });
    // ECMWF delivers its whole fetched window: no cap.
    expect(result.availability["ECMWF IFS"]?.available_hours).toBeNull();
    const byTime = new Map(result.combined.map((p) => [p.timestamp, p]));
    for (let h = 0; h < 7; h += 1) expect(byTime.get(at(h))).toMatchObject({ model: "ICON-EU", value: expect.any(Number) });
    for (let h = 7; h < 20; h += 1) expect(byTime.get(at(h))?.model).toBe("ECMWF IFS");
    expect(result.chain.map((m) => [m.model, m.sliceEndHours])).toEqual([
      ["ICON-EU", 7],
      ["ECMWF IFS", 20],
    ]);
    expect(api.ofKind("meta").map((c) => c.model).sort()).toEqual([
      "dwd_icon_eu",
      "dwd_icon_eu_eps_native",
      "ecmwf_ifs",
      "ecmwf_ifs025_ensemble",
    ]);
  });

  it("does not let the ensemble probability extend the main run", async () => {
    const api = fakeOpenMeteo({ forecast: runEndForecast((v) => v === "precipitation_probability") });
    const result = await download(api, {
      chain: RUN_END_CHAIN,
      quantities: ["temperature", "precipitation_probability"],
    });
    expect(result.availability["ICON-EU"]?.available_hours).toBe(7);
    const after = result.combined.find((p) => p.timestamp === at(7) && p.variable === "temperature")!;
    expect(after.model).toBe("ECMWF IFS");
    expect(after.value).not.toBeNull();
  });
});

describe("downloadChain: auto chain", () => {
  const ZUGSPITZE = { name: "Zugspitze", latitude: 47.421, longitude: 10.985 };
  const cloudAnswer: FakeHandlers["cloud"] = (call) => {
    const { start, count } = windowStart(call, NOW_HOUR);
    return hourlyAnswer(call.hourly, start, count, (v) => (v.startsWith("cloud_cover") ? 40 : 1500));
  };

  it("resolves the chains from the location and drops models without data", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) =>
        call.model === "icon_d2"
          ? json({ error: true, reason: "No data is available for this location" }, 400)
          : perModel({ icon_eu: 20, ecmwf_ifs: 30 })!(call),
      cloud: cloudAnswer,
    });
    const result = await download(api, {
      location: ZUGSPITZE,
      auto: true,
      cloudChain: undefined,
      quantities: ["temperature"],
    });
    expect(api.ofKind("forecast").map((c) => c.model).sort()).toEqual(["ecmwf_ifs", "icon_d2", "icon_eu"]);
    expect(api.ofKind("cloud").map((c) => c.model).sort()).toEqual(["ecmwf_ifs025", "icon_d2", "icon_eu"]);
    expect(result.autoChain).toMatchObject({
      region_id: "northern_alps",
      resolution_reason: "region",
      dropped_models: ["ICON-D2"],
      dropped_cloud_models: [],
    });
    expect(result.autoChain?.main_model_chain.map((m) => m.id)).toEqual(["icon_eu", "ecmwf_ifs"]);
    expect(result.autoChain?.cloud_model_chain.map((m) => m.id)).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs025"]);
    // ICON-EU takes over ICON-D2's hours, past hours included.
    expect(result.chain.map((m) => [m.id, m.sliceEndHours])).toEqual([
      ["icon_eu", 120],
      ["ecmwf_ifs", 360],
    ]);
    expect(result.combined[0]?.model).toBe("ICON-EU");
    expect(result.timeline.end).toBe(at(360));
    expect(result.cloud?.profiles[0]?.source_model_id).toBe("icon_d2");
    expect(result.cloudChain.map((m) => m.id)).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs025"]);
    expect(result.cloudTransitions.map((t) => [t.from_model, t.to_model, t.timestamp])).toEqual([
      ["icon_d2", "icon_eu", at(48)],
      ["icon_eu", "ecmwf_ifs025", at(120)],
    ]);
  });

  it("needs the domains and regions", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({}) });
    await expect(
      downloadChain(client(api), { location: ZUGSPITZE, auto: true, now: NOW }, { catalogue, registry }),
    ).rejects.toThrow(/domains/);
  });
});

// REQ-767: a main chain model without current data gives its slice to a fine model with current data at the place.
describe("downloadChain: replacement of a model without current data (REQ-767)", () => {
  const SOELDEN = { name: "Sölden", latitude: 46.9655, longitude: 11.0076 };
  const resolver = createResolver(resolverData);

  it("prefers the region's cloud chain, then the finest models covering the place", () => {
    const austria = resolver.resolve(SOELDEN.latitude, SOELDEN.longitude);
    const chainIds = austria.main_chain_ids;
    const ids = replacementCandidates("geosphere_claef_austria", chainIds, austria, resolver, catalogue, SOELDEN);
    // ICON-D2 from Austria's cloud chain first, then the finest models, finest first.
    expect(ids[0]).toBe("icon_d2");
    expect(ids.slice(1, 4)).toEqual(["meteoswiss_icon_ch1", "meteofrance_arome_france", "meteofrance_arome_france_hd"]);
    const km = ids.slice(1).map((id) => findCatalogueModel(id, catalogue)!.spatial_resolution_km as number);
    expect(km).toEqual([...km].sort((a, b) => a - b));
    // Never a model of the chain, the discontinued AROME Austria, a blend or a coarse model.
    for (const id of [...chainIds, "geosphere_arome_austria", "geosphere_seamless", "best_match", "ecmwf_ifs025"]) {
      expect(ids).not.toContain(id);
    }
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("takes the finest model when the cloud chain has none fine enough", () => {
    const ids = replacementCandidates(
      "geosphere_claef_austria",
      ["geosphere_claef_austria", "icon_eu", "ecmwf_ifs"],
      { cloud_chain_ids: ["icon_eu", "ecmwf_ifs025"] },
      resolver,
      catalogue,
      SOELDEN,
    );
    expect(ids[0]).toBe("meteoswiss_icon_ch1");
    expect(ids).toContain("icon_d2");
  });

  it("takes a cloud chain model first only up to 2.5 km coarser than the failed model", () => {
    const first = (failed: string, cloud: string[]) =>
      replacementCandidates(failed, [failed], { cloud_chain_ids: cloud }, resolver, catalogue, SOELDEN)[0];
    // ICON-D2 (2.2 km) for ICON-CH1 (1.1 km); ICON-EU (7 km) is too coarse for ICON-D2: the finest model comes first
    // (C-LAEF, 1 km), ICON-EU later.
    expect(first("meteoswiss_icon_ch1", ["icon_d2"])).toBe("icon_d2");
    expect(first("icon_d2", ["icon_eu"])).toBe("geosphere_claef_austria");
    const coarse = { cloud_chain_ids: ["icon_eu"] };
    const ids = replacementCandidates("icon_d2", ["icon_d2"], coarse, resolver, catalogue, SOELDEN);
    expect(ids.indexOf("icon_eu")).toBeGreaterThan(ids.indexOf("meteoswiss_icon_ch2"));
  });

  /** Data from the timeline start until `hours` after now (negative: before now); `null` hours have no value. */
  const until = (hours: number | null) => (call: Call) => {
    const { start, count } = windowStart(call, NOW_HOUR);
    return hourlyAnswer(call.hourly, start, count, (_v, i, t) =>
      hours === null || t >= NOW_HOUR + hours * HOUR_MS ? null : 5 + (i % 10),
    );
  };

  it("replaces the first model of Austria's chain by ICON-D2 up to ICON-D2's own data end", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        if (call.model === "geosphere_claef_austria") return until(-30)(call); // ended a day ago
        if (call.model === "icon_d2") return until(20)(call);
        return perModel({ icon_eu: 20, ecmwf_ifs: 30 })!(call);
      },
    });
    const result = await download(api, { location: SOELDEN, auto: true, quantities: ["temperature"] });
    expect(result.autoChain?.region_id).toBe("austria");
    expect(result.autoChain?.main_model_chain.map((m) => m.id)).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs"]);
    expect(result.autoChain?.replaced_models).toEqual([{ model: "GeoSphere C-LAEF Austria", replacement: "ICON-D2" }]);
    expect(result.autoChain?.dropped_models).toEqual([]);
    // ICON-D2 is fetched like a chain model, after the chain.
    expect(api.ofKind("forecast").map((c) => c.model)).toEqual([
      "geosphere_claef_austria",
      "icon_eu",
      "ecmwf_ifs",
      "icon_d2",
    ]);
    expect(result.chain.map((m) => [m.id, m.sliceEndHours])).toEqual([
      ["icon_d2", 20],
      ["icon_eu", 120],
      ["ecmwf_ifs", 360],
    ]);
    expect(result.chain[0]?.replaces).toEqual({
      model: "GeoSphere C-LAEF Austria",
      id: "geosphere_claef_austria",
      shortName: "C-LAEF",
    });
    expect(result.chain[1]?.replaces).toBeUndefined();
    // The chart is complete: ICON-D2 from the timeline start, ICON-EU from its data end on, no gap.
    expect(result.combined.every((p) => p.value !== null)).toBe(true);
    expect(result.combined[0]?.model).toBe("ICON-D2");
    expect(result.combined.find((p) => p.timestamp === at(19))?.model).toBe("ICON-D2");
    expect(result.combined.find((p) => p.timestamp === at(20))?.model).toBe("ICON-EU");
    expect(result.byModel["GeoSphere C-LAEF Austria"]).toBeUndefined();
    expect(result.warnings).toContain(
      "Model 'GeoSphere C-LAEF Austria' delivers no current data; replaced by 'ICON-D2'",
    );
  });

  it("tries the next candidate when one has no current data either", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        if (call.model === "geosphere_claef_austria" || call.model === "icon_d2") return until(null)(call);
        if (call.model === "meteoswiss_icon_ch1") return until(30)(call);
        return perModel({ icon_eu: 20, ecmwf_ifs: 30 })!(call);
      },
    });
    const result = await download(api, { location: SOELDEN, auto: true, quantities: ["temperature"] });
    expect(api.ofKind("forecast").map((c) => c.model).slice(3)).toEqual(["icon_d2", "meteoswiss_icon_ch1"]);
    expect(result.chain[0]).toMatchObject({ id: "meteoswiss_icon_ch1", sliceEndHours: 30 });
    expect(result.chain[0]?.replaces?.id).toBe("geosphere_claef_austria");
  });

  it("replaces in a chain set by hand as well", async () => {
    const api = fakeOpenMeteo({
      forecast: (call) => (call.model === "geosphere_claef_austria" ? until(0)(call) : until(40)(call)),
    });
    const result = await download(api, {
      location: SOELDEN,
      chain: [
        { id: "geosphere_claef_austria", max_forecast_horizon_hours: 30 },
        { id: "icon_eu", max_forecast_horizon_hours: 40 },
      ],
      quantities: ["temperature"],
    });
    expect(result.chain.map((m) => [m.id, m.sliceEndHours, m.replaces?.id])).toEqual([
      ["icon_d2", 30, "geosphere_claef_austria"],
      ["icon_eu", 40, undefined],
    ]);
  });

  it("replaces nothing when the model failed, no model has current data or the domains are missing", async () => {
    const chain = [
      { id: "geosphere_claef_austria", max_forecast_horizon_hours: 30 },
      { id: "icon_eu", max_forecast_horizon_hours: 40 },
    ];
    const failing = fakeOpenMeteo({
      forecast: (call) =>
        call.model === "geosphere_claef_austria" ? json({ error: true, reason: "Server error" }, 400) : until(40)(call),
    });
    const failed = await download(failing, { location: SOELDEN, chain, quantities: ["temperature"] });
    expect(failed.chain.map((m) => m.id)).toEqual(["geosphere_claef_austria", "icon_eu"]);
    expect(failing.ofKind("forecast")).toHaveLength(2);

    const stale = fakeOpenMeteo({ forecast: until(-5) });
    const none = await download(stale, { location: SOELDEN, chain, quantities: ["temperature"] });
    expect(none.chain.map((m) => m.id)).toEqual(["geosphere_claef_austria", "icon_eu"]);
    expect(stale.ofKind("forecast")).toHaveLength(2);

    const withoutDomains = fakeOpenMeteo({
      forecast: (call) => (call.model === "geosphere_claef_austria" ? until(0)(call) : until(40)(call)),
    });
    const manual = await downloadChain(
      client(withoutDomains),
      { location: SOELDEN, now: NOW, timezone: TZ, cloudChain: [], chain, quantities: ["temperature"] },
      { catalogue, registry },
    );
    expect(manual.chain.map((m) => m.id)).toEqual(["icon_eu"]);
    expect(withoutDomains.ofKind("forecast")).toHaveLength(2);
  });
});

describe("downloadChain: adapters", () => {
  it("gives the snake-case response of the former backend and the meteogram input", async () => {
    const api = fakeOpenMeteo({ forecast: perModel({ icon_d2: 10, icon_eu: 20 }) });
    const result = await download(api, { chain: D2_EU, quantities: ["temperature"] });
    const response = toHarmonizedResponse(result);
    expect(response).toMatchObject({
      combined_forecast: result.combined,
      model_forecasts: result.byModel,
      forecast_start_time: at(0),
      timeline_start: at(0, START),
      timeline_end: at(24),
      user_timezone: TZ,
      vertical_cloud_forecast: null,
      auto_chain: null,
    });
    const input = toMeteogramInput(result);
    expect(input.series).toBe(result.combined);
    expect(input.chain).toEqual([
      expect.objectContaining({ model: "ICON-D2", id: "icon_d2", sliceEndHours: 10 }),
      expect.objectContaining({ model: "ICON-EU", id: "icon_eu", sliceEndHours: 24 }),
    ]);
    expect(input.timeline).toEqual({ start: at(0, START), now: at(0), end: at(24) });
  });
});
