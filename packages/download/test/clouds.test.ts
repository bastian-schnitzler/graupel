// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Vertical cloud profiles and the cloud chain. Coverage comes from the generated model domains (model_domains.json). No network: Open-Meteo is a fake behind an injected fetch.
import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  canonicalTimestamp,
  createClient,
  createResolver,
  downloadChain,
  estimateAltitudeMAsl,
  catalogueModels,
  fetchCloudModelForecast,
  findCatalogueModel,
  isCloudCompatibleModel,
  mergeVerticalCloudSegments,
  type DetailedCloudForecast,
  type DownloadChainRequest,
  type ForecastResult,
  type WeatherModel,
} from "../src/index";
import { fakeOpenMeteo, hourlyAnswer, windowStart, type FakeApi, type FakeHandlers } from "./fakeOpenMeteo";
import { catalogue, registry, resolverData } from "./modelData";

const NOW = Date.UTC(2026, 9, 6, 12, 20);
const NOW_HOUR = Date.UTC(2026, 9, 6, 12);
const at = (hours: number) => canonicalTimestamp(NOW_HOUR + hours * HOUR_MS);
const LEVELS = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400];
const ZURICH = { name: "Zurich", latitude: 47.376, longitude: 8.541 };

function client(api: FakeApi) {
  return createClient({ fetch: api.fetch, retryBackoffMs: 0, cache: null });
}

function cloudModel(name: string, id: string, horizon: number): WeatherModel {
  return { name, id, max_forecast_horizon_hours: horizon, pressure_levels_hpa: LEVELS };
}

const level850 = (profile: { levels: { pressure_hpa: number; cloud_cover_percent?: number | null }[] }) =>
  profile.levels.find((l) => l.pressure_hpa === 850);

describe("catalogue (test_open_meteo.py)", () => {
  it("contains ICON-D2 by name with its id", () => {
    expect(catalogueModels(catalogue).length).toBeGreaterThan(0);
    expect(findCatalogueModel("ICON-D2", catalogue)?.id).toBe("icon_d2");
  });

  it("admits cloud models by their number of pressure levels", () => {
    const model = (id: string) => findCatalogueModel(id, catalogue)!;
    // The default cloud model, ECMWF IFS 0.25°, qualifies.
    expect(model("ecmwf_ifs025").name).toContain("IFS 0.25");
    for (const id of ["ecmwf_ifs025", "icon_d2", "meteofrance_arome_france"]) {
      expect(model(id).pressure_levels_hpa!.length).toBeGreaterThanOrEqual(10);
      expect(isCloudCompatibleModel(model(id))).toBe(true);
    }
    // ItaliaMeteo ICON-2i has only 6 levels; ICON-CH1 and IFS HRES have none.
    expect(model("italia_meteo_arpae_icon_2i").pressure_levels_hpa).toHaveLength(6);
    for (const id of ["italia_meteo_arpae_icon_2i", "meteoswiss_icon_ch1", "ecmwf_ifs"]) {
      expect(isCloudCompatibleModel(model(id))).toBe(false);
    }
  });
});

