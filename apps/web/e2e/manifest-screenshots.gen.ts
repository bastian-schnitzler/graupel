// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Makes the screenshots of the web app manifest (REQ-807) in public/app-screenshots/: per language of the domains
 * (SCREENSHOT_LANGUAGES) one "wide" picture of the desktop and one "narrow" of a phone (SCREENSHOTS in
 * scripts/app-manifest.mjs). The page runs as the installed app with fake weather at a fixed time, so the pictures
 * only change when the page does; they are stored with 256 colours (e2e/pngPalette.ts) to stay small. Run with
 * e2e/manifest-screenshots.config.ts (`pnpm screenshots` in apps/web).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SCREENSHOTS, SCREENSHOT_LANGUAGES, screenshotPath } from "../scripts/app-manifest.mjs";
import { fakeForecast } from "./openMeteo.ts";
import { toPalettePng } from "./pngPalette.ts";

const APP = "http://localhost:4175/";
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
/** Fixed time: Tuesday, 3 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 9);
const DAY_MS = 86_400_000;

/** Weather fronts: middle (days from FIXED_NOW), width (days) and strongest precipitation (mm/h). */
const FRONTS = [
  { day: 1.6, width: 0.35, peak: 1.8 },
  { day: 5.4, width: 0.5, peak: 1.1 },
  { day: 9.8, width: 0.3, peak: 2.4 },
  { day: 13.6, width: 0.55, peak: 0.9 },
];

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const round = (value: number, step: number) => Math.round(value / step) * step;
/** Sum of bell curves around the fronts, `stretch` times as wide, `shift` days earlier, each up to `weight(front)`. */
type Front = (typeof FRONTS)[number];
const fronts = (day: number, stretch: number, shift = 0, weight: (front: Front) => number = () => 1) =>
  FRONTS.reduce(
    (sum, front) => sum + weight(front) * Math.exp(-(((day - front.day + shift) / (front.width * stretch)) ** 2) / 2),
    0,
  );

/**
 * Weather that looks real for the pictures (instead of the sine waves of the e2e fake): four fronts with clouds,
 * precipitation and wind, cirrus ahead of them, clear days with a daily cycle of the temperature in between.
 */
function weather(variable: string, time: number): number | undefined {
  const day = (time - FIXED_NOW) / DAY_MS;
  const hour = new Date(time).getUTCHours() + 1; // Central European Time
  const rain = fronts(day, 1, 0, (front) => front.peak);
  const wet = clamp(fronts(day, 1.8));
  const windy = clamp(fronts(day, 2.4));
  const ahead = clamp(fronts(day, 2, 0.7));
  const cloud = clamp(0.15 + 0.85 * wet);
  const temperature =
    1 +
    4 * Math.sin((2 * Math.PI * (day + 1)) / 9) -
    3 * wet +
    4.5 * (1 - 0.6 * cloud) * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  const wind = 8 + 30 * windy + 4 * Math.sin(day * 3.1);
  const precipitation = rain < 0.1 ? 0 : round(rain * (0.75 + 0.25 * Math.sin(time / 3_600_000)), 0.1);
  const level = /^cloud_cover_(\d+)hPa$/.exec(variable);
  if (level) {
    const pressure = Number(level[1]);
    if (pressure >= 700)
      return Math.round(100 * clamp(1.3 * wet - 0.1 + (pressure >= 850 ? 0.15 * Math.cos(day * 5) : 0)));
    if (pressure > 400) return Math.round(100 * clamp(1.1 * clamp(fronts(day, 1.4)) - 0.05));
    return Math.round(80 * clamp(1.2 * ahead - 0.1));
  }
  switch (variable) {
    case "temperature_2m":
      return round(temperature, 0.1);
    case "apparent_temperature":
      return round(temperature - 1 - 0.15 * wind, 0.1);
    case "dew_point_2m":
      return round(temperature - 6 + 5 * wet, 0.1);
    case "precipitation":
      return precipitation;
    case "rain":
      return temperature >= 1 ? precipitation : 0;
    case "snowfall":
      return temperature < 1 ? round(precipitation * 0.7, 0.1) : 0;
    case "showers":
      return 0;
    case "precipitation_probability":
      return Math.round(5 + 90 * wet);
    case "wind_speed_10m":
      return round(wind, 0.1);
    case "wind_gusts_10m":
      return round(wind * 1.6 + 5, 0.1);
    case "wind_direction_10m":
      return Math.round(250 + 50 * Math.sin((2 * Math.PI * day) / 7)) % 360;
    case "cloud_cover":
      return Math.round(100 * cloud);
    case "cloud_cover_low":
      return Math.round(100 * clamp(1.3 * wet - 0.1));
    case "cloud_cover_mid":
      return Math.round(100 * clamp(fronts(day, 1.4)));
    case "cloud_cover_high":
      return Math.round(80 * ahead);
    case "weather_code":
      return precipitation > 0 ? (temperature < 1 ? 73 : 61) : cloud > 0.7 ? 3 : cloud > 0.3 ? 2 : 0;
    case "pressure_msl":
      return round(1022 - 18 * wet, 0.1);
    case "freezing_level_height":
      return Math.round(2200 + 500 * Math.sin((2 * Math.PI * (day + 1)) / 9) - 600 * wet);
    default:
      return undefined;
  }
}

for (const language of SCREENSHOT_LANGUAGES) {
  for (const shot of SCREENSHOTS) {
    test(`${shot.name} screenshot in ${language}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: shot.viewport,
        screen: shot.viewport,
        deviceScaleFactor: shot.scale,
        isMobile: shot.mobile,
        hasTouch: shot.mobile,
        locale: language,
        timezoneId: "Europe/Paris",
        colorScheme: "light",
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(FIXED_NOW);
      // Nothing leaves the page (map tiles, place search), so the picture does not depend on the network; the forecast
      // goes to the fake (the route added later wins).
      await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
      await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
        fakeForecast(route, { now: FIXED_NOW, at: weather }),
      );
      await page.addInitScript(
        (value) => {
          window.localStorage.setItem("graupel.language", value.language);
          // The phone shows the meteogram instead of the legend.
          if (value.mobile) window.localStorage.setItem("graupel.legend", "false");
          // The installed app (as in e2e/install.spec.ts): no download button, no browser bars.
          const original = window.matchMedia.bind(window);
          window.matchMedia = (query: string) =>
            query === "(display-mode: standalone)"
              ? ({
                  ...original(query),
                  media: query,
                  matches: true,
                  addEventListener() {},
                  removeEventListener() {},
                } as never)
              : original(query);
        },
        { language, mobile: shot.mobile },
      );
      await page.goto(APP);
      await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const picture = await page.screenshot({ animations: "disabled" });
      writeFileSync(`${PUBLIC_DIR}${screenshotPath(shot.name, language)}`, toPalettePng(picture));
      await context.close();
    });
  }
}
