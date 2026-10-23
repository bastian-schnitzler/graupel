import type { Location } from "../../types";

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
 */
export function formatTooltipHeaderDate(
  dateObj: Date,
  locationOrTimezone?: Location | string,
): string {
  let tz =
    typeof locationOrTimezone === "string"
      ? locationOrTimezone
      : locationOrTimezone?.timezone || "UTC";
  if (!tz || tz === "auto") tz = "UTC";
  try {
    return dateObj.toLocaleDateString("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: tz,
    });
  } catch {
    return dateObj.toLocaleDateString("en-US", {
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
