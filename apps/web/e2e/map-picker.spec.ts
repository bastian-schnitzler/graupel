// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Full-screen map in a real browser (REQ-474, REQ-475, REQ-476): the OpenTopoMap attribution on the desktop and on a
 * phone, the layout of the desktop app (map over the whole area, zoom top right, Cancel and OK bottom right, no
 * header) and picking a place with a click and OK or with a double click, on OpenTopoMap (Leaflet) and Maptoolkit
 * (MapLibre). There is no network: OpenTopoMap tiles are a transparent pixel, the Maptoolkit style is refused, so the
 * MapLibre map has no labels but still takes clicks on its canvas. The map has no scroll bars (REQ-512) and the
 * Maptoolkit map always points north, without a compass button (REQ-511).
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 740 };

test.beforeEach(async ({ page }) => {
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
});

async function useProvider(page: Page, provider: "opentopomap" | "maptoolkit") {
  await page.addInitScript((value) => localStorage.setItem("graupel.map", value), provider);
}

async function openMap(page: Page) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function coordinates(page: Page) {
  return page.locator('[data-region="location"] > .location__facts').getByTestId("location-coordinates");
}

test("OpenTopoMap attribution: required credits, Leaflet only on the desktop", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  let dialog = await openMap(page);
  const attribution = dialog.locator(".leaflet-control-attribution");
  // Short since REQ-644 (details in map-attribution.spec.ts).
  await expect(attribution).toHaveText("Leaflet | © OpenStreetMap, © OpenTopoMap (CC-BY-SA)");
  await expect(attribution.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/copyright",
  );
  await expect(attribution.getByRole("link", { name: "OpenTopoMap" })).toHaveAttribute("href", "https://opentopomap.org");
  await expect(attribution.getByRole("link", { name: "CC-BY-SA" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by-sa/3.0/",
  );
  await expect(attribution.getByRole("link", { name: "Leaflet" })).toBeVisible();
  await expect(attribution).not.toContainText("SRTM");
  await expect(attribution).not.toContainText("Map data");

  // Narrowed to phone width the Leaflet credit goes, and with it "(CC-BY-SA)" (REQ-644).
  await page.setViewportSize(PHONE);
  await expect(attribution).toHaveText("© OpenStreetMap, © OpenTopoMap");
  await page.keyboard.press("Escape");

  await page.reload();
  dialog = await openMap(page);
  await expect(dialog.locator(".leaflet-control-attribution")).toHaveText("© OpenStreetMap, © OpenTopoMap");

  // About names SRTM and Leaflet instead.
  await page.keyboard.press("Escape");
  await page.getByRole("banner").getByRole("button", { name: "Info" }).click();
  const about = page.getByRole("dialog");
  await expect(about.getByRole("link", { name: "SRTM" })).toBeVisible();
  await expect(about.getByRole("link", { name: "Leaflet" })).toHaveAttribute("href", "https://leafletjs.com/");
});

for (const provider of ["opentopomap", "maptoolkit"] as const) {
  for (const size of [DESKTOP, PHONE]) {
    test(`${provider} at ${size.width} px: map over the whole area, zoom top right, buttons bottom right`, async ({
      page,
    }) => {
      await useProvider(page, provider);
      await page.setViewportSize(size);
      await page.goto(APP);
      const dialog = await openMap(page);
      const map = dialog.locator(`[data-map="${provider}"]`);
      await expect(map).toBeVisible();
      await expect(dialog.getByRole("heading")).toHaveCount(0);
      await expect(dialog).not.toContainText("orientation");

      const box = (await map.boundingBox())!;
      expect(box).toEqual({ x: 0, y: 0, width: size.width, height: size.height });

      const zoom = dialog.locator(provider === "opentopomap" ? ".leaflet-control-zoom" : ".maplibregl-ctrl-zoom-in");
      const zoomBox = (await zoom.boundingBox())!;
      expect(zoomBox.y).toBeLessThan(20);
      expect(size.width - (zoomBox.x + zoomBox.width)).toBeLessThan(20);

      const cancel = (await dialog.getByRole("button", { name: "Cancel" }).boundingBox())!;
      const ok = (await dialog.getByRole("button", { name: "OK" }).boundingBox())!;
      expect(cancel.x + cancel.width).toBeLessThanOrEqual(ok.x);
      expect(size.width - (ok.x + ok.width)).toBeLessThan(20);
      expect(size.height - (ok.y + ok.height)).toBeLessThan(60);

      // The attribution sits in the bottom right corner below the buttons.
      const attribution = dialog.locator(
        provider === "opentopomap" ? ".leaflet-control-attribution" : ".maplibregl-ctrl-attrib",
      );
      const attributionBox = (await attribution.boundingBox())!;
      expect(attributionBox.y).toBeGreaterThanOrEqual(ok.y + ok.height);
      expect(size.width - (attributionBox.x + attributionBox.width)).toBeLessThan(2);
      if (provider === "maptoolkit") {
        const logo = (await dialog.locator(".maptoolkit-logo-control").boundingBox())!;
        // Bottom left; on a phone a little away from the rounded corner (REQ-681, map-logo-corner.spec.ts).
        expect(logo.x).toBeLessThan(30);
        expect(size.height - (logo.y + logo.height)).toBeLessThan(30);
      }
    });
  }

  test(`${provider}: a click sets the marker and OK picks it, a double click picks at once`, async ({ page }) => {
    await useProvider(page, provider);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const field = page.locator('[data-region="location"]').getByRole("combobox");
    await expect(field).toHaveValue("Mont Blanc");
    await expect(coordinates(page)).toHaveText("45.8326° N · 6.8652° E");

    let dialog = await openMap(page);
    const map = dialog.locator(`[data-map="${provider}"]`);
    const ok = dialog.getByRole("button", { name: "OK" });
    await expect(ok).toBeDisabled();
    // Wait until the library has set up the map (Leaflet: panes; MapLibre: the canvas).
    await expect(map.locator(provider === "opentopomap" ? ".leaflet-map-pane" : "canvas")).toHaveCount(1);
    await map.click({ position: { x: 400, y: 300 } });
    await expect(ok).toBeEnabled();
    await expect(dialog).toBeVisible();
    await ok.click();
    await expect(dialog).toHaveCount(0);
    // No fixed name: the field shows the coordinates (REQ-536), so they do not stand below it again (REQ-673).
    const picked = await field.inputValue();
    expect(picked).toMatch(/^\d+\.\d{4}° [NS] · \d+\.\d{4}° [EW]$/);
    await expect(coordinates(page)).toHaveCount(0);
    await expect(page.locator('[data-region="location"]').getByTestId("location-elevation")).toHaveText("1,234 m");

    // Cancel keeps the place.
    dialog = await openMap(page);
    await expect(map.locator(provider === "opentopomap" ? ".leaflet-map-pane" : "canvas")).toHaveCount(1);
    await map.click({ position: { x: 900, y: 500 } });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(field).toHaveValue(picked);

    // A double click picks at once, without zooming first.
    dialog = await openMap(page);
    await expect(map.locator(provider === "opentopomap" ? ".leaflet-map-pane" : "canvas")).toHaveCount(1);
    await map.dblclick({ position: { x: 900, y: 500 } });
    await expect(dialog).toHaveCount(0);
    await expect(field).not.toHaveValue(picked);
    await expect(field).toHaveValue(/^\d+\.\d{4}° [NS] · \d+\.\d{4}° [EW]$/);
  });
}

// REQ-512: the full-screen map fits the viewport exactly; the page behind does not scroll and shows no scroll bar.
for (const provider of ["opentopomap", "maptoolkit"] as const) {
  for (const size of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
    test(`${provider} at ${size.width} px: full-screen map without scroll bars`, async ({ page }) => {
      await useProvider(page, provider);
      await page.setViewportSize(size);
      await page.goto(APP);
      await expect(page.locator('[data-region="meteogram"]').first()).toBeVisible();
      // The page behind is longer than the viewport, so it would scroll (made longer where the test data is short).
      const pageScrolls = await page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
      );
      if (!pageScrolls) await page.evaluate(() => (document.body.style.paddingBottom = "150vh"));
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 120));

      const dialog = await openMap(page);
      const map = dialog.locator(`[data-map="${provider}"]`);
      await expect(map.locator(provider === "opentopomap" ? ".leaflet-map-pane" : "canvas")).toHaveCount(1);
      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        const box = document.querySelector<HTMLElement>(".map-dialog")!;
        const area = document.querySelector<HTMLElement>(".map-dialog__map")!;
        return {
          rootOverflow: [getComputedStyle(root).overflowX, getComputedStyle(root).overflowY],
          bodyOverflow: getComputedStyle(document.body).overflowY,
          rootClientWidth: root.clientWidth,
          rootClientHeight: root.clientHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          dialog: [box.scrollWidth, box.clientWidth, box.scrollHeight, box.clientHeight],
          area: [area.scrollWidth, area.clientWidth, area.scrollHeight, area.clientHeight],
        };
      });
      // No scroll bar on the page: it does not scroll and keeps the whole viewport.
      expect(metrics.rootOverflow).toEqual(["hidden", "hidden"]);
      expect(metrics.bodyOverflow).toBe("hidden");
      expect(metrics.rootClientWidth).toBe(metrics.innerWidth);
      expect(metrics.rootClientHeight).toBe(metrics.innerHeight);
      // Nothing in the dialog overflows it.
      const [dsw, dcw, dsh, dch] = metrics.dialog;
      expect(dsw).toBeLessThanOrEqual(dcw!);
      expect(dsh).toBeLessThanOrEqual(dch!);
      const [asw, acw, ash, ach] = metrics.area;
      expect(asw).toBeLessThanOrEqual(acw!);
      expect(ash).toBeLessThanOrEqual(ach!);
      expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: size.width, height: size.height });

      // The wheel over the map does not scroll the page behind.
      const scrollY = await page.evaluate(() => window.scrollY);
      await page.mouse.move(size.width / 2, size.height / 2);
      await page.mouse.wheel(0, 600);
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

      // Closed, the page scrolls again where it was.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe("hidden");
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    });
  }
}

