// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The map's error card only for a map that does not load (REQ-771), on a phone, a tablet and the desktop: on an iPad
 * Air 2 the card "The map could not be loaded" showed over a Maptoolkit map that loaded slowly but completely. Single
 * failing or late tiles, glyphs and sprites show no card; a blocked style or tiles, or a device offline, show it as
 * before (REQ-492), for Maptoolkit and for OpenTopoMap. No network: Maptoolkit is a small stand-in style with raster
 * tiles, a sprite and glyphs, all on maptoolkit.org; OpenTopoMap tiles are a transparent pixel.
 */
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./fixtures.ts";

type Provider = "opentopomap" | "maptoolkit";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 11 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 11, 11);
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const MAPTOOLKIT_TILES = "https://tiles.maptoolkit.org/test/";
/**
 * Stand-in for the Maptoolkit style: raster tiles, a sprite and glyphs on maptoolkit.org, and the name of the start
 * place (Mont Blanc) as a label, so MapLibre asks for each kind of resource.
 */
const MAPTOOLKIT_STYLE = {
  version: 8,
  sprite: "https://sprites.maptoolkit.org/test/sprite",
  glyphs: "https://fonts.maptoolkit.org/{fontstack}/{range}.pbf",
  sources: {
    maptoolkit: {
      type: "raster",
      tiles: [`${MAPTOOLKIT_TILES}{z}/{x}/{y}.png`],
      tileSize: 256,
      attribution: '<a href="https://www.maptoolkit.com/">© Maptoolkit</a>',
    },
    names: {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Mont Blanc" },
            geometry: { type: "Point", coordinates: [6.8652, 45.8326] },
          },
        ],
      },
    },
  },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": "#f6f4ef" } },
    { id: "tiles", type: "raster", source: "maptoolkit" },
    {
      id: "labels",
      type: "symbol",
      source: "names",
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"] },
    },
  ],
};

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [4806] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function useProvider(page: Page, provider: Provider) {
  await page.addInitScript((value) => localStorage.setItem("graupel.map", value), provider);
}

/** The map's error card (REQ-492), not the forecast's. */
const MAP_CARD = '[data-testid="error-card"][data-notice="location.map"]';
const mapCard = (page: Page) => page.locator(MAP_CARD);

/** Notes whether the map's error card ever shows, even for a moment (a map that loads takes it away again). */
async function watchMapCard(page: Page) {
  await page.addInitScript((selector) => {
    const flags = window as unknown as { mapCardSeen?: boolean };
    new MutationObserver(() => {
      if (document.querySelector(selector)) flags.mapCardSeen = true;
    }).observe(document, { childList: true, subtree: true });
  }, MAP_CARD);
  return async () => page.evaluate(() => (window as unknown as { mapCardSeen?: boolean }).mapCardSeen ?? false);
}

async function openMap(page: Page, provider: Provider) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toHaveAttribute("data-provider", provider);
  return dialog;
}

/** Answers tile requests: the first ones fail, the next ones come late, the rest at once; counts what was asked for. */
function flakyTiles(options: { failing: number; late: number; delay: number }) {
  const tiles = { asked: 0, done: 0, failed: 0 };
  const handle = async (route: Route, answer: () => Promise<void>) => {
    const index = tiles.asked++;
    try {
      if (index < options.failing) {
        tiles.failed += 1;
        await route.abort();
      } else {
        if (index < options.failing + options.late) await new Promise((done) => setTimeout(done, options.delay));
        await answer();
      }
    } catch {
      // The map no longer needed the tile and the page dropped it.
    }
    tiles.done += 1;
  };
  return { tiles, handle };
}

