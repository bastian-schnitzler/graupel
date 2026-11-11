// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The text that names a place (REQ-536): the own name of a renamed map-point favourite at its coordinates (REQ-489),
 * else its own name, else (a point picked on the map) its coordinates in the active language.
 */
import type { Place } from "../config/index.ts";
import type { Translate } from "../i18n/index.ts";
import { favoriteName, type Favorite } from "./favorites.ts";
import { ownName } from "./place.ts";

/** Coordinates with four decimals and hemisphere letters, e.g. "45.8326° N · 6.8652° E". */
export function formatCoordinates(lat: number, lon: number, locale: string, t: Translate): string {
  const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const latText = `${format.format(Math.abs(lat))}° ${t(lat >= 0 ? "location.hemisphere.north" : "location.hemisphere.south")}`;
  const lonText = `${format.format(Math.abs(lon))}° ${t(lon >= 0 ? "location.hemisphere.east" : "location.hemisphere.west")}`;
  return `${latText} · ${lonText}`;
}

/** Alias of a favourite at the place, else its own name, else its coordinates (`formatCoordinates`). */
export function placeLabel(place: Place, favorites: readonly Favorite[], locale: string, t: Translate): string {
  return favoriteName(favorites, place) ?? ownName(place) ?? formatCoordinates(place.lat, place.lon, locale, t);
}
