// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  buildModels,
  buildRegions,
  buildZones,
  domainGroup,
  escapeHtml,
  inRingWrapped,
  modelsAt,
  normalizeRing,
  regionAt,
  ringBox,
  ringOutline,
  wrapLon,
  zoneAt,
  zoneOrigin,
} from "../src/lib.js";
import { load } from "./data.ts";

type Ring = [number, number][];

const domainsDoc = load("model_domains.json");
const catalogueDoc = load("model_catalogue.json");
const models = buildModels(domainsDoc, catalogueDoc);
const zones = buildZones(load("chain_zones.json"), load("chain_zones.geojson"));
const regions = buildRegions(load("regions.geojson"));

describe("wrapLon", () => {
  it("keeps longitudes in range exactly and wraps the others into [-180, 180)", () => {
    expect(wrapLon(7.81)).toBe(7.81);
    expect(wrapLon(-180)).toBe(-180);
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(316.451)).toBeCloseTo(-43.549, 9);
    expect(wrapLon(-190)).toBe(170);
  });
});

describe("normalizeRing", () => {
  it("leaves every regional domain unchanged, RDPS is closed in the data since GEN-S2", () => {
    const changed = Object.entries(domainsDoc.models as Record<string, "global" | { polygon: Ring }>)
      .flatMap(([id, d]) => (d === "global" ? [] : [[id, d.polygon] as const]))
      .filter(([, polygon]) => JSON.stringify(normalizeRing(polygon)) !== JSON.stringify(polygon))
      .map(([id]) => id);
    expect(changed).toEqual([]);
  });

  it("closes RDPS over the North Pole around the full globe", () => {
    const raw: Ring = domainsDoc.models.cmc_gem_rdps.polygon;
    const ring = normalizeRing(raw) as Ring;
    const [west, south, east, north] = ringBox(ring);
    expect(east - west).toBeCloseTo(360, 9);
    expect([south, north]).toEqual([-1.137, 90]);
    expect(ring.slice(-5)).toEqual([
      [311.411, 14.594],
      [316.451, 19.881],
      [316.451, 90],
      [-43.549, 90],
      [-43.549, 19.881],
    ]);
    expect(ring.at(-1)).toEqual(ring[0]);
    // The wedge between the last and first boundary vertex (311.4° to 316.5° east = 48.6° to 43.5° west) was outside
    // the raw ring before GEN-S2 (REQ-441): central Greenland and the Labrador Sea.
    for (const [lon, lat] of [
      [-46, 70],
      [-45, 62],
      [-44, 40],
    ] as const) {
      expect(inRingWrapped(lon, lat, raw)).toBe(true);
      expect(inRingWrapped(lon, lat, ring)).toBe(true);
    }
    // Over the pole, in North America, Europe and Siberia; not in the tropics or the southern hemisphere.
    for (const [lon, lat] of [
      [0, 89],
      [-100, 50],
      [10, 55],
      [100, 80],
      [-150, 61],
    ] as const)
      expect(inRingWrapped(lon, lat, ring)).toBe(true);
    for (const [lon, lat] of [
      [0, 0],
      [-60, -20],
      [100, 10],
    ] as const)
      expect(inRingWrapped(lon, lat, ring)).toBe(false);
  });

  it("strokes RDPS along its boundary only, not along the closure over the pole", () => {
    const rdps = models.find((m) => m.id === "cmc_gem_rdps")!;
    const ring = rdps.ring as Ring;
    const outline = rdps.outline as Ring;
    expect(outline.some(([, lat]) => lat === 90)).toBe(false);
    expect(outline[0]).toEqual([-43.549, 19.881]);
    expect(outline.at(-1)).toEqual([316.451, 19.881]);
    expect(outline).toHaveLength(ring.length - 3);
    const icon = models.find((m) => m.id === "icon_d2")!;
    expect(icon.outline).toBe(icon.ring);
    expect(ringOutline([[0, 0], [1, 0], [0, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [0, 1], [0, 0]]);
  });

  it("draws a ring across the antimeridian as one shape", () => {
    const ring = normalizeRing([
      [170, 10],
      [-170, 10],
      [-170, 20],
      [170, 20],
      [170, 10],
    ]) as Ring;
    expect(ring).toEqual([
      [170, 10],
      [190, 10],
      [190, 20],
      [170, 20],
      [170, 10],
    ]);
    expect(inRingWrapped(179, 15, ring)).toBe(true);
    expect(inRingWrapped(-179, 15, ring)).toBe(true);
    expect(inRingWrapped(0, 15, ring)).toBe(false);
  });

  it("moves a ring that lies in another world copy back", () => {
    const ring = normalizeRing([
      [370, 0],
      [380, 0],
      [380, 10],
      [370, 0],
    ]);
    expect(ring).toEqual([
      [10, 0],
      [20, 0],
      [20, 10],
      [10, 0],
    ]);
  });

  it("closes a ring around a pole without pole vertices", () => {
    const circle: Ring = [];
    for (let lon = -180; lon < 180; lon += 30) circle.push([lon, 80]);
    const ring = normalizeRing(circle) as Ring;
    expect(ring.slice(-4)).toEqual([
      [180, 80],
      [180, 90],
      [-180, 90],
      [-180, 80],
    ]);
    expect(inRingWrapped(0, 85, ring)).toBe(true);
    expect(inRingWrapped(100, 85, ring)).toBe(true);
    expect(inRingWrapped(0, 70, ring)).toBe(false);
  });

  it("keeps the shape of the polar rings of the chain zones (Antarctica, Arctic Ocean)", () => {
    const fallback = zones.find((z) => z.id === "ecmwf_ifs~ecmwf_ifs025")!;
    const antarctica = fallback.land.find((p) => p.box[1] === -90)!;
    expect(antarctica.box).toEqual([-180, -90, 180, -63.22]);
    expect(inRingWrapped(0, -80, antarctica.rings[0] as Ring)).toBe(true);
    const arctic = fallback.sea.find((p) => p.box[3] === 90)!;
    expect(arctic.box[2] - arctic.box[0]).toBe(360);
    expect(zoneAt(zones, 0, 89)).toBe(fallback);
    expect(zoneAt(zones, 179.9, 89)).toBe(fallback);
  });
});

describe("buildModels", () => {
  it("joins domains and catalogue: 47 models, regional ones with a ring, global ones listed", () => {
    expect(models).toHaveLength(47);
    expect(models.filter((m) => m.ring)).toHaveLength(25);
    const globals = models.filter((m) => !m.ring).map((m) => m.id);
    expect(globals).toHaveLength(22);
    expect(globals).toContain("ecmwf_ifs");
    const names = models.map((m) => m.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const hrdps = models.find((m) => m.id === "cmc_gem_hrdps")!;
    expect(hrdps).toMatchObject({
      name: "GEM HRDPS Continental",
      short_name: "HRDPS",
      hours: 48,
      resolution_km: 2.5,
      band: "short",
      source: "grid",
      group: "North America",
      cloud: true,
    });
  });

  it("marks models with at least 10 pressure levels as usable for the cloud profile", () => {
    const cloud = Object.fromEntries(models.map((m) => [m.id, m.cloud]));
    expect(cloud.ecmwf_ifs025).toBe(true);
    expect(cloud.ecmwf_ifs).toBe(false);
    expect(cloud.cmc_gem_hrdps_west).toBe(false);
  });

  it("groups the domains", () => {
    // Expected groups, without the five models removed in model-data.
    const expected: Record<string, string> = {
      cmc_gem_hrdps: "North America",
      cmc_gem_hrdps_west: "North America",
      cmc_gem_rdps: "Intercontinental",
      dmi_harmonie_arome_europe: "Europe",
      geosphere_arome_austria: "Europe",
      // C-LAEF, AROME Austria's successor since November 2026 (REQ-767).
      geosphere_claef_austria: "Europe",
      geosphere_seamless: "Europe",
      icon_d2: "Europe",
      icon_eu: "Europe",
      italia_meteo_arpae_icon_2i: "Europe",
      jma_msm: "Asia",
      knmi_harmonie_arome_europe: "Europe",
      knmi_harmonie_arome_netherlands: "Europe",
      meteofrance_arome_france: "Europe",
      meteofrance_arome_france_hd: "Europe",
      meteofrance_arpege_europe: "Europe",
      meteoswiss_icon_ch1: "Europe",
      meteoswiss_icon_ch2: "Europe",
      meteoswiss_icon_seamless: "Europe",
      metno_nordic: "Europe",
      ncep_hrrr_conus: "North America",
      ncep_nam_conus: "North America",
      ncep_nbm_conus: "North America",
      // RRFS, HRRR's successor since November 2026 (REQ-768).
      ncep_rrfs_conus: "North America",
      ukmo_uk_deterministic_2km: "Europe",
    };
    for (const m of models) expect([m.id, m.group]).toEqual([m.id, expected[m.id] ?? "Global"]);
    expect(domainGroup("global")).toBe("Global");
  });

  it("finds the regional models covering a point", () => {
    const ids = modelsAt(models, 10.985, 47.421).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["icon_d2", "icon_eu", "geosphere_arome_austria", "meteoswiss_icon_ch1"]));
    expect(modelsAt(models, -30, -30)).toEqual([]);
  });
});

describe("chain zones and regions", () => {
  it("has every zone of chain_zones.json, each found at its own sample point", () => {
    expect(zones).toHaveLength(load("chain_zones.json").zones.length);
    for (const z of zones) {
      const [lon, lat] = z.sample;
      expect(zoneAt(zones, lon, lat)?.id).toBe(z.id);
    }
  });

  it("resolves the resolver cases of model-data to their region and chains", () => {
    const cases = load("resolver_cases.json").cases as Array<{
      name: string;
      lat: number;
      lon: number;
      region_id: string | null;
      main_chain_ids: string[];
      cloud_chain_ids: string[];
    }>;
    expect(cases.length).toBeGreaterThan(20);
    for (const c of cases) {
      expect([c.name, regionAt(regions, c.lon, c.lat)?.id ?? null]).toEqual([c.name, c.region_id]);
      const zone = zoneAt(zones, c.lon, c.lat);
      expect([c.name, zone?.main_chain_ids, zone?.cloud_chain_ids]).toEqual([
        c.name,
        c.main_chain_ids,
        c.cloud_chain_ids,
      ]);
    }
  });

  it("Zugspitze lies in northern_alps, Paris in france", () => {
    expect(regionAt(regions, 10.985, 47.421)?.id).toBe("northern_alps");
    expect(regionAt(regions, 2.352, 48.857)?.id).toBe("france");
    expect(zoneAt(zones, 10.985, 47.421)?.regions).toContain("Northern Alps");
    expect(zoneAt(zones, 2.352, 48.857)?.regions).toContain("France");
  });

  it("orders regions by priority, then area", () => {
    for (let i = 1; i < regions.length; i++) {
      const [a, b] = [regions[i - 1]!, regions[i]!];
      expect(a.priority > b.priority || (a.priority === b.priority && a.area_km2 <= b.area_km2)).toBe(true);
    }
  });
});

describe("texts", () => {
  it("names a zone's regions and fallbacks", () => {
    expect(zoneOrigin({ regions: ["France", "USA"], reasons: ["region", "global_fallback"] })).toBe(
      "France, USA + global fallback",
    );
    expect(zoneOrigin({ regions: [], reasons: ["domain_fallback"] })).toBe("domain fallback");
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<b a="x">&'`)).toBe("&#60;b a=&#34;x&#34;&#62;&#38;&#39;");
  });
});
