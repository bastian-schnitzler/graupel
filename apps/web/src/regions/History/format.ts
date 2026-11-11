// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Texts of the history (REQ-684): dates and times in the device's local time, in the active language. */

/** Date and time of a fetch, e.g. "08.11.2026, 14:05". */
export function formatFetchTime(time: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

/** Day and month of a fetch for the clock button, e.g. "08.11." (REQ-684: "TT.MM."). */
export function formatFetchDay(time: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(time);
}

/** Name of a month fold-out, with its year where it does not stand inside that year's fold-out. */
export function formatMonth(year: number, month: number, locale: string, withYear: boolean): string {
  const options: Intl.DateTimeFormatOptions = withYear ? { month: "long", year: "numeric" } : { month: "long" };
  return new Intl.DateTimeFormat(locale, options).format(new Date(year, month, 1, 12));
}
