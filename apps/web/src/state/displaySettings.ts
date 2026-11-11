// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Settings of the settings popup that override config.json (REQ-470, REQ-472, REQ-473): the start place (GPS or a
 * fixed place from the favourites), the model headers of the meteogram, the day slider and, with the slider off, the
 * number of days the meteogram shows. Each is kept in `localStorage` and goes into the settings export; without an own
 * choice the value of the domain's config.json applies. The dew point of the meteogram (REQ-593) is kept the same way;
 * config.json has no value for it, without an own choice it is `off` (REQ-621). So is the relative humidity of the
 * meteogram (REQ-650): `on` or `off`, without an own choice `off`. And whether the precipitation and wind axes of the
 * meteogram follow the visible range (REQ-656): on or off, without an own choice on. Likewise whether the meteogram
 * shows its legend (REQ-639): on or off, without an own choice on. The installed app adds how many days its archive
 * keeps (REQ-684, REQ-686) and, on a phone, whether the history slider is shown (REQ-686), both without a value in
 * config.json.
 */
import {
  isDewPointMode,
  isRelativeHumidityMode,
  type DewPointMode,
  type RelativeHumidityMode,
} from "@graupel/meteogram";
import { useConfig, type DaySliderConfig, type GraupelConfig, type StartLocation } from "../config/index.ts";
import { isPlace, keptPlace, toPlace } from "./place.ts";
import { decodeBoolean, encodeBoolean, storedChoice } from "./storedChoice.ts";

// --- start place (REQ-470, REQ-599) -------------------------------------------------------------------------------

export const START_LOCATION_STORAGE_KEY = "graupel.startLocation";

/**
 * Choice of the start place in the settings: the place shown last (`"last"`, REQ-599), the current position (`"gps"`)
 * or a fixed place. config.json only knows the last two (`StartLocation`).
 */
export type StartLocationChoice = "last" | StartLocation;

/** Start place without an own choice (REQ-599): the place shown last; before one is remembered, config.json applies. */
export const DEFAULT_START_LOCATION: StartLocationChoice = "last";

/** Whether a value read from storage or a file is a start place choice: `"last"`, `"gps"` or a place. */
export function isStartLocation(value: unknown): value is StartLocationChoice {
  return value === "last" || value === "gps" || isPlace(value);
}

function decodeStartLocation(text: string): StartLocationChoice | null {
  if (text === "last" || text === "gps") return text;
  try {
    const value: unknown = JSON.parse(text);
    // A fixed place named "My location" (from an earlier favourite) is shown by its coordinates (REQ-765).
    return isPlace(value) ? keptPlace(value) : null;
  } catch {
    return null;
  }
}

export const startLocationChoice = storedChoice<StartLocationChoice>(
  START_LOCATION_STORAGE_KEY,
  decodeStartLocation,
  (value) => (value === "last" || value === "gps" ? value : JSON.stringify(toPlace(value))),
);

/** Start place choice that applies on this page: the own choice, else the place shown last (REQ-599). */
export function useStartLocation(): StartLocationChoice {
  const [choice] = startLocationChoice.use();
  return choice ?? DEFAULT_START_LOCATION;
}

// --- model headers (REQ-472) --------------------------------------------------------------------------------------

export const MODEL_HEADERS_STORAGE_KEY = "graupel.modelHeaders";

export const modelHeadersChoice = storedChoice<boolean>(MODEL_HEADERS_STORAGE_KEY, decodeBoolean, encodeBoolean);

/** Whether the meteogram shows the model headers: the own choice, else `modelHeaders` from config.json. */
export function useModelHeaders(): boolean {
  const [choice] = modelHeadersChoice.use();
  const { modelHeaders } = useConfig();
  return choice ?? modelHeaders;
}

// --- day slider and days (REQ-473) --------------------------------------------------------------------------------

export const DAY_SLIDER_STORAGE_KEY = "graupel.daySlider";
export const DAYS_STORAGE_KEY = "graupel.days";

