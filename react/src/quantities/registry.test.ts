import { afterEach, describe, expect, it } from "vitest";
import {
  getQuantityRegistry,
  hourlyQuantityIds,
  isOptionalQuantity,
  isRequestedFromModel,
  resetQuantityRegistry,
  setQuantityRegistry,
} from "./registry";

afterEach(() => resetQuantityRegistry());

describe("quantity registry", () => {
  it("lists the stitched surface quantities in registry order", () => {
    expect(hourlyQuantityIds()).toEqual([
      "temperature",
      "apparent_temperature",
      "wind_speed",
      "wind_gusts",
      "wind_direction",
      "cloud_cover",
      "precipitation",
      "precipitation_probability",
      "snowfall",
      "snow_depth",
      "cape",
      "convective_inhibition",
      "lightning_potential",
      "weather_code",
    ]);
  });

  it("marks optional quantities", () => {
    expect(isOptionalQuantity("lightning_potential")).toBe(true);
    expect(isOptionalQuantity("weather_code")).toBe(true);
    expect(isOptionalQuantity("temperature")).toBe(false);
    expect(isOptionalQuantity("unknown")).toBe(false);
  });

  it("requests optional catalogued quantities only from supporting models", () => {
    expect(isRequestedFromModel("cape", ["cape"])).toBe(true);
    expect(isRequestedFromModel("cape", [])).toBe(false);
    expect(isRequestedFromModel("snowfall", [])).toBe(true);
    expect(isRequestedFromModel("temperature", null)).toBe(true);
  });

  it("keeps the built-in copy when the backend sends something unusable", () => {
    const builtin = getQuantityRegistry();
    expect(setQuantityRegistry(null)).toBe(false);
    expect(setQuantityRegistry([])).toBe(false);
    expect(setQuantityRegistry([{ id: "x" }])).toBe(false);
    expect(getQuantityRegistry()).toBe(builtin);
  });

  it("uses a valid backend registry", () => {
    const backend = [
      { ...getQuantityRegistry()[0] },
      { ...getQuantityRegistry()[0], id: "extra", optional: true },
    ];
    expect(setQuantityRegistry(backend)).toBe(true);
    expect(hourlyQuantityIds()).toEqual(["temperature", "extra"]);
    expect(isOptionalQuantity("extra")).toBe(true);
  });
});
