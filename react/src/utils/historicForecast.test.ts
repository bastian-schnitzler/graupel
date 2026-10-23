import { describe, it, expect } from "vitest";
import {
  buildHistoricConfig,
  findMissingQuantities,
  formatArchivedChain,
  formatConfigVersion,
  formatHistoricBadge,
} from "./historicForecast";
import type { ArchivedFetchSummary, HarmonizedForecastResponse } from "../types";

const fetch: ArchivedFetchSummary = {
  id: 7,
  fetched_at: "2026-10-21T06:00:00Z",
  latitude: 47.26,
  longitude: 11.39,
  location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39 },
  mode: "power",
  region_id: null,
  chain: {
    main: [
      { name: "ICON-D2", short_name: "D2", max_forecast_horizon_hours: 48 },
      { name: "ECMWF IFS", max_forecast_horizon_hours: 240 },
    ],
    cloud: [{ name: "ECMWF IFS", max_forecast_horizon_hours: 240 }],
  },
  layout_id: null,
  config_id: "alpen",
  config_version_id: 3,
  config_version: {
    version_id: 3,
    name: "Alpen",
    valid_from: "2026-10-18T10:00:00Z",
    valid_to: null,
  },
};

describe("historic forecast labels", () => {
  it("formats badge, chain and configuration version", () => {
    expect(formatHistoricBadge(fetch.fetched_at, "Europe/Berlin")).toBe(
      "historic: fetched 21.10. 08:00",
    );
    expect(formatArchivedChain(fetch)).toBe("D2 → ECMWF IFS");
    expect(formatConfigVersion(fetch.config_version, "Europe/Berlin")).toBe(
      "Alpen · 18.10. 12:00 – now",
    );
    expect(
      formatConfigVersion(
        { ...fetch.config_version!, valid_to: "2026-10-20T10:00:00Z" },
        "Europe/Berlin",
      ),
    ).toBe("Alpen · 18.10. 12:00 – 20.10. 12:00");
    expect(formatConfigVersion(null)).toBeNull();
  });

  it("builds a configuration from the fetch's own chains", () => {
    const config = buildHistoricConfig(fetch);
    expect(config.id).toBe("historic-7");
    expect(config.name).toBe("Alpen");
    expect(config.model_chain.map((m) => m.name)).toEqual([
      "ICON-D2",
      "ECMWF IFS",
    ]);
    expect(config.cloud_model_chain).toHaveLength(1);
    expect(config.location.name).toBe("Innsbruck");
  });
});

describe("findMissingQuantities", () => {
  const point = (variable: string, value: number | null = 1) => ({
    timestamp: "2026-10-21T06:00:00Z",
    value,
    unit: "",
    variable,
    model: "ICON-D2",
  });
  const forecast = {
    combined_forecast: [],
    model_forecasts: {
      "ICON-D2": [point("temperature"), point("precipitation"), point("cape", null)],
    },
  } as unknown as HarmonizedForecastResponse;

  it("lists layout quantities the archive does not hold", () => {
    expect(
      findMissingQuantities(
        ["temperature", "cape", "vertical_cloud_profile"],
        forecast,
      ),
    ).toEqual(["cape", "vertical_cloud_profile"]);
    // Without a cloud chain no profile was ever expected.
    expect(
      findMissingQuantities(["vertical_cloud_profile"], forecast, false),
    ).toEqual([]);
  });

  it("counts cloud profiles and skips derived quantities", () => {
    const withClouds = {
      ...forecast,
      vertical_cloud_model_forecasts: {
        IFS: {
          location: fetch.location,
          profiles: [{ timestamp: "x", source_model_id: "ifs", levels: [] }],
        },
      },
    } as unknown as HarmonizedForecastResponse;
    expect(
      findMissingQuantities(
        ["vertical_cloud_profile", "precipitation_rain_snow"],
        withClouds,
      ),
    ).toEqual([]);
  });
});
