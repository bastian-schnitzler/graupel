// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "My location" is only for the position just found (REQ-765): the field shows it after "Current location", but a
 * favourite made from it is named by its coordinates, as a place without own name (REQ-536), and so is the place shown
 * last when the page opens again. Favourites, a remembered place or a fixed start place stored earlier with the name,
 * in any language of the page, are named by their coordinates when read. Back after the page was hidden (the app
 * closed or sent to the background), the position shown is named by its coordinates too, without locating again; a
 * share sheet or save dialog that hides the page meanwhile keeps "My location".
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type Place } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES } from "../src/i18n/index.ts";
import { LocationPicker } from "../src/regions/LocationPicker/index.ts";
import {
  FAVORITES_STORAGE_KEY,
  GPS_PLACE_NAMES,
  LAST_PLACE_STORAGE_KEY,
  LocationProvider,
  START_LOCATION_STORAGE_KEY,
  keepingPlaceName,
  readLastPlace,
  readStoredFavorites,
  resetDisplaySettings,
  startLocationChoice,
  useLocation,
  type Favorite,
} from "../src/state/index.ts";

const HOME = { lat: 51.1806, lon: 7.5093 };

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Back to jsdom's own visibility (the prototype's getters).
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(document, "hidden");
});

function Probe() {
  const { place } = useLocation();
  return <output data-testid="place">{JSON.stringify(place)}</output>;
}

const currentPlace = () => JSON.parse(screen.getByTestId("place").textContent ?? "{}") as Place;
const field = () => screen.getByRole("combobox") as HTMLInputElement;
const storedFavorites = () => JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]") as Favorite[];

/**
 * The page's location picker in `language`; "Current location" finds `HOME` at once. `fetchElevation` by default finds
 * none.
 */
function renderPicker(language = "en", fetchElevation: () => Promise<number | undefined> = async () => undefined) {
  const geolocation = {
    getCurrentPosition: (ok: PositionCallback) =>
      ok({ coords: { latitude: HOME.lat, longitude: HOME.lon } } as GeolocationPosition),
  } as unknown as Geolocation;
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider browserLanguages={[language]}>
        <NoticesProvider>
          <LocationProvider>
            <LocationPicker searchDelay={0} services={{ geolocation, fetchElevation }} />
            <Probe />
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

/** Names of the favourites menu's entries (without the pencils of map points, which have no text). */
function favoriteEntries(showLabel: string): string[] {
  fireEvent.click(screen.getByRole("button", { name: showLabel }));
  const menu = screen.getByRole("menu", { hidden: true });
  return within(menu)
    .getAllByRole("menuitem", { hidden: true })
    .map((item) => item.textContent ?? "")
    .filter((text) => text !== "");
}

describe("the name of a found position (REQ-765)", () => {
  it("knows the name of every language of the page", () => {
    for (const language of LANGUAGES) {
      expect(GPS_PLACE_NAMES.has(MESSAGES[language]["location.gps.placeName"]!)).toBe(true);
    }
    expect(GPS_PLACE_NAMES.has("Mein Standort")).toBe(true);
    expect(GPS_PLACE_NAMES.has("Innsbruck")).toBe(false);
  });
});

describe("a favourite made from 'My location' (REQ-765)", () => {
  it("is stored without name and listed by its coordinates, while the field still shows 'My location'", async () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, "[]");
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    expect(field().value).toBe("My location");
    fireEvent.click(screen.getByRole("button", { name: "Add My location to favourites" }));
    await act(async () => {});
    // Kept like a point picked on the map: no own name, so it can be renamed (REQ-489).
    expect(storedFavorites()).toEqual([{ name: "", lat: HOME.lat, lon: HOME.lon, mapPoint: true }]);
    expect(field().value).toBe("My location");
    expect(currentPlace()).toMatchObject({ name: "My location", ...HOME });
    expect(favoriteEntries("Show favourites")).toContain("51.1806° N · 7.5093° E");
  });
});

