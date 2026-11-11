// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Location-based model chains (auto chain). Same rules as the resolver of
 * the generator (`generator/src/graupel_gen/resolver.py`), which writes
 * `resolver_cases.json`.
 *
 * `resolveAutoChain(lat, lon, data)` picks the region containing the point
 * (highest priority, then smallest area). A region's chains are preference
 * lists: models whose domain does not cover the point with
 * {@link DOMAIN_MARGIN_DEG} are dropped, then every model that does not
 * extend the horizon by {@link MIN_EXTENSION_HOURS}. Without a region, or
 * when only the terminal model of the region's chain is left, the domain
 * fallback takes the regional models finer than `ecmwf_ifs` covering the
 * point, finest first, under the same rule, and ends with `ecmwf_ifs` /
 * `ecmwf_ifs025`.
 */

import { catalogueModels, type CatalogueModel, type ModelCatalogue } from "./quantities";
import type { WeatherModel } from "./types";

export const MAIN_TERMINAL = "ecmwf_ifs";
export const CLOUD_TERMINAL = "ecmwf_ifs025";
/** Points closer than this to a domain edge count as outside. */
export const DOMAIN_MARGIN_DEG = 0.5;
/** The fallback only uses regional models finer than the terminal model. */
export const FALLBACK_MAX_RESOLUTION_KM = 9.0;
/** Blends and statistical products are never chosen automatically. */
export const FALLBACK_EXCLUDED: ReadonlySet<string> = new Set(["best_match", "ncep_nbm_conus", "cmc_gem_hrdps_west"]);
export const MIN_CLOUD_PRESSURE_LEVELS = 10;
/** A model joins a chain only when it extends the horizon by this much. */
export const MIN_EXTENSION_HOURS = 12;
/** Simplified region outlines lose up to ~1 km along coasts; a point this near still takes a region. */
export const REGION_SNAP_DEG = 0.02;

type Point = readonly [number, number];
type Ring = readonly Point[];
type Bounds = readonly [number, number, number, number];

/** One entry of `model_domains.json`: `"global"` or a closed lon/lat ring. */
export type ModelDomainEntry = "global" | { source?: string; polygon: readonly (readonly number[])[] };

/** `model_domains.json` of `@graupel/model-data`, or just its `models` map. */
export type ModelDomains = { meta?: Record<string, unknown>; models: Readonly<Record<string, ModelDomainEntry>> } | Readonly<
  Record<string, ModelDomainEntry>
>;

export interface RegionProperties {
  id: string;
  name: string;
  priority: number;
  group?: string | null;
  area_km2: number;
  chains_from?: string | null;
  main_chain_ids: readonly string[];
  cloud_chain_ids: readonly string[];
  [key: string]: unknown;
}

export interface RegionFeature {
  type?: string;
  properties: RegionProperties;
  geometry: { type?: string; coordinates: readonly (readonly (readonly (readonly number[])[])[])[] };
}

/** `regions.geojson` of `@graupel/model-data`, or just its features. */
export type Regions = { features: readonly RegionFeature[]; [key: string]: unknown } | readonly RegionFeature[];

/** Data the resolver needs, all from `@graupel/model-data`. */
export interface ResolverData {
  catalogue: ModelCatalogue;
  domains: ModelDomains;
  regions: Regions;
}

export type ResolutionReason = "region" | "domain_fallback" | "global_fallback";

/** A resolved chain: model ids, the catalogue models (horizons strictly increasing) and where it comes from. */
export interface AutoChainResolution {
  main_chain_ids: string[];
  cloud_chain_ids: string[];
  main_model_chain: WeatherModel[];
  cloud_model_chain: WeatherModel[];
  region_id: string | null;
  region_name: string | null;
  resolution_reason: ResolutionReason;
}

