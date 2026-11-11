// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Checks the model-data files the viewer reads (prebuild and tests). Each check returns a list of errors; an empty
// list means the file can be shown.

import { GROUPS } from "./lib.js";

/** The files the viewer loads, as copied to public/data/. */
export const DATA_FILES = [
  "model_domains.json",
  "model_catalogue.json",
  "chain_zones.json",
  "chain_zones.geojson",
  "regions.geojson",
];

const REASONS = ["region", "domain_fallback", "global_fallback"];
const PARTS = ["land", "coast", "sea"];

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {v is number} */
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
/** @param {unknown} v */
const isPoint = (v) => Array.isArray(v) && v.length === 2 && isNumber(v[0]) && isNumber(v[1]) && Math.abs(v[1]) <= 90;
/** @param {unknown} v */
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");

/** @param {unknown} ring closed ring of at least 4 [lon, lat] points */
function ringError(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return "ring with fewer than 4 points";
  if (!ring.every(isPoint)) return "ring with an invalid [lon, lat] point";
  const [a, b] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) return "ring not closed";
  return null;
}

/** @param {unknown} doc @param {string[]} errors @param {string} file */
function checkMeta(doc, errors, file) {
  if (!isObject(doc)) {
    errors.push(`${file}: not an object`);
    return false;
  }
  if (!isObject(doc.meta) || typeof doc.meta.license !== "string") errors.push(`${file}: meta.license missing`);
  return true;
}

/** @param {unknown} geometry @param {string} where @param {string[]} errors */
function checkMultiPolygon(geometry, where, errors) {
  if (!isObject(geometry) || geometry.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates)) {
    errors.push(`${where}: geometry is not a MultiPolygon`);
    return;
  }
  for (const polygon of geometry.coordinates) {
    if (!Array.isArray(polygon) || !polygon.length) {
      errors.push(`${where}: empty polygon`);
      return;
    }
    for (const ring of polygon) {
      const error = ringError(ring);
      if (error) {
        errors.push(`${where}: ${error}`);
        return;
      }
    }
  }
}

/**
 * All five files together, including references between them (catalogue ↔ domains, zone chains → models, GeoJSON
 * parts → zones).
 * @param {Record<string, unknown>} docs file name → parsed JSON
 * @returns {string[]}
 */
