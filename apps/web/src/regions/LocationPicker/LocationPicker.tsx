// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Location picker (REQ-433): place search with suggestions, full-screen map, current location by GPS
 * (on button press, DEC-021; at start with GPS as start place, DEC-107) and favourites (split button, REQ-450);
 * below them elevation and coordinates of the place, except on a phone (REQ-573), where place and elevation stand
 * between the day slider's grips (REQ-562).
 * Condensed (REQ-455): no visible heading; the GPS button sits inside the field on the left, an X to empty it on the
 * right; behind the field the map button as an icon, then, set apart, the favourites.
 * The selected place lives in the location state (`useLocation`). A renamed map-point favourite (REQ-489) lends its
 * name to the place whenever the place has its coordinates; a place without own name (a point picked on the map) is
 * named by its coordinates in the active language (REQ-536, `placeLabel`). Errors of the search and the GPS show as cards in the
 * bottom-left corner (REQ-492), not in the region. On the desktop the full-screen map has the same search field and
 * favourites in its top-left corner (REQ-641), with the elevation of the place marked there below them (REQ-673), but
 * no coordinates, not even for a named place (REQ-732). Where the place row's field already names the place by its
 * coordinates, the coordinates do not stand below it a second time; the elevation stays (REQ-673). In the installed app
 * the desktop's place row ends with the history's clock button (REQ-684).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConfig, type Place } from "../../config/index.ts";
import { useI18n } from "../../i18n/index.ts";
import {
  fetchElevation as defaultFetchElevation,
  searchPlaces as defaultSearchPlaces,
  type PlaceSuggestion,
  type RequestOptions,
  type SearchOptions,
} from "../../services/geocoding.ts";
import {
  isMapPointFavorite,
  placeKey,
  placeLabel,
  useFavorites,
  useForecast,
  useLocation,
  useNotices,
  usePhone,
  type Favorite,
} from "../../state/index.ts";
import { HistorySplitButton } from "../History/HistorySplitButton.tsx";
import { FavoritesSplitButton } from "./FavoritesSplitButton.tsx";
import { MapDialog } from "./MapDialog.tsx";
import { Icon } from "./Icon.tsx";
import { PlaceSearch, gpsErrorNotice } from "./PlaceSearch.tsx";
import { formatCoordinates, formatElevation } from "./format.ts";
import { currentLocationHint, type LocationHint } from "./locationHint.ts";
import "./LocationPicker.css";

/** External services of the picker; tests replace them. */
export interface LocationServices {
  searchPlaces: (query: string, options: SearchOptions) => Promise<PlaceSuggestion[]>;
  fetchElevation: (lat: number, lon: number, options: RequestOptions) => Promise<number | undefined>;
  /** Browser geolocation; `undefined` when the browser has none. */
  geolocation: Geolocation | undefined;
  /** Where this browser allows the location again (REQ-509); default from the user agent. */
  locationHint: () => LocationHint;
}

type FetchElevation = LocationServices["fetchElevation"];

export interface LocationPickerProps {
  services?: Partial<LocationServices>;
  /** Pause after typing before searching, in milliseconds. */
  searchDelay?: number;
  /** At the end of the place row, after the favourites: the phone's menu (REQ-580). */
  end?: ReactNode;
}

function browserGeolocation(): Geolocation | undefined {
  return typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : undefined;
}

/**
 * A map-point favourite is selected without own name, so that the place falls back to its coordinates once the
 * favourite is removed; while it is a favourite, its own name is shown.
 */
function favoritePlace(favorite: Favorite): Place {
  return isMapPointFavorite(favorite) ? { ...favorite, name: "" } : favorite;
}

interface PlaceFactsProps {
  place: Place;
  label: string;
  elevation: number | undefined;
  /** Whether the coordinates may stand there at all; the full-screen map has none (REQ-732). */
  withCoordinates?: boolean;
}

/**
 * Elevation and coordinates of a place, below its search field (REQ-433). The coordinates are left out when the field
 * already shows them as the name of a place without own name (REQ-673, REQ-536), and always in the full-screen map
 * (REQ-732); the elevation always stays.
 */
