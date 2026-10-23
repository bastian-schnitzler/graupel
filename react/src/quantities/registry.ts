import type { QuantityDefinition } from "./types";
import { BUILTIN_QUANTITY_REGISTRY } from "./quantityRegistry.generated";

export type { QuantityDefinition } from "./types";

// The backend registry replaces the built-in copy once it is loaded; the
// built-in copy keeps tests and runs without the pywebview bridge working.
let registry: QuantityDefinition[] = BUILTIN_QUANTITY_REGISTRY;

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

/** Replaces the registry; ignores anything that is not a non-empty registry. */
export function setQuantityRegistry(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isQuantityDefinition)
  ) {
    return false;
  }
  registry = value;
  return true;
}

export function resetQuantityRegistry(): void {
  registry = BUILTIN_QUANTITY_REGISTRY;
}

export function getQuantityRegistry(): QuantityDefinition[] {
  return registry;
}

export function getQuantity(id: string): QuantityDefinition | undefined {
  return registry.find((quantity) => quantity.id === id);
}

/** Surface quantities stitched per model chain, in registry order. */
export function hourlyQuantityIds(): string[] {
  return registry
    .filter((quantity) => quantity.source === "hourly")
    .map((quantity) => quantity.id);
}

/** Missing or incomplete data for these quantities is not warned about. */
export function isOptionalQuantity(id: string): boolean {
  return getQuantity(id)?.optional === true;
}

/**
 * Whether a model is asked for a quantity: optional quantities probed by the
 * catalogue only when the model lists them in `supported_variables`.
 */
export function isRequestedFromModel(
  id: string,
  supportedVariables?: string[] | null,
): boolean {
  const quantity = getQuantity(id);
  if (!quantity || !(quantity.optional && quantity.catalogued)) return true;
  return supportedVariables?.includes(id) === true;
}
