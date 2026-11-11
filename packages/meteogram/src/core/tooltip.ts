// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { DEFAULT_LOCALE } from "./texts";
import type { Location } from "./types";

/**
 * Formats degrees into a cardinal wind direction string (e.g. "270° W").
 */
export function getCardinalDirection(deg: number | null): string {
  if (deg === null || deg === undefined) return "-";
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const index = Math.round((deg % 360) / 22.5) % 16;
  return `${Math.round(deg)}° ${dirs[(index + 16) % 16]}`;
}

/**
 * Formats the tooltip header date string according to the user or location timezone.
 * A whole date in the style of the locale ("Mi., 16.9."): unlike the day
 * header, it keeps the period Intl writes after the weekday (REQ-668).
 */
export function formatTooltipHeaderDate(
  dateObj: Date,
  locationOrTimezone?: Location | string,
  locale: string = DEFAULT_LOCALE,
): string {
  let tz =
    typeof locationOrTimezone === "string"
      ? locationOrTimezone
      : locationOrTimezone?.timezone || "UTC";
  if (!tz || tz === "auto") tz = "UTC";
  try {
    return dateObj.toLocaleDateString(locale, {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: tz,
    });
  } catch {
    return dateObj.toLocaleDateString(locale, {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
  }
}

// Quantities with their own popup rows (or no popup value at all).
const GROUPED_TOOLTIP_QUANTITIES = new Set([
  "temperature",
  "apparent_temperature",
  // In the temperature group while drawn (REQ-676; before only drawn, REQ-595, REQ-649).
  "dew_point",
  "relative_humidity",
  "wind_speed",
  "wind_gusts",
  "wind_direction",
  "precipitation_probability",
  "precipitation",
  // Derived bars show their sources (precipitation, snowfall) instead.
  "precipitation_rain_snow",
  "snowfall_with_rain",
  "snowfall",
  "snow_depth",
  "cape",
  "convective_inhibition",
  "lightning_potential",
  "weather_code",
  "vertical_cloud_profile",
]);

/**
 * Layout quantities without a dedicated popup group, shown as plain
 * `Label: value unit` rows after the built-in groups.
 */
export function getExtraTooltipQuantities(
  quantities: Set<string> | undefined,
): string[] {
  if (!quantities) return [];
  return [...quantities].filter((id) => !GROUPED_TOOLTIP_QUANTITIES.has(id));
}
