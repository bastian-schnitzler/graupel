// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * No zoom when typing on the phone (REQ-578): Safari on the iPhone zooms into any focused field whose text is smaller
 * than 16 px. So on a phone (Chromium with the iPhone's size, touch and pixel density, as in `mobile-ui.spec.ts`) the
 * field for renaming a favourite (REQ-489) and every other text field and select the user can type in has at least
 * 16 px text, the language in the phone's menu included (REQ-575, REQ-580); on the desktop the rename field keeps its small text. There is no network: OpenTopoMap tiles are a
 * transparent pixel.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
/** Fields with an on-screen keyboard or picker; boxes to tick, sliders and file buttons do not zoom. */
const FIELDS = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), select, textarea";
const POINT = "47.1718° N · 12.6806° E";

// The tests store their own favourites before the page loads.
test.use({ locale: "en-GB", storedFavorites: false });

test.beforeEach(async ({ page }) => {
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [2779] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const results = name.startsWith("Inns")
      ? [{ name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, elevation: 574, country: "Austria" }]
      : [];
    return route.fulfill({ json: { results } });
  });
});

const region = (page: Page) => page.locator('[data-region="location"]');
const menu = (page: Page) => page.getByRole("menu", { name: "Favourites" });
const renameField = (page: Page) => menu(page).getByRole("textbox", { name: "Name of the favourite" });
const fontSize = (page: Page) => renameField(page).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

/** A map point saved as a favourite before the page loads. */
async function withMapPointFavourite(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("graupel.favorites")) {
      localStorage.setItem(
        "graupel.favorites",
        JSON.stringify([{ name: "", lat: 47.1718, lon: 12.6806, mapPoint: true }]),
      );
    }
  });
}

/** The visible fields of the page, each with its text size in CSS pixels. */
async function visibleFields(page: Page) {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((field) => field.checkVisibility())
        .map((field) => ({
          field: `${field.tagName.toLowerCase()}.${field.className} ${field.getAttribute("aria-label") ?? ""}`.trim(),
          size: parseFloat(getComputedStyle(field).fontSize),
        })),
    FIELDS,
  );
}

/** Checks the visible fields; there must be at least `count` of them, none with text below 16 px. */
async function expectNoZoomingField(page: Page, count: number) {
  const fields = await visibleFields(page);
  expect(fields.length).toBeGreaterThanOrEqual(count);
  expect(fields.filter(({ size }) => size < 16)).toEqual([]);
}

test.describe("on the phone (REQ-578)", () => {
  test.use(PHONE);
  ownDevice();

  test("a map point saved as a favourite is renamed in a field with at least 16 px text", async ({ page }) => {
    await page.goto(APP);

    // Pick a point on the map with a double tap, off the centre (the current place, a preset favourite).
    await region(page).getByRole("button", { name: "Map", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Map" });
    const map = dialog.locator('[data-map="opentopomap"]');
    await expect(map.locator(".leaflet-map-pane")).toHaveCount(1);
    await map.dblclick({ position: { x: 130, y: 280 } });
    await expect(dialog).toHaveCount(0);
    // The phone shows no coordinates line (REQ-573): the point's name comes from the star's label.
    const add = region(page).getByRole("button", { name: /^Add .+ to favourites$/ });
    const coordinates = (await add.getAttribute("aria-label"))!.replace(/^Add (.+) to favourites$/, "$1");

    // Save it as a favourite and open the rename field with the pencil.
    await add.click();
    await region(page).getByRole("button", { name: "Show favourites" }).click();
    await menu(page).getByRole("menuitem", { name: `Rename ${coordinates}` }).click();
    await expect(renameField(page)).toBeFocused();
    expect(await fontSize(page)).toBeGreaterThanOrEqual(16);

    // The rename still works.
    await renameField(page).fill("Hausberg");
    await renameField(page).press("Enter");
    await expect(region(page).getByRole("combobox")).toHaveValue("Hausberg");
  });

  test("no field the user types in has text below 16 px", async ({ page }) => {
    await withMapPointFavourite(page);
    await page.goto(APP);
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();

    // Start page: the place search; the language sits in the phone's menu (REQ-575, REQ-580).
    await expectNoZoomingField(page, 1);
    const phoneMenu = page.getByRole("button", { name: "Menu" });
    await phoneMenu.click();
    await expect(page.getByTestId("phone-menu-panel").getByRole("combobox", { name: "Language" })).toBeVisible();
    await expectNoZoomingField(page, 2);
    await phoneMenu.click();

    // Favourites menu while renaming.
    await region(page).getByRole("button", { name: "Show favourites" }).click();
    await menu(page).getByRole("menuitem", { name: `Rename ${POINT}` }).click();
    await expect(renameField(page)).toBeFocused();
    await expectNoZoomingField(page, 2);
    await page.keyboard.press("Escape");
    await expect(renameField(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();

    // Place search with suggestions.
    await region(page).getByRole("combobox").fill("Inns");
    await expect(region(page).getByRole("option")).toHaveCount(1);
    await expectNoZoomingField(page, 1);
    await page.keyboard.press("Escape");

    // Settings dialog, opened from the phone's menu: its selects come on top of the page's fields.
    await phoneMenu.click();
    await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    // The selects of the tab Start (REQ-686): the start place and the days shown.
    await settings.getByRole("tab", { name: "Start" }).click();
    expect(await settings.locator(FIELDS).count()).toBeGreaterThanOrEqual(1);
    await expectNoZoomingField(page, 2);
  });
});

test("on the desktop the rename field keeps its small text (REQ-578)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await withMapPointFavourite(page);
  await page.goto(APP);
  await region(page).getByRole("button", { name: "Show favourites" }).click();
  await menu(page).getByRole("menuitem", { name: `Rename ${POINT}` }).click();
  await expect(renameField(page)).toBeFocused();
  expect(await fontSize(page)).toBe(14);
});
