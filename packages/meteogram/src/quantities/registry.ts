// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { QuantityDefinition } from "./types";
import { BUILTIN_QUANTITIES } from "./builtin";

export type { QuantityDefinition } from "./types";

/**
 * Quantity registry the meteogram works with. It is passed in as an option
 * (no module-wide state), so several meteograms with different registries
 * can live side by side.
 */
export interface QuantityRegistry {
  readonly quantities: readonly QuantityDefinition[];
  get(id: string): QuantityDefinition | undefined;
}

export function createQuantityRegistry(
  quantities: readonly QuantityDefinition[],
): QuantityRegistry {
  const byId = new Map<string, QuantityDefinition>();
  for (const quantity of quantities) {
    if (!byId.has(quantity.id)) byId.set(quantity.id, quantity);
  }
  return {
    quantities,
    get: (id) => byId.get(id),
  };
}

/** Registry of the quantities shipped with the package. */
export const BUILTIN_QUANTITY_REGISTRY: QuantityRegistry =
  createQuantityRegistry(BUILTIN_QUANTITIES);

function isQuantityDefinition(value: unknown): value is QuantityDefinition {
  const entry = value as Partial<QuantityDefinition> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.id === "string" &&
    typeof entry.source === "string" &&
    typeof entry.optional === "boolean" &&
    typeof entry.catalogued === "boolean"
  );
}

/**
 * Registry from untrusted data (e.g. a loaded JSON file); null for anything
 * that is not a non-empty list of quantity definitions.
 */
export function parseQuantityRegistry(value: unknown): QuantityRegistry | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isQuantityDefinition)
  ) {
    return null;
  }
  return createQuantityRegistry(value);
}

/** Surface quantities stitched per model chain, in registry order. */
export function hourlyQuantityIds(
  registry: QuantityRegistry = BUILTIN_QUANTITY_REGISTRY,
): string[] {
  return registry.quantities
    .filter((quantity) => quantity.source === "hourly")
    .map((quantity) => quantity.id);
}

/** Missing or incomplete data for these quantities is not warned about. */
export function isOptionalQuantity(
  id: string,
  registry: QuantityRegistry = BUILTIN_QUANTITY_REGISTRY,
): boolean {
  return registry.get(id)?.optional === true;
}

/**
 * Whether a model is asked for a quantity: optional quantities probed by the
 * catalogue only when the model lists them in `supported_variables`.
 */
export function isRequestedFromModel(
  id: string,
  supportedVariables?: string[] | null,
  registry: QuantityRegistry = BUILTIN_QUANTITY_REGISTRY,
): boolean {
  const quantity = registry.get(id);
  if (!quantity || !(quantity.optional && quantity.catalogued)) return true;
  return supportedVariables?.includes(id) === true;
}
