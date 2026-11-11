// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Parts of this file (inRing, buildRegions, regionAt, MIN_CLOUD_PRESSURE_LEVELS, REGION_SNAP_DEG) follow the
// resolver of graupel-gen (generator/, MPL-2.0, same copyright holder). As permitted by section 3.3 of the MPL-2.0,
// they are distributed here under the GPL-3.0-or-later as a Secondary License; recipients may use those parts
// under either license. See THIRD_PARTY_LICENSES.md.

// Model Domain Viewer: data handling without DOM or map (unit-tested with Vitest).
//
// Coordinates are [lon, lat] as in model-data/. Model domains may use unwrapped longitudes (RDPS reaches from
// -43.5° east to 311.4° and closes over the North Pole); `normalizeRing` turns every ring into one that draws
// correctly on a Web-Mercator map with world copies and works with `inRingWrapped`.

/** Sidebar groups in display order. */
export const GROUPS = ["Europe", "North America", "Asia", "Intercontinental", "Global"];
/** Groups hidden at start (domains and chains). */
export const OFF_BY_DEFAULT = ["Intercontinental", "Global"];
/** A model is usable in a cloud chain with at least this many pressure levels (as graupel-gen's resolver). */
export const MIN_CLOUD_PRESSURE_LEVELS = 10;
/** A point this near a region still takes it (graupel-gen REGION_SNAP_DEG). */
export const REGION_SNAP_DEG = 0.02;

/** Horizon bands for the filter chips. */
export const BANDS = [
  { id: "short", label: "≤ 90h", test: (/** @type {number} */ h) => h <= 90 },
  { id: "mid", label: "91–200h", test: (/** @type {number} */ h) => h > 90 && h <= 200 },
  { id: "long", label: "> 200h", test: (/** @type {number} */ h) => h > 200 },
];

/**
 * @typedef {[number, number]} Point
 * @typedef {Point[]} Ring
 * @typedef {Ring[]} Polygon outer ring, then holes
 * @typedef {[number, number, number, number]} Box west, south, east, north
 * @typedef {{ rings: Polygon, box: Box }} Part
 *
 * @typedef {object} Model
 * @property {string} id
 * @property {string} name
 * @property {string | null} short_name
 * @property {number} hours
 * @property {number} resolution_km
 * @property {boolean} cloud usable for the cloud profile
 * @property {string} group
 * @property {string} band
 * @property {"global" | string} source "global", "grid" or "measured"
 * @property {Ring | null} ring normalized polygon, null for global models
 * @property {Ring | null} outline line to stroke (ringOutline), null for global models
 *
 * @typedef {object} Zone
 * @property {string} id
 * @property {string[]} main_chain_ids
 * @property {string[]} cloud_chain_ids
 * @property {string[]} regions
 * @property {string[]} reasons
 * @property {string} group
 * @property {Point} sample
 * @property {Part[]} land
 * @property {Part[]} coast
 * @property {Part[]} sea
 *
 * @typedef {object} Region
 * @property {string} id
 * @property {string} name
 * @property {number} priority
 * @property {number} area_km2
 * @property {string} group
 * @property {Part[]} parts
 */

/** Longitude in [-180, 180). @param {number} lon */
export function wrapLon(lon) {
  // Values in range stay exact: modulo arithmetic would move 7.81 to 7.809999… (and across a border).
  return lon >= -180 && lon < 180 ? lon : lon - 360 * Math.floor((lon + 180) / 360);
}

