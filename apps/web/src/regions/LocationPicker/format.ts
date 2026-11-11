// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Translate } from "../../i18n/index.ts";

/** Next highlighted suggestion for arrow keys, wrapping around; -1 for an empty list. */
export function nextIndex(current: number, length: number, direction: "up" | "down"): number {
  if (length <= 0) return -1;
  if (direction === "down") return current < length - 1 ? current + 1 : 0;
  return current > 0 ? current - 1 : length - 1;
}

/** Coordinates of a place, also used to name a place without own name (REQ-536). */
export { formatCoordinates } from "../../state/placeLabel.ts";

/** Elevation in whole metres, e.g. "4,806 m"; "n/a" in every language without a value (REQ-732). */
export function formatElevation(elevation: number | undefined, locale: string, t: Translate): string {
  if (elevation === undefined) return t("location.elevation.unknown");
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(elevation);
  return t("location.elevation.value", { value });
}
