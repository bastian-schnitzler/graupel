// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Keyboard shortcuts of the day slider (REQ-533) in a real browser: keys by position (`code`), the meteogram follows;
 * nothing happens while typing in the search field; the focused meteogram keeps 0 and the key after 0. "Today" is the
 * day of the forecast's "now" (the red line), also a day after loading.
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const DAY_MS = 24 * 3_600_000;

// Days are local days; in UTC every day has 24 hours.
test.use({ timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function visibleRange(page: Page): Promise<[number, number]> {
  const svg = chart(page);
  const start = await svg.getAttribute("data-visible-start-time");
  const end = await svg.getAttribute("data-visible-end-time");
  return [Date.parse(start!), Date.parse(end!)];
}

async function marker(page: Page): Promise<[number, number]> {
  const element = page.getByTestId("day-slider-marker");
  return [Number(await element.getAttribute("data-start")), Number(await element.getAttribute("data-end"))];
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const cards = page.getByTestId("day-card");
  await expect(cards.nth(1)).toHaveAttribute("aria-current", "date");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(6);
  // Nothing focused on the page: the shortcuts work anywhere outside text fields.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  const [start, end] = await visibleRange(page);
  return { count, start, end };
}

test("digits, the key before 1 and the key after 0 select days; the meteogram follows", async ({ page }) => {
  const { count, start, end } = await open(page);
  // The marker over all days tells that all days are selected (no "All" since REQ-640).
  const whole = page.getByTestId("day-slider-marker");

  // 1: yesterday and today.
  await page.keyboard.press("Digit1");
  await expect.poll(() => marker(page)).toEqual([0, 1]);
  await expect.poll(() => visibleRange(page)).toEqual([start, start + 2 * DAY_MS]);
  // 2: yesterday, today and tomorrow.
  await page.keyboard.press("Digit2");
  await expect.poll(() => marker(page)).toEqual([0, 2]);
  await expect.poll(() => visibleRange(page)).toEqual([start, start + 3 * DAY_MS]);
  // 4: yesterday to today + 3.
  await page.keyboard.press("Digit4");
  await expect.poll(() => marker(page)).toEqual([0, Math.min(count - 1, 4)]);

  // The key after 0 removes yesterday, then shows it again; the digits follow.
  await page.keyboard.press("Minus");
  await expect.poll(() => marker(page)).toEqual([1, Math.min(count - 1, 4)]);
  await page.keyboard.press("Digit1");
  await expect.poll(() => marker(page)).toEqual([1, 1]);
  await expect.poll(() => visibleRange(page)).toEqual([start + DAY_MS, start + 2 * DAY_MS]);
  await page.keyboard.press("Digit3");
  await expect.poll(() => marker(page)).toEqual([1, 3]);
  await page.keyboard.press("Minus");
  await expect.poll(() => marker(page)).toEqual([0, 3]);

  // 0: ten days with yesterday and today, clamped to the days there are.
  await page.keyboard.press("Digit0");
  await expect.poll(() => marker(page)).toEqual([0, Math.min(count - 1, 9)]);

  // The key before 1: all days, like a double click on the slider.
  await page.keyboard.press("Digit2");
  await expect(whole).not.toHaveClass(/day-slider__marker--whole/);
  await page.keyboard.press("Backquote");
  await expect(whole).toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start, end]);
});

test("no effect while typing in the search field or with Ctrl", async ({ page }) => {
  await open(page);
  const search = page.getByRole("combobox").first();
  await search.click();
  await page.keyboard.press("Digit1");
  await page.keyboard.press("Minus");
  await page.keyboard.press("Backquote");
  await expect.poll(() => marker(page)).toEqual([0, (await page.getByTestId("day-card").count()) - 1]);
  await expect(page.getByTestId("day-slider-marker")).toHaveClass(/day-slider__marker--whole/);
  await search.blur();
  await page.keyboard.press("Control+Digit1");
  await expect(page.getByTestId("day-slider-marker")).toHaveClass(/day-slider__marker--whole/);
  await page.keyboard.press("Digit1");
  await expect.poll(() => marker(page)).toEqual([0, 1]);
});

test("the focused meteogram keeps 0 and the key after 0", async ({ page }) => {
  const { count } = await open(page);
  await page.keyboard.press("Digit2");
  await expect.poll(() => marker(page)).toEqual([0, 2]);
  await page.getByTestId("meteogram").first().focus();
  await page.keyboard.press("Digit0");
  await page.keyboard.press("Minus");
  await page.waitForTimeout(100);
  expect(await marker(page)).toEqual([0, 2]);
  // Other digits still select days.
  await page.keyboard.press("Digit3");
  await expect.poll(() => marker(page)).toEqual([0, Math.min(count - 1, 3)]);
});

test("today is the day the forecast was loaded (the red line), also a day later", async ({ page }) => {
  const loadedAt = Date.now();
  await page.clock.setFixedTime(loadedAt);
  await open(page);
  await page.clock.setFixedTime(loadedAt + DAY_MS);
  await page.keyboard.press("Digit1");
  await expect.poll(() => marker(page)).toEqual([0, 1]);
  await expect(page.getByTestId("day-card").nth(1)).toHaveAttribute("aria-current", "date");
  await page.keyboard.press("Minus");
  await expect.poll(() => marker(page)).toEqual([1, 1]);
});
