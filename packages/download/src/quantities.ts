// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Quantity registry and model catalogue of `@graupel/model-data`: which
 * quantities are fetched, how Open-Meteo names them, their target units, and
 * which of them a model is asked for.
 *
 * The library has no runtime dependencies: callers pass the parsed
 * `quantities.json` and `model_catalogue.json` (or just their arrays).
 */

import { toOpenMeteoModel } from "./client";

/** Where a quantity's values come from. */
export type QuantitySource = "hourly" | "pressure_level" | "composite" | "derived";

/** One entry of `quantities.json`. */
export interface QuantityDefinition {
  id: string;
  label?: string;
  unit: string;
  /** point: value at its timestamp; interval: start-stamped [t, t + 1h). */
  kind?: "point" | "interval" | string;
  source: QuantitySource | string;
  /** Open-Meteo name; pressure-level names contain `{level}`. */
  api_name?: string | null;
  aliases?: readonly string[];
  /** Missing or incomplete for a model: no warning, does not define delivered hours. */
  optional?: boolean;
  /** Probed by the catalogue into `supported_variables`. */
  catalogued?: boolean;
  always_fetch?: boolean;
  unit_from_api?: boolean;
  /** Some model endpoints reject it: the request is repeated without it. */
  retry_without?: boolean;
  /** Comes from the model's ensemble, not its main run. */
  ensemble?: boolean;
  allowed_styles?: readonly string[];
  requires?: readonly string[];
  /** Part of the fetch set. False: derived or parts of a composite quantity. */
  downloadable?: boolean;
  color?: string | null;
}

/** `quantities.json` of `@graupel/model-data`. */
export interface QuantitiesDocument {
  meta?: Record<string, unknown>;
  quantities: readonly QuantityDefinition[];
}

/** One model of `model_catalogue.json`. */
export interface CatalogueModel {
  id?: string | null;
  name: string;
  short_name?: string | null;
  /** Model description at the publisher or on Open-Meteo (https); missing in older catalogues. */
  documentation_url?: string | null;
  provider?: string | null;
  /** Homepage of the publisher (https); missing in older catalogues. */
  provider_url?: string | null;
  region?: string | null;
  max_forecast_hours?: number | null;
  supported_variables?: readonly string[] | null;
  pressure_levels_hpa?: readonly number[] | null;
  meta_path?: string | null;
  ensemble_meta_path?: string | null;
  active?: boolean;
  [key: string]: unknown;
}

/** `model_catalogue.json` of `@graupel/model-data`, or just its models. */
export type ModelCatalogue = { meta?: Record<string, unknown>; models: readonly CatalogueModel[] } | readonly CatalogueModel[];

/** Lookup structure built once per registry document. */
export interface QuantityRegistry {
  /** Quantities in registry order. */
  readonly quantities: readonly QuantityDefinition[];
  readonly byId: ReadonlyMap<string, QuantityDefinition>;
  /** Lower-case id, Open-Meteo name and alias → quantity id. */
  readonly aliases: ReadonlyMap<string, string>;
  /** Id, Open-Meteo name and alias → Open-Meteo hourly name. */
  readonly openMeteoNames: ReadonlyMap<string, string>;
  /** Hourly quantity id → target unit. */
  readonly targetUnits: ReadonlyMap<string, string>;
}

export type QuantityRegistryInput = QuantityRegistry | QuantitiesDocument | readonly QuantityDefinition[];

const built = new WeakMap<object, QuantityRegistry>();

function isRegistry(input: QuantityRegistryInput): input is QuantityRegistry {
  return !Array.isArray(input) && (input as QuantityRegistry).byId instanceof Map;
}

/** Build the lookup structure of a registry; repeated calls with the same document reuse it. */
export function createQuantityRegistry(input: QuantityRegistryInput): QuantityRegistry {
  if (isRegistry(input)) return input;
  const cached = built.get(input);
  if (cached) return cached;
  const quantities = Array.isArray(input) ? input : (input as QuantitiesDocument).quantities;
  if (!Array.isArray(quantities)) throw new TypeError("Quantity registry without a quantities list");
  const byId = new Map<string, QuantityDefinition>();
  const aliases = new Map<string, string>();
  const openMeteoNames = new Map<string, string>();
  const targetUnits = new Map<string, string>();
  for (const q of quantities as readonly QuantityDefinition[]) {
    byId.set(q.id, q);
    const plainApiName = q.api_name && !q.api_name.includes("{") ? q.api_name : null;
    for (const name of [q.id, ...(q.aliases ?? []), ...(plainApiName ? [plainApiName] : [])]) {
      aliases.set(name.toLowerCase(), q.id);
    }
    if (q.source === "hourly") {
      targetUnits.set(q.id, q.unit);
      if (q.api_name) {
        for (const name of [q.id, q.api_name, ...(q.aliases ?? [])]) openMeteoNames.set(name, q.api_name);
      }
    }
  }
  const registry: QuantityRegistry = { quantities, byId, aliases, openMeteoNames, targetUnits };
  built.set(input, registry);
  return registry;
}

/** Quantity id of a raw variable name (Open-Meteo name or alias, any case); unknown names stay as they are. */
export function normalizeVariable(rawVariable: string, registry: QuantityRegistryInput): string {
  return createQuantityRegistry(registry).aliases.get(rawVariable.toLowerCase()) ?? rawVariable;
}

