// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Start place "Last selected place" (REQ-599) in a real browser, on the desktop and on the phone: a fresh visit opens
 * the start place of config.json; a place chosen by search or from the favourites is opened again after a reload.
 * "Last selected place" is the first option of the start place setting and the default.
 */
import { expect, test, type Page, ownDevice, onlyIn } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

let errors: string[] = [];

test.use({ locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const results = name.startsWith("Inns")
      ? [{ name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, elevation: 574, admin1: "Tyrol", country: "Austria" }]
      : [];
    return route.fulfill({ json: { results } });
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const region = (page: Page) => page.locator('[data-region="location"]');
const search = (page: Page) => region(page).getByRole("combobox", { name: "Search for a place" });
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const OPTIONS = [
  "Last selected place",
  "Current position (GPS)",
  "Großglockner",
  "Matterhorn",
  "Mont Blanc",
  "Gran Paradiso",
  "Ortler",
];

async function chooseFavorite(page: Page, name: string) {
  await region(page).getByRole("button", { name: "Show favourites" }).click();
  await page.getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name, exact: true }).click();
  await expect(search(page)).toHaveValue(name);
}

test.describe("desktop", () => {
  onlyIn("desktop", "the desktop's header bar and the line below the place; the phone has its own block");
  async function openSettings(page: Page) {
    await page.locator('[data-region="header"]').getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    // The start place is in the tab Start (REQ-686).
    await dialog.getByRole("tab", { name: "Start" }).click();
    return dialog;
  }

  test("a place chosen by search or from the favourites appears again after a reload (REQ-599)", async ({ page }) => {
    await page.goto(APP);
    // First visit: the start place of config.json.
    await expect(search(page)).toHaveValue("Mont Blanc");
    await expect(chart(page)).toBeVisible();

    await search(page).fill("Inns");
    await region(page).getByRole("option", { name: /Innsbruck/ }).click();
    await expect(search(page)).toHaveValue("Innsbruck");
    await page.reload();
    await expect(search(page)).toHaveValue("Innsbruck");
    await expect(region(page).getByTestId("location-coordinates")).toHaveText("47.2627° N · 11.3945° E");
    await expect(chart(page)).toBeVisible();

    await chooseFavorite(page, "Matterhorn");
    await page.reload();
    await expect(search(page)).toHaveValue("Matterhorn");

    // "Last selected place" is the first option and the default: no own choice is stored.
    const dialog = await openSettings(page);
    const start = dialog.getByRole("combobox", { name: "Start place" });
    await expect(start.locator("option")).toHaveText(OPTIONS);
    await expect(start.locator("option:checked")).toHaveText("Last selected place");
    await expect(dialog.locator('[data-settings="startLocation"] .settings__text')).toContainText(
      "“Last selected place” opens the place you viewed last, on the first visit the site's start place.",
    );
    expect(await page.evaluate(() => localStorage.getItem("graupel.startLocation"))).toBeNull();

    // A fixed start place wins over the place shown last; choosing "Last selected place" again brings it back.
    await start.selectOption({ label: "Ortler" });
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(search(page)).toHaveValue("Ortler");
    await chooseFavorite(page, "Großglockner");
    const again = await openSettings(page);
    await again.getByRole("combobox", { name: "Start place" }).selectOption({ label: "Last selected place" });
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(search(page)).toHaveValue("Großglockner");
    expect(await page.evaluate(() => localStorage.getItem("graupel.startLocation"))).toBe("last");
  });
});

test.describe("phone", () => {
  test.use(PHONE);
  ownDevice();

  test("a place chosen from the favourites appears again after a reload (REQ-599)", async ({ page }) => {
    await page.goto(APP);
    await expect(search(page)).toHaveValue("Mont Blanc");
    await expect(chart(page)).toBeVisible();

    await chooseFavorite(page, "Gran Paradiso");
    await page.reload();
    await expect(search(page)).toHaveValue("Gran Paradiso");
    await expect(chart(page)).toBeVisible();

    await region(page).getByRole("button", { name: "Menu" }).click();
    await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Start" }).click();
    const start = dialog.getByRole("combobox", { name: "Start place" });
    await expect(start.locator("option")).toHaveText(OPTIONS);
    await expect(start.locator("option:checked")).toHaveText("Last selected place");
  });
});
