// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renaming a favourite picked on the map (REQ-489) in a real browser, on the desktop and on a phone: pick a point on
 * the map, mark it, rename it with the pencil in the favourites menu; the new name is shown for the place and stays
 * after a reload. A point without own name is shown by its coordinates, in the search field and in the meteogram's
 * footer before the elevation, re-formatted with the language (REQ-536). There is no network: OpenTopoMap tiles are a
 * transparent pixel.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { chooseLanguage } from "./headerControls.ts";

const APP = "http://localhost:4175/";
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const SIZES = [
  { width: 1280, height: 800 },
  { width: 375, height: 740 },
];

test.beforeEach(async ({ page }) => {
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [2779] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
});

const region = (page: Page) => page.locator('[data-region="location"]');
const footer = (page: Page) => page.getByTestId("meteogram-footer-location").first();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The footer's place label: the name (here coordinates) right before the elevation. */
const footerLabel = (name: string) => new RegExp(`^${escape(name)}, \\d[\\d,.]* m`);

for (const size of SIZES) {
  test(`at ${size.width} px: a map point saved as a favourite is renamed with the pencil`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(APP);

    // Pick a point on the map with a double click.
    await region(page).getByRole("button", { name: "Map", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Map" });
    const map = dialog.locator('[data-map="opentopomap"]');
    await expect(map.locator(".leaflet-map-pane")).toHaveCount(1);
    // Off the centre, which is the current place (a preset favourite).
    await map.dblclick({ position: { x: Math.round(size.width / 3), y: Math.round(size.height / 3) } });
    await expect(dialog).toHaveCount(0);
    // No fixed name: the field and the meteogram's footer show the coordinates, the footer before the elevation.
    const combobox = region(page).getByRole("combobox");
    const coordinates = await combobox.inputValue();
    expect(coordinates).toMatch(/^\d+\.\d{4}° [NS] · \d+\.\d{4}° [EW]$/);
    // Not a second time below the field (REQ-673).
    await expect(region(page).getByTestId("location-coordinates")).toHaveCount(0);
    await expect(footer(page)).toHaveText(footerLabel(coordinates));

    // Save it as a favourite; its entry in the menu has a pencil, the presets have none.
    await region(page).getByRole("button", { name: `Add ${coordinates} to favourites` }).click();
    await region(page).getByRole("button", { name: "Show favourites" }).click();
    const menu = page.getByRole("menu", { name: "Favourites" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Rename / })).toHaveCount(1);
    const pencil = menu.getByRole("menuitem", { name: `Rename ${coordinates}` });
    await expect(pencil).toBeVisible();

    // The pencil sits on the right of the entry, inside the menu, which fits the screen.
    const entryBox = (await menu.getByRole("menuitem", { name: coordinates, exact: true }).boundingBox())!;
    const pencilBox = (await pencil.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(pencilBox.x).toBeGreaterThanOrEqual(entryBox.x + entryBox.width - 1);
    expect(pencilBox.x + pencilBox.width).toBeLessThanOrEqual(menuBox.x + menuBox.width);
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(size.width);
    expect(pencilBox.height).toBeGreaterThanOrEqual(30);

    // Rename it in place.
    await pencil.click();
    const field = menu.getByRole("textbox", { name: "Name of the favourite" });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    await field.fill("Hausberg");
    await field.press("Enter");
    await expect(field).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Hausberg", exact: true })).toBeFocused();
    await expect(combobox).toHaveValue("Hausberg");

    // Chosen from the menu, the place keeps the new name.
    await menu.getByRole("menuitem", { name: "Hausberg", exact: true }).click();
    await expect(combobox).toHaveValue("Hausberg");
    await expect(region(page).getByTestId("location-coordinates")).toHaveText(coordinates);
    // The meteogram's footer names the place the same way (REQ-535), with the alias only (REQ-536).
    await expect(footer(page)).toHaveText(footerLabel("Hausberg"));

    // After a reload the name is still there.
    await page.reload();
    await region(page).getByRole("button", { name: "Show favourites" }).click();
    await page.getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name: "Hausberg", exact: true }).click();
    await expect(region(page).getByRole("combobox")).toHaveValue("Hausberg");
    await expect(region(page).getByTestId("location-coordinates")).toHaveText(coordinates);
    await expect(footer(page)).toHaveText(footerLabel("Hausberg"));
  });
}

const POINT = "47.1718° N · 12.6806° E";

