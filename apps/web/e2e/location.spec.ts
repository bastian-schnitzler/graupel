// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Location picker in a real browser with mocked network: search a place and select it, open the map
 * (OpenTopoMap with Leaflet, the default) without leaving the page.
 */
import { expect, test, ownDevice, onlyIn } from "./fixtures.ts";

const APP = "http://localhost:4175/";
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const results = name.startsWith("Inns")
      ? [
          { name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, elevation: 574, admin1: "Tyrol", country: "Austria" },
          { name: "Innsbrook", latitude: 38.76, longitude: -91.07, admin1: "Missouri", country: "United States" },
        ]
      : [];
    return route.fulfill({ json: { results } });
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("search a place and select it with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(APP);
  const region = page.locator('[data-region="location"]');
  const input = region.getByRole("combobox", { name: "Search for a place" });
  await expect(input).toHaveValue("Mont Blanc");
  await expect(region.getByTestId("location-elevation")).toHaveText("4,806 m");

  await input.fill("Inns");
  const options = region.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("Innsbruck");
  await expect(options.first()).toContainText("Tyrol, Austria");
  await input.press("ArrowDown");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");

  await expect(input).toHaveValue("Innsbruck");
  await expect(options).toHaveCount(0);
  await expect(region.getByTestId("location-coordinates")).toHaveText("47.2627° N · 11.3945° E");
  await expect(region.getByTestId("location-elevation")).toHaveText("574 m");

  // Mark as favourite and select it again from the menu of the split button.
  await region.getByRole("button", { name: "Add Innsbruck to favourites" }).click();
  const showFavourites = region.getByRole("button", { name: "Show favourites" });
  await showFavourites.click();
  await region.getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name: "Matterhorn" }).click();
  await expect(input).toHaveValue("Matterhorn");
  await showFavourites.click();
  await region.getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name: "Innsbruck" }).click();
  await expect(input).toHaveValue("Innsbruck");

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("select a place with the mouse", async ({ page, deviceClass }) => {
  await page.goto(APP);
  const region = page.locator('[data-region="location"]');
  await region.getByRole("combobox").fill("Inns");
  await region.getByRole("option", { name: /Innsbrook/ }).click();
  await expect(region.getByRole("combobox")).toHaveValue("Innsbrook");
  // Missing elevation comes from the elevation API: on the desktop in the line below the field with the coordinates,
  // in the phone's design (also a tablet's, REQ-728) between the day slider's grips (REQ-562).
  if (deviceClass === "desktop") {
    await expect(region.getByTestId("location-coordinates")).toHaveText("38.7600° N · 91.0700° W");
    await expect(region.getByTestId("location-elevation")).toHaveText("200 m");
  } else await expect(page.getByTestId("day-slider-caption")).toContainText("200 m");
});

test("open the OpenTopoMap map and close it", async ({ page }) => {
  await page.goto(APP);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".leaflet-container")).toBeVisible();
  await expect(dialog.locator(".leaflet-control-attribution")).toContainText("OpenTopoMap");
  await expect(dialog.getByRole("button", { name: "OK" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("a place tapped in the list closes the on-screen keyboard: the field lets go of the focus (REQ-560)", async ({
    page,
  }) => {
    await page.goto(APP);
    const region = page.locator('[data-region="location"]');
    const input = region.getByRole("combobox");
    await input.tap();
    await input.fill("Inns");
    await expect(input).toBeFocused();
    await region.getByRole("option", { name: /Innsbruck/ }).tap();
    await expect(input).toHaveValue("Innsbruck");
    await expect(input).not.toBeFocused();
  });
});

test.describe("desktop", () => {
  onlyIn("desktop", "on a touch screen a chosen place lets go of the focus to close the keyboard (REQ-560, block phone)");

  test("on the desktop the field keeps the focus after Enter (REQ-560)", async ({ page }) => {
    await page.goto(APP);
    const region = page.locator('[data-region="location"]');
    const input = region.getByRole("combobox");
    await input.fill("Inns");
    await expect(region.getByRole("option")).toHaveCount(2);
    await input.press("Enter");
    await expect(input).toHaveValue("Innsbruck");
    await expect(input).toBeFocused();
  });
});

