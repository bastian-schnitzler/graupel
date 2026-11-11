// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { DATA_FILES, validateData } from "../src/schema.js";
import { load } from "./data.ts";

const docs = () => Object.fromEntries(DATA_FILES.map((file) => [file, load(file)]));

describe("validateData", () => {
  it("accepts model-data as generated", () => {
    expect(validateData(docs())).toEqual([]);
  });

  it("reports a missing file", () => {
    const d = docs();
    delete d["regions.geojson"];
    expect(validateData(d)).toEqual(["regions.geojson: missing"]);
  });

  it("reports an open domain ring and a domain without catalogue entry", () => {
    const d = docs();
    const polygon = d["model_domains.json"].models.icon_d2.polygon;
    polygon[polygon.length - 1] = [0, 0];
    d["model_domains.json"].models.extra = "global";
    expect(validateData(d)).toEqual([
      "model_domains.json: icon_d2: ring not closed",
      "model_domains.json: extra is not in model_catalogue.json",
    ]);
  });

  it("reports unknown models in a chain, an unknown group and a GeoJSON part of an unknown zone", () => {
    const d = docs();
    const zone = d["chain_zones.json"].zones[0];
    zone.main_chain_ids = ["kma_ldps", ...zone.main_chain_ids];
    zone.group = "Antarctica";
    d["chain_zones.geojson"].features[0].properties.id = "nowhere";
    expect(validateData(d)).toEqual([
      `chain_zones.json: ${zone.id}: unknown model kma_ldps in main_chain_ids`,
      `chain_zones.json: ${zone.id}: unknown group Antarctica`,
      "chain_zones.geojson: nowhere/land: zone not in chain_zones.json",
    ]);
  });

  it("reports a catalogue model without horizon and a region without MultiPolygon", () => {
    const d = docs();
    delete d["model_catalogue.json"].models[0].max_forecast_hours;
    d["regions.geojson"].features[0].geometry = { type: "Polygon", coordinates: [] };
    const id = d["model_catalogue.json"].models[0].id;
    expect(validateData(d)).toEqual([
      `model_catalogue.json: ${id}: max_forecast_hours missing`,
      "regions.geojson: northern_alps: geometry is not a MultiPolygon",
    ]);
  });
});