describe("stored earlier with the name (REQ-765)", () => {
  it("renames old favourites called 'My location' in any language on load", () => {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([
        { name: "Mein Standort", lat: 47.1235, lon: 11.6543, elevation: 600 },
        { name: "Ma position", lat: 46.5, lon: 11.25 },
        { name: "Innsbruck", lat: 47.2627, lon: 11.3945 },
      ]),
    );
    expect(readStoredFavorites()).toEqual([
      { name: "", lat: 47.1235, lon: 11.6543, elevation: 600 },
      { name: "", lat: 46.5, lon: 11.25 },
      { name: "Innsbruck", lat: 47.2627, lon: 11.3945 },
    ]);
    renderPicker("de");
    expect(favoriteEntries("Favoriten anzeigen")).toEqual([
      "47,1235° N · 11,6543° O",
      "46,5000° N · 11,2500° O",
      "Innsbruck",
    ]);
  });

  it("names a remembered place 'Mein Standort' by its coordinates on load", () => {
    window.localStorage.setItem(
      LAST_PLACE_STORAGE_KEY,
      JSON.stringify({ name: "Mein Standort", lat: 47.1235, lon: 11.6543, elevation: 600 }),
    );
    expect(readLastPlace()).toEqual({ name: "", lat: 47.1235, lon: 11.6543, elevation: 600 });
    // Start place "last" (the default): the page opens with it, shown by its coordinates.
    renderPicker("de");
    expect(currentPlace()).toEqual({ name: "", lat: 47.1235, lon: 11.6543, elevation: 600 });
    expect(field().value).toBe("47,1235° N · 11,6543° O");
  });

  it("names a fixed start place 'My location' by its coordinates", () => {
    window.localStorage.setItem(START_LOCATION_STORAGE_KEY, JSON.stringify({ name: "My location", ...HOME }));
    resetDisplaySettings();
    expect(startLocationChoice.read()).toEqual({ name: "", ...HOME });
  });
});

/** The browser reports the page `state` (hidden: the app closed or in the background), outside React's `act`. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The page turns `state`. */
function turn(state: DocumentVisibilityState) {
  act(() => setVisibility(state));
}

const remembered = () => JSON.parse(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY) ?? "null") as Place | null;

describe("back after the page was hidden (REQ-765)", () => {
  it("shows the position found before by its coordinates, and remembers it so", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    expect(field().value).toBe("My location");
    turn("hidden");
    // Still hidden: nothing changes yet.
    expect(field().value).toBe("My location");
    turn("visible");
    expect(field().value).toBe("51.1806° N · 7.5093° E");
    expect(currentPlace()).toEqual({ name: "", ...HOME });
    expect(remembered()).toEqual({ name: "", ...HOME });
  });

  it("keeps the coordinates when the elevation comes with the return; locating again names it anew", async () => {
    const answers: ((elevation: number) => void)[] = [];
    renderPicker("en", () => new Promise<number>((resolve) => answers.push(resolve)));
    const locateButton = () => screen.getByRole("button", { name: "Current location" });
    fireEvent.click(locateButton());
    expect(answers).toHaveLength(1);
    turn("hidden");
    // The elevation of the position (still named "My location") arrives before the page has drawn the return.
    await act(async () => {
      setVisibility("visible");
      answers[0]!(327);
    });
    expect(field().value).toBe("51.1806° N · 7.5093° E");
    expect(currentPlace()).toMatchObject({ name: "", ...HOME });
    // A new search for the position at the same point: "My location" again, also with its elevation.
    fireEvent.click(locateButton());
    expect(field().value).toBe("My location");
    await act(async () => answers.at(-1)!(327));
    expect(currentPlace()).toEqual({ name: "My location", ...HOME, elevation: 327 });
  });

  it("counts only a real return: visible without hidden before keeps 'My location'", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    turn("visible");
    expect(field().value).toBe("My location");
  });

  it("keeps a place with own name", () => {
    renderPicker();
    turn("hidden");
    turn("visible");
    expect(field().value).toBe("Mont Blanc");
  });

  it("keeps 'My location' while a share sheet or save dialog hides the page", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    let close!: () => void;
    const shared = keepingPlaceName(() => new Promise<void>((resolve) => (close = resolve)));
    turn("hidden");
    turn("visible");
    expect(field().value).toBe("My location");
    // Hidden behind the sheet, back only after it closed: still no leaving.
    turn("hidden");
    await act(async () => {
      close();
      await shared;
    });
    turn("visible");
    expect(field().value).toBe("My location");
    // Closed: the next return counts.
    turn("hidden");
    turn("visible");
    expect(field().value).toBe("51.1806° N · 7.5093° E");
  });

  it("does not locate again on return, also with the start place GPS", async () => {
    startLocationChoice.set("gps");
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: HOME.lat, longitude: HOME.lon } } as GeolocationPosition),
    );
    const query = vi.fn(() => Promise.resolve({ state: "granted" }));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition }, permissions: { query } });
    renderPicker();
    // The start locates (DEC-107): "My location".
    await act(async () => {});
    expect(field().value).toBe("My location");
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    turn("hidden");
    turn("visible");
    await act(async () => {});
    expect(field().value).toBe("51.1806° N · 7.5093° E");
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