export function validateData(docs) {
  /** @type {string[]} */
  const errors = [];
  for (const file of DATA_FILES) if (!(file in docs)) errors.push(`${file}: missing`);
  if (errors.length) return errors;

  const domains = docs["model_domains.json"];
  /** @type {Set<string>} */
  const domainIds = new Set();
  if (checkMeta(domains, errors, "model_domains.json")) {
    const models = /** @type {Record<string, any>} */ (domains).models;
    if (!isObject(models)) errors.push("model_domains.json: models is not an object");
    else
      for (const [id, d] of Object.entries(models)) {
        domainIds.add(id);
        if (d === "global") continue;
        if (!isObject(d) || typeof d.source !== "string") {
          errors.push(`model_domains.json: ${id}: neither "global" nor { source, polygon }`);
          continue;
        }
        const error = ringError(d.polygon);
        if (error) errors.push(`model_domains.json: ${id}: ${error}`);
      }
  }

  const catalogue = docs["model_catalogue.json"];
  /** @type {Set<string>} */
  const catalogueIds = new Set();
  if (checkMeta(catalogue, errors, "model_catalogue.json")) {
    const models = /** @type {Record<string, any>} */ (catalogue).models;
    if (!Array.isArray(models)) errors.push("model_catalogue.json: models is not a list");
    else
      for (const m of models) {
        const id = isObject(m) && typeof m.id === "string" ? m.id : null;
        if (!id) {
          errors.push("model_catalogue.json: model without id");
          continue;
        }
        catalogueIds.add(id);
        if (typeof m.name !== "string") errors.push(`model_catalogue.json: ${id}: name missing`);
        if (!(m.short_name === null || typeof m.short_name === "string"))
          errors.push(`model_catalogue.json: ${id}: short_name is neither text nor null`);
        if (!isNumber(m.max_forecast_hours) || m.max_forecast_hours <= 0)
          errors.push(`model_catalogue.json: ${id}: max_forecast_hours missing`);
        if (!isNumber(m.spatial_resolution_km)) errors.push(`model_catalogue.json: ${id}: spatial_resolution_km missing`);
        if (!Array.isArray(m.pressure_levels_hpa)) errors.push(`model_catalogue.json: ${id}: pressure_levels_hpa missing`);
      }
  }
  for (const id of domainIds)
    if (!catalogueIds.has(id)) errors.push(`model_domains.json: ${id} is not in model_catalogue.json`);
  for (const id of catalogueIds)
    if (!domainIds.has(id)) errors.push(`model_catalogue.json: ${id} has no domain in model_domains.json`);

  const zonesDoc = docs["chain_zones.json"];
  /** @type {Set<string>} */
  const zoneIds = new Set();
  if (checkMeta(zonesDoc, errors, "chain_zones.json")) {
    const zones = /** @type {Record<string, any>} */ (zonesDoc).zones;
    if (!Array.isArray(zones) || !zones.length) errors.push("chain_zones.json: zones is not a non-empty list");
    else
      for (const z of zones) {
        const id = isObject(z) && typeof z.id === "string" ? z.id : null;
        if (!id) {
          errors.push("chain_zones.json: zone without id");
          continue;
        }
        if (zoneIds.has(id)) errors.push(`chain_zones.json: ${id} twice`);
        zoneIds.add(id);
        for (const key of ["main_chain_ids", "cloud_chain_ids"]) {
          if (!isStringList(z[key]) || !z[key].length) errors.push(`chain_zones.json: ${id}: ${key} missing`);
          else
            for (const m of z[key])
              if (!catalogueIds.has(m)) errors.push(`chain_zones.json: ${id}: unknown model ${m} in ${key}`);
        }
        if (!isStringList(z.regions)) errors.push(`chain_zones.json: ${id}: regions missing`);
        if (!isStringList(z.reasons) || !z.reasons.every((/** @type {string} */ r) => REASONS.includes(r)))
          errors.push(`chain_zones.json: ${id}: reasons not in ${REASONS.join(", ")}`);
        if (!GROUPS.includes(z.group)) errors.push(`chain_zones.json: ${id}: unknown group ${z.group}`);
        if (!isPoint(z.sample)) errors.push(`chain_zones.json: ${id}: sample is not [lon, lat]`);
      }
  }

  const zonesGeo = docs["chain_zones.geojson"];
  if (checkMeta(zonesGeo, errors, "chain_zones.geojson")) {
    const features = /** @type {Record<string, any>} */ (zonesGeo).features;
    if (!Array.isArray(features)) errors.push("chain_zones.geojson: features is not a list");
    else
      for (const f of features) {
        const p = isObject(f) && isObject(f.properties) ? f.properties : {};
        const where = `chain_zones.geojson: ${p.id}/${p.part}`;
        if (!zoneIds.has(p.id)) errors.push(`${where}: zone not in chain_zones.json`);
        if (!PARTS.includes(p.part)) errors.push(`${where}: part not in ${PARTS.join(", ")}`);
        checkMultiPolygon(isObject(f) ? f.geometry : null, where, errors);
      }
  }

  const regions = docs["regions.geojson"];
  if (checkMeta(regions, errors, "regions.geojson")) {
    const features = /** @type {Record<string, any>} */ (regions).features;
    if (!Array.isArray(features) || !features.length) errors.push("regions.geojson: features is not a non-empty list");
    else
      for (const f of features) {
        const p = isObject(f) && isObject(f.properties) ? f.properties : {};
        const where = `regions.geojson: ${p.id}`;
        if (typeof p.id !== "string" || typeof p.name !== "string") errors.push(`${where}: id or name missing`);
        if (!isNumber(p.priority) || !isNumber(p.area_km2)) errors.push(`${where}: priority or area_km2 missing`);
        checkMultiPolygon(isObject(f) ? f.geometry : null, where, errors);
      }
  }
  return errors;
}
