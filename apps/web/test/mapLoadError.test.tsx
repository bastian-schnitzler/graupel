// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The map's error card only for a map that does not load (REQ-771): on an iPad Air 2 Maptoolkit loaded slowly and some
 * single resources failed on the way, and the card "The map could not be loaded" showed over a map that had loaded.
 * Now no style, no WebGL, no map module or no load by the deadline shows the card (REQ-492); a single failing tile,
 * glyph or sprite before or after the load does not, and a map that loads after the card showed takes it away. The
 * same rule for OpenTopoMap: all first tiles failed or none by the deadline. Both map libraries are mocked and hand out
 * their event handlers. Also: the Maptoolkit style starts loading together with the map library.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type Place } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MapDialog } from "../src/regions/LocationPicker/MapDialog.tsx";
import { MAP_LOAD_TIMEOUT_MS, watchMapLoad } from "../src/regions/LocationPicker/map/loadWatch.ts";
import {
  MAPTOOLKIT_REFERRER_POLICY,
  MAPTOOLKIT_STYLE,
  prefetchMaptoolkitStyle,
  takeMaptoolkitStyle,
} from "../src/regions/LocationPicker/map/maptoolkitStyle.ts";
import { setMapProvider } from "../src/state/index.ts";

type Handler = (event?: unknown) => void;

/** The maps made last, with their handlers; `webgl: false` makes MapLibre throw as without WebGL. */
const made = vi.hoisted(() => ({
  maplibre: [] as { handlers: Record<string, Handler>; styles: unknown[] }[],
  leaflet: [] as { handlers: Record<string, Handler> }[],
  webgl: true,
}));

vi.mock("leaflet", () => ({
  default: {
    map: vi.fn(() => ({
      remove: vi.fn(),
      on: vi.fn(),
      attributionControl: { setPrefix: vi.fn(), addAttribution: vi.fn(), removeAttribution: vi.fn() },
    })),
    tileLayer: vi.fn(() => {
      const layer = { handlers: {} as Record<string, Handler> };
      made.leaflet.push(layer);
      return { addTo: vi.fn(), on: (name: string, handler: Handler) => (layer.handlers[name] = handler) };
    }),
    circleMarker: vi.fn(() => ({ addTo: () => ({ setLatLng: vi.fn() }) })),
    control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
    Control: { Attribution: { prototype: { options: { prefix: "Leaflet" } } } },
  },
}));
vi.mock("maplibre-gl", () => {
  class Map {
    touchZoomRotate = { disableRotation() {} };
    keyboard = { disableRotation() {} };
    record = { handlers: {} as Record<string, Handler>, styles: [] as unknown[] };
    constructor() {
      if (!made.webgl) throw new Error("Failed to initialize WebGL");
      made.maplibre.push(this.record);
    }
    addControl() {}
    setStyle(style: unknown) {
      this.record.styles.push(style);
    }
    on(name: string, handler: Handler) {
      this.record.handlers[name] = handler;
    }
    getStyle() {
      return { layers: [] };
    }
    remove() {}
  }
  class Marker {
    setLngLat() {
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
const CARD = "The map could not be loaded. Check your connection.";

function open(map: "maptoolkit" | "opentopomap") {
  render(
    <ConfigProvider config={{ ...DEFAULT_CONFIG, map }}>
      <I18nProvider browserLanguages={["en"]}>
        <NoticesProvider>
          <MapDialog place={MONT_BLANC} onClose={() => {}} onAccept={() => {}} />
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const card = () => screen.queryByTestId("error-card");

/** The Maptoolkit map once made: its MapLibre handlers. */
async function maptoolkit() {
  open("maptoolkit");
  await waitFor(() => expect(made.maplibre).toHaveLength(1));
  return made.maplibre[0]!.handlers;
}

/** The OpenTopoMap map once made: the handlers of its tile layer. */
async function opentopomap() {
  open("opentopomap");
  await waitFor(() => expect(made.leaflet).toHaveLength(1));
  return made.leaflet[0]!.handlers;
}

/** A failing tile of a source, as MapLibre reports it. */
const TILE_ERROR = { error: new Error("Failed to fetch"), sourceId: "maptoolkit", tile: {} };
/** A failing glyph or sprite: no source, after the style has loaded. */
const RESOURCE_ERROR = { error: new Error("Failed to fetch") };

beforeEach(() => {
  // Real time drives the fake clock (`waitFor` keeps working); `advanceTimersByTime` jumps to the deadline.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  window.localStorage.clear();
  made.maplibre = [];
  made.leaflet = [];
  made.webgl = true;
  takeMaptoolkitStyle();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setMapProvider(null);
});

describe("map load rule (REQ-771)", () => {
  it("reports an error only on failure or at the deadline, and the load after it", () => {
    const report = { onError: vi.fn(), onLoad: vi.fn() };
    const watch = watchMapLoad(report);
    vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS - 1);
    expect(report.onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(report.onError).toHaveBeenCalledTimes(1);
    // A failure after the deadline reports nothing more; the load ends it.
    watch.failed();
    expect(report.onError).toHaveBeenCalledTimes(1);
    watch.loaded();
    expect(report.onLoad).toHaveBeenCalledTimes(1);
    watch.loaded();
    expect(report.onLoad).toHaveBeenCalledTimes(1);
  });

  it("is quiet after the load and after the map is gone", () => {
    const loadedFirst = { onError: vi.fn(), onLoad: vi.fn() };
    const watch = watchMapLoad(loadedFirst);
    watch.loaded();
    watch.failed();
    vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS);
    expect(loadedFirst.onError).not.toHaveBeenCalled();
    expect(loadedFirst.onLoad).toHaveBeenCalledTimes(1);

    const gone = { onError: vi.fn(), onLoad: vi.fn() };
    const stopped = watchMapLoad(gone);
    stopped.stop();
    stopped.failed();
    stopped.loaded();
    vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS);
    expect(gone.onError).not.toHaveBeenCalled();
    expect(gone.onLoad).not.toHaveBeenCalled();
  });
});

describe("Maptoolkit error card (REQ-771)", () => {
  it("shows no card for single failing tiles, glyphs or sprites before and after the load", async () => {
    const handlers = await maptoolkit();
    act(() => handlers.error!(TILE_ERROR));
    act(() => handlers.styledata!());
    act(() => handlers.error!(RESOURCE_ERROR));
    act(() => handlers.error!(TILE_ERROR));
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS / 2));
    act(() => handlers.load!());
    act(() => handlers.error!(TILE_ERROR));
    act(() => handlers.error!(RESOURCE_ERROR));
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
    expect(card()).toBeNull();
  });

  it("shows the card when the style cannot be loaded", async () => {
    const handlers = await maptoolkit();
    act(() => handlers.error!({ error: new Error("Failed to fetch") }));
    expect(card()?.textContent).toBe(CARD);
  });

  it("shows the card without WebGL", async () => {
    made.webgl = false;
    open("maptoolkit");
    await waitFor(() => expect(card()?.textContent).toBe(CARD));
  });

  it("shows the card when the map has not loaded by the deadline, and takes it away when it loads", async () => {
    const handlers = await maptoolkit();
    act(() => handlers.styledata!());
    // A second short of it (the clock also runs on its own meanwhile).
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS - 1000));
    expect(card()).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(card()?.textContent).toBe(CARD);
    act(() => handlers.load!());
    expect(card()).toBeNull();
  });
});

