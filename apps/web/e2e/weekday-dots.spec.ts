// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Weekdays in the day slider without a dot after their abbreviation (REQ-667): in no language a card shows "mar.",
 * "tirs." or "čet.", but "mar", "tirs" and "čet", with the long labels on a desktop and with the short ones (two
 * letters, REQ-626) on narrower windows. The hidden copy that measures the switch to short labels (REQ-520) has the
 * same text as the cards. The text read out stays the full date. The meteogram's day header has no such dot either
 * ("mar 27", "čet 29"; the meteogram's REQ-668, taken over with its version 0.11.0).
 *
 * Note: without its dot Danish keeps the long labels down to 700 px (the narrowest wide slider, 17 days), where it
 * switched to short ones before.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC; the strip runs from yesterday, Tuesday 27 October. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);

/** The first three weekdays of the strip (Tuesday to Thursday) on the wide cards. */
const LONG: Readonly<Record<string, readonly string[]>> = {
  en: ["Tue", "Wed", "Thu"],
  de: ["Di", "Mi", "Do"],
  fr: ["mar", "mer", "jeu"],
  it: ["mar", "mer", "gio"],
  sl: ["tor", "sre", "čet"],
  cs: ["út", "st", "čt"],
  nl: ["di", "wo", "do"],
  da: ["tirs", "ons", "tors"],
};
const LANGUAGES = Object.keys(LONG);

test.use({ timezoneId: "UTC", locale: "en-GB" });

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
  await page.goto(APP);
  await page.evaluate((value) => window.localStorage.setItem("graupel.language", value), language);
  await page.reload();
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  // The measured labels are applied before the next frames.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** The weekday each card shows (the visible one of its long and short form) and the texts of the measuring copy. */
const weekdays = (page: Page) =>
  page.evaluate(() => ({
    shown: [...document.querySelectorAll<HTMLElement>('[data-testid="day-card"] .day-card__weekday')].map(
      (weekday) => [...weekday.children].find((span) => (span as HTMLElement).offsetParent !== null)?.textContent ?? "",
    ),
    long: [...document.querySelectorAll('[data-testid="day-card"] .day-card__weekday .day-card__long')].map(
      (span) => span.textContent ?? "",
    ),
    short: [...document.querySelectorAll('[data-testid="day-card"] .day-card__weekday .day-card__short')].map(
      (span) => span.textContent ?? "",
    ),
    measured: [...document.querySelectorAll(".day-slider__measure-weekday")].map((span) => span.textContent ?? ""),
  }));

/** The labels of the meteogram's day header (test hook `day-label-text` of @graupel/meteogram). */
const dayHeader = (page: Page) => page.locator('[data-region="meteogram"] text.day-label-text').allTextContents();

test("desktop 1280 px: no weekday ends with a dot in any language, long labels, in the meteogram's day header neither (REQ-667)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const language of LANGUAGES) {
    await open(page, language);
    await expect(page.getByTestId("day-slider-track")).toHaveAttribute("data-labels", "long");
    const { shown, long, measured } = await weekdays(page);
    expect(shown.length, language).toBeGreaterThanOrEqual(7);
    expect(shown.slice(0, 3), language).toEqual(LONG[language]);
    for (const weekday of shown) expect(weekday, `${language} ${weekday}`).not.toMatch(/[.\s]$/u);
    // The switch to short labels is measured with the text the cards show (REQ-520).
    expect(measured, language).toEqual(long);
    // Nor the meteogram's day header: "mar 27", "tirs 27", "čet 29" (REQ-667, the meteogram's REQ-668).
    const header = await dayHeader(page);
    expect(header.length, language).toBeGreaterThanOrEqual(7);
    expect(header.slice(0, 3).map((label) => label.split(" ")[0]), language).toEqual(LONG[language]);
    for (const label of header) expect(label, `${language} ${label}`).not.toMatch(/\p{L}\./u);
  }
  // The name read out stays the full date.
  await expect(page.getByTestId("day-card").nth(1)).toHaveAttribute("aria-label", "onsdag 28. oktober");
});

test("700 px: no weekday ends with a dot in any language, short labels (REQ-667, REQ-626)", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  for (const language of LANGUAGES) {
    await open(page, language);
    // Danish "tirs" and "27.10" fit the cards of the wide slider down to 700 px since the dot is gone; the other
    // languages show their short labels there.
    if (language !== "da") await expect(page.getByTestId("day-slider-track")).toHaveAttribute("data-labels", "short");
    const { shown, long, short, measured } = await weekdays(page);
    expect(shown.length, language).toBeGreaterThanOrEqual(7);
    for (const weekday of [...shown, ...long, ...short]) expect(weekday, `${language} ${weekday}`).not.toMatch(/[.\s]$/u);
    for (const weekday of short) expect([...weekday].length, `${language} ${weekday}`).toBeGreaterThanOrEqual(2);
    expect(measured, language).toEqual(long);
    for (const label of await dayHeader(page)) expect(label, `${language} ${label}`).not.toMatch(/\p{L}\./u);
  }
});
