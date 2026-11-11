// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Short attribution of the OpenTopoMap map (REQ-644): on the desktop the Leaflet prefix and "© OpenStreetMap,
 * © OpenTopoMap (CC-BY-SA)", on a phone (PHONE_QUERY) "© OpenStreetMap, © OpenTopoMap" with "OpenTopoMap" linking to
 * the license, without prefix; the line changes with PHONE_QUERY. On a phone the line keeps about 0.5 em more room on
 * the right. Leaflet is mocked; its attribution control records what the map shows.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LeafletMap, {
  OPENTOPOMAP_ATTRIBUTION,
  OPENTOPOMAP_PHONE_ATTRIBUTION,
  opentopomapAttribution,
  PHONE_QUERY,
} from "../src/regions/LocationPicker/map/LeafletMap.tsx";

const OSM = "https://www.openstreetmap.org/copyright";
const LICENSE = "https://creativecommons.org/licenses/by-sa/3.0/";

/** What Leaflet's attribution control shows: prefix and attributions, as the mocked map receives them. */
const shown = vi.hoisted(() => ({ prefix: "" as string | false, texts: [] as string[], tileOptions: [] as object[] }));
vi.mock("leaflet", () => {
  const control = {
    setPrefix: (prefix: string | false) => (shown.prefix = prefix),
    addAttribution: (text: string) => shown.texts.push(text),
    removeAttribution: (text: string) => (shown.texts = shown.texts.filter((item) => item !== text)),
  };
  return {
    default: {
      map: () => ({ remove: () => {}, on: () => {}, attributionControl: control }),
      tileLayer: (_url: string, options: object) => {
        shown.tileOptions.push(options);
        return { addTo: () => {}, on: () => {} };
      },
      circleMarker: () => ({ addTo: () => {} }),
      control: { zoom: () => ({ addTo: () => {} }) },
      Control: { Attribution: { prototype: { options: { prefix: "Leaflet" } } } },
    },
  };
});

/** A matchMedia stand-in for PHONE_QUERY that can be switched and fires `change`. */
function fakePhone(initial: boolean) {
  let phone = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return query === PHONE_QUERY && phone;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return {
    listeners,
    set(next: boolean) {
      phone = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

/** The text a viewer reads: tags dropped, entities decoded. */
function text(html: string): string {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element.textContent ?? "";
}

/** The links of an attribution as [text, href] pairs. */
function links(html: string): [string, string][] {
  const element = document.createElement("div");
  element.innerHTML = html;
  return [...element.querySelectorAll("a")].map((a) => [a.textContent ?? "", a.getAttribute("href") ?? ""]);
}

const place = { name: "Sölden", lat: 46.97, lon: 11.0, elevation: 1377 };

afterEach(() => {
  cleanup();
  shown.prefix = "";
  shown.texts = [];
  shown.tileOptions = [];
});

describe("OpenTopoMap attribution texts (REQ-644)", () => {
  it("desktop: © OpenStreetMap, © OpenTopoMap (CC-BY-SA), without contributors", () => {
    expect(text(OPENTOPOMAP_ATTRIBUTION)).toBe("© OpenStreetMap, © OpenTopoMap (CC-BY-SA)");
    expect(links(OPENTOPOMAP_ATTRIBUTION)).toEqual([
      ["OpenStreetMap", OSM],
      ["OpenTopoMap", "https://opentopomap.org"],
      ["CC-BY-SA", LICENSE],
    ]);
  });

  it("phone: © OpenStreetMap, © OpenTopoMap, OpenTopoMap links to the license", () => {
    expect(text(OPENTOPOMAP_PHONE_ATTRIBUTION)).toBe("© OpenStreetMap, © OpenTopoMap");
    expect(links(OPENTOPOMAP_PHONE_ATTRIBUTION)).toEqual([
      ["OpenStreetMap", OSM],
      ["OpenTopoMap", LICENSE],
    ]);
    expect(OPENTOPOMAP_PHONE_ATTRIBUTION).not.toMatch(/contributors|CC-BY-SA/);
  });

  it("picks the text by the view", () => {
    expect(opentopomapAttribution(false)).toBe(OPENTOPOMAP_ATTRIBUTION);
    expect(opentopomapAttribution(true)).toBe(OPENTOPOMAP_PHONE_ATTRIBUTION);
  });
});

describe("OpenTopoMap attribution on the map (REQ-474, REQ-644)", () => {
  it("shows the desktop line with the Leaflet prefix and switches with PHONE_QUERY", () => {
    const phone = fakePhone(false);
    render(<LeafletMap place={place} />);
    expect(shown.prefix).toBe("Leaflet");
    expect(shown.texts).toEqual([OPENTOPOMAP_ATTRIBUTION]);
    // The tile layer brings no attribution of its own, so the line is not doubled.
    expect(shown.tileOptions).toHaveLength(1);
    expect(shown.tileOptions[0]).not.toHaveProperty("attribution");

    phone.set(true);
    expect(shown.prefix).toBe(false);
    expect(shown.texts).toEqual([OPENTOPOMAP_PHONE_ATTRIBUTION]);

    phone.set(false);
    expect(shown.prefix).toBe("Leaflet");
    expect(shown.texts).toEqual([OPENTOPOMAP_ATTRIBUTION]);
  });

  it("opens on a phone with the short line and stops listening when closed", () => {
    const phone = fakePhone(true);
    const { unmount } = render(<LeafletMap place={place} />);
    expect(shown.prefix).toBe(false);
    expect(shown.texts).toEqual([OPENTOPOMAP_PHONE_ATTRIBUTION]);
    expect(phone.listeners.size).toBe(1);
    unmount();
    expect(phone.listeners.size).toBe(0);
  });
});

describe("room on the right on a phone (REQ-644)", () => {
  it("MapDialog.css widens the right padding of the Leaflet attribution under PHONE_QUERY", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../src/regions/LocationPicker/MapDialog.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const media = [...css.matchAll(/@media ([^{]+)\{([^{}]*\{[^}]*\}\s*)+\}/g)].find((match) =>
      match[0].includes(".leaflet-control-attribution"),
    );
    expect(media).toBeDefined();
    // Same query as PHONE_QUERY in LeafletMap.tsx, so the room and the short line come together.
    expect(media![1]!.trim()).toBe(PHONE_QUERY);
    expect(media![0]).toMatch(/\.map-dialog \.leaflet-control-attribution\s*\{\s*padding-right: calc\(5px \+ 0\.5em\);/);
  });
});
