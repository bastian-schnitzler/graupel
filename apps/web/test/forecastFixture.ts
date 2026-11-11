// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** A small `ForecastResult` for the day slider and meteogram tests (no download). */
import { OPEN_METEO_ATTRIBUTION, type DataPoint, type ForecastResult } from "@graupel/download";

export const HOUR = 3_600_000;

export interface FixtureOptions {
  /** Timeline start (yesterday 00:00 local), ISO. */
  start?: string;
  /** Forecast start, ISO. */
  now?: string;
  /** Timeline end (exclusive), ISO. */
  end?: string;
  timezone?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  /** Temperature (°C) of each hour from its index; left out: between 0 and 10 °C. */
  temperature?: (hour: number) => number;
  /** Dew point (°C) of each hour from its index and temperature; left out: no dew point (REQ-593). */
  dewPoint?: (hour: number, temperature: number) => number;
  /** Relative humidity (%) of each hour from its index; left out: no relative humidity (REQ-650). */
  relativeHumidity?: (hour: number) => number;
  /** Wind, gusts (km/h) and precipitation (mm) of each hour from its index; left out: the fixture's own values. */
  wind?: (hour: number) => number;
  gusts?: (hour: number) => number;
  precipitation?: (hour: number) => number;
}

// Vienna: Mon 26.10.2026 00:00 CET to Sun 01.11.2026 12:00 CET (last day only half covered), today Tue 27.10.
export const FIXTURE_START = "2026-10-25T23:00:00Z";
export const FIXTURE_NOW = "2026-10-27T10:00:00Z";
export const FIXTURE_END = "2026-11-01T11:00:00Z";

export function forecastFixture(options: FixtureOptions = {}): ForecastResult {
  const start = options.start ?? FIXTURE_START;
  const now = options.now ?? FIXTURE_NOW;
  const end = options.end ?? FIXTURE_END;
  const startMs = Date.parse(start);
  const hours = Math.round((Date.parse(end) - startMs) / HOUR);
  const combined: DataPoint[] = [];
  for (let h = 0; h < hours; h++) {
    const timestamp = new Date(startMs + h * HOUR).toISOString().replace(".000Z", "Z");
    const add = (variable: string, value: number, unit: string) =>
      combined.push({ timestamp, variable, value, unit, model: "ICON" });
    const temperature = options.temperature ? options.temperature(h) : 5 + Math.sin(h / 4) * 5;
    add("temperature", temperature, "°C");
    if (options.dewPoint) add("dew_point", options.dewPoint(h, temperature), "°C");
    if (options.relativeHumidity) add("relative_humidity", options.relativeHumidity(h), "%");
    add("wind_speed", options.wind ? options.wind(h) : 12 + Math.cos(h / 3) * 6, "km/h");
    add("wind_gusts", options.gusts ? options.gusts(h) : 24 + Math.cos(h / 3) * 8, "km/h");
    add("wind_direction", (h * 30) % 360, "°");
    add("cloud_cover", 50, "%");
    add("precipitation", options.precipitation ? options.precipitation(h) : h % 6 === 0 ? 1 : 0, "mm");
    add("precipitation_probability", (h * 7) % 100, "%");
  }
  return {
    location: {
      name: options.name ?? "Innsbruck",
      latitude: options.latitude ?? 47.2627,
      longitude: options.longitude ?? 11.3945,
    },
    timezone: options.timezone ?? "Europe/Vienna",
    timeline: { start, now, end },
    chain: [{ model: "ICON", sliceEndHours: hours, configuredHours: hours }],
    cloudChain: [],
    combined,
    byModel: {},
    cloud: null,
    cloudByModel: {},
    cloudTransitions: [],
    sunPhases: [],
    availability: {},
    cloudAvailability: {},
    runSegments: {},
    diagnostics: {},
    raw: [],
    errors: {},
    warnings: [],
    generatedAt: now,
    attribution: { ...OPEN_METEO_ATTRIBUTION },
  };
}
