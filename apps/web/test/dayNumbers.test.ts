// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Day numbers and dates of the day slider on a phone end without a dot in every language (REQ-629); dots inside a date
 * stay.
 */
import { describe, expect, it } from "vitest";
import { LANGUAGES, toLocale } from "../src/i18n/index.ts";
import { withoutTrailingDot } from "../src/regions/DaySlider/dayNumbers.ts";

describe("withoutTrailingDot (REQ-629)", () => {
  it("drops the dots and spaces at the end, nothing else", () => {
    expect(withoutTrailingDot("31.")).toBe("31");
    expect(withoutTrailingDot("1.")).toBe("1");
    expect(withoutTrailingDot("31")).toBe("31");
    expect(withoutTrailingDot("31.10.")).toBe("31.10");
    expect(withoutTrailingDot("31. 10.")).toBe("31. 10");
    expect(withoutTrailingDot("31.10")).toBe("31.10");
    expect(withoutTrailingDot("10/31")).toBe("10/31");
    expect(withoutTrailingDot("31-10")).toBe("31-10");
    expect(withoutTrailingDot("31. ")).toBe("31");
  });

  // Saturday, 31 October 2026, and Sunday, 1 November, at noon UTC: the month's end and start, one and two digits.
  const DAYS = [Date.UTC(2026, 9, 31, 12), Date.UTC(2026, 10, 1, 12)];

  for (const language of LANGUAGES) {
    it(`leaves no dot at the end of the day number and the date in ${language}`, () => {
      const locale = toLocale(language);
      const dayOfMonth = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
      const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
      for (const time of DAYS) {
        const day = withoutTrailingDot(dayOfMonth.format(time));
        expect(day).toMatch(/^\d{1,2}$/);
        expect(Number(day)).toBe(new Date(time).getUTCDate());
        const shown = withoutTrailingDot(date.format(time));
        expect(shown).not.toMatch(/[.\s]$/u);
        // The dots between day and month stay where the language has them.
        expect(shown.replace(/\s/gu, "")).toBe(date.format(time).replace(/\s/gu, "").replace(/\.$/u, ""));
      }
    });
  }
});
