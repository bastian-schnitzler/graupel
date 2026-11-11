// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Switch between OpenTopoMap and Maptoolkit in the full-screen map (REQ-659, DEC-065): a preview tile with the other
 * map's name on the desktop, a layers button on a phone (`MAP_PHONE_QUERY`). A click stores the choice as the settings
 * do and makes the other map with the centre, zoom and marker of the one before; a place picked before stays picked
 * for OK. Both map libraries are mocked; they record how they were made and hand out their event handlers.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type Place } from "../src/config/index.ts";
import { I18nProvider, MESSAGES } from "../src/i18n/index.ts";
import { MapDialog } from "../src/regions/LocationPicker/MapDialog.tsx";
import { leafletZoom, OPENTOPOMAP_MAX_ZOOM } from "../src/regions/LocationPicker/map/LeafletMap.tsx";
import {
  MAP_PROVIDER_NAMES,
  MAP_PROVIDER_STORAGE_KEY,
  otherMapProvider,
  setMapProvider,
} from "../src/state/index.ts";
import { MAP_PHONE_QUERY } from "../src/state/phoneLandscape.ts";

type Handler = (event?: unknown) => void;

/** What the mocked libraries were asked to do, and the handlers of the map made last. */
const made = vi.hoisted(() => ({
  leaflet: [] as { center: [number, number]; zoom: number; marker?: [number, number] }[],
  maplibre: [] as { center: [number, number]; zoom: number; marker?: [number, number] }[],
  handlers: {} as Record<string, Handler>,
  view: { lat: 0, lng: 0, zoom: 0 },
}));

