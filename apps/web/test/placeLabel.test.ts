// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** A place without own name is named by its coordinates, a renamed map point only by its alias (REQ-536). */
import { describe, expect, it } from "vitest";
import { LANGUAGES, MESSAGES, createTranslate, toLocale } from "../src/i18n/index.ts";
import {
  LEGACY_MAP_POINT_NAMES,
  favoriteName,
  isMapPointFavorite,
  ownName,
  placeLabel,
  toFavorite,
  toPlace,
  type Favorite,
} from "../src/state/index.ts";

const POINT = { name: "", lat: 46.9263, lon: 10.9261 };
const OLD_NAMES = [
  "Point on the map",
  "Punkt auf der Karte",
  "Point sur la carte",
  "Punto sulla mappa",
  "Punt op de kaart",
  "Punkt på kortet",
  "Bod na mapě",
  "Točka na zemljevidu",
];
const label = (place: typeof POINT, favorites: readonly Favorite[], language: (typeof LANGUAGES)[number]) =>
  placeLabel(place, favorites, toLocale(language), createTranslate(language));

describe("own name of a place (REQ-536)", () => {
  it("knows the generic map-point name of all eight languages, and only it", () => {
    expect(LANGUAGES).toHaveLength(8);
    expect([...LEGACY_MAP_POINT_NAMES].sort()).toEqual([...OLD_NAMES].sort());
    for (const name of OLD_NAMES) expect(ownName({ name })).toBeUndefined();
    expect(ownName({ name: "" })).toBeUndefined();
    expect(ownName({ name: "  " })).toBeUndefined();
    expect(ownName({ name: " Point sur la carte " })).toBeUndefined();
    expect(ownName({ name: "Innsbruck" })).toBe("Innsbruck");
    expect(ownName({ name: "Point sur la carte du Tyrol" })).toBe("Point sur la carte du Tyrol");
  });

  it("no language has a fixed name for a map point any more", () => {
    for (const language of LANGUAGES) expect(Object.keys(MESSAGES[language])).not.toContain("location.map.pointName");
  });

  it("stores a place with an old generic name without name", () => {
    for (const name of OLD_NAMES) {
      expect(toPlace({ ...POINT, name, elevation: 3158 })).toEqual({ ...POINT, elevation: 3158 });
      expect(toFavorite({ ...POINT, name })).toEqual(POINT);
      expect(isMapPointFavorite({ ...POINT, name })).toBe(true);
    }
    expect(isMapPointFavorite(POINT)).toBe(true);
    expect(isMapPointFavorite({ ...POINT, name: "Hausberg" })).toBe(false);
    expect(toPlace({ ...POINT, name: "Hausberg" }).name).toBe("Hausberg");
  });
});

describe("name shown for a place (REQ-536)", () => {
  it("shows a place without own name by its coordinates, in the language's format", () => {
    expect(label(POINT, [], "en")).toBe("46.9263° N · 10.9261° E");
    expect(label(POINT, [], "de")).toBe("46,9263° N · 10,9261° O");
    expect(label(POINT, [], "fr")).toBe("46,9263° N · 10,9261° E");
    expect(label({ name: "", lat: -33.9, lon: -70.25 }, [], "fr")).toBe("33,9000° S · 70,2500° O");
  });

  it("shows an old generic name of any language as coordinates, also for a favourite", () => {
    for (const name of OLD_NAMES) {
      expect(label({ ...POINT, name }, [], "de")).toBe("46,9263° N · 10,9261° O");
      const favorites = [{ ...POINT, name, mapPoint: true as const }];
      expect(favoriteName(favorites, POINT)).toBeUndefined();
      expect(label({ ...POINT, name }, favorites, "en")).toBe("46.9263° N · 10.9261° E");
    }
  });

  it("shows only the alias of a renamed map point at the coordinates", () => {
    const favorites = [{ ...POINT, name: "Hausberg", mapPoint: true as const }];
    expect(label(POINT, favorites, "de")).toBe("Hausberg");
    expect(label({ ...POINT, name: "Point sur la carte" }, favorites, "fr")).toBe("Hausberg");
    // A place at the same rounded coordinates, e.g. from the search, too.
    expect(label({ name: "Somewhere", lat: 46.92631, lon: 10.92609 }, favorites, "en")).toBe("Hausberg");
  });

  it("shows the own name of a named place", () => {
    expect(label({ name: "Innsbruck", lat: 47.2627, lon: 11.3945 }, [], "de")).toBe("Innsbruck");
  });
});
