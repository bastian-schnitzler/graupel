// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The pluggable cache (in memory by default).
import { describe, expect, it } from "vitest";
import { createClient, createMemoryCache, forecastCacheKey, type ForecastResult } from "../src/index";

describe("cache", () => {
  it("keeps entries in memory, optionally with age and size limits", () => {
    let now = 0;
    const cache = createMemoryCache<string>({ maxAgeMs: 100, maxEntries: 2, now: () => now });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    now = 101;
    expect(cache.get("c")).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it("is in memory by default and can be replaced or switched off", () => {
    expect(createClient({ fetch: async () => new Response("{}") }).cache).not.toBeNull();
    expect(createClient({ fetch: async () => new Response("{}"), cache: null }).cache).toBeNull();
    const own = createMemoryCache<ForecastResult>();
    expect(createClient({ fetch: async () => new Response("{}"), cache: own }).cache).toBe(own);
  });

  it("keys by rounded location, chains, quantities, options and the forecast hour", () => {
    const base = {
      location: { latitude: 47.42112, longitude: 10.98531 },
      auto: false,
      chain: [{ name: "ICON-D2", id: "icon_d2", max_forecast_horizon_hours: 48 }],
      cloudChain: null,
      quantities: ["temperature"],
      timezone: "Europe/Berlin",
      tNow: Date.UTC(2026, 9, 6, 12),
      runSegments: true,
    };
    const key = forecastCacheKey(base);
    expect(forecastCacheKey({ ...base, location: { latitude: 47.42114, longitude: 10.98529 } })).toBe(key);
    expect(forecastCacheKey({ ...base, chain: [{ ...base.chain[0]!, max_forecast_horizon_hours: 24 }] })).not.toBe(key);
    expect(forecastCacheKey({ ...base, cloudChain: [] })).not.toBe(key);
    expect(forecastCacheKey({ ...base, runSegments: false })).not.toBe(key);
    expect(forecastCacheKey({ ...base, tNow: base.tNow + 3_600_000 })).not.toBe(key);
    expect(forecastCacheKey({ ...base, auto: true })).not.toBe(key);
  });
});