vi.mock("leaflet", () => ({
  default: {
    map: vi.fn((_element: HTMLElement, options: { center: [number, number]; zoom: number }) => {
      made.leaflet.push({ center: options.center, zoom: options.zoom });
      made.handlers = {};
      return {
        remove: vi.fn(),
        on: (name: string, handler: Handler) => (made.handlers[name] = handler),
        getCenter: () => ({ wrap: () => ({ lat: made.view.lat, lng: made.view.lng }) }),
        getZoom: () => made.view.zoom,
        attributionControl: { setPrefix: vi.fn(), addAttribution: vi.fn(), removeAttribution: vi.fn() },
      };
    }),
    tileLayer: vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() })),
    circleMarker: vi.fn((latlng: [number, number]) => {
      made.leaflet.at(-1)!.marker = latlng;
      return { addTo: () => ({ setLatLng: vi.fn() }) };
    }),
    control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
    Control: { Attribution: { prototype: { options: { prefix: "Leaflet" } } } },
  },
}));
vi.mock("maplibre-gl", () => {
  class Map {
    touchZoomRotate = { disableRotation() {} };
    keyboard = { disableRotation() {} };
    constructor(options: { center: [number, number]; zoom: number }) {
      made.maplibre.push({ center: options.center, zoom: options.zoom });
      made.handlers = {};
    }
    addControl() {}
    setStyle() {}
    on(name: string, handler: Handler) {
      made.handlers[name] = handler;
    }
    getCenter() {
      return { wrap: () => ({ lat: made.view.lat, lng: made.view.lng }) };
    }
    getZoom() {
      return made.view.zoom;
    }
    remove() {}
  }
  class Marker {
    setLngLat(lngLat: [number, number]) {
      made.maplibre.at(-1)!.marker = lngLat;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  class NavigationControl {}
  return { default: { Map, Marker, NavigationControl } };
});
vi.mock("@maptoolkit/maplibre-gl-logo", () => ({ MaptoolkitLogoControl: class {} }));

const MONT_BLANC: Place = { name: "Mont Blanc", lat: 45.8326, lon: 6.8652, elevation: 4808 };

/** `matchMedia` for MAP_PHONE_QUERY: a phone or the desktop. */
function layout(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: phone && query === MAP_PHONE_QUERY,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function open(onAccept = vi.fn()) {
  render(
    <ConfigProvider config={{ ...DEFAULT_CONFIG, map: "opentopomap" }}>
      <I18nProvider browserLanguages={["en"]}>
        <MapDialog place={MONT_BLANC} onClose={() => {}} onAccept={onAccept} />
      </I18nProvider>
    </ConfigProvider>,
  );
  return screen.getByRole("dialog", { name: "Map" });
}

beforeEach(() => {
  window.localStorage.clear();
  made.leaflet = [];
  made.maplibre = [];
  made.handlers = {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setMapProvider(null);
});

describe("map switch", () => {
  it("names the other map and how a zoom carries over", () => {
    expect(otherMapProvider("opentopomap")).toBe("maptoolkit");
    expect(otherMapProvider("maptoolkit")).toBe("opentopomap");
    expect(MAP_PROVIDER_NAMES).toEqual({ opentopomap: "OpenTopoMap", maptoolkit: "Maptoolkit" });
    // MapLibre's 512 px tiles: one Leaflet level more for the same view, up to OpenTopoMap's last level.
    expect(leafletZoom(13)).toBe(14);
    expect(leafletZoom(16.5)).toBe(OPENTOPOMAP_MAX_ZOOM);
  });

  it("has its label in every language, with the map's name", () => {
    for (const [language, messages] of Object.entries(MESSAGES)) {
      expect(messages["location.map.switch"], language).toContain("{name}");
    }
  });

  it("desktop: the tile shows the other map; a click stores it and keeps view, marker and the picked place", async () => {
    layout(false);
    const onAccept = vi.fn();
    const dialog = open(onAccept);
    await waitFor(() => expect(made.leaflet).toHaveLength(1));
    expect(dialog.getAttribute("data-provider")).toBe("opentopomap");
    const tile = within(dialog).getByRole("button", { name: "Switch to Maptoolkit" });
    expect(tile.getAttribute("title")).toBe("Switch to Maptoolkit");
    expect(tile.classList.contains("map-switch--tile")).toBe(true);
    expect(tile.textContent).toBe("Maptoolkit");
    // REQ-675: the picture of the other map, the shaded half of Bastian's sample for Maptoolkit.
    const picture = () => tile.ownerDocument.querySelector<HTMLImageElement>(".map-switch--tile img")!;
    expect(picture().getAttribute("src")).toMatch(/maptoolkit\.webp$/);
    expect(picture().getAttribute("alt")).toBe("");

    // A point picked, the map moved and zoomed to Leaflet level 15.
    const picked = { lat: 45.9, lng: 6.9 };
    act(() => made.handlers.click!({ latlng: picked }));
    made.view = { lat: 45.88, lng: 6.95, zoom: 15 };
    act(() => made.handlers.moveend!());

    fireEvent.click(tile);
    await waitFor(() => expect(made.maplibre).toHaveLength(1));
    expect(window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY)).toBe("maptoolkit");
    expect(dialog.getAttribute("data-provider")).toBe("maptoolkit");
    // Same centre, the same zoom in MapLibre's levels, the marker on the picked point.
    expect(made.maplibre[0]).toEqual({ center: [6.95, 45.88], zoom: 14, marker: [6.9, 45.9] });
    const back = within(dialog).getByRole("button", { name: "Switch to OpenTopoMap" });
    expect(back.textContent).toBe("OpenTopoMap");
    expect(picture().getAttribute("src")).toMatch(/opentopomap\.webp$/);

    // And back again, after MapLibre moved.
    made.view = { lat: 45.87, lng: 6.94, zoom: 12.5 };
    act(() => made.handlers.moveend!());
    fireEvent.click(back);
    await waitFor(() => expect(made.leaflet).toHaveLength(2));
    expect(window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY)).toBe("opentopomap");
    expect(made.leaflet[1]).toEqual({ center: [45.87, 6.94], zoom: 13.5, marker: [45.9, 6.9] });

    // OK takes the place picked before the switches.
    const ok = within(dialog).getByRole("button", { name: "OK" });
    expect((ok as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ok);
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ lat: 45.9, lon: 6.9 }));
  });

  it("desktop: without a move the other map opens at the place, OK stays off", async () => {
    layout(false);
    const dialog = open();
    await waitFor(() => expect(made.leaflet).toHaveLength(1));
    expect(made.leaflet[0]).toEqual({ center: [45.8326, 6.8652], zoom: 15, marker: [45.8326, 6.8652] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch to Maptoolkit" }));
    await waitFor(() => expect(made.maplibre).toHaveLength(1));
    expect(made.maplibre[0]).toEqual({ center: [6.8652, 45.8326], zoom: 14, marker: [6.8652, 45.8326] });
    expect((within(dialog).getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("phone: a layers button instead of the tile", async () => {
    layout(true);
    const dialog = open();
    await waitFor(() => expect(made.leaflet).toHaveLength(1));
    const button = within(dialog).getByRole("button", { name: "Switch to Maptoolkit" });
    expect(button.classList.contains("map-switch--button")).toBe(true);
    expect(button.textContent).toBe("");
    expect(button.querySelector("img")).toBeNull();
    expect(dialog.querySelector(".map-switch--tile")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(made.maplibre).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Switch to OpenTopoMap" })).toBeTruthy();
  });
});