describe("OpenTopoMap error card (REQ-771)", () => {
  it("shows no card for single failing tiles before and after the load", async () => {
    const handlers = await opentopomap();
    act(() => handlers.tileerror?.());
    act(() => handlers.tileload!());
    act(() => handlers.load!());
    act(() => handlers.tileerror?.());
    act(() => handlers.load!());
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
    expect(card()).toBeNull();
  });

  it("shows the card when all first tiles failed, and takes it away when a tile loads", async () => {
    const handlers = await opentopomap();
    act(() => handlers.load!());
    expect(card()?.textContent).toBe(CARD);
    act(() => handlers.tileload!());
    expect(card()).toBeNull();
  });

  it("shows the card when no tile has loaded by the deadline", async () => {
    await opentopomap();
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
    expect(card()?.textContent).toBe(CARD);
  });
});

describe("Maptoolkit style alongside the library (REQ-771)", () => {
  it("is asked for with the page's domain as Referer and handed to the map once", async () => {
    const style = { version: 8, sources: {}, layers: [] };
    const fetch = vi.fn(async () => new Response(JSON.stringify(style)));
    vi.stubGlobal("fetch", fetch);
    prefetchMaptoolkitStyle();
    prefetchMaptoolkitStyle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(MAPTOOLKIT_STYLE, { referrerPolicy: MAPTOOLKIT_REFERRER_POLICY });
    const first = takeMaptoolkitStyle();
    expect(takeMaptoolkitStyle()).toBeNull();
    await expect(first).resolves.toEqual(style);
  });

  it("gives the map the loaded style, or its address when loading it failed", async () => {
    const style = { version: 8, sources: {}, layers: [] };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(style)));
    prefetchMaptoolkitStyle();
    await maptoolkit();
    await waitFor(() => expect(made.maplibre[0]!.styles).toEqual([style]));
    cleanup();

    made.maplibre = [];
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    prefetchMaptoolkitStyle();
    await maptoolkit();
    await waitFor(() => expect(made.maplibre[0]!.styles).toEqual([MAPTOOLKIT_STYLE]));

    // Without a style loaded ahead, the map asks for it itself.
    cleanup();
    made.maplibre = [];
    await maptoolkit();
    expect(made.maplibre[0]!.styles).toEqual([MAPTOOLKIT_STYLE]);
  });
});