// These tests store their own favourites before the page loads.
test.describe("with own stored favourites", () => {
  test.use({ storedFavorites: false });

  test("the rename works with the keyboard; Escape cancels", async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("graupel.favorites")) {
        localStorage.setItem(
          "graupel.favorites",
          JSON.stringify([{ name: "", lat: 47.1718, lon: 12.6806, mapPoint: true }]),
        );
      }
    });
    await page.goto(APP);
    const arrow = region(page).getByRole("button", { name: "Show favourites" });
    await arrow.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Favourites" });
    await expect(menu.getByRole("menuitem", { name: POINT, exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menu.getByRole("menuitem", { name: `Rename ${POINT}` })).toBeFocused();
    await page.keyboard.press("Enter");
    const field = menu.getByRole("textbox", { name: "Name of the favourite" });
    await expect(field).toBeFocused();
    await page.keyboard.type("Alm");
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: POINT, exact: true })).toBeFocused();

    await page.keyboard.press("F2");
    await page.keyboard.type("Alm");
    await page.keyboard.press("Enter");
    await expect(menu.getByRole("menuitem", { name: "Alm", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(region(page).getByRole("combobox")).toHaveValue("Alm");
  });

  test("over the pencil only its own row is highlighted, not the entry before (REQ-508)", async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("graupel.favorites")) {
        localStorage.setItem(
          "graupel.favorites",
          JSON.stringify([
            { name: "Sölden", lat: 46.9655, lon: 11.0076 },
            { name: "Rettenbachgletscher", lat: 46.9375, lon: 10.9286, mapPoint: true },
          ]),
        );
      }
    });
    await page.goto(APP);
    await region(page).getByRole("button", { name: "Show favourites" }).click();
    const menu = page.getByRole("menu", { name: "Favourites" });
    const solden = menu.getByRole("menuitem", { name: "Sölden", exact: true });
    const glacier = menu.getByRole("menuitem", { name: "Rettenbachgletscher", exact: true });
    const pencil = menu.getByRole("menuitem", { name: "Rename Rettenbachgletscher" });
    const highlight = (locator: typeof solden) =>
      locator.evaluate((node) => getComputedStyle(node).boxShadow !== "none");

    await solden.hover();
    await expect(solden).toBeFocused();
    expect(await highlight(solden)).toBe(true);

    // From Sölden straight onto the pencil of the next entry.
    await pencil.hover();
    await expect(pencil).toBeFocused();
    expect(await highlight(solden)).toBe(false);
    expect(await highlight(glacier)).toBe(false);
    const background = (locator: typeof solden) => locator.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await background(solden)).toBe("rgba(0, 0, 0, 0)");

    // Back over an entry it is highlighted again; the keyboard goes on from there.
    await glacier.hover();
    await expect(glacier).toBeFocused();
    expect(await highlight(glacier)).toBe(true);
    await page.keyboard.press("ArrowUp");
    await expect(solden).toBeFocused();
  });

  test("a point without own name follows the language; an old French map point shows coordinates (REQ-536)", async ({
    page,
    deviceClass,
  }) => {
    // The line below the field with elevation and coordinates is the desktop's place row; the phone's design (also a
    // tablet's, REQ-728) shows the elevation between the slider's grips instead (REQ-562).
    const lineBelow = deviceClass === "desktop";
    await page.addInitScript(() => {
      if (!localStorage.getItem("graupel.favorites")) {
        localStorage.setItem(
          "graupel.favorites",
          JSON.stringify([
            { name: "Sölden", lat: 46.9655, lon: 11.0076 },
            { name: "Point sur la carte", lat: 46.9263, lon: 10.9261, mapPoint: true },
          ]),
        );
      }
    });
    await page.goto(APP);
    await region(page).getByRole("button", { name: "Show favourites" }).click();
    const menu = page.getByRole("menu", { name: "Favourites" });
    const entry = menu.getByRole("menuitem", { name: "46.9263° N · 10.9261° E", exact: true });
    await expect(entry).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Rename 46.9263° N · 10.9261° E" })).toBeVisible();
    await entry.click();
    const combobox = region(page).getByRole("combobox");
    await expect(combobox).toHaveValue("46.9263° N · 10.9261° E");
    await expect(footer(page)).toHaveText(footerLabel("46.9263° N · 10.9261° E"));

    // Another language formats the coordinates anew, in the field, the footer and the menu.
    await chooseLanguage(page, "de", "Language");
    await expect(combobox).toHaveValue("46,9263° N · 10,9261° O");
    // The field shows the coordinates, the line below only the elevation (REQ-673).
    await expect(region(page).getByTestId("location-coordinates")).toHaveCount(0);
    if (lineBelow) await expect(region(page).getByTestId("location-elevation")).toBeVisible();
    await expect(footer(page)).toHaveText(footerLabel("46,9263° N · 10,9261° O"));
    await region(page).getByRole("button", { name: "Favoriten anzeigen" }).click();
    const menuDe = page.getByRole("menu", { name: "Favoriten" });
    await expect(menuDe.getByRole("menuitem", { name: "46,9263° N · 10,9261° O", exact: true })).toBeVisible();

    // Renamed, only the alias is shown.
    await menuDe.getByRole("menuitem", { name: "46,9263° N · 10,9261° O umbenennen" }).click();
    const field = menuDe.getByRole("textbox", { name: "Name des Favoriten" });
    await field.fill("Rettenbachferner");
    await field.press("Enter");
    await expect(combobox).toHaveValue("Rettenbachferner");
    await expect(footer(page)).toHaveText(footerLabel("Rettenbachferner"));
    // With a name in the field the coordinates stand below it again (REQ-673).
    if (lineBelow) {
      await expect(region(page).getByTestId("location-coordinates")).toHaveText("46,9263° N · 10,9261° O");
    }
  });
});
