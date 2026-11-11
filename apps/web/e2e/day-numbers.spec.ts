// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Day numbers in the day slider on a phone (REQ-629): in no language a dot after the day of the month ("31", not "31."
 * as Slovenian, Czech and Danish write it), and a date with its month ends without one as well. The desktop and the
 * text read out stay as before.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC; the strip runs from yesterday, 27 October, for 17 days. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const DAYS = Array.from({ length: 17 }, (_, index) => new Date(Date.UTC(2026, 9, 27 + index)).getUTCDate());

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

async function open(page: Page, language: string) {
  await page.addInitScript((value) => window.localStorage.setItem("graupel.language", value), language);
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** The date each card shows (the visible one of its long and short form). */
const shownDates = (page: Page) =>
  page
    .getByTestId("day-card")
    .evaluateAll((cards) =>
      cards.map(
        (card) =>
          [...card.querySelectorAll<HTMLElement>(".day-card__date > span")].find((span) => span.offsetParent !== null)
            ?.textContent ?? "",
      ),
    );

test.describe("phone held upright, 17 days (REQ-629)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  for (const language of ["sl", "cs", "da", "de", "en"]) {
    test(`${language}: no card shows a dot after its day`, async ({ page }) => {
      await open(page, language);
      const dates = await shownDates(page);
      expect(dates).toHaveLength(17);
      for (const date of dates) expect(date, date).not.toMatch(/[.\s]$/u);
      // The narrow cards show the day of the month alone.
      if ((await page.getByTestId("day-slider-track").getAttribute("data-labels")) === "short") {
        expect(dates.map(Number)).toEqual(DAYS);
      }
      // The text read out stays the full date.
      await expect(page.getByTestId("day-card").first()).toHaveAttribute("aria-label", /27/);
    });
  }
});

test.describe("not a phone (REQ-629 is for phones)", () => {
  test.use({ locale: "en-GB" });

  test("Slovenian at 700 px and German at 1280 px keep their dots", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await open(page, "sl");
    await expect(page.getByTestId("day-slider-track")).toHaveAttribute("data-labels", "short");
    const slovenian = await shownDates(page);
    expect(slovenian[0]).toBe(
      new Intl.DateTimeFormat("sl", { day: "numeric", timeZone: "UTC" }).format(Date.UTC(2026, 9, 27)),
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, "de");
    await expect(page.getByTestId("day-slider-track")).toHaveAttribute("data-labels", "long");
    const german = await shownDates(page);
    expect(german[0]).toBe(
      new Intl.DateTimeFormat("de", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(Date.UTC(2026, 9, 27)),
    );
  });
});
