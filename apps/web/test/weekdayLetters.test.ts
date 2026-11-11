// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Weekdays of narrow day cards (REQ-626): at least two letters in every language of the website, the first two of the
 * short name without its dot, the first in the case of the narrow form. Weekdays of wide day cards: the short name
 * without the dot at its end (REQ-667).
 */
import { describe, expect, it } from "vitest";
import { LANGUAGES, toLocale, type Language } from "../src/i18n/index.ts";
import { shortWeekdayFormat, twoLetterWeekday, weekdayLettersFormat } from "../src/regions/DaySlider/weekdayLetters.ts";

/** Noon UTC of Sunday, 1 November 2026, and the six days after it: one whole week from Sunday on. */
const WEEK = Array.from({ length: 7 }, (_, index) => Date.UTC(2026, 10, 1 + index, 12));

const EXPECTED: Readonly<Record<Language, readonly string[]>> = {
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
  fr: ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"],
  it: ["Do", "Lu", "Ma", "Me", "Gi", "Ve", "Sa"],
  sl: ["ne", "po", "to", "sr", "če", "pe", "so"],
  cs: ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"],
  nl: ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"],
  da: ["Sø", "Ma", "Ti", "On", "To", "Fr", "Lø"],
};

const letters = (text: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;

describe("two-letter weekdays (REQ-626)", () => {
  it("covers every language of the website", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...LANGUAGES].sort());
  });

  for (const language of LANGUAGES) {
    it(`gives a whole week in ${language} at least two letters, without a dot`, () => {
      const format = weekdayLettersFormat(toLocale(language), "UTC");
      const week = WEEK.map(format);
      expect(week).toEqual(EXPECTED[language]);
      for (const day of week) {
        expect(letters(day), day).toBeGreaterThanOrEqual(2);
        expect(day).not.toContain(".");
      }
      // Seven different labels: no two days of the week look alike.
      expect(new Set(week).size).toBe(7);
    });
  }

  it("follows the time zone of the forecast", () => {
    // Sunday 23:30 UTC is already Monday in Vienna.
    const time = Date.UTC(2026, 10, 1, 23, 30);
    expect(weekdayLettersFormat("de-DE", "UTC")(time)).toBe("So");
    expect(weekdayLettersFormat("de-DE", "Europe/Vienna")(time)).toBe("Mo");
  });

  it("takes the first letter's case from the narrow form and the second from the short name", () => {
    expect(twoLetterWeekday("lun.", "L", "fr-FR")).toBe("Lu");
    expect(twoLetterWeekday("út", "Ú", "cs-CZ")).toBe("Út");
    expect(twoLetterWeekday("sre.", "s", "sl-SI")).toBe("sr");
    expect(twoLetterWeekday("tirs.", "T", "da-DK")).toBe("Ti");
    expect(twoLetterWeekday("Wed", "W", "en-GB")).toBe("We");
    // Letters without case keep their own; a combining accent stays with its letter.
    expect(twoLetterWeekday("木曜日", "木", "ja-JP")).toBe("木曜");
    expect(twoLetterWeekday("út", "Ú", "cs-CZ")).toBe("Út");
  });

  it("keeps a short name of one letter and falls back to the narrow form without one", () => {
    expect(twoLetterWeekday("S", "S", "en-GB")).toBe("S");
    expect(twoLetterWeekday(".", "S", "en-GB")).toBe("S");
  });
});

const SHORT: Readonly<Record<Language, readonly string[]>> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
  fr: ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"],
  it: ["dom", "lun", "mar", "mer", "gio", "ven", "sab"],
  sl: ["ned", "pon", "tor", "sre", "čet", "pet", "sob"],
  cs: ["ne", "po", "út", "st", "čt", "pá", "so"],
  nl: ["zo", "ma", "di", "wo", "do", "vr", "za"],
  da: ["søn", "man", "tirs", "ons", "tors", "fre", "lør"],
};

describe("weekday abbreviations without a dot (REQ-667)", () => {
  it("covers every language of the website", () => {
    expect(Object.keys(SHORT).sort()).toEqual([...LANGUAGES].sort());
  });

  for (const language of LANGUAGES) {
    it(`ends no abbreviation of a whole week in ${language} with a dot`, () => {
      const locale = toLocale(language);
      const week = WEEK.map(shortWeekdayFormat(locale, "UTC"));
      expect(week).toEqual(SHORT[language]);
      // The short name of Intl without its dot, nothing else.
      const intl = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
      expect(week).toEqual(WEEK.map((time) => intl.format(time).replace(/\.$/u, "")));
      for (const day of week) expect(day, day).not.toMatch(/[.\s]$/u);
    });
  }

  it("follows the time zone of the forecast", () => {
    const time = Date.UTC(2026, 10, 1, 23, 30);
    expect(shortWeekdayFormat("fr-FR", "UTC")(time)).toBe("dim");
    expect(shortWeekdayFormat("fr-FR", "Europe/Vienna")(time)).toBe("lun");
  });
});
