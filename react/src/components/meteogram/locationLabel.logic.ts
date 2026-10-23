import type { Location } from "../../types";
import { CUSTOM_LOCATION_NAME } from "../FullscreenMapPicker.logic";
import { formatCoordinates } from "../locationSelectorUtils";

/**
 * Formats the forecast generation instant as a short locale date and time
 * (e.g. "16.10.26, 22:45" for German, "10/16/26, 10:45 PM" for US English).
 * Returns null for a missing or unparsable timestamp.
 */
export function formatGeneratedAt(
  generatedAt: string | null | undefined,
  timeZone?: string,
  locale?: string,
): string | null {
  if (!generatedAt) return null;
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
      date,
    );
  } catch {
    // Unknown time zone: fall back to the runtime default.
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

/**
 * Place shown below the meteogram: the location name, or its GPS coordinates
 * for a point picked on the map ("Custom location") or an unnamed location.
 */
export function getLocationLabelPlace(location: Location): string {
  const name = location.name?.trim();
  if (!name || name === CUSTOM_LOCATION_NAME) {
    return formatCoordinates(location.latitude, location.longitude);
  }
  return name;
}

/**
 * Full label text: `Place, elevation m (generated)`. The elevation and the
 * generation time are omitted when unknown.
 */
export function buildLocationLabel(
  location: Location | null | undefined,
  generatedAt?: string | null,
  timeZone?: string,
  locale?: string,
): string | null {
  if (!location) return null;
  let text = getLocationLabelPlace(location);
  if (
    typeof location.elevation === "number" &&
    Number.isFinite(location.elevation)
  ) {
    text += `, ${Math.round(location.elevation)} m`;
  }
  const generated = formatGeneratedAt(generatedAt, timeZone, locale);
  if (generated) text += ` (${generated})`;
  return text;
}
