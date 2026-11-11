// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useConfig, type Place } from "../../config/index.ts";
import { useI18n } from "../../i18n/index.ts";
import {
  placeKey,
  placeLabel,
  samePlace,
  startLocationChoice,
  useFavorites,
  useStartLocation,
} from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

const LAST = "last";
const GPS = "gps";

/**
 * Start place section of the settings popup (REQ-470, REQ-599): first the place shown last (the default; on the first
 * visit the start place of config.json), then the current position by GPS or a fixed place from the favourites. The
 * choice that applies is selected; a fixed place of config.json or a chosen place that is no favourite is offered too.
 * The choice takes effect at the next start; with GPS the page asks for the position at start (DEC-107). A place is
 * named as in the search field: alias, own name or coordinates (REQ-536).
 */
export function StartLocationSettings({ titleId }: SettingsSectionProps) {
  const { t, locale } = useI18n();
  const config = useConfig();
  const { favorites } = useFavorites(config.favorites.presets);
  const choice = useStartLocation();
  const places: Place[] = [...favorites];
  for (const place of [config.startLocation, choice]) {
    if (typeof place === "object" && !places.some((item) => samePlace(item, place))) places.unshift(place);
  }
  const value = typeof choice === "object" ? placeKey(choice) : choice;

  const choose = (key: string) => {
    if (key === LAST || key === GPS) {
      startLocationChoice.set(key);
      return;
    }
    const place = places.find((item) => placeKey(item) === key);
    if (place) startLocationChoice.set(place);
  };

  return (
    <>
      <select
        className="settings__select"
        aria-labelledby={titleId}
        value={value}
        onChange={(event) => choose(event.currentTarget.value)}
      >
        <option value={LAST}>{t("settings.startLocation.last")}</option>
        <option value={GPS}>{t("settings.startLocation.gps")}</option>
        {places.map((place) => (
          <option key={placeKey(place)} value={placeKey(place)}>
            {placeLabel(place, favorites, locale, t)}
          </option>
        ))}
      </select>
      <p className="settings__text">{t("settings.startLocation.text")}</p>
    </>
  );
}
