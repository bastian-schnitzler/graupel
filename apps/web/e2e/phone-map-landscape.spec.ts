// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Turning a phone to landscape while the full-screen map is open (REQ-645) keeps the map: the full-screen meteogram
 * (REQ-454) does not open, not even for a moment, and the map fills the landscape screen with its buttons and its
 * attribution clear of the camera (REQ-618; Chromium is given the insets iOS reports, as in phone-safe-area.spec.ts).
 * Closed in landscape, the map leaves the page without the full-screen view until the next turn; turned upright and
 * back the view opens as before. Turned back upright with the map open, the map stays.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const PORTRAIT = { width: 393, height: 852 };
const LANDSCAPE = { width: 852, height: 393 };
/** The camera's inset iOS reports at both sides in landscape (iPhone, iOS 26). */
const CAMERA = 47;
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC" });
ownDevice();

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  // No network for the map (as in map-picker.spec.ts): OpenTopoMap tiles are a transparent pixel.
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
  // Counts every full-screen view that opens, however briefly (`__fullscreenOpened`).
  await page.addInitScript(() => {
    const state = window as unknown as { __fullscreenOpened: number };
    state.__fullscreenOpened = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(".meteogram-fullscreen") || node.querySelector(".meteogram-fullscreen")) {
            state.__fullscreenOpened += 1;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const map = (page: Page) => page.getByRole("dialog", { name: "Map" });
const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fullscreenOpened: number }).__fullscreenOpened);
const box = async (locator: Locator) => (await locator.boundingBox())!;

/** Gives the page the screen's safe-area insets, as Safari reports them with viewport-fit=cover. */
async function setInsets(page: Page, insets: { left?: number; right?: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
  await cdp.detach();
}

/**
 * Turns the phone: resizes the page (Chromium makes the screen and its orientation follow) and waits until the media
 * query of a phone in landscape follows, then a few frames more for a full-screen view to open, if it would.
 */
async function turn(page: Page, to: "portrait" | "landscape") {
  const landscape = to === "landscape";
  await setInsets(page, landscape ? { left: CAMERA, right: CAMERA } : {});
  await page.setViewportSize(landscape ? LANDSCAPE : PORTRAIT);
  await expect
    .poll(() =>
      page.evaluate(
        (query) =>
          new Promise<boolean>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(matchMedia(query).matches))),
          ),
        PHONE_LANDSCAPE,
      ),
    )
    .toBe(landscape);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200)))),
  );
}

/** Left and right edge of an element, to check it stays clear of the camera at both sides. */
async function clearOfCamera(locator: Locator) {
  const { x, width } = await box(locator);
  expect(x).toBeGreaterThanOrEqual(CAMERA - 0.5);
  expect(x + width).toBeLessThanOrEqual(LANDSCAPE.width - CAMERA + 0.5);
}

async function openMap(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).tap();
  await expect(map(page)).toBeVisible();
  await expect(map(page).locator(".leaflet-control-attribution")).toBeVisible();
}

test("turned with the map open: the map stays and fills the screen, no full-screen meteogram (REQ-645)", async ({
  page,
}) => {
  await openMap(page);
  await turn(page, "landscape");
  await expect(map(page)).toBeVisible();
  await expect(fullscreen(page)).toHaveCount(0);
  expect(await opened(page)).toBe(0);
  // The map fills the landscape screen; map area, buttons and attribution keep clear of the camera (REQ-618).
  expect(await box(map(page))).toEqual({ x: 0, y: 0, width: LANDSCAPE.width, height: LANDSCAPE.height });
  const area = map(page).locator(".map-dialog__map");
  await expect.poll(async () => (await box(area)).width).toBe(LANDSCAPE.width - 2 * CAMERA);
  expect((await box(area)).height).toBe(LANDSCAPE.height);
  await clearOfCamera(area);
  await clearOfCamera(map(page).getByRole("button", { name: "OK" }));
  await clearOfCamera(map(page).getByRole("button", { name: "Cancel" }));
  await clearOfCamera(map(page).locator(".leaflet-control-zoom"));
  const attribution = map(page).locator(".leaflet-control-attribution");
  await expect(attribution).toBeVisible();
  await clearOfCamera(attribution);
  await page.screenshot({ path: test.info().outputPath("map-landscape.png") });

  // Turned back upright, the map stays open.
  await turn(page, "portrait");
  await expect(map(page)).toBeVisible();
  expect(await opened(page)).toBe(0);
  // Turned again with the map still open: still no view.
  await turn(page, "landscape");
  await expect(map(page)).toBeVisible();
  expect(await opened(page)).toBe(0);
});

test("the map closed in landscape leaves the full-screen view closed until the next turn (REQ-645)", async ({
  page,
}) => {
  await openMap(page);
  await turn(page, "landscape");
  await expect(map(page)).toBeVisible();
  await map(page).getByRole("button", { name: "Cancel" }).tap();
  await expect(map(page)).toHaveCount(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200)))),
  );
  await expect(fullscreen(page)).toHaveCount(0);
  expect(await opened(page)).toBe(0);
  await expect(chart(page)).toBeVisible();

  // Upright and turned again: the view opens as before (REQ-454) and closes on turning back.
  await turn(page, "portrait");
  await expect(fullscreen(page)).toHaveCount(0);
  await turn(page, "landscape");
  await expect(fullscreen(page)).toBeVisible();
  expect(await opened(page)).toBe(1);
  await turn(page, "portrait");
  await expect(fullscreen(page)).toHaveCount(0);
});

test("a place picked on the map in landscape: the map closes, no full-screen view until the next turn (REQ-645)", async ({
  page,
}) => {
  await openMap(page);
  await turn(page, "landscape");
  // A double click picks a place at once and closes the map (REQ-476).
  const area = await box(map(page).locator(".map-dialog__map"));
  await page.mouse.dblclick(area.x + area.width / 3, area.y + area.height / 2);
  await expect(map(page)).toHaveCount(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200)))),
  );
  await expect(fullscreen(page)).toHaveCount(0);
  expect(await opened(page)).toBe(0);
  await turn(page, "portrait");
  await turn(page, "landscape");
  await expect(fullscreen(page)).toBeVisible();
});