function PlaceFacts({ place, label, elevation, withCoordinates = true }: PlaceFactsProps) {
  const { t, locale } = useI18n();
  const coordinates = formatCoordinates(place.lat, place.lon, locale, t);
  return (
    <dl className="location__facts">
      <div>
        <dt>{t("location.elevation")}</dt>
        <dd data-testid="location-elevation">{formatElevation(elevation, locale, t)}</dd>
      </div>
      {withCoordinates && label !== coordinates && (
        <div>
          <dt>{t("location.coordinates")}</dt>
          <dd data-testid="location-coordinates">{coordinates}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Elevation of a place marked in the full-screen map (REQ-673): its own, else fetched from the elevation API as for the
 * place row. `null` fetches nothing (the place row's place, whose elevation the picker fetches itself). A fetched value
 * goes to `known`, so that the place row has it at once when OK takes the place.
 */
function useMarkedElevation(
  place: Place | null,
  fetchElevation: FetchElevation,
  known: Map<string, number>,
): number | undefined {
  const [fetched, setFetched] = useState<{ place: Place; elevation: number } | null>(null);
  const fetchRef = useRef(fetchElevation);
  useEffect(() => {
    fetchRef.current = fetchElevation;
  });
  useEffect(() => {
    if (!place || place.elevation !== undefined) return;
    const controller = new AbortController();
    void fetchRef.current(place.lat, place.lon, { signal: controller.signal }).then((elevation) => {
      if (controller.signal.aborted || elevation === undefined) return;
      known.set(placeKey(place), elevation);
      setFetched({ place, elevation });
    });
    return () => controller.abort();
  }, [place, known]);
  if (!place) return undefined;
  return place.elevation ?? (fetched?.place === place ? fetched.elevation : undefined);
}

interface MapFactsProps {
  /** The place marked in the map. */
  shown: Place;
  /** The place of the place row. */
  current: Place;
  fetchElevation: FetchElevation;
  known: Map<string, number>;
}

/**
 * Elevation of the place marked in the full-screen map, below its search field (REQ-673); no coordinates, also not for
 * a named place (REQ-732).
 */
function MapFacts({ shown, current, fetchElevation, known }: MapFactsProps) {
  const marked = shown === current ? null : shown;
  const fetched = useMarkedElevation(marked, fetchElevation, known);
  return <PlaceFacts place={shown} label="" elevation={marked ? fetched : current.elevation} withCoordinates={false} />;
}

export function LocationPicker({ services, searchDelay = 300, end }: LocationPickerProps) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const { place, setLocation, startGpsError = null } = useLocation();
  const favorites = useFavorites(config.favorites.presets);
  const phone = usePhone();
  // On a phone and a tablet the field's GPS symbol turns into a turning refresh symbol while another place's forecast
  // loads, instead of a message over the meteogram (REQ-751); the desktop keeps that message (REQ-497).
  const { placeChanging = false } = useForecast();
  const placeLoading = phone && placeChanging;
  const searchServices = {
    searchPlaces: services?.searchPlaces ?? defaultSearchPlaces,
    geolocation: services && "geolocation" in services ? services.geolocation : browserGeolocation(),
    locationHint: services?.locationHint ?? currentLocationHint,
  };
  const fetchElevation = services?.fetchElevation ?? defaultFetchElevation;

  // The start with GPS ended on the fallback place (REQ-760): the same card as an error of the GPS button, gone when a
  // late position replaces the place after all.
  const { notify, dismiss } = useNotices();
  const hintRef = useRef(searchServices.locationHint);
  useEffect(() => {
    hintRef.current = searchServices.locationHint;
  });
  const startErrorShown = useRef(false);
  useEffect(() => {
    if (startGpsError !== null) {
      startErrorShown.current = true;
      notify(gpsErrorNotice(startGpsError, hintRef.current));
    } else if (startErrorShown.current) {
      startErrorShown.current = false;
      dismiss("location.gps");
    }
  }, [startGpsError, notify, dismiss]);

  // Name shown for a place: the own name of a renamed map-point favourite at its coordinates, else its own name, else
  // its coordinates (REQ-536); a new language re-formats them.
  const nameOf = (target: Place) => placeLabel(target, favorites.favorites, locale, t);

  // Counts the places chosen, so the search field shows the chosen one's name again (`PlaceSearch` resetKey).
  const [chosen, setChosen] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);

  // The latest elevation service, read by the effect without re-running it.
  const elevationRef = useRef(fetchElevation);
  useEffect(() => {
    elevationRef.current = fetchElevation;
  });
  // Elevations fetched for points marked in the full-screen map (REQ-673), by `placeKey`.
  const [knownElevations] = useState(() => new Map<string, number>());

  // Places without elevation (GPS, map points, some search results) get it from the elevation API, unless the
  // full-screen map fetched it already for the point it marked (REQ-673).
  useEffect(() => {
    if (place.elevation !== undefined) return;
    const known = knownElevations.get(placeKey(place));
    if (known !== undefined) {
      setLocation({ ...place, elevation: known });
      return;
    }
    const controller = new AbortController();
    void elevationRef
      .current(place.lat, place.lon, { signal: controller.signal })
      .then((elevation) => {
        if (!controller.signal.aborted && elevation !== undefined) setLocation({ ...place, elevation });
      });
    return () => controller.abort();
  }, [place, setLocation, knownElevations]);

  const select = (next: Place) => {
    setLocation(next);
    setChosen((count) => count + 1);
  };

  /** The search field (GPS inside, X) for the shown place; `loading` only in the place row (REQ-751). */
  const search = (
    shown: Place,
    resetKey: unknown,
    onPick: (next: Place) => void,
    onLocate: (next: Place) => void,
    loading = false,
  ) => (
    <PlaceSearch
      name={nameOf(shown)}
      resetKey={resetKey}
      services={searchServices}
      searchDelay={searchDelay}
      onPick={onPick}
      onLocate={onLocate}
      loading={loading}
    />
  );

  /** The favourites (split button) for the shown place, if the configuration has them. */
  const favoritesButton = (shown: Place, onSelect: (next: Place) => void) =>
    config.favorites.enabled && (
      <FavoritesSplitButton
        place={{ ...shown, name: nameOf(shown) }}
        favorites={favorites.favorites}
        isFavorite={favorites.isFavorite(shown)}
        onToggle={() => favorites.toggle(shown)}
        onSelect={(favorite) => onSelect(favoritePlace(favorite))}
        onRename={favorites.rename}
        labelOf={nameOf}
      />
    );

  const mapLabel = t("location.map.open");

  return (
    <section className="region location" data-region="location" aria-label={t("region.location.title")}>
      <div className="location__bar">
        {search(place, chosen, select, select, placeLoading)}
        <button
          type="button"
          className="button button--icon location__map"
          onClick={() => setMapOpen(true)}
          aria-haspopup="dialog"
          aria-label={mapLabel}
          title={mapLabel}
        >
          <Icon name="map" />
        </button>
        {favoritesButton(place, select)}
        {/*
         * Desktop: the history of the installed app beside the favourites (REQ-684); the phone has it in its menu at the
         * row's end (`end`). So does a tablet showing that menu; with the desktop's header bar instead it has the
         * button here (REQ-731).
         */}
        {end == null && <HistorySplitButton />}
        {end}
      </div>

      {!phone && <PlaceFacts place={place} label={nameOf(place)} elevation={place.elevation} />}

      {mapOpen && (
        <MapDialog
          place={place}
          onClose={() => setMapOpen(false)}
          onAccept={(picked) => {
            setMapOpen(false);
            select(picked);
          }}
          // Desktop: search and favourites top left, as in the place row (REQ-641). A hit or a favourite moves the map
          // and its marker there for OK; the current position is taken at once. Below them the elevation of the
          // marked place (REQ-673), without coordinates (REQ-732).
          tools={({ place: shown, pick, accept }) => (
            <>
              <div className="map-dialog__row">
                {search(shown, shown, pick, accept)}
                {favoritesButton(shown, pick)}
              </div>
              <MapFacts shown={shown} current={place} fetchElevation={fetchElevation} known={knownElevations} />
            </>
          )}
        />
      )}
    </section>
  );
}
