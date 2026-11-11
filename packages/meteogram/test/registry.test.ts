// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import {
  BUILTIN_QUANTITY_REGISTRY,
  createQuantityRegistry,
  getSeriesColor,
  hourlyQuantityIds,
  isOptionalQuantity,
  isRequestedFromModel,
  parseQuantityRegistry,
} from "../src";

describe("quantity registry", () => {
  it("lists the stitched surface quantities in registry order", () => {
    expect(hourlyQuantityIds()).toEqual([
      "temperature",
      "apparent_temperature",
      "dew_point",
      "relative_humidity",
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

  it("rejects unusable registry data", () => {
    expect(parseQuantityRegistry(null)).toBeNull();
    expect(parseQuantityRegistry([])).toBeNull();
    expect(parseQuantityRegistry([{ id: "x" }])).toBeNull();
  });

  it("uses a given registry without touching the built-in one", () => {
    const first = BUILTIN_QUANTITY_REGISTRY.quantities[0]!;
    const registry = parseQuantityRegistry([
      { ...first },
      { ...first, id: "extra", optional: true, color: "#123456" },
    ]);
    expect(registry).not.toBeNull();
    expect(hourlyQuantityIds(registry!)).toEqual(["temperature", "extra"]);
    expect(isOptionalQuantity("extra", registry!)).toBe(true);
    expect(isOptionalQuantity("extra")).toBe(false);
    expect(getSeriesColor("extra", null, registry!)).toBe("#123456");
    expect(getSeriesColor("extra", null)).toBe("#334155");
    expect(hourlyQuantityIds()).toContain("wind_speed");
  });

  it("looks quantities up by id, the first definition wins", () => {
    const first = BUILTIN_QUANTITY_REGISTRY.quantities[0]!;
    const registry = createQuantityRegistry([
      first,
      { ...first, label: "Duplicate" },
    ]);
    expect(registry.get("temperature")?.label).toBe(first.label);
    expect(registry.get("missing")).toBeUndefined();
  });
});