describe("cloud models (test_vertical_clouds.py)", () => {
  it("checks coverage against the model domains", () => {
    const resolver = createResolver(resolverData);
    const berlin = [52.52, 13.405] as const;
    const newYork = [40.712, -74.006] as const;
    expect(resolver.domainContains("meteoswiss_icon_ch1", ZURICH.latitude, ZURICH.longitude)).toBe(true);
    expect(resolver.domainContains("meteoswiss_icon_ch1", ...berlin)).toBe(false);
    expect(resolver.domainContains("icon_eu", ZURICH.latitude, ZURICH.longitude)).toBe(true);
    expect(resolver.domainContains("icon_eu", ...berlin)).toBe(true);
    expect(resolver.domainContains("icon_eu", ...newYork)).toBe(false);
    expect(resolver.domainContains("ncep_gfs_seamless", ...newYork)).toBe(true);
    expect(resolver.domainContains("unknown_model", ...berlin)).toBeNull();
  });

  it("estimates the altitude of a pressure level", () => {
    expect(estimateAltitudeMAsl(1000)).toBeGreaterThanOrEqual(50);
    expect(estimateAltitudeMAsl(1000)).toBeLessThanOrEqual(200);
    expect(estimateAltitudeMAsl(500)).toBeGreaterThanOrEqual(5000);
    expect(estimateAltitudeMAsl(500)).toBeLessThanOrEqual(6000);
  });

  it("fetches live on every call, with levels sorted by altitude", async () => {
    let cover = 80;
    const api = fakeOpenMeteo({
      cloud: () => ({
        timezone: "GMT",
        hourly: {
          time: ["2026-09-11T00:00"],
          cloud_cover_850hPa: [cover],
          geopotential_height_850hPa: [1450],
        },
      }),
    });
    const location = { name: "Zugspitze", latitude: 47.4211, longitude: 10.9853 };
    const model = cloudModel("ICON-EU", "icon_eu", 6);
    const first = await fetchCloudModelForecast(client(api), { location, model }, { catalogue, registry });
    cover = 20;
    const second = await fetchCloudModelForecast(client(api), { location, model }, { catalogue, registry });
    expect(api.ofKind("cloud")).toHaveLength(2);
    expect(level850(first.profiles[0]!)?.cloud_cover_percent).toBe(80);
    expect(level850(second.profiles[0]!)?.cloud_cover_percent).toBe(20);
    expect(api.ofKind("cloud")[0]!.hourly).toEqual(LEVELS.flatMap((p) => [`cloud_cover_${p}hPa`, `geopotential_height_${p}hPa`]));
    // Levels without a height get the barometric estimate.
    const levels = first.profiles[0]!.levels;
    expect(levels.find((l) => l.pressure_hpa === 500)?.altitude_m_asl).toBe(estimateAltitudeMAsl(500));
    const altitudes = levels.map((l) => l.altitude_m_asl as number);
    expect(altitudes).toEqual([...altitudes].sort((a, b) => a - b));
    expect(first.profiles[0]).toMatchObject({ timestamp: "2026-09-11T00:00:00Z", source_model_id: "icon_eu" });
  });

  it("switches the source model along the cloud chain", async () => {
    const series: Record<string, Record<string, number>> = {
      meteoswiss_icon_ch1: { "2026-09-11T00:00": 50, "2026-09-11T01:00": 60 },
      // Requests use the prefixed Open-Meteo id for GFS.
      ncep_gfs_seamless: { "2026-09-11T03:00": 30 },
    };
    const api = fakeOpenMeteo({
      cloud: (call) => {
        const values = series[call.model] ?? {};
        const times = Object.keys(values);
        return {
          timezone: "GMT",
          hourly: {
            time: times,
            cloud_cover_850hPa: times.map((t) => values[t]),
            geopotential_height_850hPa: times.map(() => 1450),
          },
        };
      },
    });
    const chain = [cloudModel("ICON-CH1", "meteoswiss_icon_ch1", 2), cloudModel("GFS Seamless", "gfs_seamless", 10)];
    const forecasts: Record<string, DetailedCloudForecast> = {};
    for (const model of chain) {
      forecasts[model.name] = await fetchCloudModelForecast(client(api), { location: ZURICH, model }, { catalogue, registry });
    }
    expect(api.ofKind("cloud").map((c) => c.model)).toEqual(["meteoswiss_icon_ch1", "ncep_gfs_seamless"]);
    const timestamps = ["2026-09-11T00:00:00Z", "2026-09-11T01:00:00Z", "2026-09-11T03:00:00Z"];
    const { verticalCloudForecast, verticalCloudTransitions } = mergeVerticalCloudSegments(
      chain,
      forecasts,
      timestamps,
      undefined,
      ZURICH,
    );
    expect(verticalCloudForecast?.profiles.map((p) => p.source_model_id)).toEqual([
      "meteoswiss_icon_ch1",
      "meteoswiss_icon_ch1",
      "gfs_seamless",
    ]);
    expect(verticalCloudTransitions).toEqual([
      { timestamp: "2026-09-11T03:00:00Z", from_model: "meteoswiss_icon_ch1", to_model: "gfs_seamless" },
    ]);
  });
});

