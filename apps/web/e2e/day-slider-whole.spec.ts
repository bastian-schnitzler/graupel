// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The whole period by double click on the desktop (REQ-640): the day slider has no card "All" any more; a double click
 * on the slider, on a day card, the selection or a grip, selects the whole period and the meteogram shows it. The grips
 * and the selection carry a tooltip that says so, in the page's language. On the phone nothing changes: no "All" there
 * either, a double tap selects the whole period.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 3 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 11);
const DESKTOP = { width: 1280, height: 900 };
const HINT: Readonly<Record<string, string>> = {
  de: "Doppelklick wählt den ganzen Zeitraum",
  en: "Double-click selects the whole period",
};

test.use({ timezoneId: "UTC" });

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

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function open(page: Page, language: string) {
  await page.addInitScript((value) => window.localStorage.setItem("graupel.language", value), language);
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

async function visibleRange(page: Page): Promise<[number, number]> {
  const svg = chart(page);
  return [
    Date.parse((await svg.getAttribute("data-visible-start-time"))!),
    Date.parse((await svg.getAttribute("data-visible-end-time"))!),
  ];
}

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Selects days 3 to 5 with a click on day 3 and the end grip moved by the keyboard, then waits out a double click. */
async function selectSomeDays(page: Page) {
  await page.getByTestId("day-card").nth(3).focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("day-slider-end").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("day-slider-marker")).toHaveAttribute("data-start", "3");
  await expect(page.getByTestId("day-slider-marker")).toHaveAttribute("data-end", "5");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
}

test.describe("desktop (REQ-640)", () => {
  test.use({ viewport: DESKTOP });
  ownDevice();

  for (const language of ["de", "en"]) {
    test(`${language}: no card "All"; the grips and the selection explain the double click`, async ({ page }) => {
      await open(page, language);
      await expect(page.getByTestId("day-slider-whole")).toHaveCount(0);
      await expect(page.getByRole("button", { name: language === "de" ? "Alle" : "All", exact: true })).toHaveCount(0);
      // Only day cards in the slider's row: the last day ends the slider.
      const cards = page.getByTestId("day-card");
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(6);
      await expect(page.getByTestId("day-slider-track").locator("button")).toHaveCount(count);
      const track = (await page.getByTestId("day-slider-track").boundingBox())!;
      const last = (await cards.last().boundingBox())!;
      expect(Math.abs(last.x + last.width - (track.x + track.width))).toBeLessThan(1);
      // The tooltip over the grips and the selection.
      for (const testId of ["day-slider-start", "day-slider-body", "day-slider-end"]) {
        await expect(page.getByTestId(testId)).toHaveAttribute("title", HINT[language]!);
      }
      // Under the mouse over a grip the element with the tooltip is the grip itself.
      await selectSomeDays(page);
      const grip = await center(page.getByTestId("day-slider-end"));
      const hovered = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("title"), grip);
      expect(hovered).toBe(HINT[language]);
    });
  }

  test("a double click on a day card selects all days; the meteogram shows the whole period", async ({ page }) => {
    await open(page, "de");
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    const marker = page.getByTestId("day-slider-marker");
    const [start, end] = await visibleRange(page);
    await selectSomeDays(page);
    await expect.poll(() => visibleRange(page)).not.toEqual([start, end]);

    // A day outside the selection.
    const day = await center(cards.nth(1));
    await page.mouse.dblclick(day.x, day.y);
    await expect(marker).toHaveAttribute("data-start", "0");
    await expect(marker).toHaveAttribute("data-end", String(count - 1));
    await expect(marker).toHaveClass(/day-slider__marker--whole/);
    await expect.poll(() => visibleRange(page)).toEqual([start, end]);
  });

  for (const [what, testId] of [
    ["the selection", "day-slider-body"],
    ["the start grip", "day-slider-start"],
    ["the end grip", "day-slider-end"],
  ] as const) {
    test(`a double click on ${what} selects all days`, async ({ page }) => {
      await open(page, "de");
      const count = await page.getByTestId("day-card").count();
      const marker = page.getByTestId("day-slider-marker");
      const [start, end] = await visibleRange(page);
      await selectSomeDays(page);
      const target = await center(page.getByTestId(testId));
      await page.mouse.dblclick(target.x, target.y);
      await expect(marker).toHaveAttribute("data-start", "0");
      await expect(marker).toHaveAttribute("data-end", String(count - 1));
      await expect.poll(() => visibleRange(page)).toEqual([start, end]);
    });
  }
});

test.describe("phone, unchanged (REQ-640)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("no card \"All\"; a double tap on a day selects all days", async ({ page }) => {
    await open(page, "de");
    await expect(page.getByTestId("day-slider-whole")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Alle", exact: true })).toHaveCount(0);
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    const marker = page.getByTestId("day-slider-marker");
    const [start, end] = await visibleRange(page);
    await selectSomeDays(page);
    const day = await center(cards.nth(1));
    await page.touchscreen.tap(day.x, day.y);
    await page.waitForTimeout(100);
    await page.touchscreen.tap(day.x, day.y);
    await expect(marker).toHaveAttribute("data-start", "0");
    await expect(marker).toHaveAttribute("data-end", String(count - 1));
    await expect.poll(() => visibleRange(page)).toEqual([start, end]);
  });
});
