// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Map provider in the settings (REQ-467) in a real browser: without a choice the map of config.json (OpenTopoMap,
 * Leaflet) opens; choosing Maptoolkit in the settings opens MapLibre instead, also after a reload. Map tiles and
 * styles are not loaded (no network in the test); the mounted library shows which provider is used.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";

test.beforeEach(async ({ page }) => {
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
  // Tiles and styles of both providers: refused, the test only checks which library is mounted.
  await page.route(/opentopomap\.org|maptoolkit\.(org|net)/, (route) => route.abort());
});

async function openMap(page: Page) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("switching the map provider in the settings loads the other map", async ({ page }) => {
  await page.goto(APP);
  let map = await openMap(page);
  await expect(map.locator('[data-map="opentopomap"].leaflet-container')).toBeVisible();
  await expect(map.locator(".maplibregl-map")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(map).toHaveCount(0);

  await (await headerControl(page, "button", "Settings")).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const providers = settings.getByRole("radiogroup", { name: "Map" });
  await expect(providers.getByRole("radio", { name: "OpenTopoMap" })).toBeChecked();
  await providers.getByRole("radio", { name: "Maptoolkit" }).check();
  await expect(providers.getByRole("radio", { name: "Maptoolkit" })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("graupel.map"))).toBe("maptoolkit");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  map = await openMap(page);
  await expect(map.locator('[data-map="maptoolkit"]')).toHaveClass(/maplibregl-map/);
  await expect(map.locator(".leaflet-container")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The choice is kept; the About tab names both providers whichever is chosen (REQ-517).
  await page.reload();
  map = await openMap(page);
  await expect(map.locator('[data-map="maptoolkit"]')).toHaveClass(/maplibregl-map/);
  await page.keyboard.press("Escape");
  await (await headerControl(page, "button", "Info")).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Maptoolkit" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: "OpenTopoMap" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Back to OpenTopoMap.
  await (await headerControl(page, "button", "Settings")).click();
  await page.getByRole("radio", { name: "OpenTopoMap" }).check();
  await page.keyboard.press("Escape");
  map = await openMap(page);
  await expect(map.locator('[data-map="opentopomap"].leaflet-container')).toBeVisible();
});
