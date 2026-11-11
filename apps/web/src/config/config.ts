// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import schemaJson from "../../config.schema.json";
import { DEFAULT_CONFIG, DEFAULT_PLACE } from "./defaults.ts";
import { validateSchema, type SchemaNode } from "./jsonSchema.ts";
import type { GraupelConfig, Place } from "./types.ts";

/** The JSON Schema of config.json (apps/web/config.schema.json). */
export const CONFIG_SCHEMA = schemaJson as unknown as SchemaNode;

export interface ParsedConfig {
  /** Defaults merged with every valid field of the input. */
  config: GraupelConfig;
  /** Human-readable problems; each invalid field fell back to its default. Empty when the input is valid. */
  warnings: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: plain objects field by field, everything else (arrays, scalars) replaces the base. */
export function mergeDeep<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override === undefined ? base : override) as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) result[key] = mergeDeep(result[key], value);
  }
  return result as T;
}

/** Returns all schema violations of `input` as messages "path: problem"; empty when valid. */
export function validateConfig(input: unknown): string[] {
  return validateSchema(input, CONFIG_SCHEMA).map((error) => `${error.path}: ${error.message}`);
}

/** Whether the browser can format times in the IANA zone `zone` (REQ-733). */
function knownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a parsed config.json and merges it with the defaults. Never throws: an input that is no object
 * yields the defaults, an invalid or unknown top-level field is dropped (its default stays), each with a warning.
 */
export function parseConfig(input: unknown): ParsedConfig {
  const warnings: string[] = [];
  if (!isPlainObject(input)) {
    warnings.push(`/: expected an object, got ${Array.isArray(input) ? "array" : input === null ? "null" : typeof input}`);
    return { config: DEFAULT_CONFIG, warnings };
  }

  const properties = CONFIG_SCHEMA.properties ?? {};
  const valid: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const schema = properties[key];
    if (!schema) {
      warnings.push(`/: unknown field "${key}" ignored`);
      continue;
    }
    const errors = validateSchema(value, schema, CONFIG_SCHEMA, `/${key}`);
    if (errors.length > 0) {
      warnings.push(...errors.map((error) => `${error.path}: ${error.message}`));
      warnings.push(`/${key}: invalid, using the default`);
      continue;
    }
    if (key !== "$schema") valid[key] = value;
  }

  const config = mergeDeep(DEFAULT_CONFIG, valid);
  if (!config.languages.includes(config.defaultLanguage)) {
    const fallback = config.languages.includes(DEFAULT_CONFIG.defaultLanguage)
      ? DEFAULT_CONFIG.defaultLanguage
      : config.languages[0]!;
    warnings.push(`/defaultLanguage: "${config.defaultLanguage}" is not in languages, using "${fallback}"`);
    config.defaultLanguage = fallback;
  }
  if (!knownTimeZone(config.timeZone)) {
    warnings.push(`/timeZone: "${config.timeZone}" is no known time zone, using "${DEFAULT_CONFIG.timeZone}"`);
    config.timeZone = DEFAULT_CONFIG.timeZone;
  }
  return { config, warnings };
}

/** The place shown at start: the fixed start place, or for "gps" the first favorite preset or the default place. */
export function startPlace(config: GraupelConfig): Place {
  if (config.startLocation !== "gps") return config.startLocation;
  return config.favorites.presets[0] ?? DEFAULT_PLACE;
}

/** Host names that name no site: the local machine and IP addresses (v4, or v6 in brackets). */
const NO_SITE_HOST = /^(localhost|\[.*\]|\d{1,3}(\.\d{1,3}){3})$/i;

/**
 * Domain shown in the meteogram footer (REQ-464): `domain` of the configuration, else the page's host name without
 * "www."; empty on localhost, an IP address or without a host (e.g. a file opened from disk).
 */
export function siteDomain(config: Pick<GraupelConfig, "domain">, hostname: string = globalThis.location?.hostname ?? ""): string {
  const configured = config.domain?.trim();
  if (configured) return configured;
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host || NO_SITE_HOST.test(host)) return "";
  return host.replace(/^www\./, "");
}
