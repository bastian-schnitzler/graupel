// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Base layout in a real browser: the page loads at phone and desktop width, shows every region and
 * does not scroll horizontally.
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const REGIONS = ["location", "header", "model-chain", "day-slider", "meteogram", "footer"];

async function box(page: Page, region: string) {
  const b = await page.locator(`[data-region="${region}"]`).boundingBox();
  if (!b) throw new Error(`Region ${region} has no box`);
  return b;
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  // Every region, so with the model chain switched on (without it the chain has no card, REQ-471).
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  });
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("phone width (375px): regions stacked, header above the place, no horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(APP);
  for (const region of REGIONS) await expect(page.locator(`[data-region="${region}"]`)).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Stacked: every region starts below the previous one; language, settings and info above the place (REQ-459), both
  // in the one top card.
  let previousBottom = -Infinity;
  for (const region of ["header", "location", ...REGIONS.slice(2)]) {
    const b = await box(page, region);
    expect(b.y).toBeGreaterThanOrEqual(previousBottom);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
    previousBottom = b.y + b.height;
  }
  const header = await box(page, "header");
  const location = await box(page, "location");
  const language = (await page.getByRole("combobox", { name: "Language" }).boundingBox())!;
  const search = (await page.getByRole("combobox", { name: "Search for a place" }).boundingBox())!;
  expect(language.y + language.height).toBeLessThanOrEqual(search.y);
  const top = (await page.locator(".app__top").boundingBox())!;
  for (const b of [header, location]) {
    expect(b.y).toBeGreaterThanOrEqual(top.y - 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(top.y + top.height + 0.5);
  }
});

test("desktop width (1280px): location left, header right, no horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP);
  for (const region of REGIONS) await expect(page.locator(`[data-region="${region}"]`)).toBeVisible();
  await expectNoHorizontalScroll(page);

  const location = await box(page, "location");
  const header = await box(page, "header");
  expect(header.x).toBeGreaterThanOrEqual(location.x + location.width);
  expect(Math.abs(header.y - location.y)).toBeLessThan(1);

  // Content below the top row, at full width.
  const modelChain = await box(page, "model-chain");
  expect(modelChain.y).toBeGreaterThanOrEqual(Math.max(location.y + location.height, header.y + header.height));
  expect(modelChain.width).toBeGreaterThan(location.width);
});

// REQ-465: on the desktop the margin between the cards and the window edge is half of what it was: 0.5rem (was
// 1rem) plus a quarter (was half) of the width beyond the 80rem page.
for (const width of [1280, 1920]) {
  test(`desktop width (${width}px): half the side margin`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(APP);
    await expect(page.locator('[data-region="meteogram"]')).toBeVisible();
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const before = Math.max(0, (clientWidth - 1280) / 2) + 16;
    // The cards: place and header, model chain, day slider, meteogram.
    for (const card of [".app__top", '[data-region="model-chain"]', '[data-region="day-slider"]', '[data-testid="meteogram-card"]']) {
      const b = (await page.locator(card).boundingBox())!;
      expect(b.x, card).toBeCloseTo(before / 2, 0);
      expect(clientWidth - (b.x + b.width), card).toBeCloseTo(before / 2, 0);
    }
    await expectNoHorizontalScroll(page);
  });
}
