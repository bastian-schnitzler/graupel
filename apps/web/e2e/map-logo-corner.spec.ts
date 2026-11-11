// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Maptoolkit logo away from the rounded corner of a phone display (REQ-681): on a phone, upright or held in landscape,
 * the logo bottom left of the full-screen Maptoolkit map stands at least 20 px from the left and 14 px from the bottom
 * edge of the map (the logo control puts it at 8 px), so that a rounded corner does not cover its left end. Held in
 * landscape the map keeps clear of the camera by the safe-area inset (REQ-618) and the logo comes on top of that. The
 * logo overlaps neither the attribution nor the buttons. The desktop keeps the logo at 8 px below the switch tile
 * (REQ-659). No network: the Maptoolkit style is a small stand-in with the same credits (as in map-switch.spec.ts).
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const DESKTOP = { width: 1280, height: 800 };
const PORTRAIT = { width: 393, height: 852 };
const LANDSCAPE = { width: 852, height: 393 };
/** The camera's inset iOS reports at both sides in landscape, and the home indicator's at the bottom (iPhone, iOS 26). */
const CAMERA = 47;
const HOME = 21;
/** The new least room of the logo to the left and bottom edge of the map on a phone (REQ-681). */
const LEFT = 20;
const BOTTOM = 14;
/** Radius of the display's corners on a recent iPhone (about 55 pt), to check the logo's corner lies outside it. */
const CORNER = 55;
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
/** Stand-in for the Maptoolkit style: plain ground and one (empty) source with the credits of the real one. */
const MAPTOOLKIT_STYLE = {
  version: 8,
  sources: {
    maptoolkit: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      attribution:
        '<a href="https://www.maptoolkit.com/">© Maptoolkit</a> ' +
        '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
    },
  },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": "#f6f4ef" } },
    { id: "points", type: "circle", source: "maptoolkit" },
  ],
};

type Box = { x: number; y: number; width: number; height: number };

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  await page.route(/opentopomap\.org/, (route) => route.abort());
  await page.route(/maptoolkit\.(org|net)/, (route) =>
    route.request().url().endsWith("/hiking.json") ? route.fulfill({ json: MAPTOOLKIT_STYLE }) : route.abort(),
  );
  await page.addInitScript(() => localStorage.setItem("graupel.map", "maptoolkit"));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Gives the page the screen's safe-area insets, as Safari reports them with viewport-fit=cover. */
async function setInsets(page: Page, insets: { left?: number; right?: number; bottom?: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
  await cdp.detach();
}

/** Opens the full-screen map and waits until MapLibre has set it up with the logo and the attribution. */
async function openMap(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-provider", "maptoolkit");
  await expect(dialog.locator('[data-map="maptoolkit"] canvas')).toHaveCount(1);
  await expect(dialog.locator(".maplibregl-ctrl-attrib")).toContainText("© Maptoolkit © OpenStreetMap");
  const logo = dialog.locator(".maptoolkit-logo-control");
  await expect(logo).toBeVisible();
  // The logo is a picture of 24 px height; wait until it is decoded and has its width.
  await expect
    .poll(() => logo.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  return dialog;
}

/** Turns the phone to landscape with the camera's insets and waits until the page has seen it. */
async function turnToLandscape(page: Page) {
  await setInsets(page, { left: CAMERA, right: CAMERA, bottom: HOME });
  await page.setViewportSize(LANDSCAPE);
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
    .toBe(true);
}

/**
 * The logo stands at least LEFT and BOTTOM px from the map's left and bottom edge and overlaps neither the attribution
 * nor Cancel, OK, the zoom or the layers button. Returns the logo's box.
 */
async function expectLogoClear(dialog: Locator) {
  const logo = await box(dialog.locator(".maptoolkit-logo-control"));
  const area = await box(dialog.locator(".map-dialog__map"));
  expect(logo.height).toBe(24);
  expect(logo.width).toBeGreaterThan(70);
  expect(logo.x - area.x).toBeGreaterThanOrEqual(LEFT - 0.5);
  expect(area.y + area.height - (logo.y + logo.height)).toBeGreaterThanOrEqual(BOTTOM - 0.5);
  // A few pixels, not far into the map.
  expect(logo.x - area.x).toBeLessThan(LEFT + 4);
  expect(area.y + area.height - (logo.y + logo.height)).toBeLessThan(BOTTOM + 4);
  const others = [
    dialog.locator(".maplibregl-ctrl-attrib"),
    dialog.getByRole("button", { name: "Cancel" }),
    dialog.getByRole("button", { name: "OK" }),
    dialog.locator(".maplibregl-ctrl-group").first(),
    dialog.locator(".map-switch"),
  ];
  for (const other of others) {
    await expect(other).toBeVisible();
    expect(overlaps(logo, await box(other))).toBe(false);
  }
  return { logo, area };
}

test.describe("phone", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  ownDevice();

  test("upright: the logo 20 px from the left and 14 px from the bottom, outside the rounded corner", async ({
    page,
  }) => {
    const dialog = await openMap(page);
    const { logo, area } = await expectLogoClear(dialog);
    // Upright the map reaches the screen's edges: the logo's bottom-left corner lies outside a rounded corner of
    // 55 px (it stood at 8 px from both edges, well inside it).
    expect(area).toEqual({ x: 0, y: 0, width: PORTRAIT.width, height: PORTRAIT.height });
    const fromCorner = { x: CORNER - logo.x, y: CORNER - (PORTRAIT.height - (logo.y + logo.height)) };
    expect(Math.hypot(fromCorner.x, fromCorner.y)).toBeLessThanOrEqual(CORNER);
    await expect(page).toHaveScreenshot("logo-phone.png", {
      clip: { x: 0, y: PORTRAIT.height - 60, width: 120, height: 60 },
    });
  });

  test("held in landscape: the logo clear of the camera and the same room inside the map", async ({ page }) => {
    const dialog = await openMap(page);
    await turnToLandscape(page);
    const area = dialog.locator(".map-dialog__map");
    await expect.poll(async () => (await box(area)).width).toBe(LANDSCAPE.width - 2 * CAMERA);
    const { logo } = await expectLogoClear(dialog);
    // The map begins after the camera's inset, the logo LEFT px further.
    expect(logo.x).toBeGreaterThanOrEqual(CAMERA + LEFT - 0.5);
    expect(LANDSCAPE.height - (logo.y + logo.height)).toBeGreaterThanOrEqual(BOTTOM - 0.5);
  });
});

test("desktop: the logo stays 8 px from the edges below the switch tile", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const dialog = await openMap(page);
  const logo = await box(dialog.locator(".maptoolkit-logo-control"));
  const area = await box(dialog.locator(".map-dialog__map"));
  expect(logo.x - area.x).toBe(8);
  expect(area.y + area.height - (logo.y + logo.height)).toBe(8);
  const tile = await box(dialog.getByRole("button", { name: "Switch to OpenTopoMap" }));
  expect(logo.y).toBeGreaterThanOrEqual(tile.y + tile.height);
  expect(overlaps(logo, await box(dialog.locator(".maplibregl-ctrl-attrib")))).toBe(false);
});
