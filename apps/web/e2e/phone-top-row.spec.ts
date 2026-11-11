// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's place row and side margins at the widths of common phones, from a small or zoomed Android (320 px, as
 * Chrome shows a 412 px phone with page zoom) to a large iPhone (430 px), with touch:
 * - The place row stays one row: field, map, favourites and menu side by side; the field shrinks (REQ-691). The menu
 *   opens below its button within the screen.
 * - The favourites stand in the middle between the map button and the menu button (REQ-689).
 * - The page's side margin (place row, day slider, legend, the chart's source line, the footer's buttons) is the same
 *   share of the screen's width at every width (REQ-692): two thirds of the 16 px of a 390 px iPhone it was, a third
 *   smaller (REQ-722); the meteogram still reaches from edge to edge.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
/** The side margin's share of the screen's width before REQ-722: 16 px of a 390 px iPhone (REQ-692). */
const FORMER_SHARE = 16 / 390;
/** The side margin's share now: a third smaller, two thirds of the former one (REQ-722). */
const SHARE = (FORMER_SHARE * 2) / 3;
const WIDTHS = [320, 360, 390, 412, 430];

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "en-GB", timezoneId: "UTC" });
ownDevice();

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function open(page: Page, width: number, theme: "light" | "dark", fontSize?: string) {
  await page.addInitScript((mode) => window.localStorage.setItem("graupel.colorMode", mode), theme);
  if (fontSize) {
    // A larger default font, as a phone's text size setting gives the page (REQ-691).
    await page.addInitScript((size) => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = size;
      });
    }, fontSize);
  }
  await page.setViewportSize({ width, height: 860 });
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const box = async (locator: Locator) => {
  const b = (await locator.boundingBox())!;
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, width: b.width, height: b.height };
};

const row = (page: Page) => {
  const location = page.locator('[data-region="location"]');
  return {
    field: location.locator(".location__field"),
    map: location.getByRole("button", { name: "Map", exact: true }),
    favourites: location.locator(".location__favorites"),
    menu: location.getByRole("button", { name: "Menu" }),
  };
};

/** One row: the same vertical centre, side by side from left to right, all on screen. */
async function expectOneRow(page: Page, width: number) {
  const { field, map, favourites, menu } = row(page);
  const boxes = [await box(field), await box(map), await box(favourites), await box(menu)];
  const centre = (b: { top: number; bottom: number }) => (b.top + b.bottom) / 2;
  for (const b of boxes) expect(Math.abs(centre(b) - centre(boxes[0]!))).toBeLessThan(1);
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index]!.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
  }
  expect(boxes[0]!.left).toBeGreaterThanOrEqual(0);
  expect(boxes.at(-1)!.right).toBeLessThanOrEqual(width);
  // The field keeps room for its GPS and X buttons and some text.
  expect(boxes[0]!.width).toBeGreaterThan(100);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
  return boxes;
}

for (const width of WIDTHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`phone ${width} px, ${theme}: place row in one row, favourites in the middle, menu on screen (REQ-689, REQ-691)`, async ({
      page,
    }) => {
      await open(page, width, theme);
      const [, map, favourites, menu] = await expectOneRow(page, width);
      // As far from the map button as from the menu button (±2 px).
      const before = favourites!.left - map!.right;
      const after = menu!.left - favourites!.right;
      expect(Math.abs(before - after)).toBeLessThanOrEqual(2);
      expect(before).toBeGreaterThan(4);

      // The menu opens below its button, inside the screen.
      await row(page).menu.click();
      const panel = page.getByTestId("phone-menu-panel");
      await expect(panel).toBeVisible();
      const panelBox = await box(panel);
      expect(panelBox.left).toBeGreaterThanOrEqual(0);
      expect(panelBox.right).toBeLessThanOrEqual(width);
      expect(panelBox.top).toBeGreaterThanOrEqual(menu!.bottom - 0.5);
    });

    test(`phone ${width} px, ${theme}: side margins the same share of the width (REQ-692)`, async ({ page }) => {
      await open(page, width, theme);
      const margin = width * SHARE;
      const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.75);

      // Place row and day slider: from the left margin to the right one.
      for (const selector of [".location__bar", '[data-region="day-slider"]']) {
        const b = await box(page.locator(selector));
        near(b.left, margin);
        near(width - b.right, margin);
      }
      // The legend, shown at the start.
      const legend = page.getByTestId("meteogram-legend");
      await expect(legend).toBeVisible();
      const legendBox = await box(legend);
      near(legendBox.left, margin);
      near(width - legendBox.right, margin);

      // The meteogram reaches from the screen's left edge to its right edge, over the margins (REQ-547); its source
      // line in the footer's row below ends at the right margin (REQ-729).
      const card = await box(page.locator(".meteogram-card"));
      near(card.left, 0);
      near(card.right, width);
      const source = page.locator(".meteogram__source");
      await expect(source).toBeVisible();
      const padding = await source.evaluate((element) => parseFloat(getComputedStyle(element).paddingRight));
      near(width - ((await box(source)).right - padding), margin);

      // The footer's row ends at the right margin.
      const footer = await box(page.locator(".footer__row"));
      near(footer.left, margin);
      near(width - footer.right, margin);
    });
  }
}

test("phone 390 px: side margin of place row and controls two thirds of the former 16 px (REQ-722)", async ({ page }) => {
  await open(page, 390, "light");
  const gutter = await page
    .locator(".app__inner")
    .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
  expect(Math.abs(gutter - (390 * FORMER_SHARE * 2) / 3)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(gutter - (16 * 2) / 3)).toBeLessThanOrEqual(0.1);
  // Place row, day slider and legend above the meteogram start and end at that margin.
  for (const selector of [".location__bar", '[data-region="day-slider"]', '[data-testid="meteogram-legend"]']) {
    const b = await box(page.locator(selector));
    expect(Math.abs(b.left - gutter)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(390 - b.right - gutter)).toBeLessThanOrEqual(0.75);
  }
  // The meteogram itself is unchanged: from the screen's left edge to its right edge.
  const card = await box(page.locator(".meteogram-card"));
  expect(Math.abs(card.left)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(card.right - 390)).toBeLessThanOrEqual(0.75);
});

test("phone 360 px with a larger text size: the place row stays one row, the menu on screen (REQ-691)", async ({ page }) => {
  await open(page, 360, "light", "125%");
  await expectOneRow(page, 360);
  await row(page).menu.click();
  const panelBox = await box(page.getByTestId("phone-menu-panel"));
  expect(panelBox.left).toBeGreaterThanOrEqual(0);
  expect(panelBox.right).toBeLessThanOrEqual(360);
});

test.describe("desktop", () => {
  test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1, viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("side margin unchanged (REQ-692)", async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    const gutter = await page.locator(".app__inner").evaluate((element) => getComputedStyle(element).paddingLeft);
    expect(gutter).toBe("8px");
  });
});
