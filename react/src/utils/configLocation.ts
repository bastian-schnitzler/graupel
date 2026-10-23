import type { MeteogramConfig } from "../types";

/**
 * Display name of a configuration's location (system.md §16.12): the override
 * (e.g. "INSB"), else the place name.
 */
export function getLocationDisplayName(config: MeteogramConfig): string {
  return config.location_name_override?.trim() || config.location.name;
}

/** Configuration dropdown entry: `Alpen (INSB)`, `Alpen (Innsbruck)`. */
export function formatConfigOptionLabel(config: MeteogramConfig): string {
  return `${config.name} (${getLocationDisplayName(config)})`;
}

/** Stored override: trimmed, empty = none (place name). */
export function normalizeLocationNameOverride(
  value: string | null | undefined,
): string | null {
  return value?.trim() || null;
}
