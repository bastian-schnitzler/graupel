// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The selected place, shared by the whole page (REQ-433): the location picker sets it, model chain,
 * meteogram and export/import read or replace it. Starts with the start place (DEC-021, REQ-470, REQ-599): the own
 * choice of the settings, by default the place shown last; without an own choice or a remembered place
 * `startLocation` from config.json. A fixed place is shown at once. With GPS the first favourite (or the default place)
 * is shown and the page asks for the position at start (DEC-107): with the permission it is read without a question,
 * while the browser has yet to ask the user it asks now, a denied permission is not asked again (only its card shows);
 * once the position is there it replaces the first favourite. Every place shown after the start is remembered in
 * `localStorage` (REQ-599).
 *
 * REQ-760: the start with GPS always ends with a forecast. The fallback place loads at once, whatever the browser does:
 * with the permission the position replaces it; a denied permission, an error of the position or no answer within
 * `START_GPS_TIMEOUT_MS` (a prompt or position that never answers, as possible in the installed app on iOS) is
 * reported as `startGpsError`, which the location picker shows like an error of its GPS button.
 *
 * REQ-765: "My location" names only the position just found. When the page shows again after it was hidden (the app
 * closed or sent to the background), that position is no longer current: the place loses the name and is shown by its
 * coordinates. The page does not look for the position again then, also not with GPS as start place. A share sheet or
 * save dialog that hides the page meanwhile (`keepingPlaceName`) is no leaving.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_CONFIG,
  startPlace,
  useConfig,
  type GraupelConfig,
  type Place,
  type StartLocation,
} from "../config/index.ts";
import { useT } from "../i18n/index.ts";
import { DEFAULT_START_LOCATION, startLocationChoice, type StartLocationChoice } from "./displaySettings.ts";
import { readStoredFavorites } from "./favorites.ts";
import { GPS_PLACE_NAMES, isPlace, keptPlace, samePlace, toPlace } from "./place.ts";

/** `localStorage` key of the place shown last (REQ-599); not part of the settings file. */
export const LAST_PLACE_STORAGE_KEY = "graupel.lastPlace";

/**
 * The place shown last in this browser, or `null` without one (also when storage is unavailable or invalid). A
 * position found by "Current location" comes without its name (`keptPlace`, REQ-765): it is shown by its coordinates.
 */
export function readLastPlace(): Place | null {
  try {
    const text = window.localStorage.getItem(LAST_PLACE_STORAGE_KEY);
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    return isPlace(value) ? keptPlace(value) : null;
  } catch {
    return null;
  }
}

/** Remembers the place shown, for the start choice "last" (REQ-599); without storage it is not remembered. */
export function rememberPlace(place: Place): void {
  try {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, JSON.stringify(toPlace(place)));
  } catch {
    // Private mode or blocked storage: the next visit starts as on a first one.
  }
}

/** Share sheets and save dialogs open now (REQ-765). */
let openSystemDialogs = 0;

/**
 * Runs `action`, which opens a share sheet or a save dialog, so that the page hidden behind it until the returned
 * promise settles does not count as left (REQ-765): coming back from it keeps "My location".
 */
export function keepingPlaceName<T>(action: () => Promise<T>): Promise<T> {
  openSystemDialogs += 1;
  let result: Promise<T>;
  try {
    result = action();
  } catch (error) {
    openSystemDialogs -= 1;
    throw error;
  }
  const done = () => {
    openSystemDialogs -= 1;
  };
  result.then(done, done);
  return result;
}

/**
 * Start place that applies (REQ-470, REQ-599): GPS or a fixed place as chosen; with "last", also without an own
 * choice, the remembered place, else `startLocation` from config.json (a place, or "gps" like the GPS choice).
 */
export function effectiveStartLocation(
  choice: StartLocationChoice | null,
  configured: StartLocation,
  remembered: Place | null = null,
): StartLocation {
  const start = choice ?? DEFAULT_START_LOCATION;
  if (start !== "last") return start;
  return remembered ?? configured;
}

/** Error codes of the Geolocation API: 1 denied, 2 no position, 3 timeout. */
export type GeolocationErrorCode = 1 | 2 | 3;

/**
 * How long the start with GPS waits for the position (REQ-760), the browser's prompt included; as long as the GPS
 * button lets the browser look for it.
 */
export const START_GPS_TIMEOUT_MS = 20_000;

