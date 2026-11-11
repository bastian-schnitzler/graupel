// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Switch between OpenTopoMap and Maptoolkit in the full-screen map (REQ-659, DEC-065): on the desktop a preview tile of
 * 80 px in the bottom-left corner with a picture (REQ-675) and the name of the other map, above the Maptoolkit logo; on
 * a phone a layers button top right under the zoom buttons, in the style of the shown map's zoom. A click loads the other
 * map with the same centre, zoom and marker, OK takes the place picked before; the choice is stored as in the settings,
 * which show it, and the next map opens with it. Attribution and zoom come from the shown map (OpenTopoMap as in REQ-644,
 * Maptoolkit with its logo). No network: OpenTopoMap tiles are a transparent pixel, the Maptoolkit style is a small
 * stand-in with the same credits.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

type Provider = "opentopomap" | "maptoolkit";

const APP = "http://localhost:4175/";
const DESKTOP = { width: 1280, height: 800 };
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
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
const NAMES: Record<Provider, string> = { opentopomap: "OpenTopoMap", maptoolkit: "Maptoolkit" };
const other = (provider: Provider): Provider => (provider === "opentopomap" ? "maptoolkit" : "opentopomap");

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
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) =>
    route.request().url().endsWith("/hiking.json") ? route.fulfill({ json: MAPTOOLKIT_STYLE }) : route.abort(),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function useProvider(page: Page, provider: Provider) {
  await page.addInitScript((value) => {
    // Only before the first load: the switch's choice has to outlast a reload.
    if (!sessionStorage.getItem("map-switch-test")) localStorage.setItem("graupel.map", value);
    sessionStorage.setItem("map-switch-test", "1");
  }, provider);
}

/** Waits until the library has set up the map (Leaflet: panes; MapLibre: the canvas and the style). */
async function mapReady(dialog: Locator, provider: Provider) {
  await expect(dialog).toHaveAttribute("data-provider", provider);
  const map = dialog.locator(`[data-map="${provider}"]`);
  await expect(map.locator(provider === "opentopomap" ? ".leaflet-map-pane" : "canvas")).toHaveCount(1);
  if (provider === "maptoolkit") await expect(dialog.locator(".maplibregl-ctrl-attrib")).toContainText("Maptoolkit");
  return map;
}

async function openMap(page: Page, provider: Provider) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  await mapReady(dialog, provider);
  return dialog;
}

/** Point of the place marker on the screen: Leaflet's circle, MapLibre's pin with its tip on the place. */
async function markerPoint(dialog: Locator, provider: Provider) {
  const marker = dialog.locator(provider === "opentopomap" ? "path.leaflet-interactive" : ".maplibregl-marker");
  const box = (await marker.boundingBox())!;
  return provider === "opentopomap"
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : { x: box.x + box.width / 2, y: box.y + box.height };
}

/** The marker's point once it stands still (after a zoom animation). */
async function restingMarker(dialog: Locator, provider: Provider) {
  let last = { x: NaN, y: NaN };
  await expect
    .poll(async () => {
      const point = await markerPoint(dialog, provider);
      const still = Math.hypot(point.x - last.x, point.y - last.y) < 0.5;
      last = point;
      return still;
    })
    .toBe(true);
  return last;
}

/** The tile's picture shows `provider`'s map (REQ-675): its own image, loaded, 160 px drawn into 76 px. */
async function expectPicture(tile: Locator, provider: Provider) {
  const picture = tile.locator("img.map-switch__picture");
  await expect(picture).toHaveAttribute("src", new RegExp(`${provider}[^/]*\\.webp$`));
  await expect(picture).toHaveAttribute("alt", "");
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(160);
  const box = (await picture.boundingBox())!;
  expect(box.width).toBe(76);
  expect(box.height).toBe(76);
}

function coordinates(page: Page) {
  return page.locator('[data-region="location"] > .location__facts').getByTestId("location-coordinates");
}

function zoomControl(dialog: Locator, provider: Provider) {
  return dialog.locator(provider === "opentopomap" ? ".leaflet-control-zoom" : ".maplibregl-ctrl-group").first();
}

/** The attribution of the shown map, and that the other's is gone (REQ-644; Maptoolkit with its logo). */
async function expectAttribution(dialog: Locator, provider: Provider, phone: boolean) {
  if (provider === "opentopomap") {
    await expect(dialog.locator(".maplibregl-ctrl-attrib")).toHaveCount(0);
    await expect(dialog.locator(".maptoolkit-logo-control")).toHaveCount(0);
    await expect(dialog.locator(".leaflet-control-attribution")).toHaveText(
      phone ? "© OpenStreetMap, © OpenTopoMap" : "Leaflet | © OpenStreetMap, © OpenTopoMap (CC-BY-SA)",
    );
  } else {
    await expect(dialog.locator(".leaflet-control-attribution")).toHaveCount(0);
    await expect(dialog.locator(".maplibregl-ctrl-attrib")).toContainText("© Maptoolkit © OpenStreetMap");
    await expect(dialog.locator(".maptoolkit-logo-control")).toBeVisible();
  }
}