/** Bounding box of a ring. @param {Ring} ring @returns {Box} */
export function ringBox(ring) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Even-odd ray casting on lon/lat (as graupel-gen). @param {number} lon @param {number} lat @param {Ring} ring */
export function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = /** @type {Point} */ (ring[i]);
    const [x2, y2] = /** @type {Point} */ (ring[j]);
    if (y1 > lat !== y2 > lat && lon < x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/** Like inRing, for a ring in any world copy. @param {number} lon @param {number} lat @param {Ring} ring */
export function inRingWrapped(lon, lat, ring) {
  return [0, 360, -360].some((shift) => inRing(lon + shift, lat, ring));
}

/** @param {number} lon @param {number} lat @param {Box} box */
function inBoxWrapped(lon, lat, [w, s, e, n]) {
  if (lat < s || lat > n) return false;
  return [0, 360, -360].some((shift) => lon + shift >= w && lon + shift <= e);
}

/** Point in a multipolygon (holes respected), any world copy. @param {Part[]} parts @param {number} lon @param {number} lat */
export function inParts(parts, lon, lat) {
  return parts.some(
    ({ rings, box }) =>
      inBoxWrapped(lon, lat, box) &&
      inRingWrapped(lon, lat, /** @type {Ring} */ (rings[0])) &&
      !rings.slice(1).some((hole) => inRingWrapped(lon, lat, hole)),
  );
}

const isPole = (/** @type {Point} */ [, lat]) => Math.abs(lat) === 90;

/**
 * Ring ready for drawing and hit tests.
 *
 * - Longitudes are made continuous (no jump over 180° between neighbours), so a ring crossing the antimeridian is
 *   drawn as one shape and not as a band around the world.
 * - A ring around a pole (its boundary circles the globe once, with or without vertices on the pole) gets the cap
 *   closed exactly: the boundary spans 360° and the ring returns over the pole. graupel-gen closes RDPS over the pole
 *   between its first and last boundary vertex but leaves out the boundary step between them, which left a 5° wedge
 *   (Greenland, Labrador Sea) outside the domain.
 * - The centre of its longitude range lies in [-180, 180].
 *
 * Rings that need none of this come back with the same coordinates.
 * @param {Ring} ring closed or open ring
 * @returns {Ring} closed ring
 */
export function normalizeRing(ring) {
  /** @type {Ring} */
  const pts = ring.map(([x, y]) => [x, y]);
  if (pts.length > 1 && samePoint(/** @type {Point} */ (pts[0]), /** @type {Point} */ (pts[pts.length - 1]))) {
    pts.pop();
  }
  if (pts.length < 3) return close(pts);
  // Boundary without pole vertices, starting right after a pole run so that it stays in one piece.
  const poleSigns = pts.filter(isPole).map(([, lat]) => Math.sign(lat));
  let boundary = pts;
  if (poleSigns.length) {
    const start = pts.findIndex((p, i) => isPole(p) && !isPole(/** @type {Point} */ (pts[(i + 1) % pts.length])));
    boundary = [...pts.slice(start + 1), ...pts.slice(0, start + 1)].filter((p) => !isPole(p));
  }
  boundary = unwrap(boundary);
  const first = boundary[0];
  const last = boundary[boundary.length - 1];
  /** @type {Ring} */
  let out = unwrap(pts);
  if (first && last && boundary.length > 1) {
    // The step back to the start closes the boundary; with it the boundary turns through 0° or a full 360°.
    const step = wrapLon(first[0] - last[0]);
    const encircles = Math.abs(last[0] - first[0] + step) > 180;
    if (encircles) {
      const sign = poleSigns[0] ?? (Math.sign(boundary.reduce((sum, [, lat]) => sum + lat, 0)) || 1);
      const end = first[0] + 360 * Math.round((last[0] - first[0]) / 360);
      out = [...boundary];
      if (step !== 0 || first[1] !== last[1]) out.push([end, first[1]]);
      out.push([end, 90 * sign], [first[0], 90 * sign]);
    }
  }
  // Centre of the longitude range in [-180, 180].
  const [west, , east] = ringBox(out);
  const centre = (west + east) / 2;
  const shift = centre > 180 ? -360 * Math.ceil((centre - 180) / 360) : centre < -180 ? 360 * Math.ceil((-180 - centre) / 360) : 0;
  if (shift) out = out.map(([x, y]) => [x + shift, y]);
  return close(out);
}

/**
 * The line to stroke for a normalized ring: the ring itself, or for a ring closed over a pole only its real boundary
 * (the meridians and the pole edge of the closure are no domain edge and would show as a seam between world copies).
 * @param {Ring} ring from normalizeRing
 * @returns {Ring}
 */
export function ringOutline(ring) {
  const start = ring.findIndex((p, i) => isPole(p) && i + 1 < ring.length && !isPole(/** @type {Point} */ (ring[i + 1])));
  if (start < 0) return ring;
  /** @type {Ring} */
  const out = [];
  for (const p of [...ring.slice(start + 1), ...ring.slice(1, start + 1)]) {
    const prev = out[out.length - 1];
    if (!isPole(p) && !(prev && samePoint(prev, p))) out.push(p);
  }
  return out;
}

/** @param {Point} a @param {Point} b */
function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

/** Continuous longitudes: each vertex moved by whole turns to within 180° of its predecessor. @param {Ring} pts */
function unwrap(pts) {
  /** @type {Ring} */
  const out = [];
  for (const [x, y] of pts) {
    const prev = out[out.length - 1];
    out.push([prev ? x + 360 * Math.round((prev[0] - x) / 360) : x, y]);
  }
  return out;
}

/** @param {Ring} pts @returns {Ring} */
function close(pts) {
  if (!pts.length) return pts;
  const head = /** @type {Point} */ (pts[0]);
  return samePoint(head, /** @type {Point} */ (pts[pts.length - 1])) && pts.length > 1 ? pts : [...pts, [head[0], head[1]]];
}

/**
 * Sidebar group of a model domain.
 * Global models are "Global", a domain spanning more than half the globe (RDPS) is "Intercontinental", otherwise
 * the majority of boundary points every 1° below 75° N votes North America (west of 30° W), Europe (to 60° E) or Asia.
 * @param {unknown} domain "global" or { polygon }
 */
export function domainGroup(domain) {
  if (!domain || typeof domain !== "object") return "Global";
  const polygon = /** @type {{ polygon: Ring }} */ (domain).polygon;
  const lons = polygon.map(([lon]) => lon);
  if (Math.max(...lons) - Math.min(...lons) > 180) return "Intercontinental";
  /** @type {Record<string, number>} */
  const votes = { "North America": 0, Europe: 0, Asia: 0 };
  const vote = (/** @type {number} */ lon, /** @type {number} */ lat) => {
    if (lat > 75) return;
    const x = wrapLon(lon);
    const key = x < -30 ? "North America" : x < 60 ? "Europe" : "Asia";
    votes[key] = /** @type {number} */ (votes[key]) + 1;
  };
  // Shapely's segmentize(1.0): every edge split into equal pieces of at most 1°, start points counted.
  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = /** @type {Point} */ (polygon[i]);
    const [x2, y2] = /** @type {Point} */ (polygon[i + 1]);
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 1.0));
    for (let k = 0; k < n; k++) vote(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n);
  }
  return Object.keys(votes).reduce((best, key) => (/** @type {number} */ (votes[key]) > /** @type {number} */ (votes[best]) ? key : best));
}