// REQ-511: the Maptoolkit map cannot be turned or tilted, so it needs no compass ("reset north") button.
test("maptoolkit: always north up, no compass button", async ({ page }) => {
  await useProvider(page, "maptoolkit");
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  const dialog = await openMap(page);
  const map = dialog.locator('[data-map="maptoolkit"]');
  await expect(map.locator("canvas")).toHaveCount(1);
  await expect(dialog.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
  await expect(dialog.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
  await expect(dialog.locator(".maplibregl-ctrl-compass")).toHaveCount(0);

  // Set the marker away from the centre: turning the map would move it on the screen.
  await map.click({ position: { x: 300, y: 200 } });
  const marker = dialog.locator(".maplibregl-marker");
  await page.waitForTimeout(600);
  const before = (await marker.boundingBox())!;

  // Right-button drag (rotate and tilt in MapLibre) and Ctrl-drag do nothing.
  await page.mouse.move(800, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(1000, 250, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(600);
  expect(await marker.boundingBox()).toEqual(before);
  await page.keyboard.down("Control");
  await page.mouse.move(800, 400);
  await page.mouse.down();
  await page.mouse.move(1000, 250, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await page.waitForTimeout(600);
  expect(await marker.boundingBox()).toEqual(before);
  // Shift with the arrow keys turns and tilts by keyboard in MapLibre: also nothing.
  await map.locator("canvas").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.press("Shift+ArrowUp");
  await page.waitForTimeout(600);
  // Easing the camera in place may shift it by a fraction of a pixel; one turning step (15°) moves it by ~100 px.
  const after = (await marker.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
});
