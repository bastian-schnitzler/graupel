// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Resolver against resolver_cases.json of @graupel/model-data (written by the generator's resolver), plus domain
// checks on the generated domains.
import { describe, expect, it } from "vitest";
import {
  CLOUD_TERMINAL,
  MAIN_TERMINAL,
  createResolver,
  resolveAutoChain,
} from "../src/index";
import { resolverCases as cases, resolverData as data } from "./modelData";

describe("resolveAutoChain (resolver_cases.json)", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_name, expected) => {
    const resolved = resolveAutoChain(expected.lat, expected.lon, data);
    expect({
      region_id: resolved.region_id,
      resolution_reason: resolved.resolution_reason,
      main_chain_ids: resolved.main_chain_ids,
      cloud_chain_ids: resolved.cloud_chain_ids,
    }).toEqual({
      region_id: expected.region_id,
      resolution_reason: expected.resolution_reason,
      main_chain_ids: expected.main_chain_ids,
      cloud_chain_ids: expected.cloud_chain_ids,
    });
    // Catalogue models with their catalogue horizons, strictly increasing.
    const horizons = resolved.main_model_chain.map((m) => m.max_forecast_horizon_hours);
    expect(horizons).toEqual([...horizons].sort((a, b) => a - b));
    expect(new Set(horizons).size).toBe(horizons.length);
    expect(resolved.main_model_chain.map((m) => m.id)).toEqual(expected.main_chain_ids);
  });
});

describe("resolver (auto_chain.py)", () => {
  const resolver = createResolver(data);

  it("falls back to the global chain for invalid coordinates", () => {
    for (const [lat, lon] of [
      [Number.NaN, 10],
      [95, 10],
      [47, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(resolveAutoChain(lat, lon, data)).toMatchObject({
        main_chain_ids: [MAIN_TERMINAL],
        cloud_chain_ids: [CLOUD_TERMINAL],
        region_id: null,
        resolution_reason: "global_fallback",
      });
    }
  });

  it("wraps longitudes", () => {
    const zugspitze = resolveAutoChain(47.421, 10.985, data);
    expect(resolveAutoChain(47.421, 10.985 + 360, data)).toEqual(zugspitze);
  });

  it("reuses one resolver per data set and lists regions without geometry", () => {
    expect(createResolver(data)).toBe(resolver);
    const regions = resolver.listRegions();
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0]).not.toHaveProperty("polygons");
    for (let i = 1; i < regions.length; i += 1) {
      const [a, b] = [regions[i - 1]!, regions[i]!];
      expect(a.priority > b.priority || (a.priority === b.priority && a.area_km2 <= b.area_km2)).toBe(true);
    }
    expect(resolver.regionAt(47.421, 10.985)?.id).toBe("northern_alps");
  });

  it("gives a region's chains without a point (horizon rule only)", () => {
    const chains = resolver.regionChains("northern_alps");
    expect(chains?.main_chain_ids).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs"]);
    expect(chains?.resolution_reason).toBe("region");
    expect(resolver.regionChains("nowhere")).toBeNull();
  });
});
