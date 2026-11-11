// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Export and import of the settings and favourites as a JSON file (REQ-429). The file carries a format name
 * and a version; an import is checked completely before anything is changed.
 *
 * Format, version 1:
 * ```json
 * {
 *   "format": "graupel-settings",
 *   "version": 1,
 *   "exported": "2026-10-26T12:00:00.000Z",
 *   "settings": {
 *     "language": "de", "colorMode": "dark", "showWeatherChain": true, "showCloudChain": null,
 *     "map": "maptoolkit",
 *     "startLocation": "gps", "modelHeaders": false, "daySlider": false, "days": 3,
 *     "dewPoint": "on", "relativeHumidity": "on", "scaleToVisibleRange": false, "legend": false,
 *     "archiveDays": 90, "historySlider": true
 *   },
 *   "favorites": [
 *     { "name": "Matterhorn", "lat": 45.9763, "lon": 7.6586, "elevation": 4478 },
 *     { "name": "Hausberg", "lat": 47.1718, "lon": 12.6806, "mapPoint": true }
 *   ]
 * }
 * ```
 * `settings.language` is the chosen language or `null` (no choice: browser language); `settings.colorMode` is
 * `system`, `light` or `dark`; `settings.showWeatherChain` and `settings.showCloudChain` whether the weather and the
 * cloud chain card are shown (REQ-503; `null`: no own choice, config.json applies; files from before have one
 * `settings.showModelChain` for both, still read on import); `settings.map` the chosen map provider
 * (`opentopomap`, `maptoolkit`) or `null` (no choice: config.json applies);
 * `settings.startLocation` the start place (`"last"`, `"gps"` or a place, REQ-470, REQ-599), `settings.modelHeaders`
 * whether the meteogram shows the model headers (REQ-472), `settings.daySlider` whether the day slider is shown and
 * `settings.days` the days the meteogram shows with the slider off (a whole number from 1, or `"all"`, REQ-473); each
 * of these four is `null` without an own choice (config.json applies); `settings.dewPoint` the dew point of the
 * meteogram, `auto`, `on` or `off` (REQ-593; a file without it leaves the option as it is, so it stays at its default
 * `off`, REQ-621, unless chosen otherwise); `settings.relativeHumidity` the relative humidity of the meteogram, `on` or
 * `off` (REQ-650; a file without it leaves the option as it is, default `off`); `settings.scaleToVisibleRange` whether
 * the precipitation and wind axes follow the visible range when zoomed, `true` or `false` (REQ-656; a file without it
 * leaves the option as it is, default `true`); `settings.legend` whether the meteogram shows its legend, `true` or
 * `false` (REQ-639; a file without it leaves the option as it is, default `true`); `settings.archiveDays` how many days
 * the installed app keeps its archived fetches, `"unlimited"`, `365`, `90`, `14` or `5` (REQ-686; a file without it
 * leaves the choice as it is, default `"unlimited"`); `settings.historySlider` whether the installed app on a phone
 * shows the history slider, `true` or `false` (REQ-686; a file without it leaves the choice as it is, default `false`).
 * All but `language` and `colorMode` were added later with the same
 * version, so older files may lack them. A favourite with `"mapPoint": true` is a point picked on the map that can be renamed
 * (REQ-489, added with the same version); its `name` is empty until it is renamed (REQ-536, shown by its coordinates;
 * older files may carry the generic map-point name of a language, read as empty).
 * `favorites` replaces the list on import (a place listed twice is kept once). What the file leaves out stays
 * unchanged on import. A new setting adds an optional field to `settings` (same version); the version only rises
 * when older files can no longer be read as before.
 */
import type { MapProvider, StartLocation } from "../config/index.ts";
import { isLanguage, type Language } from "../i18n/index.ts";
import { isColorMode, type ColorMode } from "./colorMode.ts";
import {
  isDewPointMode,
  isRelativeHumidityMode,
  type DewPointMode,
  type RelativeHumidityMode,
} from "@graupel/meteogram";
import { isArchiveDays, isDayCount, isStartLocation, type ArchiveDays, type DayCount } from "./displaySettings.ts";
import { isMapProvider } from "./mapProvider.ts";
import { toFavorite, type Favorite } from "./favorites.ts";
import { isPlace, samePlace, toPlace } from "./place.ts";

export const SETTINGS_FILE_FORMAT = "graupel-settings";
export const SETTINGS_FILE_VERSION = 1;
/** Larger files are refused without reading them; a real export is a few kilobytes. */
export const SETTINGS_FILE_MAX_BYTES = 1_000_000;

export interface SettingsData {
  /** Chosen language; `null` for no choice. */
  language?: Language | null;
  /** Chosen colour mode (`system`: follow the system). */
  colorMode?: ColorMode;
  /** Whether both model chain cards are shown (REQ-445); only in files from before REQ-503, read on import. */
  showModelChain?: boolean;
  /** Whether the weather chain card is shown (REQ-503); `null` for no choice. */
  showWeatherChain?: boolean | null;
  /** Whether the cloud chain card is shown (REQ-503); `null` for no choice. */
  showCloudChain?: boolean | null;
  /** Chosen map provider (REQ-467); `null` for no choice. */
  map?: MapProvider | null;
  /**
   * Chosen start place (REQ-470): the place shown last (`"last"`, REQ-599), `"gps"` or a place; `null` for no choice,
   * which also means the place shown last. The remembered place itself is not part of the file.
   */
  startLocation?: StartLocation | "last" | null;
  /** Whether the meteogram shows the model headers (REQ-472); `null` for no choice. */
  modelHeaders?: boolean | null;
  /** Whether the day slider is shown (REQ-473); `null` for no choice. */
  daySlider?: boolean | null;
  /** Days the meteogram shows with the slider off (REQ-473); `null` for no choice. */
  days?: DayCount | null;
  /** Dew point and spread in the meteogram (REQ-593): `auto`, `on` or `off`. */
  dewPoint?: DewPointMode;
  /** Relative humidity in the meteogram (REQ-650): `on` or `off`. */
  relativeHumidity?: RelativeHumidityMode;
  /** Whether the precipitation and wind axes of the meteogram follow the visible range when zoomed (REQ-656). */
  scaleToVisibleRange?: boolean;
  /** Whether the meteogram shows its legend (REQ-639). */
  legend?: boolean;
  /** How many days the installed app keeps its archived fetches (REQ-686). */
  archiveDays?: ArchiveDays;
  /** Whether the installed app on a phone shows the history slider (REQ-686). */
  historySlider?: boolean;
}

