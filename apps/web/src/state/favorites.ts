// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Favourite places (REQ-433): the presets of the configuration until the user marks or unmarks a place,
 * then the user's list, stored in localStorage. Storage errors (private mode, blocked) are ignored.
 * A favourite made from a point picked on the map can be renamed (REQ-489); the name is shown whenever the selected
 * place has its coordinates (`favoriteName`). Until then it has no own name (REQ-536) and is shown by its coordinates.
 * So is a favourite made from a position found by "Current location" (REQ-765): it is kept without the name "My
 * location", also when read from storage.
 */
import { useCallback, useEffect, useState } from "react";
import type { Place } from "../config/index.ts";
import { isPlace, keptPlace, ownName, samePlace } from "./place.ts";

export const FAVORITES_STORAGE_KEY = "graupel.favorites";

/** A favourite place; `mapPoint` marks a point picked on the map (REQ-489), which can be renamed. */
export interface Favorite extends Place {
  mapPoint?: true;
}

/**
 * Whether a favourite is a point picked on the map: marked so, or (stored before the mark existed) without own name
 * (`ownName`: empty, or still the generic name of a map point in one of the languages).
 */
export function isMapPointFavorite(favorite: Favorite): boolean {
  return favorite.mapPoint === true || ownName(favorite) === undefined;
}

/**
 * Only the fields of `Favorite` (`keptPlace`: a position found by "Current location" without its name, REQ-765);
 * `mapPoint` is kept only when it is `true`.
 */
export function toFavorite(place: Place & { mapPoint?: unknown }): Favorite {
  const result: Favorite = keptPlace(place);
  if (place.mapPoint === true) result.mapPoint = true;
  return result;
}

/**
 * The own name of a renamed map-point favourite at the place's coordinates (REQ-489), or `undefined` when there is
 * none (no such favourite, or it has no own name yet).
 */
export function favoriteName(favorites: readonly Favorite[], place: Pick<Place, "lat" | "lon">): string | undefined {
  const favorite = favorites.find((item) => samePlace(item, place) && isMapPointFavorite(item));
  return favorite ? ownName(favorite) : undefined;
}

/** The stored favourites, or `null` when nothing (valid) is stored. */
export function readStoredFavorites(): Favorite[] | null {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlace).map(toFavorite) : null;
  } catch {
    return null;
  }
}

export function storeFavorites(favorites: readonly Favorite[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Not stored; the list stays for this visit.
  }
}

/** Window event after `replaceFavorites`; its `detail` is the new list. */
export const FAVORITES_REPLACED_EVENT = "graupel:favorites-replaced";

/** Stores a new list and passes it to every `useFavorites` of the page (e.g. after an import). */
export function replaceFavorites(favorites: readonly Favorite[]): void {
  const next = favorites.map(toFavorite);
  storeFavorites(next);
  announceFavorites(next);
}

/** Passes a stored list to every `useFavorites` of the page, outside React's render (REQ-535). */
function announceFavorites(next: readonly Favorite[]): void {
  const event = () => new CustomEvent<readonly Favorite[]>(FAVORITES_REPLACED_EVENT, { detail: next });
  queueMicrotask(() => window.dispatchEvent(event()));
}

export interface FavoritesApi {
  favorites: readonly Favorite[];
  isFavorite: (place: Place) => boolean;
  /**
   * Marks the place, or unmarks it when it is already a favourite. A place without own name (a point picked on the
   * map, or a position found by "Current location", REQ-765) becomes a map-point favourite.
   */
  toggle: (place: Place) => void;
  /** Gives the favourite at the place's coordinates a new name (trimmed; an empty name changes nothing). */
  rename: (place: Place, name: string) => void;
}

/** Favourites of this browser, starting with `presets`. */
export function useFavorites(presets: readonly Place[]): FavoritesApi {
  const [favorites, setFavorites] = useState<readonly Favorite[]>(
    () => readStoredFavorites() ?? presets.map(toFavorite),
  );

  useEffect(() => {
    const onReplaced = (event: Event) => setFavorites((event as CustomEvent<readonly Favorite[]>).detail);
    window.addEventListener(FAVORITES_REPLACED_EVENT, onReplaced);
    return () => window.removeEventListener(FAVORITES_REPLACED_EVENT, onReplaced);
  }, []);

  const isFavorite = useCallback((place: Place) => favorites.some((item) => samePlace(item, place)), [favorites]);

  const toggle = useCallback((place: Place) => {
    setFavorites((current) => {
      const favorite = toFavorite(place);
      const next = current.some((item) => samePlace(item, place))
        ? current.filter((item) => !samePlace(item, place))
        : [...current, ownName(favorite) === undefined ? { ...favorite, mapPoint: true as const } : favorite];
      storeFavorites(next);
      announceFavorites(next);
      return next;
    });
  }, []);

  const rename = useCallback((place: Place, name: string) => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    setFavorites((current) => {
      if (!current.some((item) => samePlace(item, place))) return current;
      const next = current.map((item) => (samePlace(item, place) ? { ...item, name: trimmed, mapPoint: true as const } : item));
      storeFavorites(next);
      announceFavorites(next);
      return next;
    });
  }, []);

  return { favorites, isFavorite, toggle, rename };
}
