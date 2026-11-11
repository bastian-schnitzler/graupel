// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Short attribution of the OpenTopoMap map (REQ-644): on the desktop "Leaflet | © OpenStreetMap, © OpenTopoMap
 * (CC-BY-SA)", on a phone, upright or held in landscape, "© OpenStreetMap, © OpenTopoMap" without Leaflet, with
 * "OpenTopoMap" linking to the license CC BY-SA 3.0, and about two spaces (0.5 em) of room on the right so that a
 * display with rounded corners at the bottom does not cut the line off. No network: tiles are a transparent pixel.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const DESKTOP = { width: 1280, height: 800 };
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
/** Same query as PHONE_QUERY in src/regions/LocationPicker/map/LeafletMap.tsx. */
const PHONE_QUERY = "(max-width: 30rem), (orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
const OSM = "https://www.openstreetmap.org/copyright";
const LICENSE = "https://creativecommons.org/licenses/by-sa/3.0/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.use({ timezoneId: "UTC", locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.addInitScript(() => localStorage.setItem("graupel.map", "opentopomap"));
});

async function openMap(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  return dialog.locator(".leaflet-control-attribution");
}

/** Room between the end of the line's text and the right edge of its box and of the window, and the font size. */
function rightRoom(attribution: Locator) {
  return attribution.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) last = node as Text;
    }
    const range = document.createRange();
    range.selectNodeContents(last!);
    const textRight = range.getBoundingClientRect().right;
    return {
      box: element.getBoundingClientRect().right - textRight,
      window: document.documentElement.clientWidth - textRight,
      fontSize: parseFloat(getComputedStyle(element).fontSize),
    };
  });
}

/** Turns the phone and waits until the page has seen the new size in PHONE_QUERY's landscape part. */
async function turn(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await expect
    .poll(() =>
      page.evaluate(
        (query) =>
          new Promise<boolean>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(matchMedia(query).matches))),
          ),
        "(orientation: landscape)",
      ),
    )
    .toBe(size.width > size.height);
}

async function expectPhoneLine(attribution: Locator) {
  await expect(attribution).toHaveText("© OpenStreetMap, © OpenTopoMap");
  await expect(attribution).not.toContainText("Leaflet");
  await expect(attribution).not.toContainText("contributors");
  await expect(attribution).not.toContainText("(CC-BY-SA)");
  await expect(attribution.getByRole("link")).toHaveCount(2);
  await expect(attribution.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute("href", OSM);
  await expect(attribution.getByRole("link", { name: "OpenTopoMap" })).toHaveAttribute("href", LICENSE);
  // About two spaces (0.5 em) before the right edge, plus the usual padding of the line (REQ-644).
  const room = await rightRoom(attribution);
  expect(room.fontSize).toBe(12);
  expect(room.box).toBeGreaterThanOrEqual(0.5 * room.fontSize);
  expect(room.window).toBeGreaterThanOrEqual(0.5 * room.fontSize);
  expect(room.box).toBeCloseTo(5 + 0.5 * room.fontSize, 0);
}

test("desktop at 1280 px: Leaflet prefix, © OpenStreetMap, © OpenTopoMap (CC-BY-SA)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const attribution = await openMap(page);
  await expect(attribution).toHaveText("Leaflet | © OpenStreetMap, © OpenTopoMap (CC-BY-SA)");
  await expect(attribution).not.toContainText("contributors");
  await expect(attribution.getByRole("link", { name: "Leaflet" })).toHaveAttribute("href", "https://leafletjs.com");
  await expect(attribution.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute("href", OSM);
  await expect(attribution.getByRole("link", { name: "OpenTopoMap" })).toHaveAttribute(
    "href",
    "https://opentopomap.org",
  );
  await expect(attribution.getByRole("link", { name: "CC-BY-SA" })).toHaveAttribute("href", LICENSE);
  // The desktop keeps its padding of 5 px on the right.
  expect(await page.evaluate((query) => matchMedia(query).matches, PHONE_QUERY)).toBe(false);
  expect((await rightRoom(attribution)).box).toBeCloseTo(5, 0);
});

test("a desktop window narrowed to phone width shows the phone line and back", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const attribution = await openMap(page);
  await expect(attribution).toContainText("Leaflet");
  await page.setViewportSize({ width: 375, height: 740 });
  await expectPhoneLine(attribution);
  await page.setViewportSize(DESKTOP);
  await expect(attribution).toHaveText("Leaflet | © OpenStreetMap, © OpenTopoMap (CC-BY-SA)");
});

test.describe("phone", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  ownDevice();

  test("390 px upright and held in landscape: the short line with room on the right", async ({ page }) => {
    const attribution = await openMap(page);
    expect(await page.evaluate((query) => matchMedia(query).matches, PHONE_QUERY)).toBe(true);
    await expectPhoneLine(attribution);

    // Held in landscape the window is wider than 30rem; PHONE_QUERY still matches through its landscape part.
    await turn(page, LANDSCAPE);
    expect(await page.evaluate(() => matchMedia("(max-width: 30rem)").matches)).toBe(false);
    expect(await page.evaluate((query) => matchMedia(query).matches, PHONE_QUERY)).toBe(true);
    await expectPhoneLine(attribution);

    await turn(page, PORTRAIT);
    await expectPhoneLine(attribution);
  });
});
