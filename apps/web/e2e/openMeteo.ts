// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A fake Open-Meteo for the end-to-end tests (after packages/download/test/fakeOpenMeteo.ts): hourly answers for every
 * requested variable from the current hour minus `past_hours`, an empty `meta.json` (no run information, so no Single
 * Runs requests), no sun times. No request leaves the browser, and every answer is 200: the browser logs error statuses
 * as console errors, which the tests count.
 */
import type { Page, Route } from "@playwright/test";

const HOUR_MS = 3_600_000;

/** `YYYY-MM-DDTHH:MM` like Open-Meteo with `timezone=GMT`. */
const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 16);

function unit(variable: string): string {
  if (variable.includes("temp") || variable.includes("dew_point")) return "°C";
  if (variable.includes("geopotential")) return "m";
  if (variable.includes("direction")) return "°";
  if (variable.includes("wind")) return "km/h";
  if (variable === "precipitation" || variable === "rain" || variable === "showers") return "mm";
  if (variable === "snowfall") return "cm";
  if (variable === "snow_depth" || variable === "freezing_level_height") return "m";
  if (variable === "weather_code") return "wmo code";
  if (variable.includes("pressure")) return "hPa";
  return "%";
}

function value(variable: string, index: number): number {
  const wave = Math.sin(index / 5);
  if (variable.includes("geopotential")) {
    const level = Number(/(\d+)hPa/.exec(variable)?.[1] ?? 500);
    return Math.round(44330 * (1 - (level / 1013.25) ** 0.1903));
  }
  if (variable.includes("temp") || variable.includes("dew_point")) return Math.round((4 + 6 * wave) * 10) / 10;
  if (variable.includes("direction")) return (index * 15) % 360;
  if (variable.includes("gust")) return 30 + 10 * wave;
  if (variable.includes("wind")) return 15 + 8 * wave;
  if (variable === "precipitation" || variable === "rain") return index % 7 === 0 ? 1.2 : 0;
  if (variable === "weather_code") return index % 7 === 0 ? 61 : 3;
  if (variable.includes("pressure")) return 1013;
  if (variable === "freezing_level_height") return 2500;
  if (variable.includes("cloud_cover")) return Math.round(50 + 40 * wave);
  if (variable === "precipitation_probability") return (index * 9) % 100;
  return 0;
}

/** Options of the fake forecast. */
export interface FakeForecastOptions {
  /** Hours cut off the end of every answer: each model's series ends that much before its requested horizon. */
  cutHours?: number;
  /** Own values of single variables by hour index (e.g. snowfall), instead of the built-in ones. */
  values?: Readonly<Record<string, (index: number) => number>>;
  /** Time the answers start from (ms), instead of the current hour; for pictures that must not change (REQ-566). */
  now?: number;
}

/** Answers one forecast request of the page with the fake data. */
export async function fakeForecast(route: Route, options: FakeForecastOptions = {}) {
  const params = new URL(route.request().url()).searchParams;
  if (params.has("daily")) {
    return route.fulfill({ json: { timezone: "GMT", daily: { time: [], sunrise: [], sunset: [] } } });
  }
  const variables = (params.get("hourly") ?? "").split(",").filter(Boolean);
  const past = Number(params.get("past_hours") ?? 0);
  const ahead = Number(params.get("forecast_hours") ?? 24);
  const nowHour = Math.floor((options.now ?? Date.now()) / HOUR_MS) * HOUR_MS;
  const length = Math.max(0, past + ahead - (options.cutHours ?? 0));
  const times = Array.from({ length }, (_, i) => nowHour + (i - past) * HOUR_MS);
  const hourly: Record<string, unknown> = { time: times.map(gmt) };
  const units: Record<string, string> = {};
  for (const variable of variables) {
    const own = options.values?.[variable];
    hourly[variable] = times.map((_, i) => (own ? own(i) : value(variable, i)));
    units[variable] = unit(variable);
  }
  return route.fulfill({ json: { timezone: "GMT", hourly, hourly_units: units } });
}

/** Routes every Open-Meteo forecast request of the page to the fake; returns the forecast requests seen. */
export async function mockOpenMeteo(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    requests.push(route.request().url());
    return fakeForecast(route);
  });
  await page.route("https://api.open-meteo.com/data/**", (route) => route.fulfill({ json: {} }));
  await page.route("https://single-runs-api.open-meteo.com/**", (route) =>
    route.fulfill({ json: { timezone: "GMT", hourly: { time: [] } } }),
  );
  return requests;
}