/** @param {number} hours */
export function bandOf(hours) {
  return /** @type {{ id: string }} */ (BANDS.find((b) => b.test(hours))).id;
}

/**
 * Models from model_domains.json and model_catalogue.json, sorted by name.
 * @param {{ models: Record<string, unknown> }} domainsDoc
 * @param {{ models: Array<Record<string, any>> }} catalogueDoc
 * @returns {Model[]}
 */
export function buildModels(domainsDoc, catalogueDoc) {
  const catalogue = new Map(catalogueDoc.models.map((m) => [m.id, m]));
  return Object.entries(domainsDoc.models)
    .map(([id, domain]) => {
      const m = catalogue.get(id);
      if (!m) throw new Error(`model ${id} missing in model_catalogue.json`);
      const regional = domain !== "global";
      const d = /** @type {{ source: string, polygon: Ring }} */ (domain);
      return {
        id,
        name: m.name,
        short_name: m.short_name ?? null,
        hours: m.max_forecast_hours,
        resolution_km: m.spatial_resolution_km,
        cloud: (m.pressure_levels_hpa ?? []).length >= MIN_CLOUD_PRESSURE_LEVELS,
        group: domainGroup(domain),
        band: bandOf(m.max_forecast_hours),
        source: regional ? d.source : "global",
        ring: regional ? normalizeRing(d.polygon) : null,
        outline: null,
      };
    })
    .map((/** @type {Model} */ m) => ({ ...m, outline: m.ring && ringOutline(m.ring) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {Polygon[]} polygons @returns {Part[]} */
export function toParts(polygons) {
  return polygons.map((rings) => {
    const norm = rings.map(normalizeRing);
    return { rings: norm, box: ringBox(/** @type {Ring} */ (norm[0])) };
  });
}

/**
 * Chain zones from chain_zones.json (order, sample) and chain_zones.geojson (land, coast and sea parts).
 * @param {{ zones: Array<Record<string, any>> }} zonesDoc
 * @param {{ features: Array<{ properties: Record<string, any>, geometry: { coordinates: Polygon[] } }> }} geojson
 * @returns {Zone[]}
 */
export function buildZones(zonesDoc, geojson) {
  /** @type {Map<string, Record<string, Part[]>>} */
  const parts = new Map();
  for (const f of geojson.features) {
    const id = f.properties.id;
    if (!parts.has(id)) parts.set(id, {});
    /** @type {Record<string, Part[]>} */ (parts.get(id))[f.properties.part] = toParts(f.geometry.coordinates);
  }
  return zonesDoc.zones.map((z) => {
    const p = parts.get(z.id) ?? {};
    return {
      id: z.id,
      main_chain_ids: z.main_chain_ids,
      cloud_chain_ids: z.cloud_chain_ids,
      regions: z.regions,
      reasons: z.reasons,
      group: z.group,
      sample: z.sample,
      land: p.land ?? [],
      coast: p.coast ?? [],
      sea: p.sea ?? [],
    };
  });
}

/**
 * Regions from regions.geojson, by priority (highest first), then area (smallest first), as graupel-gen's resolver.
 * @param {{ features: Array<{ properties: Record<string, any>, geometry: { coordinates: Polygon[] } }> }} geojson
 * @returns {Region[]}
 */
export function buildRegions(geojson) {
  return geojson.features
    .map((f) => ({
      id: f.properties.id,
      name: f.properties.name,
      priority: f.properties.priority,
      area_km2: f.properties.area_km2,
      group: f.properties.group,
      parts: toParts(f.geometry.coordinates),
    }))
    .sort((a, b) => b.priority - a.priority || a.area_km2 - b.area_km2);
}

/**
 * The winning region at a point, as graupel-gen's `Resolver.region_at` (including the snap to a region within
 * REGION_SNAP_DEG), or null.
 * @param {Region[]} regions from buildRegions
 * @param {number} lon @param {number} lat
 */
export function regionAt(regions, lon, lat) {
  const containing = (/** @type {number} */ x, /** @type {number} */ y) =>
    regions.find((r) => inParts(r.parts, wrapLon(x), y)) ?? null;
  const here = containing(lon, lat);
  if (here) return here;
  /** @type {Region[]} */
  const found = [];
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      if (!dx && !dy) continue;
      const r = containing(lon + dx * REGION_SNAP_DEG, lat + dy * REGION_SNAP_DEG);
      if (r) found.push(r);
    }
  }
  if (!found.length) return null;
  return found.reduce((best, r) =>
    r.priority > best.priority || (r.priority === best.priority && r.area_km2 < best.area_km2) ? r : best,
  );
}

/** Zone whose land, coast or sea covers the point, or null. @param {Zone[]} zones @param {number} lon @param {number} lat */
export function zoneAt(zones, lon, lat) {
  const x = wrapLon(lon);
  return zones.find((z) => inParts(z.land, x, lat) || inParts(z.coast, x, lat) || inParts(z.sea, x, lat)) ?? null;
}

/** Regional models whose domain covers the point (no margin). @param {Model[]} models @param {number} lon @param {number} lat */
export function modelsAt(models, lon, lat) {
  const x = wrapLon(lon);
  return models.filter((m) => m.ring && inRingWrapped(x, lat, m.ring));
}

const FALLBACK_LABEL = /** @type {Record<string, string>} */ ({
  domain_fallback: "domain fallback",
  global_fallback: "global fallback",
});

/** Where a zone's chain comes from: its regions plus the fallbacks. @param {Pick<Zone, "regions" | "reasons">} zone */
export function zoneOrigin(zone) {
  return [zone.regions.join(", "), ...zone.reasons.filter((r) => r !== "region").map((r) => FALLBACK_LABEL[r] ?? r)]
    .filter(Boolean)
    .join(" + ");
}

/** Escapes text for innerHTML. @param {unknown} text */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
