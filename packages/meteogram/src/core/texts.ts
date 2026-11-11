// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Language of the meteogram: the locale for dates and weekday names, and the
 * texts the chart writes itself (empty state, detail labels). Quantity
 * names come from the registry, model names from the input.
 */

/** Default locale (option `locale`). */
export const DEFAULT_LOCALE = "en-US";

export interface MeteogramTexts {
  /** Shown instead of the chart without data or visible range. */
  emptyState: string;
  time: string;
  temperature: string;
  feelsLike: string;
  windSpeed: string;
  gusts: string;
  direction: string;
  precipitationProbability: string;
  precipitation: string;
  accumulated: string;
  cape: string;
  cin: string;
}

export const DEFAULT_TEXTS: Readonly<MeteogramTexts> = {
  emptyState: "No forecast data available for the selected parameters.",
  time: "Time",
  temperature: "Temperature",
  feelsLike: "Feels like",
  windSpeed: "Wind Speed",
  gusts: "Gusts",
  direction: "Direction",
  precipitationProbability: "Precip. Prob.",
  precipitation: "Precipitation",
  accumulated: "Accumulated",
  cape: "CAPE",
  cin: "CIN",
};

/** Default texts with the given ones replaced. */
export function resolveMeteogramTexts(texts?: Partial<MeteogramTexts> | null): MeteogramTexts {
  if (!texts) return { ...DEFAULT_TEXTS };
  const resolved: MeteogramTexts = { ...DEFAULT_TEXTS };
  for (const key of Object.keys(DEFAULT_TEXTS) as (keyof MeteogramTexts)[]) {
    const value = texts[key];
    if (typeof value === "string") resolved[key] = value;
  }
  return resolved;
}

/**
 * Short weekday name ("Mon", "Mo", "čet") in a time zone; UTC for unknown
 * zones. A period at the end of the abbreviation ("čet.", "mar.", "tirs.")
 * is dropped in every language (REQ-668); nothing else is changed.
 */
export function formatWeekdayShort(timestamp: number, timeZone: string, locale: string): string {
  return withoutTrailingPeriod(formatIntlWeekdayShort(timestamp, timeZone, locale));
}

/** The abbreviation without a period at its end ("čet." → "čet", REQ-668). */
function withoutTrailingPeriod(text: string): string {
  return text.trimEnd().replace(/\.$/, "");
}

function formatIntlWeekdayShort(timestamp: number, timeZone: string, locale: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "short" };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(timestamp);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(timestamp);
    } catch {
      return new Intl.DateTimeFormat(DEFAULT_LOCALE, { ...options, timeZone: "UTC" }).format(
        timestamp,
      );
    }
  }
}
