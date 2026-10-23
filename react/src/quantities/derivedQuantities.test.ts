import { describe, expect, it } from "vitest";
import type { DataPoint } from "../types";
import {
  PRECIPITATION_RAIN_SNOW,
  SNOWFALL_WITH_RAIN,
  SNOW_CM_PER_WATER_MM,
  deriveValue,
  missingDerivedSources,
  splitRainSnow,
  withDerivedPoints,
} from "./derivedQuantities";
import { getQuantity } from "./registry";

describe("derived snow quantities", () => {
  it("are derived from precipitation and snowfall, never downloaded", () => {
    for (const id of [PRECIPITATION_RAIN_SNOW, SNOWFALL_WITH_RAIN]) {
      const quantity = getQuantity(id)!;
      expect(quantity.source).toBe("derived");
      expect(quantity.downloadable).toBe(false);
      expect(quantity.requires).toEqual(["precipitation", "snowfall"]);
    }
  });

  it("splits an hour into snow and the rain part in snow-equivalent cm", () => {
    // 2 mm water, 0.7 cm snow = 1 mm water as snow -> 1 mm rain -> 0.7 cm.
    const parts = splitRainSnow(2, 0.7)!;
    expect(parts.snowCm).toBeCloseTo(0.7);
    expect(parts.rainCm).toBeCloseTo(1 * SNOW_CM_PER_WATER_MM);
    expect(splitRainSnow(1, 0)).toEqual({ snowCm: 0, rainCm: 0.7 });
    // Snow explains all precipitation: no rain part.
    expect(splitRainSnow(1, 1.4)).toEqual({ snowCm: 1.4, rainCm: 0 });
  });

  it("leaves a gap when a source value is missing", () => {
    expect(splitRainSnow(null, 1)).toBeNull();
    expect(splitRainSnow(1, undefined)).toBeNull();
    expect(deriveValue(SNOWFALL_WITH_RAIN, 1, null)).toBeNull();
    expect(deriveValue(SNOWFALL_WITH_RAIN, null, 1)).toBeNull();
    expect(deriveValue(PRECIPITATION_RAIN_SNOW, null, 1)).toBeNull();
    // Precipitation bars without snowfall stay plain precipitation bars.
    expect(deriveValue(PRECIPITATION_RAIN_SNOW, 1.2, null)).toBe(1.2);
    expect(deriveValue(SNOWFALL_WITH_RAIN, 2, 0.7)).toBeCloseTo(1.4);
  });

  it("adds derived points per timestamp and model", () => {
    const point = (
      timestamp: string,
      variable: string,
      value: number | null,
      model = "ICON-D2",
    ): DataPoint => ({ timestamp, variable, value, unit: "", model });
    const points = [
      point("2026-01-01T00:00:00Z", "precipitation", 2),
      point("2026-01-01T00:00:00Z", "snowfall", 0.7),
      point("2026-01-01T01:00:00Z", "precipitation", 1),
      point("2026-01-01T01:00:00Z", "precipitation", 3, "ICON-EU"),
      point("2026-01-01T01:00:00Z", "snowfall", 0, "ICON-EU"),
    ];
    const derived = withDerivedPoints(points).slice(points.length);
    const find = (variable: string, timestamp: string, model = "ICON-D2") =>
      derived.find(
        (entry) =>
          entry.variable === variable &&
          entry.timestamp === timestamp &&
          entry.model === model,
      )?.value;
    expect(find(PRECIPITATION_RAIN_SNOW, "2026-01-01T00:00:00Z")).toBe(2);
    expect(find(SNOWFALL_WITH_RAIN, "2026-01-01T00:00:00Z")).toBeCloseTo(1.4);
    expect(find(PRECIPITATION_RAIN_SNOW, "2026-01-01T01:00:00Z")).toBe(1);
    // No snowfall for that hour and model: gap.
    expect(find(SNOWFALL_WITH_RAIN, "2026-01-01T01:00:00Z")).toBeUndefined();
    expect(
      find(SNOWFALL_WITH_RAIN, "2026-01-01T01:00:00Z", "ICON-EU"),
    ).toBeCloseTo(2.1);
    expect(withDerivedPoints([])).toEqual([]);
  });

  it("names the sources a model lacks for the drawn derived quantities", () => {
    const point = (variable: string, value: number | null): DataPoint => ({
      timestamp: "2026-01-01T00:00:00Z",
      variable,
      value,
      unit: "",
      model: "ICON-D2",
    });
    const precipOnly = [point("precipitation", 0), point("snowfall", null)];
    expect(missingDerivedSources([SNOWFALL_WITH_RAIN], precipOnly)).toEqual([
      "snowfall",
    ]);
    // Bars are still drawn, but snow cannot be marked: warn as well.
    expect(missingDerivedSources([PRECIPITATION_RAIN_SNOW], precipOnly)).toEqual(
      ["snowfall"],
    );
    expect(
      missingDerivedSources([PRECIPITATION_RAIN_SNOW], [point("snowfall", 1)]),
    ).toEqual(["precipitation"]);
    expect(
      missingDerivedSources([PRECIPITATION_RAIN_SNOW, SNOWFALL_WITH_RAIN], []),
    ).toEqual(["precipitation", "snowfall"]);
    // Nothing derived drawn, or no forecast for the model: no warning.
    expect(missingDerivedSources(["precipitation"], [])).toEqual([]);
    expect(missingDerivedSources([SNOWFALL_WITH_RAIN], undefined)).toEqual([]);
  });
});
