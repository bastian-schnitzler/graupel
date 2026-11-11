// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Place } from "../config/index.ts";
import { MESSAGES } from "../i18n/messages.ts";

/**
 * Names a point picked on the map carried before REQ-536, in every language ("Point on the map", …). A place stored
 * with one of them has no own name.
 */
export const LEGACY_MAP_POINT_NAMES: ReadonlySet<string> = new Set([
  "Point on the map",
  "Punkt auf der Karte",
  "Point sur la carte",
  "Punto sulla mappa",
  "Punt op de kaart",
  "Punkt på kortet",
  "Bod na mapě",
  "Točka na zemljevidu",
]);

/**
 * The own name of a place, or `undefined` when it has none (REQ-536): a point picked on the map has an empty name;
 * one stored earlier still carries the generic name of a map point in one of the languages.
 */
export function ownName(place: Pick<Place, "name">): string | undefined {
  const name = place.name.trim();
  return name === "" || LEGACY_MAP_POINT_NAMES.has(name) ? undefined : place.name;
}

/** Identity of a place: its coordinates rounded to four decimals (about 10 m). */
export function placeKey(place: Pick<Place, "lat" | "lon">): string {
  return `${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
}

/** Whether two places are at the same point (see `placeKey`). */
export function samePlace(a: Pick<Place, "lat" | "lon">, b: Pick<Place, "lat" | "lon">): boolean {
  return placeKey(a) === placeKey(b);
}

/** Whether a value read from storage or a file is a usable place. */
export function isPlace(value: unknown): value is Place {
  if (typeof value !== "object" || value === null) return false;
  const { name, lat, lon, elevation } = value as Record<string, unknown>;
  return (
    typeof name === "string" &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180 &&
    (elevation === undefined || (typeof elevation === "number" && Number.isFinite(elevation)))
  );
}

/**
 * Only the fields of `Place` (drops region, country and other extras of a search result); a place without own name
 * gets the empty name (`ownName`).
 */
export function toPlace(place: Place): Place {
  const result: Place = { name: ownName(place) ?? "", lat: place.lat, lon: place.lon };
  if (place.elevation !== undefined) result.elevation = place.elevation;
  return result;
}

/**
 * Names of a position found by "Current location" ("My location", "Mein Standort", …) in every language of the page
 * (REQ-765).
 */
export const GPS_PLACE_NAMES: ReadonlySet<string> = new Set(
  Object.values(MESSAGES).flatMap((messages) => messages["location.gps.placeName"]?.trim() || []),
);

/**
 * A place as a favourite or a later visit has it (REQ-765): `toPlace`, and a position found by "Current location"
 * loses its name ("My location" in any language), since the position is no longer current there; like a place without
 * own name (REQ-536) it is shown by its coordinates. Applied when a favourite is made and when places are read from
 * storage, so ones stored earlier with the name are shown the same way.
 */
export function keptPlace(place: Place): Place {
  const result = toPlace(place);
  if (GPS_PLACE_NAMES.has(result.name.trim())) result.name = "";
  return result;
}
