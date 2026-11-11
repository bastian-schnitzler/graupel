// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Two-letter weekdays in the day slider (REQ-626): where the cards are too narrow for the long labels (REQ-520), e.g.
 * on a phone held upright with 17 days, each card shows at least two letters of its weekday in every language ("We",
 * "Mo", "Me", "Ma") instead of an initial, and the two letters fit their card. They get smaller only where they would
 * not fit; the day of the month keeps its size. At desktop width the long labels stay.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const PORTRAIT = { width: 390, height: 844 };
/**
 * Fixed time: Wednesday, 28 October 2026, 11:00 UTC. Today is a Wednesday, whose two letters are among the widest
 * ("We", "Me"), and with yesterday and 16 days ahead every weekday is on the strip at least twice.
 */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);

/** The strip from yesterday (Tuesday) on, 17 days, in the languages tested. */
const STRIP: Readonly<Record<string, readonly string[]>> = {
  en: ["Tu", "We", "Th", "Fr", "Sa", "Su", "Mo"],
  de: ["Di", "Mi", "Do", "Fr", "Sa", "So", "Mo"],
  fr: ["Ma", "Me", "Je", "Ve", "Sa", "Di", "Lu"],
  da: ["Ti", "On", "To", "Fr", "Lø", "Sø", "Ma"],
  cs: ["Út", "St", "Čt", "Pá", "So", "Ne", "Po"],
};
const strip = (language: string) => Array.from({ length: 17 }, (_, index) => STRIP[language]![index % 7]!);

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
  // The measured labels are applied before the next frames.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Per card: the weekday it shows, its width, the card's inner edges, the fonts of weekday and date. */
function cardLabels(page: Page) {
  return page.getByTestId("day-card").evaluateAll((cards) =>
    cards.map((card) => {
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const left = box.left + parseFloat(style.paddingLeft);
      const right = box.right - parseFloat(style.paddingRight);
      const visible = (selector: string) =>
        [...card.querySelectorAll<HTMLElement>(`${selector} > span`)].find((span) => span.offsetParent !== null)!;
      const weekday = visible(".day-card__weekday");
      const text = weekday.getBoundingClientRect();
      return {
        text: weekday.textContent ?? "",
        short: weekday.classList.contains("day-card__short"),
        left: text.left - left,
        right: right - text.right,
        inner: right - left,
        width: text.width,
        font: parseFloat(getComputedStyle(weekday).fontSize),
        nominal: parseFloat(getComputedStyle(weekday.parentElement!).fontSize),
        date: parseFloat(getComputedStyle(visible(".day-card__date")).fontSize),
        today: card.getAttribute("aria-current") === "date",
      };
    }),
  );
}

const letters = (text: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;

/** Text may end this close to the card's inner edge (sub-pixel rounding of the layout). */
const EDGE = 0.1;

test.describe("phone held upright, 17 days (REQ-626)", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  for (const language of ["en", "de", "fr", "da"]) {
    test(`${language}: every card shows two letters of its weekday, inside the card`, async ({ page }) => {
      await open(page, language);
      const track = page.getByTestId("day-slider-track");
      await expect(track).toHaveAttribute("data-labels", "short");
      const cards = await cardLabels(page);
      expect(cards).toHaveLength(17);
      expect(cards.map((card) => card.text)).toEqual(strip(language));
      expect(cards.filter((card) => card.today).map((card) => card.text)).toEqual([strip(language)[1]]);
      for (const card of cards) {
        expect(letters(card.text), card.text).toBe(2);
        expect(card.text).not.toContain(".");
        // Not beyond the card on either side, today's larger weekday too.
        expect(card.left, card.text).toBeGreaterThanOrEqual(-EDGE);
        expect(card.right, card.text).toBeGreaterThanOrEqual(-EDGE);
        expect(card.width, card.text).toBeLessThanOrEqual(card.inner + EDGE);
        // Still readable (REQ-458), and the day of the month keeps its size.
        expect(card.font, card.text).toBeGreaterThanOrEqual(11);
        expect(card.date).toBe(14);
      }
      // English, French and Danish abbreviations are too long here, so the cards show their two letters (REQ-626);
      // German "Mo" fits as it is (REQ-548).
      expect(cards.every((card) => card.short)).toBe(language !== "de");
    });
  }
});

// The narrowest phone: the cards are so narrow that English "We" only just fits at the weekday's size.
test.describe("narrowest phone, 320 px (REQ-626)", () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  for (const language of ["en", "fr"]) {
    test(`${language}: the two letters fit, smaller only where they have to`, async ({ page }) => {
      await open(page, language);
      const cards = await cardLabels(page);
      expect(cards).toHaveLength(17);
      expect(cards.map((card) => card.text)).toEqual(strip(language));
      for (const card of cards) {
        expect(card.short, card.text).toBe(true);
        expect(card.left, card.text).toBeGreaterThanOrEqual(-EDGE);
        expect(card.right, card.text).toBeGreaterThanOrEqual(-EDGE);
        expect(card.width, card.text).toBeLessThanOrEqual(card.inner + EDGE);
        // Not smaller than needed: at the weekday's size, or as wide as the card.
        if (card.font < card.nominal - 0.01) expect(card.width, card.text).toBeGreaterThan(card.inner - 0.5);
        // Never much smaller than the other weekdays.
        expect(card.font, card.text).toBeGreaterThanOrEqual(10);
      }
      // Today is one of the widest pairs, in its larger font where that fits (REQ-565); it is inside its card above.
      expect(cards.filter((card) => card.today).map((card) => card.text)).toEqual([language === "en" ? "We" : "Me"]);
    });
  }
});

test.describe("wide slider (REQ-626)", () => {
  test.use({ locale: "en-GB" });

  // The narrowest width with the wide slider (cards for the days, no "All" since REQ-640): the short labels with their
  // two letters. Danish keeps its long labels there since "tirs" lost its dot (REQ-667); Czech has short ones.
  for (const language of ["en", "fr", "cs"]) {
    test(`${language}: 700 px, short labels with two letters inside their cards`, async ({ page }) => {
      await page.setViewportSize({ width: 700, height: 800 });
      await open(page, language);
      // The wide slider: a card with the label "Horizon" (REQ-499), which the phone's strip has not (REQ-529).
      await expect(page.getByTestId("day-slider-label")).toBeVisible();
      await expect(page.getByTestId("day-slider-track")).toHaveAttribute("data-labels", "short");
      const cards = await cardLabels(page);
      expect(cards.map((card) => card.text)).toEqual(strip(language));
      for (const card of cards) {
        expect(card.short, card.text).toBe(true);
        expect(card.left, card.text).toBeGreaterThanOrEqual(-EDGE);
        expect(card.right, card.text).toBeGreaterThanOrEqual(-EDGE);
        expect(card.width, card.text).toBeLessThanOrEqual(card.inner + EDGE);
      }
    });
  }

  test("desktop 1280 px keeps the long labels", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [language, weekdays] of [
      ["en", ["Tue", "Wed", "Thu"]],
      ["fr", ["mar", "mer", "jeu"]],
    ] as const) {
      await open(page, language);
      await expect(page.getByTestId("day-slider-track")).toHaveAttribute("data-labels", "long");
      const cards = await cardLabels(page);
      expect(cards.slice(0, 3).map((card) => card.text)).toEqual(weekdays);
      expect(cards.every((card) => !card.short)).toBe(true);
      // The name read out stays the full date.
      await expect(page.getByTestId("day-card").nth(1)).toHaveAttribute(
        "aria-label",
        language === "en" ? "Wednesday 28 October" : "mercredi 28 octobre",
      );
    }
  });
});
