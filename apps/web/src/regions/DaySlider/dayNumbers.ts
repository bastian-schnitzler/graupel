// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Day numbers and dates of the day slider on a phone without a dot at their end (REQ-629): `Intl` writes the day of the
 * month as "31." in Slovenian, Czech and Danish (in German depending on the browser) and as "31" in English, and dates
 * as "31.10." or "31. 10."; on the phone none of them ends with a dot. Dots inside a date stay.
 */

/** The text without the dots (and spaces) at its end: "31." → "31", "31. 10." → "31. 10", "10/31" stays. */
export function withoutTrailingDot(text: string): string {
  return text.replace(/[.\s]+$/u, "");
}