/** Waits until every tile asked for has been answered, and a little longer for the map to settle. */
async function settled(page: Page, tiles: { asked: number; done: number }) {
  await expect.poll(() => tiles.asked > 0 && tiles.done === tiles.asked, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(1000);
  expect(tiles.done).toBe(tiles.asked);
}

test.describe("Maptoolkit (REQ-771)", () => {
  test.beforeEach(async ({ page }) => {
    await useProvider(page, "maptoolkit");
    await page.route(/opentopomap\.org/, (route) => route.abort());
  });

  test("single failing and late tiles, a failing sprite and glyphs: the map loads without the card", async ({
    page,
  }) => {
    const cardSeen = await watchMapCard(page);
    const { tiles, handle } = flakyTiles({ failing: 2, late: 2, delay: 2000 });
    const failed: string[] = [];
    await page.route(/maptoolkit\.(org|net)/, (route) => {
      const url = route.request().url();
      if (url.endsWith("/hiking.json")) return route.fulfill({ json: MAPTOOLKIT_STYLE });
      if (url.startsWith(MAPTOOLKIT_TILES)) {
        return handle(route, () => route.fulfill({ body: TILE, contentType: "image/png" }));
      }
      failed.push(url);
      return route.abort();
    });
    await page.goto(APP);
    const dialog = await openMap(page, "maptoolkit");
    await expect(dialog.locator('[data-map="maptoolkit"] canvas')).toHaveCount(1);
    await expect(dialog.locator(".maplibregl-ctrl-attrib")).toContainText("Maptoolkit");
    await settled(page, tiles);
    expect(tiles.failed).toBe(2);
    // The sprite and the glyphs were asked for and failed too.
    expect(failed.some((url) => url.startsWith("https://sprites.maptoolkit.org/"))).toBe(true);
    await expect.poll(() => failed.some((url) => url.startsWith("https://fonts.maptoolkit.org/"))).toBe(true);
    await expect(mapCard(page)).toHaveCount(0);
    expect(await cardSeen()).toBe(false);
  });

  test("a blocked style shows the card", async ({ page }) => {
    await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
    await page.goto(APP);
    await openMap(page, "maptoolkit");
    await expect(mapCard(page)).toContainText("The map could not be loaded. Check your connection.");
  });

  test("offline: the card shows", async ({ page }) => {
    await page.route(/maptoolkit\.(org|net)/, (route) =>
      route.request().url().endsWith("/hiking.json") ? route.fulfill({ json: MAPTOOLKIT_STYLE }) : route.abort(),
    );
    await page.goto(APP);
    // Once online, so the map library has loaded: the card then stands for the map's own data.
    await openMap(page, "maptoolkit");
    await expect(page.locator('[data-map="maptoolkit"] canvas')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.unroute(/maptoolkit\.(org|net)/);
    await page.context().setOffline(true);
    await openMap(page, "maptoolkit");
    await expect(mapCard(page)).toContainText("The map could not be loaded. Check your connection.");
    await page.context().setOffline(false);
  });
});

test.describe("OpenTopoMap (REQ-771)", () => {
  test.beforeEach(async ({ page }) => {
    await useProvider(page, "opentopomap");
    await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
  });

  test("single failing and late tiles: the map loads without the card", async ({ page }) => {
    const cardSeen = await watchMapCard(page);
    const { tiles, handle } = flakyTiles({ failing: 2, late: 2, delay: 2000 });
    await page.route("https://*.tile.opentopomap.org/**", (route) =>
      handle(route, () => route.fulfill({ body: TILE, contentType: "image/png" })),
    );
    await page.goto(APP);
    const dialog = await openMap(page, "opentopomap");
    await expect(dialog.locator('[data-map="opentopomap"] .leaflet-tile-loaded').first()).toBeAttached();
    await settled(page, tiles);
    expect(tiles.failed).toBe(2);
    await expect(mapCard(page)).toHaveCount(0);
    expect(await cardSeen()).toBe(false);
  });

  test("blocked tiles show the card", async ({ page }) => {
    await page.route(/opentopomap\.org/, (route) => route.abort());
    await page.goto(APP);
    await openMap(page, "opentopomap");
    await expect(mapCard(page)).toContainText("The map could not be loaded. Check your connection.");
  });

  test("offline: the card shows", async ({ page }) => {
    // Tiles that do not come yet (none the browser could keep for later).
    let asked = 0;
    await page.route("https://*.tile.opentopomap.org/**", () => {
      asked += 1;
    });
    await page.goto(APP);
    // Once online, so the map library has loaded: the card then stands for the tiles.
    await openMap(page, "opentopomap");
    await expect.poll(() => asked).toBeGreaterThan(0);
    await expect(mapCard(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.unroute("https://*.tile.opentopomap.org/**");
    await page.context().setOffline(true);
    await openMap(page, "opentopomap");
    await expect(mapCard(page)).toContainText("The map could not be loaded. Check your connection.");
    await page.context().setOffline(false);
  });
});