/** Number of days the meteogram shows, or every day. */
export type DayCount = DaySliderConfig["days"];

/** Whether a value read from storage or a file is a day count: `"all"` or a whole number of at least 1. */
export function isDayCount(value: unknown): value is DayCount {
  return value === "all" || (typeof value === "number" && Number.isInteger(value) && value >= 1);
}

export const daySliderChoice = storedChoice<boolean>(DAY_SLIDER_STORAGE_KEY, decodeBoolean, encodeBoolean);

export const daysChoice = storedChoice<DayCount>(
  DAYS_STORAGE_KEY,
  (text) => {
    const value = text === "all" ? text : Number(text);
    return isDayCount(value) ? value : null;
  },
  String,
);

/**
 * Day slider that applies: on or off (own choice, else `daySlider.enabled` from config.json) and the days it offers.
 * With the slider on, `daySlider.days` from config.json limits its days as before; with it off, the meteogram shows
 * the chosen number of days (own choice, else `daySlider.days`).
 */
export function effectiveDaySlider(
  enabled: boolean | null,
  days: DayCount | null,
  configured: GraupelConfig["daySlider"],
): DaySliderConfig {
  const on = enabled ?? configured.enabled;
  return { enabled: on, days: on ? configured.days : (days ?? configured.days) };
}

/** Day slider that applies on this page (see `effectiveDaySlider`). */
export function useDaySlider(): DaySliderConfig {
  const [enabled] = daySliderChoice.use();
  const [days] = daysChoice.use();
  return effectiveDaySlider(enabled, days, useConfig().daySlider);
}

// --- dew point (REQ-593, REQ-621) ---------------------------------------------------------------------------------

export const DEW_POINT_STORAGE_KEY = "graupel.dewPoint";

/** Dew point and spread without an own choice: off (REQ-621; until then Auto, REQ-593). */
export const DEFAULT_DEW_POINT: DewPointMode = "off";

/**
 * Own choice of the dew point in the meteogram: `auto`, `on` or `off`, the value of the layout switch `dewPoint` of
 * @graupel/meteogram (REQ-661). `off` is not stored (as the colour mode's `system`): no choice means `off`. `auto` and `on` are
 * stored. Auto, the default before REQ-621, was not stored either, so a browser that kept it counts as `off` until Auto
 * is chosen again; a stored `on` (or `off`) stays.
 */
export const dewPointChoice = storedChoice<DewPointMode>(
  DEW_POINT_STORAGE_KEY,
  (text) => (isDewPointMode(text) ? text : null),
  String,
);

/** Dew point option that applies: the stored choice, else `off`. */
export function readDewPoint(): DewPointMode {
  return dewPointChoice.read() ?? DEFAULT_DEW_POINT;
}

/** Stores the dew point option (`off` removes the stored choice) and tells every `useDewPoint()`. */
export function setDewPoint(mode: DewPointMode): void {
  dewPointChoice.set(mode === DEFAULT_DEW_POINT ? null : mode);
}

/** Dew point option that applies on this page: page meteogram, its picture and the full-screen view follow it. */
export function useDewPoint(): DewPointMode {
  const [choice] = dewPointChoice.use();
  return choice ?? DEFAULT_DEW_POINT;
}

// --- relative humidity (REQ-650) ----------------------------------------------------------------------------------

export const RELATIVE_HUMIDITY_STORAGE_KEY = "graupel.relativeHumidity";

/** Relative humidity without an own choice: off. */
export const DEFAULT_RELATIVE_HUMIDITY: RelativeHumidityMode = "off";

/**
 * Own choice of the relative humidity in the meteogram: `on` or `off`, the value of the layout switch
 * `relativeHumidity` of @graupel/meteogram (REQ-661). Kept like the dew point: `off`, the default, is not stored; `on` is.
 */
