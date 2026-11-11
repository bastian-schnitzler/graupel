// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "My location" only for the position just found (REQ-765), on a phone, a tablet and a desktop: after "Current
 * location" the field shows "My location"; a favourite made from it is listed by its coordinates, and after a reload
 * with the start place "Last selected place" the field shows the coordinates, since the position is no longer current.
 * With the start place "Current position (GPS)" the page locates again at start and shows "My location". Back after
 * the page was hidden (the app closed or sent to the background; the page's visibility is set and the browser's event
 * sent by the test), the field shows the coordinates, without locating again.
 *
 * Playwright grants the position (fixed, rounded to four decimals by the page) without a question.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";
/** The device's fixed position, and how the page names it without "My location". */
const HOME = { latitude: 51.180634, longitude: 7.509271 };
const HOME_COORDINATES = "51.1806° N · 7.5093° E";

let errors: string[] = [];

test.use({ locale: "en-GB", geolocation: HOME, permissions: ["geolocation"] });

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [327] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const region = (page: Page) => page.locator('[data-region="location"]');
const search = (page: Page) => region(page).getByRole("combobox", { name: "Search for a place" });
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** Opens the page and selects the position with the GPS button in the field. */
async function locate(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await region(page).getByRole("button", { name: "Current location" }).click();
  await expect(search(page)).toHaveValue("My location");
}

/** Chooses the start place `label` in the settings (tab Start) and closes them. */
async function chooseStartPlace(page: Page, label: string) {
  await (await headerControl(page, "button", "Settings")).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Start" }).click();
  await dialog.getByRole("combobox", { name: "Start place" }).selectOption({ label });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("a favourite made from 'My location' is listed by its coordinates (REQ-765)", async ({ page }) => {
  await locate(page);
  await region(page).getByRole("button", { name: "Add My location to favourites" }).click();
  await expect(region(page).getByRole("button", { name: "Remove My location from favourites" })).toBeVisible();
  // The field still shows the position just found.
  await expect(search(page)).toHaveValue("My location");
  await region(page).getByRole("button", { name: "Show favourites" }).click();
  const menu = region(page).getByRole("menu", { name: "Favourites" });
  await expect(menu.getByRole("menuitem", { name: HOME_COORDINATES, exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "My location", exact: true })).toHaveCount(0);
  // Stored without the name, like a point picked on the map.
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem("graupel.favorites") ?? "[]") as { name: string; lat: number }[],
  );
  expect(stored.find((favorite) => favorite.lat === 51.1806)).toMatchObject({ name: "", lon: 7.5093, mapPoint: true });
});

test("start place 'Last selected place': after a reload the field shows the coordinates (REQ-765)", async ({
  page,
}) => {
  await locate(page);
  await chooseStartPlace(page, "Last selected place");
  expect(await page.evaluate(() => localStorage.getItem("graupel.startLocation"))).toBe("last");
  await page.reload();
  await expect(search(page)).toHaveValue(HOME_COORDINATES);
  await expect(chart(page)).toBeVisible();
  await expect(search(page)).not.toHaveValue("My location");
});

test("start place 'Current position (GPS)': after a reload the field shows 'My location' (REQ-765)", async ({
  page,
  openMeteo,
}) => {
  await locate(page);
  await chooseStartPlace(page, "Current position (GPS)");
  expect(await page.evaluate(() => localStorage.getItem("graupel.startLocation"))).toBe("gps");
  await page.reload();
  await expect(search(page)).toHaveValue("My location");
  await expect(chart(page)).toBeVisible();
  expect(openMeteo.some((url) => url.includes("latitude=51.1806") && url.includes("longitude=7.5093"))).toBe(true);
});

/** The page turns hidden and visible again, as when the app is sent to the background and opened again. */
async function hideAndShow(page: Page) {
  for (const state of ["hidden", "visible"] as const) {
    await page.evaluate((visibility) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  }
}

test("back after the page was hidden the field shows the coordinates (REQ-765)", async ({ page }) => {
  await locate(page);
  await hideAndShow(page);
  await expect(search(page)).toHaveValue(HOME_COORDINATES);
  await expect(chart(page)).toBeVisible();
});

test("start place 'Current position (GPS)': back after hidden, coordinates without locating again (REQ-765)", async ({
  page,
}) => {
  // Counts the page's requests for the position.
  await page.addInitScript(() => {
    const locate = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    const win = window as unknown as { gpsRequests: number };
    win.gpsRequests = 0;
    navigator.geolocation.getCurrentPosition = (...args) => {
      win.gpsRequests += 1;
      locate(...args);
    };
  });
  const gpsRequests = () => page.evaluate(() => (window as unknown as { gpsRequests: number }).gpsRequests);
  await locate(page);
  await chooseStartPlace(page, "Current position (GPS)");
  await page.reload();
  await expect(search(page)).toHaveValue("My location");
  expect(await gpsRequests()).toBe(1);
  await hideAndShow(page);
  await expect(search(page)).toHaveValue(HOME_COORDINATES);
  expect(await gpsRequests()).toBe(1);
});
