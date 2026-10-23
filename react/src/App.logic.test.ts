import { describe, it, expect } from "vitest";
import {
  resolveAppBoot,
  filterMeteogramConfigs,
  resolveHeaderLocationChange,
} from "./App.logic";
import type { MeteogramConfig, Location } from "./types";

describe("App.logic unit tests", () => {
  const dummyLoc: Location = {
    name: "Berlin",
    latitude: 52.52,
    longitude: 13.405,
    elevation: 40,
  };

  const configWithModels: MeteogramConfig = {
    id: "cfg-1",
    name: "Berlin Config",
    location: dummyLoc,
    model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
  };

  const configEmptyModels: MeteogramConfig = {
    id: "cfg-2",
    name: "Empty Config",
    location: dummyLoc,
    model_chain: [],
  };

  describe("resolveAppBoot", () => {
    it("selects first runnable configuration and returns fetch parameters", () => {
      const result = resolveAppBoot([configEmptyModels, configWithModels]);
      expect(result.shouldFetch).toBe(true);
      expect(result.selectedConfig?.id).toBe("cfg-1");
      expect(result.targetLoc).toEqual(dummyLoc);
      expect(result.fetchConfigId).toBe("cfg-1");
      expect(result.snapshotKey).toContain("cfg-1");
    });

    it("handles all empty configurations gracefully without fetching", () => {
      const result = resolveAppBoot([configEmptyModels]);
      expect(result.shouldFetch).toBe(false);
      expect(result.selectedConfig?.id).toBe("cfg-2");
      expect(result.targetLoc).toBeNull();
      expect(result.snapshotKey).toBe("");
    });

    it("handles completely empty list", () => {
      const result = resolveAppBoot([]);
      expect(result.shouldFetch).toBe(false);
      expect(result.selectedConfig).toBeNull();
    });
  });

  describe("filterMeteogramConfigs", () => {
    it("filters out configs with empty or missing model chains", () => {
      const result = filterMeteogramConfigs([
        configWithModels,
        configEmptyModels,
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("cfg-1");
    });
  });

  describe("resolveHeaderLocationChange", () => {
    const newLoc: Location = {
      name: "Munich",
      latitude: 48.13,
      longitude: 11.58,
    };

    it("changes nothing in config tab (header field disabled, #175)", () => {
      expect(
        resolveHeaderLocationChange("config", configWithModels, newLoc),
      ).toEqual({});
    });

    it("returns sessionLocationOverride and fetch args in meteogram tab", () => {
      const outcome = resolveHeaderLocationChange(
        "meteogram",
        configWithModels,
        newLoc,
      );
      expect(outcome.sessionLocationOverride).toEqual(newLoc);
      expect(outcome.fetchForecastArgs).toEqual({
        loc: newLoc,
        configId: "cfg-1",
      });
    });
  });
});