export const relativeHumidityChoice = storedChoice<RelativeHumidityMode>(
  RELATIVE_HUMIDITY_STORAGE_KEY,
  (text) => (isRelativeHumidityMode(text) ? text : null),
  String,
);

/** Relative humidity option that applies: the stored choice, else `off`. */
export function readRelativeHumidity(): RelativeHumidityMode {
  return relativeHumidityChoice.read() ?? DEFAULT_RELATIVE_HUMIDITY;
}

/** Stores the relative humidity option (`off` removes the stored choice) and tells every `useRelativeHumidity()`. */
export function setRelativeHumidity(mode: RelativeHumidityMode): void {
  relativeHumidityChoice.set(mode === DEFAULT_RELATIVE_HUMIDITY ? null : mode);
}

/** Relative humidity option that applies on this page: page meteogram, its picture and the full-screen view follow it. */
export function useRelativeHumidity(): RelativeHumidityMode {
  const [choice] = relativeHumidityChoice.use();
  return choice ?? DEFAULT_RELATIVE_HUMIDITY;
}

// --- axes when zoomed (REQ-656) -----------------------------------------------------------------------------------

export const SCALE_TO_VISIBLE_RANGE_STORAGE_KEY = "graupel.scaleToVisibleRange";

/** Axes when zoomed without an own choice: they follow the visible range (on). */
export const DEFAULT_SCALE_TO_VISIBLE_RANGE = true;

/**
 * Own choice whether the precipitation and wind axes of the meteogram follow the visible range when it shows only part
 * of the forecast (zoom or fewer days in the day slider): the layout switch `scaleToVisibleRange` of @graupel/meteogram
 * (`"on"` or `"off"`, REQ-661). On, the default, is not stored; off is (`"false"`).
 */
export const scaleToVisibleRangeChoice = storedChoice<boolean>(
  SCALE_TO_VISIBLE_RANGE_STORAGE_KEY,
  decodeBoolean,
  encodeBoolean,
);

/** Whether the axes follow the visible range: the stored choice, else on. */
export function readScaleToVisibleRange(): boolean {
  return scaleToVisibleRangeChoice.read() ?? DEFAULT_SCALE_TO_VISIBLE_RANGE;
}

/** Stores the choice (on removes the stored choice) and tells every `useScaleToVisibleRange()`. */
export function setScaleToVisibleRange(on: boolean): void {
  scaleToVisibleRangeChoice.set(on === DEFAULT_SCALE_TO_VISIBLE_RANGE ? null : on);
}

/** Whether the axes follow the visible range on this page: page meteogram, its picture and the full-screen view. */
export function useScaleToVisibleRange(): boolean {
  const [choice] = scaleToVisibleRangeChoice.use();
  return choice ?? DEFAULT_SCALE_TO_VISIBLE_RANGE;
}

// --- legend (REQ-639) ---------------------------------------------------------------------------------------------

export const LEGEND_STORAGE_KEY = "graupel.legend";

/** Legend of the meteogram without an own choice: shown. */
export const DEFAULT_LEGEND = true;

/**
 * Own choice whether the meteogram shows its legend: its X sets it to off, the settings popup switches it back on.
 * Kept like the axes when zoomed: on, the default, is not stored; off is (`"false"`).
 */
export const legendChoice = storedChoice<boolean>(LEGEND_STORAGE_KEY, decodeBoolean, encodeBoolean);

/** Whether the legend is shown: the stored choice, else on. */
export function readLegend(): boolean {
  return legendChoice.read() ?? DEFAULT_LEGEND;
}

/** Stores the choice (on removes the stored choice) and tells every `useLegend()`. */
export function setLegend(on: boolean): void {
  legendChoice.set(on === DEFAULT_LEGEND ? null : on);
}

/** Whether the meteogram on this page shows its legend. */
export function useLegend(): boolean {
  const [choice] = legendChoice.use();
  return choice ?? DEFAULT_LEGEND;
}

// --- archive of the installed app (REQ-684, REQ-686) ---------------------------------------------------------------

