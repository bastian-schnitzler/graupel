// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULT_CONFIG } from "./defaults.ts";
import { parseConfig, type ParsedConfig } from "./config.ts";

/** Relative to the page, so the same build works on every domain and sub-path (DEC-019). */
export const CONFIG_URL = "./config.json";

/**
 * Fetches config.json, validates it and merges it with the defaults. Never rejects: a missing or unreadable
 * file yields the defaults with a warning; invalid fields fall back to their defaults (see `parseConfig`).
 */
export async function loadConfig(url: string = CONFIG_URL, fetchImpl: typeof fetch = fetch): Promise<ParsedConfig> {
  let input: unknown;
  try {
    const response = await fetchImpl(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    input = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { config: DEFAULT_CONFIG, warnings: [`could not load ${url} (${reason}), using the defaults`] };
  }
  return parseConfig(input);
}

/** Reports problems of the configuration in the console as one warning. */
export function reportConfigWarnings(warnings: readonly string[], url: string = CONFIG_URL): void {
  if (warnings.length === 0) return;
  console.warn(`Graupel: problems in ${url}:\n- ${warnings.join("\n- ")}`);
}
