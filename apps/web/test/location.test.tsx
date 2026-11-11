// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE, startPlace, type GraupelConfig, type Place } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { I18nProvider, useI18n } from "../src/i18n/index.ts";
import { LocationPicker, locationHint, type LocationPickerProps } from "../src/regions/LocationPicker/index.ts";
import { formatCoordinates, formatElevation, nextIndex } from "../src/regions/LocationPicker/format.ts";
import {
  enlargeMapLabels,
  featurePlace,
  maptoolkitRequest,
  scaleTextSize,
} from "../src/regions/LocationPicker/map/maptoolkitStyle.ts";
import { ELEVATION_URL, GEOCODING_URL, fetchElevation, searchPlaces, toSuggestion } from "../src/services/geocoding.ts";
import { FAVORITES_STORAGE_KEY, LAST_PLACE_STORAGE_KEY, LocationProvider, useLocation } from "../src/state/index.ts";
import { LANGUAGES, MESSAGES, createTranslate, toLocale } from "../src/i18n/index.ts";
import type { MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";

// Map libraries: mocked; the dialog must load them only when it opens.
const maps = vi.hoisted(() => {
  type Handler = (event: unknown) => void;
  const leafletMaps: {
    options: Record<string, unknown>;
    handlers: Record<string, Handler>;
    setPrefix: ReturnType<typeof vi.fn>;
    /** Attributions the map's control shows (REQ-644). */
    attributions: string[];
    /** Moves of the map to a place (REQ-641). */
    setView: ReturnType<typeof vi.fn>;
  }[] = [];
  const marker = { addTo: vi.fn(() => marker), setLatLng: vi.fn() };
  const leaflet = {
    instances: leafletMaps,
    map: vi.fn((_container: unknown, options: Record<string, unknown>) => {
      const instance = {
        options,
        handlers: {} as Record<string, Handler>,
        setPrefix: vi.fn(),
        attributions: [] as string[],
        setView: vi.fn(),
      };
      leafletMaps.push(instance);
      return {
        remove: vi.fn(),
        setView: instance.setView,
        on: (event: string, handler: Handler) => {
          instance.handlers[event] = handler;
        },
        attributionControl: {
          setPrefix: instance.setPrefix,
          addAttribution: (text: string) => instance.attributions.push(text),
          removeAttribution: (text: string) => {
            instance.attributions = instance.attributions.filter((item) => item !== text);
          },
        },
      };
    }),
    tileLayer: vi.fn<(url: string, options: Record<string, unknown>) => { addTo: () => void; on: () => void }>(() => ({
      addTo: vi.fn(),
      on: vi.fn(),
    })),
    circleMarker: vi.fn(() => marker),
    marker,
    control: { zoom: vi.fn<(options: Record<string, unknown>) => { addTo: () => void }>(() => ({ addTo: vi.fn() })) },
    Control: { Attribution: { prototype: { options: { prefix: "Leaflet" } } } },
  };
  const maplibre: {
    instances: {
      handlers: Record<string, (event: unknown) => void>;
      options: unknown;
      controls: unknown[];
      touchZoomRotate: { disableRotation: () => void };
      keyboard: { disableRotation: () => void };
      jumpTo: ReturnType<typeof vi.fn>;
      marker?: { setLngLat: ReturnType<typeof vi.fn> };
    }[];
  } = {
    instances: [],
  };
  return { leaflet, maplibre };
});

vi.mock("leaflet", () => ({ default: maps.leaflet }));
vi.mock("maplibre-gl", () => {
  class Map {
    handlers: Record<string, (event: unknown) => void> = {};
    controls: unknown[] = [];
    touchZoomRotate = { disableRotation: vi.fn() };
    keyboard = { disableRotation: vi.fn() };
    jumpTo = vi.fn();
    marker?: { setLngLat: ReturnType<typeof vi.fn> };
    constructor(public options: unknown) {
      maps.maplibre.instances.push(this);
    }
    addControl(control: unknown) {
      this.controls.push(control);
    }
    setStyle() {}
    on(event: string, handler: (event: unknown) => void) {
      this.handlers[event] = handler;
    }
    getStyle() {
      return { layers: [] };
    }
    queryRenderedFeatures() {
      return [];
    }
    getCanvas() {
      return { style: {} };
    }
    setPaintProperty() {}
    remove() {}
  }
  class Marker {
    setLngLat = vi.fn(() => this);
    addTo(map: Map) {
      map.marker = this;
      return this;
    }
    remove() {}
  }
  class NavigationControl {
    constructor(public options?: unknown) {}
  }
  return { default: { Map, Marker, NavigationControl } };
});
vi.mock("@maptoolkit/maplibre-gl-logo", () => ({ MaptoolkitLogoControl: class {} }));

const INNSBRUCK = { name: "Innsbruck", latitude: 47.2627, longitude: 11.3945, elevation: 574, admin1: "Tyrol", country: "Austria" };
const INNICHEN = { name: "Innichen", latitude: 46.7333, longitude: 12.2833, admin1: "South Tyrol", country: "Italy" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function Probe() {
  const { place } = useLocation();
  return <output data-testid="place">{JSON.stringify(place)}</output>;
}

function currentPlace(): Place {
  return JSON.parse(screen.getByTestId("place").textContent ?? "{}") as Place;
}

/** Five mountains as favourites of a configuration that presets them; the domains preset none (REQ-708). */
const MOUNTAINS: Place[] = [
  { name: "Großglockner", lat: 47.0742, lon: 12.6947, elevation: 3798 },
  { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 },
  { name: "Mont Blanc", lat: 45.8326, lon: 6.8652, elevation: 4806 },
  { name: "Gran Paradiso", lat: 45.5175, lon: 7.2669, elevation: 4061 },
  { name: "Ortler", lat: 46.5086, lon: 10.5447, elevation: 3905 },
];
const WITH_PRESETS: GraupelConfig = { ...DEFAULT_CONFIG, favorites: { enabled: true, presets: MOUNTAINS } };

function renderPicker(
  config: GraupelConfig = DEFAULT_CONFIG,
  props: LocationPickerProps = {},
  language = "en",
) {
  return render(
    <ConfigProvider config={config}>
      <I18nProvider browserLanguages={[language]}>
        <NoticesProvider>
          <LocationProvider>
            <LocationPicker searchDelay={0} {...props} />
            <Probe />
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

function type(text: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: text } });
  return input;
}

beforeEach(() => {
  window.localStorage.clear();
  maps.maplibre.instances.length = 0;
  maps.leaflet.instances.length = 0;
  maps.leaflet.marker.setLatLng.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("condensed layout (REQ-455)", () => {
  const region = () => screen.getByRole("region", { name: "Location" });

  it("has no visible heading; field, GPS inside the field, X, map and favourites are named buttons", () => {
    const { container } = renderPicker();
    expect(within(region()).queryByRole("heading")).toBeNull();
    expect(container.querySelector(".region__title")).toBeNull();
    const field = container.querySelector(".location__field")!;
    const input = within(region()).getByRole("combobox", { name: "Search for a place" });
    const gps = within(region()).getByRole("button", { name: "Current location" });
    const clear = within(region()).getByRole("button", { name: "Clear search" });
    // GPS left of the input and X right of it, both inside the field.
    expect([...field.children].filter((el) => el.tagName !== "LABEL")).toEqual([gps, input, clear]);
    expect(gps.getAttribute("title")).toBe("Current location");
    expect(clear.getAttribute("title")).toBe("Clear search");
    // Behind the field: the map button as an icon only, then the favourites.
    const map = within(region()).getByRole("button", { name: "Map" });
    expect(map.textContent).toBe("");
    expect(map.getAttribute("title")).toBe("Map");
    expect(field.contains(map)).toBe(false);
    const star = within(region()).getByRole("button", { name: new RegExp(`${DEFAULT_PLACE.name} (to|from) favourites`) });
    expect(field.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.compareDocumentPosition(star) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the X empties the field and focuses it; the place stays until another is chosen", () => {
    renderPicker();
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe(DEFAULT_PLACE.name);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(currentPlace()).toEqual(DEFAULT_PLACE);
    // Leaving the empty field shows the selected place again.
    fireEvent.blur(input);
    expect(input.value).toBe(DEFAULT_PLACE.name);
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("the X clears a typed query and closes the suggestions", async () => {
    const searchPlacesMock = vi.fn(async () => [{ name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 }]);
    renderPicker(DEFAULT_CONFIG, { services: { searchPlaces: searchPlacesMock } });
    const input = type("Inns");
    await screen.findAllByRole("option");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((input as HTMLInputElement).value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("the GPS button in the field shows that it is busy and selects the position", () => {
    let answer: PositionCallback | undefined;
    const geo = { getCurrentPosition: vi.fn((ok: PositionCallback) => (answer = ok)) } as unknown as Geolocation;
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo, fetchElevation: async () => undefined } });
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    const busy = screen.getByRole("button", { name: "Locating…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    act(() => answer!({ coords: { latitude: 46.5, longitude: 11.25 } } as GeolocationPosition));
    expect(currentPlace()).toMatchObject({ name: "My location", lat: 46.5, lon: 11.25 });
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("My location");
    expect(screen.getByRole("button", { name: "Current location" }).getAttribute("aria-busy")).toBe("false");
  });

  it("the map icon button opens the map dialog", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByRole("dialog", { name: "Map" })).toBeTruthy();
    await waitFor(() => expect(maps.leaflet.map).toHaveBeenCalled());
  });

  it("names the buttons in the page language", () => {
    renderPicker(DEFAULT_CONFIG, {}, "de");
    const region = screen.getByRole("region", { name: "Ort" });
    expect(within(region).getByRole("button", { name: "Aktueller Standort" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Suchfeld leeren" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Karte" })).toBeTruthy();
  });
});

describe("geocoding service", () => {
  it("searches Open-Meteo in the given language and maps the results", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [INNSBRUCK, { name: "broken" }, INNICHEN] }));
    const results = await searchPlaces(" Inns ", { language: "de", fetch: fetchMock as unknown as typeof fetch });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(`${url.origin}${url.pathname}`).toBe(GEOCODING_URL);
    expect(url.searchParams.get("name")).toBe("Inns");
    expect(url.searchParams.get("language")).toBe("de");
    expect(results).toEqual([
      { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574, admin1: "Tyrol", country: "Austria" },
      { name: "Innichen", lat: 46.7333, lon: 12.2833, admin1: "South Tyrol", country: "Italy" },
    ]);
  });

  it("does not search short queries and throws on HTTP errors", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    expect(await searchPlaces("I", { fetch: fetchMock as unknown as typeof fetch })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(searchPlaces("Inns", { fetch: fetchMock as unknown as typeof fetch })).rejects.toThrow("500");
    expect(await searchPlaces("Inns", { fetch: (async () => jsonResponse({})) as typeof fetch })).toEqual([]);
  });

  it("reads the elevation, undefined on errors", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ elevation: [1234.5] }));
    expect(await fetchElevation(47, 11, { fetch: fetchMock as unknown as typeof fetch })).toBe(1234.5);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${ELEVATION_URL}?latitude=47&longitude=11`);
    expect(await fetchElevation(47, 11, { fetch: (async () => jsonResponse({}, 500)) as typeof fetch })).toBeUndefined();
    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchElevation(47, 11, { fetch: failing })).toBeUndefined();
  });

  it("accepts numeric strings and drops results without coordinates", () => {
    expect(toSuggestion({ name: "A", latitude: "1.5", longitude: 2, elevation: "300" })).toEqual({
      name: "A",
      lat: 1.5,
      lon: 2,
      elevation: 300,
    });
    expect(toSuggestion({ name: "A", latitude: 1 })).toBeNull();
  });
});

describe("formatting", () => {
  it("formats coordinates with hemispheres and the locale", () => {
    expect(formatCoordinates(45.8326, 6.8652, "en", createTranslate("en"))).toBe("45.8326° N · 6.8652° E");
    expect(formatCoordinates(-33.9, -70.25, "de-DE", createTranslate("de"))).toBe("33,9000° S · 70,2500° W");
  });

  it("wraps the highlighted suggestion", () => {
    expect(nextIndex(-1, 3, "down")).toBe(0);
    expect(nextIndex(2, 3, "down")).toBe(0);
    expect(nextIndex(0, 3, "up")).toBe(2);
    expect(nextIndex(0, 0, "down")).toBe(-1);
  });
});

describe("start place", () => {
  it("starts with the configured place and shows its elevation and coordinates", () => {
    renderPicker();
    expect(currentPlace()).toEqual(DEFAULT_PLACE);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Mont Blanc");
    expect(screen.getByTestId("location-elevation").textContent).toBe("4,806 m");
    expect(screen.getByTestId("location-coordinates").textContent).toBe("45.8326° N · 6.8652° E");
  });

  it("names elevation and coordinates for screen readers, also where the labels are hidden on phones (REQ-527)", () => {
    renderPicker();
    const facts = screen.getByTestId("location-elevation").closest("dl");
    expect(facts?.classList.contains("location__facts")).toBe(true);
    const rows = [...(facts?.children ?? [])].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.getAttribute("data-testid"),
    ]);
    expect(rows).toEqual([
      ["Elevation", "location-elevation"],
      ["Coordinates", "location-coordinates"],
    ]);
  });

  it('falls back to the first favourite preset for "gps", without asking for the position', () => {
    const getCurrentPosition = vi.fn();
    const presets = [{ name: "Brüssel", lat: 50.8467, lon: 4.3525, elevation: 13 }];
    renderPicker(
      { ...DEFAULT_CONFIG, startLocation: "gps", favorites: { enabled: true, presets } },
      { services: { geolocation: { getCurrentPosition } as unknown as Geolocation } },
    );
    expect(currentPlace()).toEqual(presets[0]);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('falls back to the default place for "gps" without presets', () => {
    expect(startPlace({ ...DEFAULT_CONFIG, startLocation: "gps", favorites: { enabled: true, presets: [] } })).toEqual(
      DEFAULT_PLACE,
    );
  });

  it("fetches a missing elevation", async () => {
    const fetchElevationMock = vi.fn(async () => 2962);
    renderPicker(
      { ...DEFAULT_CONFIG, startLocation: { name: "Zugspitze", lat: 47.4211, lon: 10.9853 } },
      { services: { fetchElevation: fetchElevationMock } },
    );
    expect(screen.getByTestId("location-elevation").textContent).toBe("n/a");
    await waitFor(() => expect(screen.getByTestId("location-elevation").textContent).toBe("2,962 m"));
    expect(fetchElevationMock).toHaveBeenCalledWith(47.4211, 10.9853, expect.anything());
    expect(currentPlace().elevation).toBe(2962);
  });
});

describe("place search", () => {
  it("shows suggestions from the geocoding API and selects one by click", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [INNSBRUCK, INNICHEN] }));
    vi.stubGlobal("fetch", fetchMock);
    renderPicker();
    const input = type("Inns");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "InnsbruckTyrol, Austria574 m",
      "InnichenSouth Tyrol, Italy",
    ]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("name=Inns");

    fireEvent.click(options[0]!);
    expect(currentPlace()).toEqual({ name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 });
    expect((input as HTMLInputElement).value).toBe("Innsbruck");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("location-coordinates").textContent).toBe("47.2627° N · 11.3945° E");
  });

  it("navigates the suggestions with the keyboard", async () => {
    const searchPlacesMock = vi.fn(async () => [
      { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 },
      { name: "Innichen", lat: 46.7333, lon: 12.2833, elevation: 1175 },
    ]);
    renderPicker(DEFAULT_CONFIG, { services: { searchPlaces: searchPlacesMock } });
    const input = type("Inn");
    const options = await screen.findAllByRole("option");
    expect(searchPlacesMock).toHaveBeenCalledWith("Inn", expect.objectContaining({ language: "en" }));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(currentPlace().name).toBe("Innichen");
  });

  it("Enter takes the first suggestion; Escape on a closed list restores the place name", async () => {
    renderPicker(DEFAULT_CONFIG, {
      services: { searchPlaces: async () => [{ name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 }] },
    });
    let input = type("Inns");
    await screen.findAllByRole("option");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(currentPlace().name).toBe("Innsbruck");

    input = type("xy");
    await screen.findAllByRole("option");
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("Innsbruck");
  });

  it("reports no results and search errors", async () => {
    let fail = false;
    renderPicker(DEFAULT_CONFIG, {
      services: {
        searchPlaces: async () => {
          if (fail) throw new Error("offline");
          return [];
        },
      },
    });
    type("Nowhere");
    expect(await screen.findByText("No places found.")).toBeTruthy();
    fail = true;
    type("Nowhere2");
    // The failure is an error card (REQ-492), not a line in the suggestion popup.
    const card = await screen.findByTestId("error-card");
    expect(card.textContent).toBe("The place search failed. Please try again.");
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
    fail = false;
    type("Nowhere3");
    await waitFor(() => expect(screen.queryByTestId("error-card")).toBeNull());
  });
});

describe("favourites (split button)", () => {
  const arrow = () => screen.getByRole("button", { name: "Show favourites" });
  // A hidden element has no accessible name, so the closed menu is found by its role only.
  const menu = () => screen.getByRole("menu", { hidden: true });
  const items = () => within(menu()).queryAllByRole("menuitem", { hidden: true });
  const names = () => items().map((item) => item.textContent);

  it("shows no list of favourite buttons, only the star and the arrow of the split button", () => {
    renderPicker(WITH_PRESETS);
    expect(screen.queryByRole("navigation", { name: "Favourites" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Matterhorn" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Mont Blanc from favourites" })).toBeTruthy();
    expect(arrow().getAttribute("aria-haspopup")).toBe("menu");
    expect(arrow().getAttribute("aria-expanded")).toBe("false");
    expect(arrow().getAttribute("aria-controls")).toBe(menu().id);
    expect(menu().hidden).toBe(true);
  });

  it("lists the presets in the menu and selects one", () => {
    renderPicker(WITH_PRESETS);
    fireEvent.click(arrow());
    expect(arrow().getAttribute("aria-expanded")).toBe("true");
    expect(menu().hidden).toBe(false);
    expect(screen.getByRole("menu", { name: "Favourites" })).toBe(menu());
    expect(names()).toEqual(["Großglockner", "Matterhorn", "Mont Blanc", "Gran Paradiso", "Ortler"]);
    expect(items()[2]!.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.click(items()[1]!);
    expect(currentPlace().name).toBe("Matterhorn");
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(arrow());
    expect(screen.getByRole("button", { name: "Remove Matterhorn from favourites" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("works with the keyboard: arrows, Home, End, Enter, Escape and Tab", () => {
    renderPicker(WITH_PRESETS);
    // Arrow down opens at the first entry, arrow up at the last.
    fireEvent.keyDown(arrow(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[4]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[4]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(items()[4]);
    // Escape closes and returns to the arrow, without choosing.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(arrow());
    expect(currentPlace().name).toBe("Mont Blanc");

    fireEvent.keyDown(arrow(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    // Enter on a menu item activates it (a native button: Enter and Space click it).
    fireEvent.click(document.activeElement!);
    expect(currentPlace().name).toBe("Matterhorn");
    expect(document.activeElement).toBe(arrow());

    // Tab closes the menu.
    fireEvent.keyDown(arrow(), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(menu().hidden).toBe(true);
  });

  it("closes on a press outside and on a second press of the arrow", () => {
    renderPicker(WITH_PRESETS);
    fireEvent.click(arrow());
    fireEvent.pointerDown(document.body);
    expect(menu().hidden).toBe(true);
    fireEvent.click(arrow());
    expect(menu().hidden).toBe(false);
    fireEvent.click(arrow());
    expect(menu().hidden).toBe(true);
  });

  it("starts without favourites, the start place included (REQ-708)", () => {
    renderPicker();
    expect(DEFAULT_CONFIG.favorites.presets).toEqual([]);
    expect(screen.getByRole("button", { name: "Add Mont Blanc to favourites" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(arrow());
    expect(names()).toEqual(["No favourites yet. Mark a place with the star."]);
  });

  it("says so in the menu when there are no favourites", () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, "[]");
    renderPicker(WITH_PRESETS);
    fireEvent.click(arrow());
    expect(names()).toEqual(["No favourites yet. Mark a place with the star."]);
    expect(items()[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("marks and unmarks the current place and keeps the list in localStorage", async () => {
    const { unmount } = renderPicker(WITH_PRESETS, {
      services: { searchPlaces: async () => [{ name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 }] },
    });
    const input = type("Inns");
    fireEvent.click((await screen.findAllByRole("option"))[0]!);

    const star = screen.getByRole("button", { name: "Add Innsbruck to favourites" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(star);
    expect(star.getAttribute("aria-pressed")).toBe("true");
    const stored = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]") as Place[];
    expect(stored.map((place) => place.name)).toEqual(["Großglockner", "Matterhorn", "Mont Blanc", "Gran Paradiso", "Ortler", "Innsbruck"]);
    expect(input).toBeTruthy();
    const innsbruck = { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 };
    expect(JSON.parse(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY)!)).toEqual(innsbruck);
    unmount();

    // A new visit reads the stored list and opens the place shown last (REQ-599); unmarking a preset removes it.
    renderPicker(WITH_PRESETS);
    expect(currentPlace()).toEqual(innsbruck);
    expect(screen.getByRole("button", { name: "Remove Innsbruck from favourites" })).toBeTruthy();
    fireEvent.click(arrow());
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Mont Blanc" }));
    expect(names()).toContain("Innsbruck");
    fireEvent.click(screen.getByRole("button", { name: "Remove Mont Blanc from favourites" }));
    expect(names()).not.toContain("Mont Blanc");
    expect(screen.getByRole("button", { name: "Add Mont Blanc to favourites" })).toBeTruthy();
    const after = JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]") as Place[];
    expect(after.map((place) => place.name)).toEqual(["Großglockner", "Matterhorn", "Gran Paradiso", "Ortler", "Innsbruck"]);
  });

  it("falls back to the presets when storage is broken or unavailable", () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, "{not json");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    renderPicker(WITH_PRESETS);
    expect(items()).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Remove Mont Blanc from favourites" }));
    expect(items()).toHaveLength(4);
  });

  it("hides favourites when the configuration turns them off", () => {
    renderPicker({ ...DEFAULT_CONFIG, favorites: { enabled: false, presets: [] } });
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
    expect(screen.queryByRole("button", { name: /favourites/ })).toBeNull();
  });
});

describe("a map point without own name (REQ-536)", () => {
  function LanguageButton() {
    const { setLanguage } = useI18n();
    return (
      <button type="button" onClick={() => setLanguage("de")}>
        Deutsch
      </button>
    );
  }

  it("shows its coordinates in the field, re-formatted when the language changes", async () => {
    render(
      <ConfigProvider config={DEFAULT_CONFIG}>
        <I18nProvider browserLanguages={["en"]}>
          <NoticesProvider>
            <LocationProvider>
              <LocationPicker searchDelay={0} services={{ fetchElevation: async () => 3158 }} />
              <Probe />
              <LanguageButton />
            </LocationProvider>
          </NoticesProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    act(() => maps.leaflet.instances[0]!.handlers.dblclick!({ latlng: { lat: 46.926312, lng: 10.926087 } }));
    const combobox = screen.getByRole("combobox") as HTMLInputElement;
    expect(combobox.value).toBe("46.9263° N · 10.9261° E");
    expect(currentPlace()).toMatchObject({ name: "", lat: 46.9263, lon: 10.9261 });
    expect(screen.getByRole("button", { name: "Add 46.9263° N · 10.9261° E to favourites" })).toBeTruthy();
    await waitFor(() => expect(currentPlace().elevation).toBe(3158));
    expect(combobox.value).toBe("46.9263° N · 10.9261° E");

    fireEvent.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(combobox.value).toBe("46,9263° N · 10,9261° O");
    // The field shows the coordinates, so they do not stand below it again; the elevation does (REQ-673).
    expect(screen.queryByTestId("location-coordinates")).toBeNull();
    expect(screen.getByTestId("location-elevation").textContent).toBe("3.158 m");
  });

  it("shows no coordinates below the field while it shows them, only the elevation (REQ-673)", async () => {
    renderPicker(DEFAULT_CONFIG, { services: { fetchElevation: async () => 2072 } });
    expect(screen.getByTestId("location-coordinates").textContent).toBe("45.8326° N · 6.8652° E");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    act(() => maps.leaflet.instances[0]!.handlers.dblclick!({ latlng: { lat: 46.9726, lng: 10.9828 } }));
    const facts = within(screen.getByRole("region", { name: "Location" })).getByTestId("location-elevation").closest("dl")!;
    await waitFor(() => expect(within(facts).getByTestId("location-elevation").textContent).toBe("2,072 m"));
    expect(within(facts).queryByTestId("location-coordinates")).toBeNull();
    expect(facts.textContent).not.toContain("Coordinates");
  });

  it("keeps the coordinates below the field for a renamed map-point favourite (REQ-673)", () => {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([{ name: "Hütte", lat: 46.9263, lon: 10.9261, elevation: 2200, mapPoint: true }]),
    );
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Show favourites" }));
    fireEvent.click(within(screen.getByRole("menu", { hidden: true })).getByRole("menuitem", { name: "Hütte", hidden: true }));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Hütte");
    expect(screen.getByTestId("location-coordinates").textContent).toBe("46.9263° N · 10.9261° E");
    expect(screen.getByTestId("location-elevation").textContent).toBe("2,200 m");
  });

  it("shows a stored favourite with an old generic name by its coordinates", () => {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([{ name: "Point sur la carte", lat: 46.9263, lon: 10.9261, mapPoint: true }]),
    );
    renderPicker(DEFAULT_CONFIG, {}, "de");
    fireEvent.click(screen.getByRole("button", { name: "Favoriten anzeigen" }));
    const menu = screen.getByRole("menu", { hidden: true });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "46,9263° N · 10,9261° O", hidden: true }));
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("46,9263° N · 10,9261° O");
    expect(currentPlace()).toMatchObject({ name: "", lat: 46.9263, lon: 10.9261 });
  });
});

describe("renaming a map-point favourite (REQ-489)", () => {
  const arrow = () => screen.getByRole("button", { name: "Show favourites" });
  const menu = () => screen.getByRole("menu", { hidden: true });
  const entry = (name: string) => within(menu()).getByRole("menuitem", { name, hidden: true });
  const pencil = (name: string) => within(menu()).queryByRole("menuitem", { name: `Rename ${name}`, hidden: true });
  const field = () => screen.getByRole("textbox", { name: "Name of the favourite" }) as HTMLInputElement;
  const combobox = () => screen.getByRole("combobox") as HTMLInputElement;
  const stored = () => JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]") as (Place & { mapPoint?: true })[];
  const MATTERHORN = { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 };
  // A point picked on the map has no own name and is shown by its coordinates (REQ-536).
  const POINT = { name: "", lat: 47.1718, lon: 12.6806, mapPoint: true as const };
  const PT = "47.1718° N · 12.6806° E";

  function seed(favorites: unknown[]) {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }

  function rename(from: string, to: string, key = "Enter") {
    fireEvent.click(pencil(from)!);
    // A point without own name starts with an empty field.
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
    fireEvent.change(field(), { target: { value: to } });
    fireEvent.keyDown(field(), { key });
  }

  it("marks a point picked on the map as a map point and gives only it a pencil", async () => {
    renderPicker(DEFAULT_CONFIG, { services: { fetchElevation: async () => 2779 } });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    act(() => maps.leaflet.instances[0]!.handlers.dblclick!({ latlng: { lat: 47.171812, lng: 12.680634 } }));
    fireEvent.click(screen.getByRole("button", { name: `Add ${PT} to favourites` }));
    expect(stored().at(-1)).toEqual({ name: "", lat: 47.1718, lon: 12.6806, mapPoint: true });

    fireEvent.click(arrow());
    expect(pencil(PT)).toBeTruthy();
    expect(pencil("Matterhorn")).toBeNull();
    expect(pencil(PT)!.getAttribute("title")).toBe(`Rename ${PT}`);
  });

  it("stores the new name, shows it in the menu and for the selected place with the same coordinates", async () => {
    seed([MATTERHORN, POINT]);
    renderPicker(DEFAULT_CONFIG, {
      services: { searchPlaces: async () => [{ name: "Somewhere", lat: 47.17181, lon: 12.68059 }] },
    });
    fireEvent.click(arrow());
    rename(PT, "  Hausberg  ");
    expect(stored()).toEqual([MATTERHORN, { ...POINT, name: "Hausberg" }]);
    expect(entry("Hausberg")).toBeTruthy();
    expect(document.activeElement).toBe(entry("Hausberg"));
    expect(menu().hidden).toBe(false);

    // Chosen from the menu, the place is shown with the new name.
    fireEvent.click(entry("Hausberg"));
    expect(combobox().value).toBe("Hausberg");
    expect(currentPlace()).toMatchObject({ lat: 47.1718, lon: 12.6806 });
    expect(screen.getByRole("button", { name: "Remove Hausberg from favourites" })).toBeTruthy();

    // Another place first, then a place at the same (rounded) coordinates: the new name again.
    fireEvent.click(arrow());
    fireEvent.click(entry("Matterhorn"));
    expect(combobox().value).toBe("Matterhorn");
    type("Somew");
    fireEvent.click((await screen.findAllByRole("option"))[0]!);
    expect(combobox().value).toBe("Hausberg");
  });

  it("keeps the name for a new visit and drops it with the favourite", () => {
    seed([POINT]);
    const { unmount } = renderPicker();
    fireEvent.click(arrow());
    rename(PT, "Hausberg");
    unmount();

    renderPicker();
    fireEvent.click(arrow());
    fireEvent.click(entry("Hausberg"));
    expect(combobox().value).toBe("Hausberg");
    // Unmarked, the place falls back to its coordinates; marked again, it is a map point again.
    fireEvent.click(screen.getByRole("button", { name: "Remove Hausberg from favourites" }));
    expect(combobox().value).toBe(PT);
    fireEvent.click(screen.getByRole("button", { name: `Add ${PT} to favourites` }));
    expect(stored()).toEqual([POINT]);
  });

  it("Escape cancels, an empty name is not taken", () => {
    seed([POINT]);
    renderPicker();
    fireEvent.click(arrow());
    rename(PT, "Hausberg", "Escape");
    expect(screen.queryByRole("textbox", { name: "Name of the favourite" })).toBeNull();
    expect(menu().hidden).toBe(false);
    expect(document.activeElement).toBe(entry(PT));
    expect(stored()).toEqual([POINT]);

    rename(PT, "   ");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(stored()).toEqual([POINT]);
    // Leaving the field with an empty name keeps the old one.
    fireEvent.blur(field());
    expect(screen.queryByRole("textbox", { name: "Name of the favourite" })).toBeNull();
    expect(stored()).toEqual([POINT]);

    // Leaving the field with a name saves it.
    fireEvent.click(pencil(PT)!);
    fireEvent.change(field(), { target: { value: "Alm" } });
    fireEvent.blur(field());
    expect(stored()).toEqual([{ ...POINT, name: "Alm" }]);
  });

  it("moves the highlight with the pointer from an entry to the pencil of the next one (REQ-508)", () => {
    seed([MATTERHORN, POINT]);
    renderPicker();
    fireEvent.click(arrow());
    expect(document.activeElement).toBe(entry("Matterhorn"));
    fireEvent.mouseEnter(entry("Matterhorn"));
    expect(document.activeElement).toBe(entry("Matterhorn"));
    // Straight onto the pencil of the next entry: Matterhorn keeps no highlight (the highlight follows the focus).
    fireEvent.mouseEnter(pencil(PT)!);
    expect(document.activeElement).toBe(pencil(PT));
    // Back to an entry, and the keyboard goes on from the hovered row.
    fireEvent.mouseEnter(entry("Matterhorn"));
    expect(document.activeElement).toBe(entry("Matterhorn"));
    fireEvent.mouseEnter(pencil(PT)!);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(entry(PT));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(entry("Matterhorn"));
    // While a name is typed the pointer moves nothing.
    fireEvent.click(pencil(PT)!);
    fireEvent.mouseEnter(entry("Matterhorn"));
    expect(document.activeElement).toBe(field());
  });

  it("works with the keyboard: arrow right to the pencil, arrow left back, F2 renames", () => {
    seed([MATTERHORN, POINT]);
    renderPicker();
    fireEvent.keyDown(arrow(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(entry(PT));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(pencil(PT));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(entry(PT));
    // No pencil on Matterhorn: arrow right stays.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(entry("Matterhorn"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    fireEvent.keyDown(document.activeElement!, { key: "F2" });
    expect(document.activeElement).toBe(field());
    // Keys while typing stay in the field; the menu does not move or close.
    fireEvent.keyDown(field(), { key: "Home" });
    expect(document.activeElement).toBe(field());
    fireEvent.change(field(), { target: { value: "Gipfel" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(stored()).toEqual([MATTERHORN, { ...POINT, name: "Gipfel" }]);
    expect(document.activeElement).toBe(entry("Gipfel"));
  });

  it("treats older favourites with the generic name in any language as map points", () => {
    seed([{ name: "Punkt auf der Karte", lat: 46.5, lon: 11.25 }, MATTERHORN]);
    renderPicker();
    fireEvent.click(arrow());
    expect(pencil("46.5000° N · 11.2500° E")).toBeTruthy();
    rename("46.5000° N · 11.2500° E", "Rifugio");
    expect(stored()[0]).toEqual({ name: "Rifugio", lat: 46.5, lon: 11.25, mapPoint: true });
    expect(pencil("Rifugio")).toBeTruthy();
  });

  it("names the pencil and the field in the page language", () => {
    seed([POINT]);
    renderPicker(DEFAULT_CONFIG, {}, "de");
    fireEvent.click(screen.getByRole("button", { name: "Favoriten anzeigen" }));
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "47,1718° N · 12,6806° O umbenennen", hidden: true }));
    expect(screen.getByRole("textbox", { name: "Name des Favoriten" })).toBeTruthy();
  });
});

describe("current location (GPS)", () => {
  function geolocation(answer: (ok: PositionCallback, fail: PositionErrorCallback) => void): Geolocation {
    return { getCurrentPosition: vi.fn(answer) } as unknown as Geolocation;
  }

  it("asks for the position only on button press and selects it", async () => {
    const geo = geolocation((ok) =>
      ok({ coords: { latitude: 47.267891, longitude: 11.392345 } } as GeolocationPosition),
    );
    const fetchElevationMock = vi.fn(async () => 580);
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo, fetchElevation: fetchElevationMock } });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    expect(currentPlace()).toMatchObject({ name: "My location", lat: 47.2679, lon: 11.3923 });
    await waitFor(() => expect(currentPlace().elevation).toBe(580));
    expect(screen.getByTestId("location-elevation").textContent).toBe("580 m");
  });

  it("explains a denied permission in the page language", () => {
    const geo = geolocation((_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError));
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo } }, "de");
    fireEvent.click(screen.getByRole("button", { name: "Aktueller Standort" }));
    // An error card with a close button (REQ-492), nothing inside the region.
    const card = screen.getByRole("alert");
    expect(card.getAttribute("data-testid")).toBe("error-card");
    // Where to allow it again, for the browser the page runs in (REQ-509); jsdom is an unknown one.
    expect(card.querySelector(".error-card__text")!.textContent).toBe("Der Zugriff auf den Standort wurde verweigert.");
    expect(within(card).getByTestId("error-card-detail").textContent).toBe(
      "Sie können ihn in den Browser-Einstellungen erlauben.",
    );
    expect(screen.getByRole("region", { name: "Ort" }).contains(card)).toBe(false);
    expect(currentPlace()).toEqual(DEFAULT_PLACE);
    fireEvent.click(within(card).getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds where this browser allows the location again (REQ-509)", () => {
    const geo = geolocation((_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError));
    const hint = () => locationHint({ platform: "ios", browser: "chrome", iosVersion: 18 });
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo, locationHint: hint } });
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    const card = screen.getByRole("alert");
    expect(card.querySelector(".error-card__text")!.textContent).toBe("Access to your location was denied.");
    expect(within(card).getByTestId("error-card-detail").textContent).toBe(
      "To allow it, set Settings › Apps › Chrome › Location to “While Using the App”. Location Services must also be on (Settings › Privacy & Security › Location Services).",
    );
  });

  it("gives no hint for other location errors", () => {
    const geo = geolocation((_ok, fail) => fail({ code: 2 } as GeolocationPositionError));
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo } });
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    expect(screen.getByRole("alert").textContent).toBe("Your location could not be determined.");
    expect(screen.queryByTestId("error-card-detail")).toBeNull();
  });

  it("takes the card back when the position is found on the next try", () => {
    let allow = false;
    const geo = geolocation((ok, fail) =>
      allow
        ? ok({ coords: { latitude: 47.1, longitude: 11.2 } } as GeolocationPosition)
        : fail({ code: 2 } as GeolocationPositionError),
    );
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo } });
    const button = screen.getByRole("button", { name: "Current location" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    allow = true;
    fireEvent.click(button);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(currentPlace()).toMatchObject({ lat: 47.1, lon: 11.2 });
  });

  it("reports timeouts and missing geolocation", () => {
    const geo = geolocation((_ok, fail) => fail({ code: 3 } as GeolocationPositionError));
    const { unmount } = renderPicker(DEFAULT_CONFIG, { services: { geolocation: geo } });
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    expect(screen.getByRole("alert").textContent).toBe("Determining your location took too long. Please try again.");
    unmount();
    renderPicker(DEFAULT_CONFIG, { services: { geolocation: undefined } });
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    expect(screen.getByRole("alert").textContent).toBe("This browser cannot determine your location.");
  });
});

describe("map", () => {
  it("opens OpenTopoMap with Leaflet lazily, without a header, Cancel and OK on the map", async () => {
    renderPicker();
    expect(maps.leaflet.map).not.toHaveBeenCalled();
    const opener = screen.getByRole("button", { name: "Map" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Map" });
    await waitFor(() => expect(maps.leaflet.map).toHaveBeenCalled());
    const [url] = maps.leaflet.tileLayer.mock.calls[0]!;
    expect(String(url)).toContain("tile.opentopomap.org");
    // Only the required credits, each linked (REQ-474), short (REQ-644).
    const instance = maps.leaflet.instances.at(-1)!;
    expect(instance.attributions).toHaveLength(1);
    const attribution = document.createElement("div");
    attribution.innerHTML = instance.attributions[0]!;
    expect(attribution.textContent).toBe("© OpenStreetMap, © OpenTopoMap (CC-BY-SA)");
    expect([...attribution.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "OpenStreetMap",
      "OpenTopoMap",
      "CC-BY-SA",
    ]);
    // Zoom top right, double click does not zoom (REQ-475, REQ-476).
    expect(instance.options).toMatchObject({ doubleClickZoom: false, zoomControl: false });
    expect(maps.leaflet.control.zoom).toHaveBeenCalledWith({ position: "topright" });
    // Without a phone media query match the Leaflet credit stays.
    expect(instance.setPrefix).toHaveBeenLastCalledWith("Leaflet");
    expect(within(dialog).queryByRole("heading")).toBeNull();
    expect(dialog.textContent).not.toContain("orientation");
    expect((within(dialog).getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(maps.maplibre.instances).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves out the Leaflet credit on phones", async () => {
    const listeners: (() => void)[] = [];
    const query = {
      matches: true,
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
    };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("matchMedia", matchMedia);
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    const instance = maps.leaflet.instances[0]!;
    expect(matchMedia).toHaveBeenCalledWith(expect.stringContaining("max-width: 30rem"));
    expect(instance.setPrefix).toHaveBeenLastCalledWith(false);
    // Turned into a desktop-sized window: the credit comes back.
    query.matches = false;
    for (const listener of listeners) listener();
    expect(instance.setPrefix).toHaveBeenLastCalledWith("Leaflet");
  });

  it("picks a point on the OpenTopoMap map with a click and OK, or a double click", async () => {
    renderPicker(DEFAULT_CONFIG, { services: { fetchElevation: async () => 900 } });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    const dialog = screen.getByRole("dialog", { name: "Map" });
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    const ok = within(dialog).getByRole("button", { name: "OK" }) as HTMLButtonElement;
    act(() => maps.leaflet.instances[0]!.handlers.click!({ latlng: { lat: 46.123456, lng: 7.654321 } }));
    expect(maps.leaflet.marker.setLatLng).toHaveBeenLastCalledWith([46.1235, 7.6543]);
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace()).toMatchObject({ name: "", lat: 46.1235, lon: 7.6543 });
    await waitFor(() => expect(currentPlace().elevation).toBe(900));
    // Remembered for the next start, with the elevation fetched afterwards (REQ-599).
    expect(JSON.parse(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY)!)).toEqual({
      name: "",
      lat: 46.1235,
      lon: 7.6543,
      elevation: 900,
    });

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(2));
    act(() => maps.leaflet.instances[1]!.handlers.dblclick!({ latlng: { lat: 47, lng: 8 } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace()).toMatchObject({ lat: 47, lon: 8 });
  });

  it("picks a place on the Maptoolkit map with MapLibre", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" }, { services: { fetchElevation: async () => 1500 } });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    const dialog = screen.getByRole("dialog", { name: "Map" });
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    const ok = within(dialog).getByRole("button", { name: "OK" });
    expect((ok as HTMLButtonElement).disabled).toBe(true);

    const map = maps.maplibre.instances[0]!;
    // A double click picks instead of zooming (REQ-476).
    expect(map.options).toMatchObject({ doubleClickZoom: false });
    act(() => map.handlers.click!({ point: { x: 1, y: 1 }, lngLat: { lng: 7.123456, lat: 46.654321 } }));
    expect((ok as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ok);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace()).toMatchObject({ name: "", lat: 46.6543, lon: 7.1235 });
    await waitFor(() => expect(currentPlace().elevation).toBe(1500));
  });

  it("sends the page's domain as Referer on every Maptoolkit request (REQ-698)", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    expect(maps.maplibre.instances[0]!.options).toMatchObject({ transformRequest: maptoolkitRequest });
  });

  it("keeps the Maptoolkit map pointing north, without a compass (REQ-511)", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    const map = maps.maplibre.instances[0]!;
    expect(map.options).toMatchObject({
      bearing: 0,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
    });
    // Pinch zoom stays, only its rotation goes; the keyboard still pans and zooms.
    expect(map.options).not.toHaveProperty("touchZoomRotate");
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
    expect(map.keyboard.disableRotation).toHaveBeenCalled();
    const navigation = map.controls.find((c) => (c as { options?: unknown }).options !== undefined) as {
      options: unknown;
    };
    expect(navigation.options).toMatchObject({ showCompass: false });
  });

  it("locks the page scrolling while the map is open (REQ-512)", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" });
    expect(document.documentElement.classList.contains("map-dialog-open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(document.documentElement.classList.contains("map-dialog-open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.documentElement.classList.contains("map-dialog-open")).toBe(false);
  });

  it("confirms a double-clicked point and cancels without change", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    act(() => maps.maplibre.instances[0]!.handlers.click!({ point: {}, lngLat: { lng: 7, lat: 46 } }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(currentPlace()).toEqual(DEFAULT_PLACE);

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(2));
    act(() =>
      maps.maplibre.instances[1]!.handlers.dblclick!({ point: {}, lngLat: { lng: 8, lat: 47 }, preventDefault() {} }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace()).toMatchObject({ lat: 47, lon: 8 });
  });

  it("shows an error when the map fails", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    act(() => maps.maplibre.instances[0]!.handlers.error!({}));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("error-card").textContent).toBe("The map could not be loaded. Check your connection.");
    // Closing the map takes the card with it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("error-card")).toBeNull();
  });
});

describe("search in the full-screen map (REQ-641)", () => {
  const INNSBRUCK_PLACE = { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 };
  const searchServices = { searchPlaces: async () => [INNSBRUCK_PLACE], fetchElevation: async () => 900 };

  async function openMap() {
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    const dialog = screen.getByRole("dialog", { name: "Map" });
    return dialog;
  }

  it("has the search field with GPS and X, and the favourites, top left on the desktop", async () => {
    renderPicker(WITH_PRESETS, { services: searchServices });
    const dialog = await openMap();
    const tools = dialog.querySelector(".map-dialog__tools")!;
    expect(tools).toBeTruthy();
    const field = within(tools as HTMLElement).getByRole("combobox", { name: "Search for a place" }) as HTMLInputElement;
    expect(field.value).toBe("Mont Blanc");
    expect(within(tools as HTMLElement).getByRole("button", { name: "Current location" })).toBeTruthy();
    expect(within(tools as HTMLElement).getByRole("button", { name: "Clear search" })).toBeTruthy();
    expect(within(tools as HTMLElement).getByRole("button", { name: "Remove Mont Blanc from favourites" })).toBeTruthy();
    expect(within(tools as HTMLElement).getByRole("button", { name: "Show favourites" })).toBeTruthy();
    // Its own field: the one in the place row is another.
    const rowField = within(screen.getByRole("region", { name: "Location" })).getAllByRole("combobox")[0]!;
    expect(rowField).not.toBe(field);
    expect(field.id).not.toBe(rowField.id);
  });

  it("a hit moves the OpenTopoMap map and its marker there, OK takes it", async () => {
    renderPicker(DEFAULT_CONFIG, { services: searchServices });
    const dialog = await openMap();
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    const map = maps.leaflet.instances[0]!;
    const ok = within(dialog).getByRole("button", { name: "OK" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    const field = within(dialog).getByRole("combobox");
    fireEvent.change(field, { target: { value: "Inns" } });
    const [option] = await within(dialog).findAllByRole("option");
    fireEvent.click(option!);
    // The same map moves, it is not made anew; the zoom follows the elevation as on opening.
    expect(maps.leaflet.instances).toHaveLength(1);
    expect(map.setView).toHaveBeenLastCalledWith([47.2627, 11.3945], 11, { animate: false });
    expect(maps.leaflet.marker.setLatLng).toHaveBeenLastCalledWith([47.2627, 11.3945]);
    expect((field as HTMLInputElement).value).toBe("Innsbruck");
    expect(screen.getByRole("dialog")).toBeTruthy();
    // The place row keeps the old place until OK.
    expect(currentPlace().name).toBe("Mont Blanc");
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace()).toEqual(INNSBRUCK_PLACE);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Innsbruck");
  });

  it("the same hit again moves the map back after a click elsewhere", async () => {
    renderPicker(DEFAULT_CONFIG, { services: searchServices });
    const dialog = await openMap();
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    const map = maps.leaflet.instances[0]!;
    const field = within(dialog).getByRole("combobox");
    const search = async () => {
      fireEvent.change(field, { target: { value: "Inns" } });
      fireEvent.click((await within(dialog).findAllByRole("option"))[0]!);
    };
    await search();
    act(() => map.handlers.click!({ latlng: { lat: 46, lng: 7 } }));
    // A click names the point by its coordinates in the field.
    expect((field as HTMLInputElement).value).toBe("46.0000° N · 7.0000° E");
    await search();
    expect(map.setView).toHaveBeenCalledTimes(2);
    expect(maps.leaflet.marker.setLatLng).toHaveBeenLastCalledWith([47.2627, 11.3945]);
  });

  it("a favourite moves the Maptoolkit map there, OK takes it", async () => {
    renderPicker({ ...WITH_PRESETS, map: "maptoolkit" }, { services: searchServices });
    const dialog = await openMap();
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    const map = maps.maplibre.instances[0]!;
    fireEvent.click(within(dialog).getByRole("button", { name: "Show favourites" }));
    fireEvent.click(within(dialog).getByRole("menuitem", { name: "Matterhorn" }));
    const matterhorn = MOUNTAINS.find((preset) => preset.name === "Matterhorn")!;
    expect(maps.maplibre.instances).toHaveLength(1);
    expect(map.jumpTo).toHaveBeenLastCalledWith({ center: [matterhorn.lon, matterhorn.lat], zoom: 14 });
    expect(map.marker!.setLngLat).toHaveBeenLastCalledWith([matterhorn.lon, matterhorn.lat]);
    expect((within(dialog).getByRole("combobox") as HTMLInputElement).value).toBe("Matterhorn");
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace().name).toBe("Matterhorn");
  });

  it("a hit moves the Maptoolkit map too", async () => {
    renderPicker({ ...DEFAULT_CONFIG, map: "maptoolkit" }, { services: searchServices });
    const dialog = await openMap();
    await waitFor(() => expect(maps.maplibre.instances).toHaveLength(1));
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "Inns" } });
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
    await within(dialog).findAllByRole("option");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
    expect(maps.maplibre.instances[0]!.jumpTo).toHaveBeenLastCalledWith({ center: [11.3945, 47.2627], zoom: 10 });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("the current position is taken at once and closes the map", async () => {
    const geo = {
      getCurrentPosition: vi.fn((ok: PositionCallback) =>
        ok({ coords: { latitude: 47.267891, longitude: 11.392345 } } as GeolocationPosition),
      ),
    } as unknown as Geolocation;
    renderPicker(DEFAULT_CONFIG, { services: { ...searchServices, geolocation: geo } });
    const dialog = await openMap();
    fireEvent.click(within(dialog).getByRole("button", { name: "Current location" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(currentPlace()).toMatchObject({ name: "My location", lat: 47.2679, lon: 11.3923 });
  });

  it("Escape closes the suggestions first, then the map", async () => {
    renderPicker(DEFAULT_CONFIG, { services: searchServices });
    const dialog = await openMap();
    const field = within(dialog).getByRole("combobox");
    fireEvent.change(field, { target: { value: "Inns" } });
    await within(dialog).findAllByRole("option");
    expect(field.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("dialog")).toBeTruthy();
    // The typed text goes, the place's name comes back.
    fireEvent.keyDown(field, { key: "Escape" });
    expect((field as HTMLInputElement).value).toBe("Mont Blanc");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the elevation of the marked place below the search field, never its coordinates (REQ-673, REQ-732)", async () => {
    const fetchElevation = vi.fn(async () => 2072);
    renderPicker(DEFAULT_CONFIG, { services: { ...searchServices, fetchElevation } });
    const dialog = await openMap();
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    const tools = dialog.querySelector<HTMLElement>(".map-dialog__tools")!;
    // The place the map opened with: its own elevation; no coordinates, although the field shows its name (REQ-732).
    expect(within(tools).getByTestId("location-elevation").textContent).toBe("4,806 m");
    expect(within(tools).queryByTestId("location-coordinates")).toBeNull();
    // Below the field, not beside it.
    const row = tools.querySelector(".map-dialog__row")!;
    expect(row.contains(within(tools).getByRole("combobox"))).toBe(true);
    expect(row.nextElementSibling).toBe(tools.querySelector("dl"));

    // A hit brings its own elevation.
    fireEvent.change(within(tools).getByRole("combobox"), { target: { value: "Inns" } });
    fireEvent.click((await within(dialog).findAllByRole("option"))[0]!);
    expect(within(tools).getByTestId("location-elevation").textContent).toBe("574 m");
    expect(within(tools).queryByTestId("location-coordinates")).toBeNull();
    expect(fetchElevation).not.toHaveBeenCalled();

    // A point clicked on the map: elevation from the elevation API, "n/a" until it comes; no coordinates below.
    act(() => maps.leaflet.instances[0]!.handlers.click!({ latlng: { lat: 46.9726, lng: 10.9828 } }));
    expect((within(tools).getByRole("combobox") as HTMLInputElement).value).toBe("46.9726° N · 10.9828° E");
    expect(within(tools).getByTestId("location-elevation").textContent).toBe("n/a");
    await waitFor(() => expect(within(tools).getByTestId("location-elevation").textContent).toBe("2,072 m"));
    expect(fetchElevation).toHaveBeenCalledTimes(1);
    expect(fetchElevation).toHaveBeenLastCalledWith(46.9726, 10.9828, expect.anything());
    expect(within(tools).queryByTestId("location-coordinates")).toBeNull();

    // OK takes the point with the elevation already fetched, without asking again.
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(currentPlace().elevation).toBe(2072));
    expect(fetchElevation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location-elevation").textContent).toBe("2,072 m");
    expect(screen.queryByTestId("location-coordinates")).toBeNull();
  });

  it("names the elevation in the map in the page language, without coordinates (REQ-673, REQ-732)", async () => {
    renderPicker(DEFAULT_CONFIG, { services: searchServices }, "de");
    fireEvent.click(screen.getByRole("button", { name: "Karte" }));
    const dialog = screen.getByRole("dialog");
    const facts = dialog.querySelector<HTMLElement>(".map-dialog__tools dl")!;
    expect([...facts.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Höhe"]);
    expect(within(facts).getByTestId("location-elevation").textContent).toBe("4.806 m");
    expect(within(facts).queryByTestId("location-coordinates")).toBeNull();
  });

  it.each(LANGUAGES)('says "n/a" without an elevation in the map and the place row in %s (REQ-732)', async (language) => {
    const messages = MESSAGES[language];
    renderPicker(
      { ...DEFAULT_CONFIG, startLocation: { name: "Zugspitze", lat: 47.4211, lon: 10.9853 } },
      { services: { ...searchServices, fetchElevation: async () => undefined } },
      language,
    );
    fireEvent.click(screen.getByRole("button", { name: messages["location.map.open"] }));
    const facts = screen.getByRole("dialog").querySelector<HTMLElement>(".map-dialog__tools dl")!;
    // The word for elevation in the language, "n/a" the same in all of them; no coordinates for the named place.
    expect([...facts.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([messages["location.elevation"]]);
    expect(within(facts).getByTestId("location-elevation").textContent).toBe("n/a");
    expect(within(facts).queryByTestId("location-coordinates")).toBeNull();
    const row = document.querySelector<HTMLElement>('[data-region="location"] > .location__facts')!;
    expect(within(row).getByTestId("location-elevation").textContent).toBe("n/a");
    expect(formatElevation(undefined, toLocale(language), createTranslate(language))).toBe("n/a");
  });

  it("has no search field on a phone", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("max-width: 30rem"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderPicker(DEFAULT_CONFIG, { services: searchServices });
    const dialog = await openMap();
    await waitFor(() => expect(maps.leaflet.instances).toHaveLength(1));
    expect(dialog.querySelector(".map-dialog__tools")).toBeNull();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Show favourites" })).toBeNull();
  });
});

describe("Maptoolkit style helpers", () => {
  it("enlarges place and contour labels", () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        { id: "a", type: "symbol", source: "s", "source-layer": "place_label", layout: { "text-field": ["get", "name"], "text-size": 12 } },
        { id: "b", type: "symbol", source: "s", "source-layer": "contours", layout: { "text-field": ["get", "ele"] } },
        { id: "c", type: "symbol", source: "s", "source-layer": "x", layout: { "text-field": ["get", "ref"], "text-size": 10 } },
      ],
    } as unknown as StyleSpecification;
    const sizes = enlargeMapLabels(style).layers.map((layer) => (layer.layout as Record<string, unknown>)["text-size"]);
    expect(sizes).toEqual([18, 32, 10]);
    expect(scaleTextSize(["get", "size"], 2)).toEqual(["*", ["get", "size"], 2]);
  });

  it("turns label features into places", () => {
    const feature = (sourceLayer: string, properties: Record<string, unknown>) =>
      ({ sourceLayer, properties, geometry: { type: "Point", coordinates: [11.39, 47.26] } }) as unknown as MapGeoJSONFeature;
    expect(featurePlace(feature("poi_label", { name: "Patscherkofel", ele: "2246 m" }))).toEqual({
      name: "Patscherkofel",
      lat: 47.26,
      lon: 11.39,
      elevation: 2246,
    });
    expect(featurePlace(feature("poi_label", { name: "Shop", type: "shop" }))).toBeNull();
    expect(featurePlace(feature("road_label", { name: "Road" }))).toBeNull();
  });
});