/** Even-odd ray casting on lon/lat. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = ring[i] as Point;
    const [x2, y2] = ring[(i + 1) % n] as Point;
    if (y1 > lat !== y2 > lat) {
      const x = x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1);
      if (x > lon) inside = !inside;
    }
  }
  return inside;
}

function inPolygon(lon: number, lat: number, ring: Ring): boolean {
  return [0, 360, -360].some((shift) => pointInRing(lon + shift, lat, ring));
}

function bounds(ring: Ring): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function mergeBounds(boxes: readonly Bounds[]): Bounds {
  if (!boxes.length) return [0, 0, -1, -1]; // contains nothing
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

function inBox(lon: number, lat: number, box: Bounds): boolean {
  return box[0] <= lon && lon <= box[2] && box[1] <= lat && lat <= box[3];
}

interface ParsedRegion extends RegionProperties {
  polygons: Ring[][];
  boxes: Bounds[];
  box: Bounds;
}

function toRing(coordinates: readonly (readonly number[])[]): Ring {
  return coordinates.map((c) => [Number(c[0]), Number(c[1])] as const);
}

function inMultipolygon(lon: number, lat: number, region: ParsedRegion): boolean {
  return region.polygons.some(
    (rings, i) =>
      inBox(lon, lat, region.boxes[i] as Bounds) &&
      pointInRing(lon, lat, rings[0] as Ring) &&
      !rings.slice(1).some((hole) => pointInRing(lon, lat, hole)),
  );
}

/** Python-style modulo (result has the sign of the divisor). */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Resolver over parsed domains and regions; build it once per data set. */
export interface AutoChainResolver {
  /** Main and cloud chain for a location. */
  resolve(lat: number, lon: number): AutoChainResolution;
  /** The winning region at the point (without geometry), or null. */
  regionAt(lat: number, lon: number): RegionProperties | null;
  /** A region's chains without a point (only the horizon rule); null for an unknown region. */
  regionChains(regionId: string): AutoChainResolution | null;
  /** Whether the model delivers data at the point; null for a model without a known domain. */
  domainContains(modelId: string, lat: number, lon: number, marginDeg?: number): boolean | null;
  /**
   * Models the domain fallback may take at the point, finest first (within one resolution the longest horizon
   * first): regional, active, no blend or ensemble, finer than {@link FALLBACK_MAX_RESOLUTION_KM}, covering the point
   * with {@link DOMAIN_MARGIN_DEG}. Without the horizon rule.
   */
  fallbackCandidates(lat: number, lon: number, cloud?: boolean): string[];
  /** Regions without geometry, by priority (desc), then area. */
  listRegions(): RegionProperties[];
}

const resolvers = new WeakMap<object, WeakMap<object, WeakMap<object, AutoChainResolver>>>();

function domainEntries(domains: ModelDomains): Readonly<Record<string, ModelDomainEntry>> {
  const doc = domains as { models?: unknown };
  return (doc.models && typeof doc.models === "object" ? doc.models : domains) as Readonly<
    Record<string, ModelDomainEntry>
  >;
}

function regionFeatures(regions: Regions): readonly RegionFeature[] {
  return Array.isArray(regions) ? regions : (regions as { features: readonly RegionFeature[] }).features ?? [];
}

/** Model as a chain entry, with the catalogue horizon. */
export function catalogueWeatherModel(model: CatalogueModel): WeatherModel {
  const result: WeatherModel = {
    name: model.name,
    max_forecast_horizon_hours: Number(model.max_forecast_hours ?? 0),
  };
  if (model.id) result.id = model.id;
  if (model.short_name !== undefined) result.short_name = model.short_name;
  if (model.max_forecast_hours != null) result.max_forecast_hours = model.max_forecast_hours;
  if (model.provider) result.provider = model.provider;
  if (model.region) result.region = model.region;
  if (typeof model.spatial_resolution_km === "number") result.spatial_resolution_km = model.spatial_resolution_km;
  if (typeof model.temporal_resolution_hours === "number") {
    result.temporal_resolution_hours = model.temporal_resolution_hours;
  }
  if (model.supported_variables) result.supported_variables = [...model.supported_variables];
  if (model.pressure_levels_hpa) result.pressure_levels_hpa = [...model.pressure_levels_hpa];
  if (model.active !== undefined) result.active = model.active;
  return result;
}

