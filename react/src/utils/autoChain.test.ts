import { describe, expect, it } from "vitest";
import type { AutoChainInfo, MeteogramConfig } from "../types";
import {
  autoChainSignature,
  findMatchingConfig,
  formatAutoEntryLabel,
} from "./autoChain";

const info: AutoChainInfo = {
  region_id: "eastern_alps",
  region_name: "Eastern Alps",
  resolution_reason: "region",
  main_model_chain: [
    { name: "GeoSphere AROME", id: "geosphere_arome_austria", max_forecast_horizon_hours: 60 },
    { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 360 },
  ],
  cloud_model_chain: [
    { name: "ECMWF IFS 0.25°", id: "ecmwf_ifs025", max_forecast_horizon_hours: 360 },
  ],
};

const config = (
  name: string,
  main: MeteogramConfig["model_chain"],
): MeteogramConfig => ({
  id: name,
  name,
  location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39 },
  model_chain: main,
  cloud_model_chain: [
    { name: "ECMWF IFS 0.25°", id: "ecmwf_ifs025", max_forecast_horizon_hours: 300 },
  ],
});

describe("Auto entry label (spec §16.4)", () => {
  const ostalpen = config("Ostalpen", [
    { name: "GeoSphere AROME", id: "geosphere_arome_austria", max_forecast_horizon_hours: 48 },
    { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 240 },
  ]);
  const other = config("Global", [
    { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 360 },
  ]);

  it("names a stored configuration with the same models, ignoring horizons", () => {
    expect(findMatchingConfig(info, [other, ostalpen])).toBe(ostalpen);
    expect(formatAutoEntryLabel(info, [other, ostalpen])).toBe("Auto · Ostalpen");
  });

  it("matches by name when a chain entry has no id", () => {
    const legacy = config("Legacy", [
      { name: "GeoSphere AROME", max_forecast_horizon_hours: 60 },
      { name: "ecmwf ifs", max_forecast_horizon_hours: 360 },
    ]);
    expect(findMatchingConfig(info, [legacy])).toBe(legacy);
  });

  it("falls back to the region, then to plain Auto", () => {
    expect(formatAutoEntryLabel(info, [other])).toBe("Auto · Eastern Alps");
    expect(
      formatAutoEntryLabel(
        { ...info, region_id: null, region_name: null, resolution_reason: "global_fallback" },
        [],
      ),
    ).toBe("Auto · Global");
    expect(formatAutoEntryLabel(null, [ostalpen])).toBe("Auto");
  });

  it("signature changes with the models, not the horizons", () => {
    expect(autoChainSignature(ostalpen)).toBe(
      "geosphere_arome_austria,ecmwf_ifs|ecmwf_ifs025",
    );
    expect(autoChainSignature(null)).toBe("");
  });
});
