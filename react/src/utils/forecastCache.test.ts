import { describe, expect, it } from "vitest";
import type { MeteogramConfig } from "../types";
import { getForecastCacheKey } from "./forecastCache";
import { AUTO_CONFIG_ID } from "./autoChain";

const loc = { name: "Munich", latitude: 48.137154, longitude: 11.575382 };
const base: MeteogramConfig = {
  id: "a",
  name: "A",
  location: loc,
  model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
  cloud_model_chain: [{ name: "ECMWF IFS", max_forecast_horizon_hours: 360 }],
};

describe("getForecastCacheKey", () => {
  it("ignores id, name, display name and layout", () => {
    const other = {
      ...base,
      id: "b",
      name: "B",
      location_name_override: "Home",
      layout_id: "power-default",
    } as MeteogramConfig;
    expect(getForecastCacheKey(loc, other)).toBe(
      getForecastCacheKey(loc, base),
    );
  });

  it("rounds the location to 4 decimals", () => {
    const near = {
      ...loc,
      name: "Elsewhere",
      latitude: 48.13716,
      longitude: 11.57538,
    };
    expect(getForecastCacheKey(near, base)).toBe(
      getForecastCacheKey(loc, base),
    );
    const far = { ...loc, latitude: 48.1373 };
    expect(getForecastCacheKey(far, base)).not.toBe(
      getForecastCacheKey(loc, base),
    );
  });

  it("changes with main or cloud chain content", () => {
    const key = getForecastCacheKey(loc, base);
    const horizon = {
      ...base,
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 24 }],
    };
    const cloud = { ...base, cloud_model_chain: [] };
    expect(getForecastCacheKey(loc, horizon)).not.toBe(key);
    expect(getForecastCacheKey(loc, cloud)).not.toBe(key);
  });

  it("prefers main_model_chain over model_chain", () => {
    const withMain = {
      ...base,
      main_model_chain: [{ name: "GFS", max_forecast_horizon_hours: 384 }],
    };
    expect(getForecastCacheKey(loc, withMain)).not.toBe(
      getForecastCacheKey(loc, base),
    );
  });

  it("keeps auto chain forecasts apart from a configuration with the same chain", () => {
    // Auto forecasts drop models without data (system.md §3.3).
    const auto = { ...base, id: AUTO_CONFIG_ID };
    expect(getForecastCacheKey(loc, auto)).not.toBe(
      getForecastCacheKey(loc, base),
    );
  });
});