/** Build a resolver; repeated calls with the same documents reuse it. */
export function createResolver(data: ResolverData): AutoChainResolver {
  const byCatalogue = resolvers.get(data.catalogue as object) ?? new WeakMap();
  resolvers.set(data.catalogue as object, byCatalogue);
  const byDomains = byCatalogue.get(data.domains as object) ?? new WeakMap();
  byCatalogue.set(data.domains as object, byDomains);
  const cached = byDomains.get(data.regions as object);
  if (cached) return cached;
  const resolver = buildResolver(data);
  byDomains.set(data.regions as object, resolver);
  return resolver;
}

function buildResolver(data: ResolverData): AutoChainResolver {
  const catalogue = new Map<string, CatalogueModel>();
  for (const model of catalogueModels(data.catalogue)) if (model.id) catalogue.set(model.id, model);

  const domains = new Map<string, "global" | Ring>();
  for (const [modelId, entry] of Object.entries(domainEntries(data.domains))) {
    domains.set(modelId, entry === "global" ? "global" : toRing(entry.polygon));
  }

  const regions: ParsedRegion[] = regionFeatures(data.regions).map((feature) => {
    const polygons = feature.geometry.coordinates.map((poly) => poly.map(toRing));
    const boxes = polygons.map((rings) => bounds(rings[0] ?? []));
    return { ...feature.properties, polygons, boxes, box: mergeBounds(boxes) };
  });
  regions.sort((a, b) => b.priority - a.priority || a.area_km2 - b.area_km2);

  const hours = (modelId: string): number => {
    const model = catalogue.get(modelId);
    if (!model) throw new RangeError(`model not in the catalogue: ${modelId}`);
    return Number(model.max_forecast_hours ?? 0);
  };

  const cloudCapable = (modelId: string): boolean =>
    (catalogue.get(modelId)?.pressure_levels_hpa ?? []).length >= MIN_CLOUD_PRESSURE_LEVELS;

  function domainContains(modelId: string, lat: number, lon: number, marginDeg = 0): boolean | null {
    const domain = domains.get((modelId ?? "").toLowerCase());
    if (domain === undefined) return null;
    if (domain === "global") return true;
    const offsets: [number, number][] = [[0, 0]];
    if (marginDeg > 0) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) if (dx || dy) offsets.push([dx * marginDeg, dy * marginDeg]);
      }
    }
    return offsets.every(([dx, dy]) => inPolygon(lon + dx, Math.max(-90, Math.min(90, lat + dy)), domain));
  }

  const covers = (modelId: string, lat: number, lon: number): boolean =>
    Boolean(domainContains(modelId, lat, lon, DOMAIN_MARGIN_DEG));

  function extending(ids: readonly string[]): string[] {
    const chain: string[] = [];
    let horizon = 0;
    for (const modelId of ids) {
      if (!catalogue.has(modelId)) continue;
      if (hours(modelId) >= horizon + MIN_EXTENSION_HOURS) {
        chain.push(modelId);
        horizon = hours(modelId);
      }
    }
    return chain;
  }

  const filter = (ids: readonly string[], lat: number, lon: number): string[] =>
    extending(ids.filter((m) => covers(m, lat, lon)));

  function fallbackCandidates(lat: number, lon: number, cloud: boolean): string[] {
    const candidates: CatalogueModel[] = [];
    for (const [modelId, domain] of domains) {
      const model = catalogue.get(modelId);
      const resolution = model?.spatial_resolution_km;
      // Inactive models (e.g. AROME Austria, discontinued, REQ-767) deliver no new runs.
      if (
        model === undefined ||
        model.active === false ||
        domain === "global" ||
        modelId.includes("seamless") ||
        modelId.includes("ensemble") ||
        FALLBACK_EXCLUDED.has(modelId) ||
        ((typeof resolution === "number" && resolution) || FALLBACK_MAX_RESOLUTION_KM) >= FALLBACK_MAX_RESOLUTION_KM ||
        (cloud && !cloudCapable(modelId)) ||
        !covers(modelId, lat, lon)
      ) {
        continue;
      }
      candidates.push(model);
    }
    // Finest first; within one resolution the longest horizon first.
    candidates.sort(
      (a, b) =>
        Number(a.spatial_resolution_km) - Number(b.spatial_resolution_km) ||
        Number(b.max_forecast_hours ?? 0) - Number(a.max_forecast_hours ?? 0),
    );
    return candidates.map((m) => m.id as string);
  }

  function withTerminal(chain: readonly string[], terminal: string): string[] {
    const result = chain.filter((m) => m !== terminal);
    const horizon = hours(terminal);
    while (result.length && hours(result[result.length - 1] as string) > horizon - MIN_EXTENSION_HOURS) {
      result.pop();
    }
    return [...result, terminal];
  }

  const models = (ids: readonly string[]): WeatherModel[] =>
    ids.map((id) => catalogueWeatherModel(catalogue.get(id) as CatalogueModel));

  function result(
    main: string[],
    cloud: string[],
    region: RegionProperties | null,
    reason: ResolutionReason,
  ): AutoChainResolution {
    return {
      main_chain_ids: main,
      cloud_chain_ids: cloud,
      main_model_chain: models(main),
      cloud_model_chain: models(cloud),
      region_id: region ? region.id : null,
      region_name: region ? region.name : null,
      resolution_reason: reason,
    };
  }

  function regionContaining(lat: number, lon: number): ParsedRegion | null {
    return regions.find((region) => inBox(lon, lat, region.box) && inMultipolygon(lon, lat, region)) ?? null;
  }

  function parsedRegionAt(lat: number, lon: number): ParsedRegion | null {
    const region = regionContaining(lat, lon);
    if (region) return region;
    const found: ParsedRegion[] = [];
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        if (!dx && !dy) continue;
        const near = regionContaining(lat + dy * REGION_SNAP_DEG, lon + dx * REGION_SNAP_DEG);
        if (near) found.push(near);
      }
    }
    if (!found.length) return null;
    return found.reduce((best, r) =>
      r.priority > best.priority || (r.priority === best.priority && r.area_km2 < best.area_km2) ? r : best,
    );
  }

  const withoutGeometry = (region: ParsedRegion): RegionProperties => {
    const props: Partial<ParsedRegion> = { ...region };
    delete props.polygons;
    delete props.boxes;
    delete props.box;
    return props as RegionProperties;
  };

  return {
    resolve(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) {
        return result([MAIN_TERMINAL], [CLOUD_TERMINAL], null, "global_fallback");
      }
      const x = mod(lon + 180, 360) - 180;
      const region = parsedRegionAt(lat, x);
      const fallbackMain = filter(fallbackCandidates(lat, x, false), lat, x);
      const fallbackCloud = filter(fallbackCandidates(lat, x, true), lat, x);
      if (region) {
        const main = filter(region.main_chain_ids, lat, x);
        const cloud = filter(region.cloud_chain_ids, lat, x);
        // A region whose regional models all miss the point yields to a
        // domain fallback with regional models (e.g. overseas parts).
        const regionalLeft = main.some((m) => m !== MAIN_TERMINAL);
        if (regionalLeft || !fallbackMain.length) {
          return result(
            withTerminal(main, MAIN_TERMINAL),
            withTerminal(cloud, CLOUD_TERMINAL),
            withoutGeometry(region),
            "region",
          );
        }
      }
      return result(
        withTerminal(fallbackMain, MAIN_TERMINAL),
        withTerminal(fallbackCloud, CLOUD_TERMINAL),
        null,
        fallbackMain.length ? "domain_fallback" : "global_fallback",
      );
    },

    regionAt(lat, lon) {
      const region = parsedRegionAt(lat, lon);
      return region ? withoutGeometry(region) : null;
    },

    regionChains(regionId) {
      const region = regions.find((r) => r.id === regionId);
      if (!region) return null;
      return result(
        withTerminal(extending(region.main_chain_ids), MAIN_TERMINAL),
        withTerminal(extending(region.cloud_chain_ids), CLOUD_TERMINAL),
        withoutGeometry(region),
        "region",
      );
    },

    domainContains,

    fallbackCandidates(lat, lon, cloud = false) {
      return fallbackCandidates(lat, mod(lon + 180, 360) - 180, cloud);
    },

    listRegions() {
      return regions.map(withoutGeometry);
    },
  };
}

/** Main and cloud chain for a location (see the module comment for the rules). */
export function resolveAutoChain(lat: number, lon: number, data: ResolverData): AutoChainResolution {
  return createResolver(data).resolve(lat, lon);
}
