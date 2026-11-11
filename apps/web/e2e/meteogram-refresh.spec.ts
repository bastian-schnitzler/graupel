// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Refresh button of the meteogram on the desktop (REQ-637): in the card's button column between "save as" and full
 * screen, with tooltip and name in every language. A click loads the forecast of the place completely anew from
 * Open-Meteo, past the page's memory and the browser's HTTP cache (every request with `cache: "reload"`), shows
 * the message of the first load meanwhile (in the day slider's box over the days, REQ-737) and then the new data; place,
 * model chain and day selection stay. Not on a phone, where pulling the chart down reloads (REQ-638).
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const LANGUAGES = ["en", "de", "fr", "it", "sl", "cs", "nl", "da"] as const;
const text = (language: string, key: string) =>
  (JSON.parse(readFileSync(new URL(`../src/i18n/${language}.json`, import.meta.url), "utf8")) as Record<string, string>)[
    key
  ]!;

test.use({ timezoneId: "UTC" });

let errors: string[] = [];

/** What Open-Meteo was asked, and what it answers: the temperature runs around `base` (°C). */
interface FakeApi {
  forecasts: string[];
  metas: string[];
  base: number;
  /** While set, forecast answers wait for it. */
  hold: Promise<void> | null;
}

let api: FakeApi;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  api = { forecasts: [], metas: [], base: 4, hold: null };
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    api.forecasts.push(route.request().url());
    const base = api.base;
    if (api.hold) await api.hold;
    return fakeForecast(route, {
      now: FIXED_NOW,
      values: { temperature_2m: (index) => Math.round((base + 6 * Math.sin(index / 5)) * 10) / 10 },
    });
  });
  await page.route("https://api.open-meteo.com/data/**", (route) => {
    api.metas.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  // The cache mode of every request to Open-Meteo, as the page asks the browser (Chromium does not show the headers
  // it adds for it to an intercepted request).
  await page.addInitScript(() => {
    const modes: [string, string | null][] = [];
    Object.assign(window, { cacheModes: modes });
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://api.open-meteo.com/")) modes.push([url, init?.cache ?? null]);
      return original(input, init);
    };
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** The daily highs and lows the chart writes, e.g. "10°C". */
const extremes = (page: Page) =>
  chart(page)
    .locator(".daily-temp-extremes text")
    .evaluateAll((texts) => texts.map((element) => element.textContent ?? ""));

async function marker(page: Page): Promise<[number, number]> {
  const element = page.getByTestId("day-slider-marker");
  return [Number(await element.getAttribute("data-start")), Number(await element.getAttribute("data-end"))];
}

async function visibleRange(page: Page) {
  const svg = chart(page);
  return [await svg.getAttribute("data-visible-start-time"), await svg.getAttribute("data-visible-end-time")];
}

/** The models of the forecast requests, sorted (the chain the page asked for). */
const models = (urls: readonly string[]) => urls.map((url) => new URL(url).searchParams.get("models") ?? "").sort();

/** Cache mode of each request to Open-Meteo, in order. */
const cacheModes = (page: Page) =>
  page.evaluate(() => (window as unknown as { cacheModes: [string, string | null][] }).cacheModes.map(([, mode]) => mode));

async function open(page: Page, language = "en") {
  await page.addInitScript((value) => window.localStorage.setItem("graupel.language", value), language);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

test("the button stands between save and full screen and loads the forecast anew past every cache", async ({ page }) => {
  await open(page);
  const tools = page.getByTestId("meteogram-tools");
  await expect(tools.getByRole("button")).toHaveCount(4);
  const names = await tools.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label")),
  );
  expect(names).toEqual([
    "Copy the meteogram as a picture",
    "Save the picture to the photos",
    "Reload the forecast",
    "Show the meteogram full screen",
  ]);
  // In the column the button stands below "save as" and above full screen.
  const save = (await page.getByTestId("meteogram-save").boundingBox())!;
  const refresh = (await page.getByTestId("meteogram-refresh").boundingBox())!;
  const fullscreen = (await page.getByTestId("meteogram-fullscreen-open").boundingBox())!;
  expect(refresh.y).toBeGreaterThanOrEqual(save.y + save.height);
  expect(fullscreen.y).toBeGreaterThanOrEqual(refresh.y + refresh.height);
  expect(Math.abs(refresh.x - save.x)).toBeLessThan(1);

  // The first load: the temperature reaches 10 °C.
  await expect.poll(() => extremes(page)).toContain("10°C");
  expect(await extremes(page)).not.toContain("20°C");
  const first = [...api.forecasts];
  const firstMetas = api.metas.length;
  expect(first.length).toBeGreaterThan(0);
  expect(firstMetas).toBeGreaterThan(0);
  const firstModes = await cacheModes(page);
  expect(firstModes).toHaveLength(first.length + firstMetas);
  expect(firstModes.every((mode) => mode === null)).toBe(true);

  // Fewer days in the slider (yesterday to tomorrow): the selection stays through the reload.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Digit2");
  await expect.poll(() => marker(page)).toEqual([0, 2]);
  const range = await visibleRange(page);

  // Open-Meteo now has a warmer forecast; its answers wait until the test lets them go.
  api.base = 14;
  let release: () => void = () => {};
  api.hold = new Promise((resolve) => (release = resolve));
  await page.getByRole("button", { name: "Reload the forecast" }).click();

  // Meanwhile the first load's message in the day slider's box (REQ-737); the chart stays.
  const loading = page.getByTestId("forecast-loading");
  await expect(loading).toHaveText("Loading forecast…");
  await expect(chart(page)).toBeVisible();
  // The client asks at most four at a time: the first ones wait.
  await expect.poll(() => api.forecasts.length).toBeGreaterThan(first.length);
  api.hold = null;
  release();
  await expect(loading).toHaveCount(0);

  // Every request again from Open-Meteo, past the HTTP cache, for the same place and chain; the new data shows.
  expect(api.forecasts.length).toBe(2 * first.length);
  const again = api.forecasts.slice(first.length);
  expect(models(again)).toEqual(models(first));
  const point = (url: string) => new URL(url).searchParams.get("latitude") + "," + new URL(url).searchParams.get("longitude");
  expect(again.map(point)).toEqual(first.map(point));
  expect(api.metas.length).toBe(2 * firstMetas);
  expect((await cacheModes(page)).slice(firstModes.length)).toEqual(Array.from(firstModes, () => "reload"));
  await expect.poll(() => extremes(page)).toContain("20°C");
  expect(await extremes(page)).not.toContain("10°C");
  expect(await marker(page)).toEqual([0, 2]);
  expect(await visibleRange(page)).toEqual(range);
  await page.screenshot({ path: test.info().outputPath("refreshed.png") });
});

for (const language of LANGUAGES) {
  test(`${language}: tooltip and name of the button`, async ({ page }) => {
    await open(page, language);
    const name = text(language, "meteogram.refresh");
    expect(name).toBeTruthy();
    if (language !== "en") expect(name).not.toBe(text("en", "meteogram.refresh"));
    const button = page.getByTestId("meteogram-refresh");
    await expect(button).toHaveAttribute("aria-label", name);
    await expect(button).toHaveAttribute("title", name);
  });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  ownDevice();

  test("has no refresh button (pulling the chart down reloads there)", async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByTestId("meteogram-scroll")).toBeVisible();
    await expect(page.getByTestId("meteogram-refresh")).toHaveCount(0);
  });
});