for (const provider of ["opentopomap", "maptoolkit"] as const) {
  test(`desktop, ${provider}: the tile bottom left changes to the other map with the same view and marker`, async ({
    page,
  }) => {
    await useProvider(page, provider);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const field = page.locator('[data-region="location"]').getByRole("combobox");
    await expect(field).toHaveValue("Mont Blanc");
    const dialog = await openMap(page, provider);
    const next = other(provider);

    // The tile: 80 px, bottom left, the other map's name; no layers button under the zoom.
    const tile = dialog.getByRole("button", { name: `Switch to ${NAMES[next]}` });
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("title", `Switch to ${NAMES[next]}`);
    await expect(tile).toContainText(NAMES[next]);
    await expect(dialog.locator(".map-switch")).toHaveCount(1);
    const tileBox = (await tile.boundingBox())!;
    expect(tileBox.width).toBe(80);
    expect(tileBox.height).toBe(80);
    expect(tileBox.x).toBeLessThan(20);
    // A little above Cancel and OK, so that the Maptoolkit logo fits below it.
    const ok = dialog.getByRole("button", { name: "OK" });
    const okBox = (await ok.boundingBox())!;
    expect(tileBox.y + tileBox.height).toBeLessThan(okBox.y + okBox.height);
    expect(DESKTOP.height - (tileBox.y + tileBox.height)).toBeGreaterThanOrEqual(40);
    expect(DESKTOP.height - (tileBox.y + tileBox.height)).toBeLessThan(60);
    if (provider === "maptoolkit") {
      const logo = (await dialog.locator(".maptoolkit-logo-control").boundingBox())!;
      expect(logo.y).toBeGreaterThanOrEqual(tileBox.y + tileBox.height);
    }
    // REQ-675: the picture of the other map from Bastian's sample (flat for OpenTopoMap, shaded for Maptoolkit), 160 px
    // for sharp screens, loaded before the reference picture.
    await expectPicture(tile, next);
    await expect(tile).toHaveScreenshot(`tile-${next}.png`);
    await expectAttribution(dialog, provider, false);

    // A point picked away from the centre, then one level closer: the marker moves twice as far from the centre.
    const map = dialog.locator(`[data-map="${provider}"]`);
    await map.click({ position: { x: 400, y: 300 } });
    await expect(ok).toBeEnabled();
    await restingMarker(dialog, provider);
    await dialog.locator(provider === "opentopomap" ? ".leaflet-control-zoom-in" : ".maplibregl-ctrl-zoom-in").click();
    await expect
      .poll(async () => {
        const point = await markerPoint(dialog, provider);
        return Math.round(Math.hypot(point.x - 160, point.y - 200));
      })
      .toBeLessThan(10);
    const shown = await restingMarker(dialog, provider);
    await page.screenshot({ path: test.info().outputPath(`desktop-${provider}-before.png`) });

    await tile.click();
    await mapReady(dialog, next);
    await expect(dialog.locator(`[data-map="${provider}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("graupel.map"))).toBe(next);
    // Same centre and zoom: the marker stands where it stood (MapLibre's pin a few pixels off its tip).
    const moved = await restingMarker(dialog, next);
    expect(Math.hypot(moved.x - shown.x, moved.y - shown.y)).toBeLessThan(8);
    await expectAttribution(dialog, next, false);
    // The tile now offers the first map; focus stays on it.
    const back = dialog.getByRole("button", { name: `Switch to ${NAMES[provider]}` });
    await expect(back).toBeFocused();
    await expect(back).toContainText(NAMES[provider]);
    await expectPicture(back, provider);
    await page.screenshot({ path: test.info().outputPath(`desktop-${provider}-after.png`) });

    // OK takes the point picked before the switch.
    await expect(ok).toBeEnabled();
    await ok.click();
    await expect(dialog).toHaveCount(0);
    // A point without own name: the field shows its coordinates, not the line below it (REQ-536, REQ-673).
    await expect(field).toHaveValue(/^\d+\.\d{4}° [NS] · \d+\.\d{4}° [EW]$/);
    await expect(coordinates(page)).toHaveCount(0);
  });
}

test("desktop: after a switch the settings show the new map and the next map opens with it", async ({ page }) => {
  await useProvider(page, "opentopomap");
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  let dialog = await openMap(page, "opentopomap");
  await dialog.getByRole("button", { name: "Switch to Maptoolkit" }).click();
  await mapReady(dialog, "maptoolkit");
  // Cancel keeps the place, not the old map.
  const before = await coordinates(page).textContent();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(coordinates(page)).toHaveText(before!);

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const providers = settings.getByRole("radiogroup", { name: "Map" });
  await expect(providers.getByRole("radio", { name: "Maptoolkit" })).toBeChecked();
  await expect(providers.getByRole("radio", { name: "OpenTopoMap" })).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  dialog = await openMap(page, "maptoolkit");
  await expect(dialog.getByRole("button", { name: "Switch to OpenTopoMap" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Kept after a reload, as a choice in the settings is.
  await page.reload();
  dialog = await openMap(page, "maptoolkit");
  // And back: the settings follow again.
  await dialog.getByRole("button", { name: "Switch to OpenTopoMap" }).click();
  await mapReady(dialog, "opentopomap");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "OpenTopoMap" })).toBeChecked();
});

test("desktop: when Maptoolkit fails, the error card beside the tile leaves it free and OpenTopoMap loads", async ({ page }) => {
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
  await useProvider(page, "maptoolkit");
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  const card = page.getByTestId("error-card");
  await expect(card).toContainText("The map could not be loaded.");
  const tile = dialog.getByRole("button", { name: "Switch to OpenTopoMap" });
  const cardBox = (await card.boundingBox())!;
  const tileBox = (await tile.boundingBox())!;
  expect(cardBox.x).toBeGreaterThanOrEqual(tileBox.x + tileBox.width);
  await tile.click();
  await mapReady(dialog, "opentopomap");
  await expect(card).toHaveCount(0);
  await expectAttribution(dialog, "opentopomap", false);
});

test("desktop: the switch speaks the page's language", async ({ page }) => {
  await useProvider(page, "opentopomap");
  await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  await page.getByRole("button", { name: "Karte", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Karte" });
  const tile = dialog.getByRole("button", { name: "Zu Maptoolkit wechseln" });
  await expect(tile).toHaveAttribute("title", "Zu Maptoolkit wechseln");
  await tile.click();
  await mapReady(dialog, "maptoolkit");
  await expect(dialog.getByRole("button", { name: "Zu OpenTopoMap wechseln" })).toBeVisible();
});

test.describe("phone", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  ownDevice();

  for (const provider of ["opentopomap", "maptoolkit"] as const) {
    test(`${provider}: a layers button under the zoom changes to the other map with the same view and marker`, async ({
      page,
    }) => {
      await useProvider(page, provider);
      await page.goto(APP);
      const dialog = await openMap(page, provider);
      const next = other(provider);

      // No tile; the layers button under the zoom buttons, as wide as they are and 10 px below them.
      await expect(dialog.locator(".map-switch--tile")).toHaveCount(0);
      await expect(dialog.locator(".map-switch img")).toHaveCount(0);
      const button = dialog.getByRole("button", { name: `Switch to ${NAMES[next]}` });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("title", `Switch to ${NAMES[next]}`);
      const zoom = (await zoomControl(dialog, provider).boundingBox())!;
      const box = (await button.boundingBox())!;
      expect(Math.abs(box.x - zoom.x)).toBeLessThan(1);
      expect(Math.abs(box.width - zoom.width)).toBeLessThan(1);
      expect(box.y - (zoom.y + zoom.height)).toBeGreaterThanOrEqual(9);
      expect(box.y - (zoom.y + zoom.height)).toBeLessThanOrEqual(11);
      await expect(button).toHaveScreenshot(`button-${provider}.png`);
      await expectAttribution(dialog, provider, true);

      const map = dialog.locator(`[data-map="${provider}"]`);
      await map.tap({ position: { x: 120, y: 300 } });
      const ok = dialog.getByRole("button", { name: "OK" });
      await expect(ok).toBeEnabled();
      const shown = await restingMarker(dialog, provider);
      await page.screenshot({ path: test.info().outputPath(`phone-${provider}-before.png`) });

      await button.tap();
      await mapReady(dialog, next);
      const moved = await restingMarker(dialog, next);
      expect(Math.hypot(moved.x - shown.x, moved.y - shown.y)).toBeLessThan(8);
      await expectAttribution(dialog, next, true);
      const back = dialog.getByRole("button", { name: `Switch to ${NAMES[provider]}` });
      const zoomAfter = (await zoomControl(dialog, next).boundingBox())!;
      const backBox = (await back.boundingBox())!;
      expect(backBox.y - (zoomAfter.y + zoomAfter.height)).toBeGreaterThanOrEqual(9);
      expect(backBox.y - (zoomAfter.y + zoomAfter.height)).toBeLessThanOrEqual(11);
      expect(await page.evaluate(() => localStorage.getItem("graupel.map"))).toBe(next);
      await page.screenshot({ path: test.info().outputPath(`phone-${provider}-after.png`) });

      await expect(ok).toBeEnabled();
      await ok.tap();
      await expect(dialog).toHaveCount(0);
    });
  }

  test("held in landscape the layers button stays under the zoom", async ({ page }) => {
    await useProvider(page, "opentopomap");
    await page.goto(APP);
    const dialog = await openMap(page, "opentopomap");
    await page.setViewportSize(LANDSCAPE);
    await expect
      .poll(() => page.evaluate(() => matchMedia("(orientation: landscape) and (max-height: 500px)").matches))
      .toBe(true);
    await expect(dialog.locator(".map-switch--tile")).toHaveCount(0);
    const button = dialog.getByRole("button", { name: "Switch to Maptoolkit" });
    const zoom = (await zoomControl(dialog, "opentopomap").boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(Math.abs(box.x - zoom.x)).toBeLessThan(1);
    expect(box.y).toBeGreaterThan(zoom.y + zoom.height);
    await button.tap();
    await mapReady(dialog, "maptoolkit");
    await expectAttribution(dialog, "maptoolkit", true);
  });
});
