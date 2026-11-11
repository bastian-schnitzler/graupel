// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Weekdays of narrow day cards with at least two letters in every language (REQ-626): one letter alone is ambiguous
 * ("S S M T W T F S" in English), two are not ("Sa Su Mo Tu We Th Fr").
 */

import { withoutTrailingDot } from "./dayNumbers.ts";

type Letters = (text: string) => string[];

/** Splits a text into its letters (grapheme clusters), so "Ú" or "č" counts as one letter however it is encoded. */
function lettersOf(locale: string): Letters {
  if (typeof Intl.Segmenter !== "function") return (text) => Array.from(text);
  const segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
  return (text) => Array.from(segmenter.segment(text), (part) => part.segment);
}

/** The rule of `twoLetterWeekday`, with the letters split by `letters`. */
function twoLetters(short: string, narrow: string, locale: string, letters: Letters): string {
  const [first, second = ""] = letters(short.replace(/\./g, "").trim());
  if (first === undefined) return narrow;
  const initial = letters(narrow.trim())[0] ?? "";
  const upper = initial.toLocaleUpperCase(locale);
  const lower = initial.toLocaleLowerCase(locale);
  // The narrow form's case where it has one; letters without case stay as they are.
  const cased =
    upper === lower ? first : initial === upper ? first.toLocaleUpperCase(locale) : first.toLocaleLowerCase(locale);
  return cased + second;
}

/**
 * Two-letter weekday from the short name (Intl weekday "short") and the narrow one (weekday "narrow") of the same day:
 * the first two letters of the short name without its dots, the first in the case of the narrow form, the second as in
 * the short name. French "lun." with "L" gives "Lu", Czech "út" with "Ú" gives "Út", Slovenian "sre." with "s" gives
 * "sr", English "Wed" with "W" gives "We". A short name of fewer than two letters stays as it is.
 */
export function twoLetterWeekday(short: string, narrow: string, locale: string): string {
  return twoLetters(short, narrow, locale, lettersOf(locale));
}

/**
 * Formats a time as its weekday's abbreviation (Intl weekday "short") in `locale` and `timeZone`, without the dot at its
 * end in every language (REQ-667): French "mar." becomes "mar", Danish "tirs." "tirs", Slovenian "čet." "čet"; "Di",
 * "Tue" and "út" stay as they are.
 */
export function shortWeekdayFormat(locale: string, timeZone: string): (time: number) => string {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone });
  return (time) => withoutTrailingDot(short.format(time));
}

/** Formats a time as its two-letter weekday in `locale` and `timeZone` (REQ-626). */
export function weekdayLettersFormat(locale: string, timeZone: string): (time: number) => string {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone });
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone });
  const letters = lettersOf(locale);
  return (time) => twoLetters(short.format(time), narrow.format(time), locale, letters);
}
