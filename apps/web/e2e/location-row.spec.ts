// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Condensed location row (REQ-455) in light and dark mode at phone and desktop width: no visible heading; GPS inside
 * the search field on the left, X on the right; the map button as an icon behind the field, then set apart the
 * favourites; the field has a limited width, so on wide screens there is room before language, settings and info,
 * of which settings and info are icons only. Every button has an accessible name.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let errors: string[] = [];

test.use({ locale: "en-GB", geolocation: { latitude: 47.1, longitude: 11.2 }, permissions: ["geolocation"] });

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
    route.fulfill({ json: { elevation: [1200] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
});

/** Text of a control that is visible on screen (text inside visually hidden elements does not count). */
const visibleText = (control: Locator) =>
  control.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const rect = node.parentElement?.getBoundingClientRect();
      if (rect && rect.width > 1 && rect.height > 1) text += node.textContent ?? "";
    }
    return text.trim();
  });

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

const centreY = (b: { y: number; height: number }) => b.y + b.height / 2;

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

for (const scheme of ["light", "dark"] as const) {
  for (const { name, width, height } of [
    { name: "phone", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    test.describe(`${scheme}, ${name}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });
      ownDevice();

      test.beforeEach(async ({ page }) => {
        await page.goto(APP);
      });

      test("arrangement of the location row and the header", async ({ page }) => {
        const location = page.getByRole("region", { name: "Location" });
        const header = page.locator('[data-region="header"]');
        await expect(location.getByRole("heading")).toHaveCount(0);

        const input = location.getByRole("combobox", { name: "Search for a place" });
        const gps = location.getByRole("button", { name: "Current location" });
        const clear = location.getByRole("button", { name: "Clear search" });
        const map = location.getByRole("button", { name: "Map", exact: true });
        const star = location.getByRole("button", { name: "Remove Mont Blanc from favourites" });
        const arrow = location.getByRole("button", { name: "Show favourites" });
        const settings = header.getByRole("button", { name: "Settings" });
        const info = header.getByRole("button", { name: "Info" });
        const language = header.getByRole("combobox", { name: "Language" });
        for (const control of [input, gps, clear, map, star, arrow, settings, info, language]) {
          await expect(control).toBeVisible();
        }

        // GPS and X inside the field, left and right of the text.
        const field = await box(location.locator(".location__field"));
        const inputBox = await box(input);
        const gpsBox = await box(gps);
        const clearBox = await box(clear);
        const mapBox = await box(map);
        const starBox = await box(star);
        for (const b of [gpsBox, inputBox, clearBox]) {
          expect(b.x).toBeGreaterThanOrEqual(field.x);
          expect(b.x + b.width).toBeLessThanOrEqual(field.x + field.width + 0.5);
          expect(b.y).toBeGreaterThanOrEqual(field.y);
          expect(b.y + b.height).toBeLessThanOrEqual(field.y + field.height + 0.5);
        }
        expect(gpsBox.x + gpsBox.width).toBeLessThanOrEqual(inputBox.x + 0.5);
        expect(clearBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 0.5);

        // Behind the field the map icon, then with more space the favourites, all in one row.
        expect(mapBox.x).toBeGreaterThan(field.x + field.width);
        expect(starBox.x - (mapBox.x + mapBox.width)).toBeGreaterThan(mapBox.x - (field.x + field.width) + 4);
        for (const b of [mapBox, starBox]) expect(Math.abs(centreY(b) - centreY(field))).toBeLessThan(2);
        expect(Math.abs(mapBox.height - field.height)).toBeLessThan(2);

        // Icons only: map, settings and info have no visible text but a name and a tooltip.
        for (const [control, label] of [
          [map, "Map"],
          [settings, "Settings"],
          [info, "Info"],
        ] as const) {
          expect(await visibleText(control)).toBe("");
          await expect(control).toHaveAttribute("title", label);
          const b = await box(control);
          expect(Math.abs(b.width - b.height)).toBeLessThan(2);
        }
        await expect(gps).toHaveAttribute("title", "Current location");
        await expect(clear).toHaveAttribute("title", "Clear search");

        const languageBox = await box(language);
        const settingsBox = await box(settings);
        const infoBox = await box(info);
        expect(settingsBox.x).toBeGreaterThan(languageBox.x + languageBox.width - 0.5);
        expect(infoBox.x).toBeGreaterThan(settingsBox.x + settingsBox.width - 0.5);
        if (name === "desktop") {
          // Limited field width; clear space between the favourites and the language on the right, same row.
          expect(field.width).toBeLessThanOrEqual(24 * 16 + 0.5);
          const arrowBox = await box(arrow);
          expect(languageBox.x - (arrowBox.x + arrowBox.width)).toBeGreaterThan(200);
          expect(Math.abs(centreY(languageBox) - centreY(field))).toBeLessThan(2);
          expect(Math.abs(centreY(infoBox) - centreY(field))).toBeLessThan(2);
        } else {
          // Phone: the field takes the free width, the row stays on the screen.
          expect(field.width).toBeGreaterThan(150);
          const arrowBox = await box(arrow);
          expect(arrowBox.x + arrowBox.width).toBeLessThanOrEqual(width);
        }
        await expectNoHorizontalScroll(page);
      });

      test("X clears the field, GPS selects the position, the map icon opens the map", async ({ page }) => {
        const location = page.getByRole("region", { name: "Location" });
        const input = location.getByRole("combobox", { name: "Search for a place" });
        await expect(input).toHaveValue("Mont Blanc");

        await location.getByRole("button", { name: "Clear search" }).click();
        await expect(input).toHaveValue("");
        await expect(input).toBeFocused();
        await expect(location.getByRole("button", { name: "Clear search" })).toHaveCount(0);
        await input.fill("Inns");
        await expect(location.getByRole("option")).toHaveCount(2);
        await location.getByRole("button", { name: "Clear search" }).click();
        await expect(input).toHaveValue("");
        await expect(location.getByRole("option")).toHaveCount(0);

        await location.getByRole("button", { name: "Current location" }).click();
        await expect(input).toHaveValue("My location");
        await expect(location.getByTestId("location-coordinates")).toHaveText("47.1000° N · 11.2000° E");

        await location.getByRole("button", { name: "Map", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Map" });
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expectNoHorizontalScroll(page);
      });
    });
  }
}
