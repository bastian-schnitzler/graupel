// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Map provider chosen in the settings (REQ-467): OpenTopoMap (Leaflet) or Maptoolkit (MapLibre). The choice is kept in
 * `localStorage` (like the colour mode) and goes into the settings export. Without a choice the provider from the
 * domain's config.json (`map`, DEC-022) applies. The map picker, the model chain map and the About and Privacy panels
 * use the effective provider (`useMapProvider()`).
 */
import { useCallback, useSyncExternalStore } from "react";
import { useConfig, type MapProvider } from "../config/index.ts";

export const MAP_PROVIDERS = ["opentopomap", "maptoolkit"] as const satisfies readonly MapProvider[];

/** Names of the providers (settings, the switch in the full-screen map, REQ-659); the same in every language. */
export const MAP_PROVIDER_NAMES: Readonly<Record<MapProvider, string>> = {
  opentopomap: "OpenTopoMap",
  maptoolkit: "Maptoolkit",
};

/** The other provider, which the switch in the full-screen map changes to (REQ-659). */
export function otherMapProvider(provider: MapProvider): MapProvider {
  return provider === "opentopomap" ? "maptoolkit" : "opentopomap";
}

/** `localStorage` key of the chosen map provider. */
export const MAP_PROVIDER_STORAGE_KEY = "graupel.map";

export function isMapProvider(value: unknown): value is MapProvider {
  return typeof value === "string" && (MAP_PROVIDERS as readonly string[]).includes(value);
}

/** Stored choice, or `null` without one (also when storage is unavailable or holds something else). */
export function readStoredMapProvider(): MapProvider | null {
  try {
    const value = window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY);
    return isMapProvider(value) ? value : null;
  } catch {
    return null;
  }
}

/** Provider that applies: the own choice, else the one from config.json. */
export function effectiveMapProvider(choice: MapProvider | null, configured: MapProvider): MapProvider {
  return choice ?? configured;
}

const listeners = new Set<() => void>();
// Choice kept for this visit only, when storing it failed (private mode, blocked storage).
let unsaved: MapProvider | null | undefined;

/** Stores the choice (`null` removes it, so config.json applies again) and tells every `useMapProvider()`. */
export function setMapProvider(choice: MapProvider | null): void {
  try {
    if (choice === null) window.localStorage.removeItem(MAP_PROVIDER_STORAGE_KEY);
    else window.localStorage.setItem(MAP_PROVIDER_STORAGE_KEY, choice);
    unsaved = undefined;
  } catch {
    unsaved = choice;
  }
  for (const listener of listeners) listener();
}

function snapshot(): MapProvider | null {
  return unsaved !== undefined ? unsaved : readStoredMapProvider();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed the choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key === MAP_PROVIDER_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Own choice of the map provider (`null`: none), and a setter that stores it. */
export function useMapProviderChoice(): [MapProvider | null, (choice: MapProvider | null) => void] {
  const choice = useSyncExternalStore(subscribe, snapshot, () => null);
  const set = useCallback((next: MapProvider | null) => setMapProvider(next), []);
  return [choice, set];
}

/** Map provider that applies on this page: the own choice, else `map` from config.json. */
export function useMapProvider(): MapProvider {
  const [choice] = useMapProviderChoice();
  return effectiveMapProvider(choice, useConfig().map);
}