export const ARCHIVE_DAYS_STORAGE_KEY = "graupel.archiveDays";

/** How many days the installed app keeps its archived fetches (REQ-686): every one, or those of the last N days. */
export type ArchiveDays = "unlimited" | 365 | 90 | 14 | 5;

/** The choices of the settings, in their order (REQ-686). */
export const ARCHIVE_DAYS_OPTIONS: readonly ArchiveDays[] = ["unlimited", 365, 90, 14, 5];

/** Without an own choice the archive keeps every fetch (REQ-686). */
export const DEFAULT_ARCHIVE_DAYS: ArchiveDays = "unlimited";

/** Whether a value read from storage or a file is one of the archive's choices. */
export function isArchiveDays(value: unknown): value is ArchiveDays {
  return ARCHIVE_DAYS_OPTIONS.includes(value as ArchiveDays);
}

/**
 * Own choice of the archive's days (REQ-686), chosen in the tab Archive of the settings. Kept like the dew point:
 * `unlimited`, the default, is not stored; a number of days is.
 */
export const archiveDaysChoice = storedChoice<ArchiveDays>(
  ARCHIVE_DAYS_STORAGE_KEY,
  (text) => {
    const value = text === "unlimited" ? text : Number(text);
    return isArchiveDays(value) ? value : null;
  },
  String,
);

/** Days the archive keeps: the stored choice, else unlimited. */
export function readArchiveDays(): ArchiveDays {
  return archiveDaysChoice.read() ?? DEFAULT_ARCHIVE_DAYS;
}

/** Stores the archive's days (`unlimited` removes the stored choice) and tells every `useArchiveDays()`. */
export function setArchiveDays(days: ArchiveDays): void {
  archiveDaysChoice.set(days === DEFAULT_ARCHIVE_DAYS ? null : days);
}

/** Days the archive of the installed app keeps on this page (REQ-684): older fetches are deleted. */
export function useArchiveDays(): ArchiveDays {
  const [choice] = archiveDaysChoice.use();
  return choice ?? DEFAULT_ARCHIVE_DAYS;
}

// --- history slider of the installed app on a phone (REQ-686, REQ-685) ---------------------------------------------

export const HISTORY_SLIDER_STORAGE_KEY = "graupel.historySlider";

/** History slider without an own choice: hidden (REQ-686). */
export const DEFAULT_HISTORY_SLIDER = false;

/**
 * Own choice whether the installed app on a phone shows the history slider (REQ-686; switched in the tab Archive of the
 * settings, shown on phones only; the slider itself follows with REQ-685). Off, the default, is not stored; on is
 * (`"true"`).
 */
export const historySliderChoice = storedChoice<boolean>(HISTORY_SLIDER_STORAGE_KEY, decodeBoolean, encodeBoolean);

/** Whether the history slider is switched on: the stored choice, else off. */
export function readHistorySlider(): boolean {
  return historySliderChoice.read() ?? DEFAULT_HISTORY_SLIDER;
}

/** Stores the choice (off removes the stored choice) and tells every `useHistorySlider()`. */
export function setHistorySlider(on: boolean): void {
  historySliderChoice.set(on === DEFAULT_HISTORY_SLIDER ? null : on);
}

/** Whether the history slider is switched on for this page (REQ-686); the phone and the history decide the rest. */
export function useHistorySlider(): boolean {
  const [choice] = historySliderChoice.use();
  return choice ?? DEFAULT_HISTORY_SLIDER;
}

/** Forgets choices kept for this visit only (tests). */
export function resetDisplaySettings(): void {
  for (const choice of [
    startLocationChoice,
    modelHeadersChoice,
    daySliderChoice,
    daysChoice,
    dewPointChoice,
    relativeHumidityChoice,
    scaleToVisibleRangeChoice,
    legendChoice,
    archiveDaysChoice,
    historySliderChoice,
  ]) {
    choice.reset();
  }
}
