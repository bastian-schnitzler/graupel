// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Map provider chosen in the settings (REQ-467): an own choice overrides `map` from config.json. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type MapProvider } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { AboutPanel } from "../src/dialogs/info/AboutPanel.tsx";
import { PrivacyPanel } from "../src/dialogs/info/PrivacyPanel.tsx";
import { I18nProvider } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { LocationPicker } from "../src/regions/LocationPicker/index.ts";
import {
  LocationProvider,
  MAP_PROVIDER_STORAGE_KEY,
  effectiveMapProvider,
  readStoredMapProvider,
  setMapProvider,
  useMapProvider,
} from "../src/state/index.ts";

// Map libraries: mocked; which one the map dialog mounts tells the provider.
const maps = vi.hoisted(() => ({ leaflet: 0, maplibre: 0 }));
vi.mock("leaflet", () => ({
  default: {
    map: vi.fn(() => {
      maps.leaflet += 1;
      return {
        remove: vi.fn(),
        on: vi.fn(),
        attributionControl: { setPrefix: vi.fn(), addAttribution: vi.fn(), removeAttribution: vi.fn() },
      };
    }),
    tileLayer: vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() })),
    circleMarker: vi.fn(() => ({ addTo: vi.fn() })),
    control: { zoom: vi.fn(() => ({ addTo: vi.fn() })) },
    Control: { Attribution: { prototype: { options: { prefix: "Leaflet" } } } },
  },
}));
vi.mock("maplibre-gl", () => {
  class Map {
    constructor() {
      maps.maplibre += 1;
    }
    addControl() {}
    on() {}
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

function Probe() {
  return <output data-testid="provider">{useMapProvider()}</output>;
}

function setup(map: MapProvider = "opentopomap") {
  const config = { ...DEFAULT_CONFIG, map };
  return render(
    <ConfigProvider config={config}>
      <I18nProvider browserLanguages={["en"]}>
        <DialogsProvider>
          <LocationProvider>
            <Header />
            <LocationPicker searchDelay={0} />
            <Probe />
          </LocationProvider>
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const provider = () => screen.getByTestId("provider").textContent;

beforeEach(() => {
  window.localStorage.clear();
  maps.leaflet = 0;
  maps.maplibre = 0;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("effective map provider", () => {
  it("is the own choice, else the one from config.json", () => {
    expect(effectiveMapProvider(null, "opentopomap")).toBe("opentopomap");
    expect(effectiveMapProvider(null, "maptoolkit")).toBe("maptoolkit");
    expect(effectiveMapProvider("maptoolkit", "opentopomap")).toBe("maptoolkit");
    expect(effectiveMapProvider("opentopomap", "maptoolkit")).toBe("opentopomap");
  });

  it.each(["opentopomap", "maptoolkit"] as const)("follows config.json (%s) without a stored choice", (map) => {
    setup(map);
    expect(readStoredMapProvider()).toBeNull();
    expect(provider()).toBe(map);
  });

  it("lets a stored choice override config.json", () => {
    window.localStorage.setItem(MAP_PROVIDER_STORAGE_KEY, "maptoolkit");
    setup("opentopomap");
    expect(provider()).toBe("maptoolkit");
    cleanup();
    window.localStorage.setItem(MAP_PROVIDER_STORAGE_KEY, "opentopomap");
    setup("maptoolkit");
    expect(provider()).toBe("opentopomap");
  });

  it("ignores a stored value that is no provider", () => {
    window.localStorage.setItem(MAP_PROVIDER_STORAGE_KEY, "google");
    setup("maptoolkit");
    expect(readStoredMapProvider()).toBeNull();
    expect(provider()).toBe("maptoolkit");
  });

  it("removes the choice with null, so config.json applies again", () => {
    setMapProvider("maptoolkit");
    expect(window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY)).toBe("maptoolkit");
    setMapProvider(null);
    expect(window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY)).toBeNull();
  });
});

describe("map section of the settings popup", () => {
  it("checks the provider from config.json and stores another choice", async () => {
    setup("opentopomap");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const group = within(screen.getByRole("dialog")).getByRole("radiogroup", { name: "Map" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual(["OpenTopoMap", "Maptoolkit"]);
    expect(within(group).getByRole("radio", { name: "OpenTopoMap" })).toHaveProperty("checked", true);

    fireEvent.click(within(group).getByRole("radio", { name: "Maptoolkit" }));
    expect(window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY)).toBe("maptoolkit");
    expect(within(group).getByRole("radio", { name: "Maptoolkit" })).toHaveProperty("checked", true);
    expect(provider()).toBe("maptoolkit");

    // The map picker opens the chosen provider: MapLibre instead of Leaflet.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.maplibre).toBe(1));
    expect(maps.leaflet).toBe(0);
    expect(within(screen.getByRole("dialog", { name: "Map" })).getByRole("button", { name: "OK" })).toBeTruthy();
  });

  it("opens Leaflet when the config says Maptoolkit but OpenTopoMap is chosen", async () => {
    window.localStorage.setItem(MAP_PROVIDER_STORAGE_KEY, "opentopomap");
    setup("maptoolkit");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(maps.leaflet).toBe(1));
    expect(maps.maplibre).toBe(0);
  });
});

describe("info panels", () => {
  function renderPanels(map: MapProvider) {
    return render(
      <ConfigProvider config={{ ...DEFAULT_CONFIG, map }}>
        <I18nProvider browserLanguages={["en"]}>
          <AboutPanel />
          <PrivacyPanel />
        </I18nProvider>
      </ConfigProvider>,
    );
  }

  it("privacy names the effective provider, About names both (REQ-517)", () => {
    window.localStorage.setItem(MAP_PROVIDER_STORAGE_KEY, "maptoolkit");
    const { container } = renderPanels("opentopomap");
    expect(container.querySelector('[data-provider="maptoolkit"]')).toBeTruthy();
    const maptoolkit = within(screen.getByTestId("about-map-maptoolkit"));
    expect(maptoolkit.getByRole("link", { name: "Maptoolkit" }).getAttribute("href")).toBe("https://www.maptoolkit.org/");
    const opentopomap = within(screen.getByTestId("about-map-opentopomap"));
    expect(opentopomap.getByRole("link", { name: "OpenTopoMap" }).getAttribute("href")).toBe("https://opentopomap.org/");
  });
});