export interface LocationContextValue {
  /** The selected place. */
  place: Place;
  /** Selects a place; extra fields of search results are dropped. */
  setLocation: (place: Place) => void;
  /**
   * Why the start with GPS shows the fallback place instead of the position (REQ-760): denied, no position, or no
   * answer in time; `null` otherwise, also while the page does not look for the position at all.
   */
  startGpsError?: GeolocationErrorCode | null;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export interface LocationProviderProps {
  /** Place at start; default the start place of the settings (by default the place shown last) or the configuration. */
  initial?: Place;
  children: ReactNode;
}

/** Configuration with the start place of the settings and the user's favourites (for the GPS fallback). */
function startConfig(config: GraupelConfig): GraupelConfig {
  const startLocation = effectiveStartLocation(startLocationChoice.read(), config.startLocation, readLastPlace());
  const presets = readStoredFavorites() ?? config.favorites.presets;
  return { ...config, startLocation, favorites: { ...config.favorites, presets } };
}

/**
 * How long the start waits for the permission query before it asks for the position anyway (REQ-760): the installed
 * app on iOS may never answer the query.
 */
export const PERMISSION_QUERY_WAIT_MS = 1_000;

/**
 * Whether the browser denies the page the position for good (DEC-107): then the page does not ask at all. `false` when
 * it allows it, would ask the user, cannot tell, or does not answer within `PERMISSION_QUERY_WAIT_MS`.
 */
function geolocationDenied(): Promise<boolean> {
  let query: Promise<PermissionStatus>;
  try {
    if (!navigator.permissions?.query) return Promise.resolve(false);
    query = navigator.permissions.query({ name: "geolocation" });
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PERMISSION_QUERY_WAIT_MS);
    query.then(
      (status) => {
        clearTimeout(timer);
        resolve(status.state === "denied");
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** A code of the Geolocation API, unknown ones as "no position". */
const errorCode = (code: number): GeolocationErrorCode => (code === 1 || code === 3 ? code : 2);

/** Holds the selected place; put it inside the `ConfigProvider`. */
export function LocationProvider({ initial, children }: LocationProviderProps) {
  const config = useConfig();
  const t = useT();
  const [start] = useState(() => startConfig(config));
  const [place, setPlace] = useState<Place>(() => toPlace(initial ?? startPlace(start)));
  const [startGpsError, setStartGpsError] = useState<GeolocationErrorCode | null>(null);
  const latestPlace = useRef(place);
  // Set once the user picks a place; a late GPS position then no longer replaces it. The elevation fetched for the
  // place shown (same point) is no choice of the user (REQ-760): the position found at start still replaces it.
  const chosen = useRef(false);
  // REQ-765: the position whose name a return to the page took away. Its elevation fetched meanwhile (same point, with
  // the old name) does not bring the name back; locating again (no elevation yet) or another place ends this.
  const leftPosition = useRef<Place | null>(null);
  const setLocation = useCallback((next: Place) => {
    if (!samePlace(next, latestPlace.current)) chosen.current = true;
    let shown = toPlace(next);
    const left = leftPosition.current;
    if (left && samePlace(shown, left) && shown.elevation !== undefined) shown = keptPlace(shown);
    else leftPosition.current = null;
    latestPlace.current = shown;
    setPlace(shown);
    rememberPlace(shown);
  }, []);
  const gpsName = useRef(t("location.gps.placeName"));
  useEffect(() => {
    gpsName.current = t("location.gps.placeName");
  }, [t]);

  // REQ-765: back after the page was hidden, a position found before is no longer current; it is shown by its
  // coordinates. Only a real return counts: hidden, then visible again, without a share sheet or save dialog open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let hidden = false;
    let hiddenByDialog = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hidden = true;
        hiddenByDialog = openSystemDialogs > 0;
        return;
      }
      if (document.visibilityState !== "visible" || !hidden) return;
      const left = !hiddenByDialog && openSystemDialogs === 0;
      hidden = false;
      hiddenByDialog = false;
      if (!left || !GPS_PLACE_NAMES.has(latestPlace.current.name.trim())) return;
      const shown = keptPlace(latestPlace.current);
      leftPosition.current = shown;
      latestPlace.current = shown;
      setPlace(shown);
      rememberPlace(shown);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const locateAtStart = initial === undefined && start.startLocation === "gps";
  // DEC-107: with GPS as start place the page asks for the position at start, the browser's prompt included.
  // REQ-760: the fallback place's forecast loads meanwhile; whatever the browser answers (or not), it stays unless the
  // position comes. The page's own timer covers what the browser's timeout does not: a prompt that never answers.
  useEffect(() => {
    if (!locateAtStart || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    let cancelled = false;
    let settled = false;
    const fail = (code: GeolocationErrorCode) => {
      if (cancelled || settled) return;
      settled = true;
      clearTimeout(timer);
      // A place the user picked meanwhile needs no word on the position.
      if (!chosen.current) setStartGpsError(code);
    };
    const timer = setTimeout(() => fail(3), START_GPS_TIMEOUT_MS);
    const found = (position: GeolocationPosition) => {
      if (cancelled) return;
      settled = true;
      clearTimeout(timer);
      if (chosen.current) return;
      leftPosition.current = null;
      const shown: Place = {
        name: gpsName.current,
        lat: Number(position.coords.latitude.toFixed(4)),
        lon: Number(position.coords.longitude.toFixed(4)),
      };
      latestPlace.current = shown;
      setPlace(shown);
      rememberPlace(shown);
      // A position after the timeout still counts; its message goes.
      setStartGpsError(null);
    };
    // DEC-107: asked only where the browser does not give the position without asking. Denied for good: no request,
    // only the card. Allowed: the position comes without a question. Else the browser asks the user now; until the
    // answer the fallback place stands.
    void geolocationDenied().then((denied) => {
      if (cancelled || settled) return;
      if (denied) {
        fail(1);
        return;
      }
      try {
        navigator.geolocation.getCurrentPosition(found, (error) => fail(errorCode(error.code)), {
          enableHighAccuracy: true,
          timeout: START_GPS_TIMEOUT_MS,
          maximumAge: 60_000,
        });
      } catch {
        fail(2);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [locateAtStart]);

  const value = useMemo<LocationContextValue>(
    () => ({ place, setLocation, startGpsError }),
    [place, setLocation, startGpsError],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

const FALLBACK: LocationContextValue = { place: startPlace(DEFAULT_CONFIG), setLocation: () => {} };

/** The selected place and its setter; outside a `LocationProvider` the default start place, read-only. */
export function useLocation(): LocationContextValue {
  return useContext(LocationContext) ?? FALLBACK;
}
