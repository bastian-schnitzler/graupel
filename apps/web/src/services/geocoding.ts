// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Place search and elevation lookup with the Open-Meteo geocoding and elevation APIs.
 * Both take an optional `fetch`, so tests and other callers can inject their own.
 */
import type { Place } from "../config/index.ts";

export const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

/** A search result: a place with the region and country it belongs to. */
export interface PlaceSuggestion extends Place {
  /** First administrative level (state, canton, region). */
  admin1?: string;
  country?: string;
}

export interface RequestOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface SearchOptions extends RequestOptions {
  /** Language of the place names (ISO 639-1). */
  language?: string;
  /** Maximum number of results. */
  count?: number;
}

/** Minimum length of a query before searching. */
export const MIN_QUERY_LENGTH = 2;

interface GeocodingResult {
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  elevation?: unknown;
  admin1?: unknown;
  country?: unknown;
}

function finite(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Maps one result of the geocoding API to a suggestion; `null` when name or coordinates are missing. */
export function toSuggestion(item: GeocodingResult): PlaceSuggestion | null {
  const name = text(item.name);
  const lat = finite(item.latitude);
  const lon = finite(item.longitude);
  if (!name || lat === undefined || lon === undefined) return null;
  const suggestion: PlaceSuggestion = { name, lat, lon };
  const elevation = finite(item.elevation);
  if (elevation !== undefined) suggestion.elevation = elevation;
  const admin1 = text(item.admin1);
  if (admin1) suggestion.admin1 = admin1;
  const country = text(item.country);
  if (country) suggestion.country = country;
  return suggestion;
}

/** Searches places by name. Shorter queries than `MIN_QUERY_LENGTH` give no results; HTTP errors throw. */
export async function searchPlaces(query: string, options: SearchOptions = {}): Promise<PlaceSuggestion[]> {
  const term = query.trim();
  if (term.length < MIN_QUERY_LENGTH) return [];
  const params = new URLSearchParams({
    name: term,
    count: String(options.count ?? 10),
    language: options.language ?? "en",
    format: "json",
  });
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(`${GEOCODING_URL}?${params}`, { signal: options.signal });
  if (!response.ok) throw new Error(`Geocoding HTTP ${response.status}`);
  const data = (await response.json()) as { results?: unknown };
  if (!Array.isArray(data.results)) return [];
  return data.results
    .map((item) => toSuggestion((item ?? {}) as GeocodingResult))
    .filter((item): item is PlaceSuggestion => item !== null);
}

/** Elevation in metres at a point (Open-Meteo, 90 m digital elevation model); `undefined` when unknown. */
export async function fetchElevation(lat: number, lon: number, options: RequestOptions = {}): Promise<number | undefined> {
  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon) });
  const doFetch = options.fetch ?? fetch;
  try {
    const response = await doFetch(`${ELEVATION_URL}?${params}`, { signal: options.signal });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { elevation?: unknown };
    return Array.isArray(data.elevation) ? finite(data.elevation[0]) : undefined;
  } catch {
    return undefined;
  }
}