/** Open-Meteo hourly name of a quantity id, alias or Open-Meteo name; unknown names stay as they are. */
export function openMeteoName(variable: string, registry: QuantityRegistryInput): string {
  return createQuantityRegistry(registry).openMeteoNames.get(variable) ?? variable;
}

/** Target unit of an hourly quantity, or undefined. */
export function targetUnit(quantityId: string, registry: QuantityRegistryInput): string | undefined {
  return createQuantityRegistry(registry).targetUnits.get(quantityId);
}

/** Known ids in registry order, without duplicates. */
export function orderedQuantities(ids: Iterable<string>, registry: QuantityRegistryInput): string[] {
  const wanted = new Set(ids);
  return createQuantityRegistry(registry).quantities.filter((q) => wanted.has(q.id)).map((q) => q.id);
}

function idsWhere(registry: QuantityRegistryInput, test: (q: QuantityDefinition) => boolean): string[] {
  return createQuantityRegistry(registry).quantities.filter(test).map((q) => q.id);
}

/** Hourly quantities a model is warned about when it lacks them. */
export function expectedQuantities(registry: QuantityRegistryInput): string[] {
  return idsWhere(registry, (q) => q.source === "hourly" && !q.optional);
}

export function optionalQuantities(registry: QuantityRegistryInput): string[] {
  return idsWhere(registry, (q) => Boolean(q.optional));
}

export function ensembleQuantities(registry: QuantityRegistryInput): string[] {
  return idsWhere(registry, (q) => Boolean(q.ensemble));
}

/** Quantities that never define a model's delivered hours (optional or from the ensemble). */
export function mainRunExcludedQuantities(registry: QuantityRegistryInput): string[] {
  return idsWhere(registry, (q) => Boolean(q.optional || q.ensemble));
}

/** Open-Meteo names a model endpoint may reject; the request is then repeated without them. */
export function retryWithoutNames(registry: QuantityRegistryInput): Set<string> {
  return new Set(
    createQuantityRegistry(registry)
      .quantities.filter((q) => q.retry_without && q.api_name)
      .map((q) => q.api_name as string),
  );
}

/** The given quantities plus everything they require, transitively, in registry order. Unknown ids throw. */
export function expandRequires(ids: Iterable<string>, registry: QuantityRegistryInput): string[] {
  const reg = createQuantityRegistry(registry);
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop() as string;
    const quantity = reg.byId.get(id);
    if (!quantity) throw new RangeError(`unknown quantity: ${id}`);
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(quantity.requires ?? []));
  }
  return orderedQuantities(seen, reg);
}

/**
 * Quantities to download: every downloadable quantity plus what it requires,
 * without derived ones (they are computed when drawn). The same set is
 * fetched for every layout; model-gated quantities are filtered per model by
 * {@link requestedFromModel}.
 */
export function fetchSet(registry: QuantityRegistryInput): string[] {
  const reg = createQuantityRegistry(registry);
  const ids = reg.quantities.filter((q) => q.downloadable !== false).map((q) => q.id);
  return expandRequires(ids, reg).filter((id) => reg.byId.get(id)?.source !== "derived");
}

/** The hourly part of the fetch set: what one `/v1/forecast` request per model asks for. */
export function hourlyFetchSet(registry: QuantityRegistryInput): string[] {
  const reg = createQuantityRegistry(registry);
  return fetchSet(reg).filter((id) => reg.byId.get(id)?.source === "hourly");
}

/**
 * Whether to ask a model for a quantity. Optional catalogued quantities are
 * only requested when the model lists them in `supported_variables`; null
 * (model not in the catalogue) leaves them out as well. Everything else,
 * including names the registry does not know, is requested.
 */
export function requestedFromModel(
  quantityId: string,
  supportedVariables: Iterable<string> | null | undefined,
  registry: QuantityRegistryInput,
): boolean {
  const quantity = createQuantityRegistry(registry).byId.get(quantityId);
  if (!quantity || !(quantity.optional && quantity.catalogued)) return true;
  return new Set(supportedVariables ?? []).has(quantityId);
}

/** Models of a catalogue document or array. */
export function catalogueModels(catalogue: ModelCatalogue | null | undefined): readonly CatalogueModel[] {
  if (!catalogue) return [];
  return Array.isArray(catalogue) ? catalogue : (catalogue as { models: readonly CatalogueModel[] }).models ?? [];
}

/** Catalogue entry of a configured model name or id, or null. */
export function findCatalogueModel(
  modelName: string,
  catalogue: ModelCatalogue | null | undefined,
): CatalogueModel | null {
  const models = catalogueModels(catalogue);
  const target = toOpenMeteoModel(modelName, models);
  return models.find((m) => (m.id || toOpenMeteoModel(m.name, models)) === target) ?? null;
}

/**
 * Open-Meteo hourly names to request from a model: the given quantities
 * (default: the hourly fetch set) without optional catalogued ones the model
 * does not list, in their given order and without duplicates.
 */
export function modelHourlyVariables(
  modelName: string,
  data: { catalogue: ModelCatalogue | null | undefined; registry: QuantityRegistryInput },
  quantities?: readonly string[],
): string[] {
  const reg = createQuantityRegistry(data.registry);
  const supported = findCatalogueModel(modelName, data.catalogue)?.supported_variables ?? null;
  const names = (quantities ?? hourlyFetchSet(reg))
    .filter((v) => requestedFromModel(normalizeVariable(v, reg), supported, reg))
    .map((v) => openMeteoName(v, reg));
  return [...new Set(names)];
}