describe("downloadChain: cloud chain (test_forecast_archive_and_handover.py, test_service.py)", () => {
  const MAIN = [{ name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 12 }];
  const mainForecast: FakeHandlers["forecast"] = (call) => {
    const { start, count } = windowStart(call, NOW_HOUR);
    return hourlyAnswer(call.hourly, start, count, (_v, i) => i);
  };

  function download(api: FakeApi, request: Partial<DownloadChainRequest>): Promise<ForecastResult> {
    return downloadChain(
      client(api),
      {
        location: { name: "Test", latitude: 47, longitude: 11 },
        now: NOW,
        timezone: "UTC",
        chain: MAIN,
        quantities: ["temperature"],
        ...request,
      },
      { catalogue, registry },
    );
  }

  it("makes no cloud request for an empty cloud chain", async () => {
    const api = fakeOpenMeteo({ forecast: mainForecast });
    const result = await download(api, { cloudChain: [] });
    expect(result.cloud).toBeNull();
    expect(result.cloudTransitions).toEqual([]);
    expect(result.cloudChain).toEqual([]);
    expect(api.ofKind("cloud")).toEqual([]);
  });

  it("bounds a longer cloud chain to the main timeline; ECMWF IFS 0.25° by default", async () => {
    const api = fakeOpenMeteo({
      forecast: mainForecast,
      cloud: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        return hourlyAnswer(call.hourly, start, count, (v) => (v.startsWith("cloud") ? 30 : 1000));
      },
    });
    const explicit = await download(api, {
      cloudChain: [{ name: "ECMWF IFS 0.25°", id: "ecmwf_ifs025", max_forecast_horizon_hours: 345 }],
    });
    expect(explicit.cloud!.profiles.length).toBeLessThanOrEqual(explicit.combined.length);
    expect(explicit.cloud!.profiles.at(-1)?.timestamp).toBe(at(11));
    expect(Object.keys(explicit.cloudByModel)).toEqual(["ECMWF IFS 0.25°"]);

    const fallback = await download(api, {});
    expect(fallback.cloudChain.map((m) => [m.id, m.sliceEndHours])).toEqual([["ecmwf_ifs025", 12]]);
    // Fetched only as far as the main chain reaches.
    expect(api.ofKind("cloud").at(-1)?.params.forecast_hours).toBe("12");
    // The catalogue's 14 levels of ECMWF IFS 0.25°.
    expect(api.ofKind("cloud").at(-1)?.hourly).toHaveLength(28);
  });

  it("drops only the profiles of a failing cloud model", async () => {
    const api = fakeOpenMeteo({
      forecast: mainForecast,
      cloud: (call) => {
        if (call.model === "icon_d2") {
          // Non-monotonic timestamps fail the timeline validation.
          return { hourly: { time: ["2026-10-06T01:00", "2026-10-06T00:00"] } };
        }
        const { start, count } = windowStart(call, NOW_HOUR);
        return hourlyAnswer(call.hourly, start, count, () => 50);
      },
    });
    const result = await download(api, {
      chain: [{ name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 24 }],
      cloudChain: [cloudModel("ICON-D2", "icon_d2", 6), cloudModel("ICON-EU", "icon_eu", 24)],
    });
    expect(result.cloud).not.toBeNull();
    expect(result.cloudByModel["ICON-D2"]?.profiles).toEqual([]);
    expect(result.cloudByModel["ICON-EU"]!.profiles.length).toBeGreaterThan(0);
    expect(new Set(result.cloud!.profiles.map((p) => p.source_model_name))).toEqual(new Set(["ICON-EU"]));
    expect(result.warnings.some((w) => w.startsWith("Failed to fetch vertical clouds for model 'ICON-D2'"))).toBe(true);
  });

  it("hands the cloud chain over where a run ends before its horizon", async () => {
    const runEnd = 5;
    const api = fakeOpenMeteo({
      forecast: mainForecast,
      cloud: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        // ICON-EU's run ends 3 h before its 8 h boundary (null rows, like Open-Meteo).
        return hourlyAnswer(call.hourly, start, count, (_v, _i, t) =>
          call.model === "icon_eu" && t >= NOW_HOUR + runEnd * HOUR_MS ? null : 40,
        );
      },
    });
    const result = await download(api, {
      cloudChain: [cloudModel("ICON-EU", "icon_eu", 8), cloudModel("ECMWF IFS 0.25°", "ecmwf_ifs025", 12)],
    });
    const source = new Map(result.cloud!.profiles.map((p) => [p.timestamp, p.source_model_name]));
    expect(source.get(at(runEnd - 1))).toBe("ICON-EU");
    for (let h = runEnd; h < 12; h += 1) expect(source.get(at(h))).toBe("ECMWF IFS 0.25°");
    expect(result.cloudTransitions).toEqual([{ timestamp: at(runEnd), from_model: "icon_eu", to_model: "ecmwf_ifs025" }]);
    expect(result.cloudAvailability["ICON-EU"]).toMatchObject({ chain: "cloud", available_hours: runEnd });
    expect(result.cloudChain.map((m) => [m.model, m.sliceEndHours])).toEqual([
      ["ICON-EU", runEnd],
      ["ECMWF IFS 0.25°", 12],
    ]);
  });
});