/** Contents of a settings file after the check. */
export interface SettingsFile {
  settings: SettingsData;
  /** Favourites; left out: unchanged. */
  favorites?: Favorite[];
}

/** Why a file was refused: not a settings file, written by a newer version, or with invalid values. */
export type SettingsFileError = "invalid" | "newer" | "content";

export type SettingsFileResult = { ok: true; value: SettingsFile } | { ok: false; error: SettingsFileError };

/** JSON text of an export file (formatted, ends with a newline). */
export function serializeSettingsFile(file: SettingsFile, exported: Date = new Date()): string {
  const body = {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    exported: exported.toISOString(),
    settings: file.settings,
    ...(file.favorites ? { favorites: file.favorites.map(toFavorite) } : {}),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseSettings(value: unknown): SettingsData | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const settings: SettingsData = {};
  if ("language" in value) {
    const { language } = value;
    if (language !== null && !isLanguage(language)) return null;
    settings.language = language;
  }
  if ("colorMode" in value) {
    const { colorMode } = value;
    if (!isColorMode(colorMode)) return null;
    settings.colorMode = colorMode;
  }
  if ("showModelChain" in value) {
    const { showModelChain } = value;
    if (typeof showModelChain !== "boolean") return null;
    settings.showModelChain = showModelChain;
  }
  if ("map" in value) {
    const { map } = value;
    if (map !== null && !isMapProvider(map)) return null;
    settings.map = map;
  }
  if ("startLocation" in value) {
    const { startLocation } = value;
    if (startLocation !== null && !isStartLocation(startLocation)) return null;
    settings.startLocation =
      startLocation === null || typeof startLocation === "string" ? startLocation : toPlace(startLocation);
  }
  for (const key of ["showWeatherChain", "showCloudChain", "modelHeaders", "daySlider"] as const) {
    if (!(key in value)) continue;
    const flag = value[key];
    if (flag !== null && typeof flag !== "boolean") return null;
    settings[key] = flag;
  }
  if ("days" in value) {
    const { days } = value;
    if (days !== null && !isDayCount(days)) return null;
    settings.days = days;
  }
  if ("dewPoint" in value) {
    const { dewPoint } = value;
    if (!isDewPointMode(dewPoint)) return null;
    settings.dewPoint = dewPoint;
  }
  if ("relativeHumidity" in value) {
    const { relativeHumidity } = value;
    if (!isRelativeHumidityMode(relativeHumidity)) return null;
    settings.relativeHumidity = relativeHumidity;
  }
  if ("scaleToVisibleRange" in value) {
    const { scaleToVisibleRange } = value;
    if (typeof scaleToVisibleRange !== "boolean") return null;
    settings.scaleToVisibleRange = scaleToVisibleRange;
  }
  if ("legend" in value) {
    const { legend } = value;
    if (typeof legend !== "boolean") return null;
    settings.legend = legend;
  }
  if ("archiveDays" in value) {
    const { archiveDays } = value;
    if (!isArchiveDays(archiveDays)) return null;
    settings.archiveDays = archiveDays;
  }
  if ("historySlider" in value) {
    const { historySlider } = value;
    if (typeof historySlider !== "boolean") return null;
    settings.historySlider = historySlider;
  }
  // Unknown settings (e.g. from a later release with the same version) are skipped.
  return settings;
}

/** Checks the text of a settings file; nothing is applied here. */
export function parseSettingsFile(text: string): SettingsFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!isRecord(data) || data.format !== SETTINGS_FILE_FORMAT) return { ok: false, error: "invalid" };
  const { version } = data;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { ok: false, error: "invalid" };
  if (version > SETTINGS_FILE_VERSION) return { ok: false, error: "newer" };

  const settings = parseSettings(data.settings);
  if (!settings) return { ok: false, error: "content" };
  const value: SettingsFile = { settings };
  if (data.favorites !== undefined) {
    if (!Array.isArray(data.favorites) || !data.favorites.every(isPlace)) return { ok: false, error: "content" };
    // A place listed twice is kept once (first entry), as marking it in the picker would do.
    value.favorites = data.favorites
      .filter((place, index, all) => all.findIndex((other) => samePlace(other, place)) === index)
      .map(toFavorite);
  }
  return { ok: true, value };
}

/** Reads and checks a chosen file; too large or unreadable files count as invalid. */
export async function readSettingsFile(file: Blob): Promise<SettingsFileResult> {
  if (file.size > SETTINGS_FILE_MAX_BYTES) return { ok: false, error: "invalid" };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "invalid" };
  }
  return parseSettingsFile(text);
}

/** File name of an export, with the local date: `graupel-settings-2026-10-26.json`. */
export function settingsFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `graupel-settings-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Offers the text as a file download. */
export function downloadTextFile(text: string, fileName: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later: some browsers start the download after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
