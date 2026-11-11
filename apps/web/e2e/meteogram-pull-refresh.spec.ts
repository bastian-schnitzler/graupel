// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pull to refresh on a phone in portrait (REQ-638): pulled down at the top of the page, the meteogram follows the
 * finger while the place row and the day slider above stay; the day slider's box shows the refresh symbol instead of
 * an arrow over the chart (REQ-737). Released after about 64 px the forecast of the place loads completely anew from
 * Open-Meteo (every request with `cache: "reload"`, as the desktop's refresh button, REQ-637); the chart goes straight
 * back to its place and the box says "Loading forecast…" with the turning symbol meanwhile (REQ-737). A shorter pull
 * does nothing; sideways scrolling of the chart, a diagonal swipe and two fingers stay as they were, and
 * the browser's own pull to refresh is off on the chart (the moves are cancelled, `overscroll-behavior` of the page).
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { Finger } from "./touch.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);

test.use({ timezoneId: "UTC" });

let errors: string[] = [];

/** What Open-Meteo was asked, and what it answers: the temperature runs around `base` (°C). */
interface FakeApi {
  forecasts: string[];
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
  api = { forecasts: [], base: 4, hold: null };
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
  // The cache mode of every request to Open-Meteo, and whether the page cancelled the moves of a finger.
  await page.addInitScript(() => {
    const modes: (string | null)[] = [];
    const moves: boolean[] = [];
    Object.assign(window, { cacheModes: modes, touchMoves: moves });
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://api.open-meteo.com/")) modes.push(init?.cache ?? null);
      return original(input, init);
    };
    window.addEventListener("touchmove", (event) => moves.push(event.defaultPrevented));
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const scroll = (page: Page) => page.getByTestId("meteogram-scroll");
const card = (page: Page) => page.getByTestId("meteogram-card");
/** The day slider's box over the days: the refresh symbol while pulling, the message while it loads (REQ-737). */
const box = (page: Page) => page.getByTestId("day-slider-loading");
const icon = (page: Page) => box(page).locator(".day-slider__loading-icon");

/** The daily highs and lows the chart writes, e.g. "10°C". */
const extremes = (page: Page) =>
  chart(page)
    .locator(".daily-temp-extremes text")
    .evaluateAll((texts) => texts.map((element) => element.textContent ?? ""));

const cacheModes = (page: Page) => page.evaluate(() => (window as unknown as { cacheModes: (string | null)[] }).cacheModes);
const touchMoves = (page: Page) => page.evaluate(() => (window as unknown as { touchMoves: boolean[] }).touchMoves);

/** Top edges on screen of the place row, the day slider and the chart (CSS px). */
const tops = (page: Page) =>
  page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return {
      location: top('[data-region="location"]'),
      slider: top('[data-region="day-slider"]'),
      chart: top('[data-region="meteogram"] svg.meteogram-svg-integrated'),
    };
  });

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect.poll(() => extremes(page)).toContain("10°C");
}

/** A point in the chart's temperature area, left of the middle. */
async function start(page: Page): Promise<[number, number]> {
  const box = (await scroll(page).boundingBox())!;
  return [Math.round(box.x + box.width * 0.4), Math.round(box.y + box.height * 0.3)];
}

test.describe("phone, portrait", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  ownDevice();

  test("a pull past the threshold reloads the forecast; only the chart moves (REQ-638)", async ({ page }) => {
    await open(page);
    const before = await tops(page);
    const first = api.forecasts.length;
    expect(first).toBeGreaterThan(0);
    const firstModes = await cacheModes(page);
    expect(firstModes.every((mode) => mode === null)).toBe(true);
    await expect(box(page)).toBeHidden();
    // No arrow over the chart any more (REQ-737).
    await expect(page.getByTestId("meteogram-pull")).toHaveCount(0);
    const strip = (await page.getByTestId("day-slider-track").locator(".day-card").first().boundingBox())!;

    const [x, y] = await start(page);
    const finger = await Finger.down(page, x, y);
    // Below the threshold: the chart follows (less than the finger); the box shows the symbol, not fully yet.
    await finger.move(0, 40, 8);
    await expect(card(page)).toHaveAttribute("data-pull", "pulling");
    await expect(box(page)).toBeVisible();
    const partly = Number(await box(page).evaluate((element) => getComputedStyle(element).opacity));
    expect(partly).toBeGreaterThan(0.2);
    expect(partly).toBeLessThan(1);
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
    // The browser's own pull to refresh is off while the finger is on the chart.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("none");
    // Past it: the box is fully there; the chart has moved down by 60 % of the finger's way, everything above stays.
    await finger.move(0, 60, 8);
    await expect(card(page)).toHaveAttribute("data-pull", "ready");
    expect(await box(page).evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    const pulled = await tops(page);
    expect(pulled.location).toBe(before.location);
    expect(pulled.slider).toBe(before.slider);
    expect(pulled.chart - before.chart).toBeCloseTo(60, 0);
    // The box lies over the strip of days, where the first load's message stands, not over the chart.
    const covered = (await box(page).boundingBox())!;
    expect(covered.y).toBeCloseTo(strip.y, 0);
    expect(covered.height).toBeCloseTo(strip.height, 0);
    expect(covered.x).toBeLessThan(25);
    expect(covered.x + covered.width).toBeGreaterThan(365);
    expect(covered.y + covered.height).toBeLessThan(before.chart);
    await expect(icon(page)).toBeVisible();
    // Every move of the pull was cancelled: neither the page nor the chart scrolled.
    const moves = await touchMoves(page);
    expect(moves.length).toBeGreaterThan(10);
    expect(moves.slice(1).every(Boolean)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await scroll(page).evaluate((element) => element.scrollLeft)).toBe(0);
    await page.screenshot({ path: test.info().outputPath("pulled.png") });

    // Open-Meteo now has a warmer forecast; its answers wait until the test lets them go.
    api.base = 14;
    let release: () => void = () => {};
    api.hold = new Promise((resolve) => (release = resolve));
    await finger.up();

    // Meanwhile the box says "Loading forecast…" with the turning symbol before it (REQ-737), once on the page; the
    // chart is back where it was before the pull and stays there, nothing else moves.
    const message = page.getByTestId("forecast-loading");
    await expect(message).toHaveText("Loading forecast…");
    await expect(page.getByText("Loading forecast…")).toHaveCount(1);
    await expect(box(page)).toHaveAttribute("data-loading", "");
    expect(await box(page).evaluate((element, text) => element.contains(text), await message.elementHandle())).toBe(true);
    expect(await icon(page).evaluate((element) => getComputedStyle(element).animationName)).toBe("day-slider-loading-turn");
    await expect.poll(() => tops(page)).toEqual(before);
    await expect(card(page)).not.toHaveAttribute("data-pull-settling");
    expect(await tops(page)).toEqual(before);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).not.toBe("none");
    await expect.poll(() => api.forecasts.length).toBeGreaterThan(first);
    // Also once the load takes a while: no second message over the chart (REQ-497's delay is 400 ms).
    await page.waitForTimeout(600);
    await expect(page.getByText("Loading forecast…")).toHaveCount(1);
    await expect(page.locator(".meteogram__status")).toHaveCount(0);
    expect(await tops(page)).toEqual(before);
    await page.screenshot({ path: test.info().outputPath("loading.png") });
    api.hold = null;
    release();

    // Every request again, past the HTTP cache; the new data shows and the chart is back where it was.
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
    await expect(box(page)).not.toHaveAttribute("data-loading");
    expect(api.forecasts.length).toBe(2 * first);
    expect((await cacheModes(page)).slice(firstModes.length)).toEqual(Array.from(firstModes, () => "reload"));
    await expect.poll(() => extremes(page)).toContain("20°C");
    await expect.poll(() => tops(page)).toEqual(before);
    await expect(box(page)).toBeHidden();
  });

  test("a short pull does nothing (REQ-638)", async ({ page }) => {
    await open(page);
    const before = await tops(page);
    const first = api.forecasts.length;
    const [x, y] = await start(page);
    const finger = await Finger.down(page, x, y);
    await finger.move(0, 50);
    await expect(card(page)).toHaveAttribute("data-pull", "pulling");
    expect((await tops(page)).chart - before.chart).toBeCloseTo(30, 0);
    await finger.up();
    await expect(card(page)).not.toHaveAttribute("data-pull");
    await expect.poll(() => tops(page)).toEqual(before);
    await expect(box(page)).toBeHidden();
    await page.waitForTimeout(500);
    expect(api.forecasts.length).toBe(first);
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
    await expect(box(page)).not.toHaveAttribute("data-loading");
  });

  test("a pull back up before the release does nothing (REQ-638)", async ({ page }) => {
    await open(page);
    const first = api.forecasts.length;
    const [x, y] = await start(page);
    const finger = await Finger.down(page, x, y);
    await finger.move(0, 120);
    await expect(card(page)).toHaveAttribute("data-pull", "ready");
    await finger.move(0, -100);
    await expect(card(page)).toHaveAttribute("data-pull", "pulling");
    await finger.up();
    await page.waitForTimeout(500);
    expect(api.forecasts.length).toBe(first);
  });

  test("sideways scrolling of the chart stays; a sideways or diagonal swipe pulls nothing (REQ-638)", async ({
    page,
  }) => {
    await open(page);
    const before = await tops(page);
    const first = api.forecasts.length;
    const [x, y] = await start(page);
    // Straight to the left, as REQ-577's test swipes.
    let finger = await Finger.down(page, x + 60, y);
    await finger.move(-150, 0);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    await finger.up();
    await expect.poll(() => scroll(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(50);
    const left = await scroll(page).evaluate((element) => element.scrollLeft);
    // Mostly to the left and a little down: the chart scrolls on and does not move down.
    finger = await Finger.down(page, x + 60, y);
    await finger.move(-150, 50);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    expect((await tops(page)).chart).toBe(before.chart);
    await finger.up();
    await expect.poll(() => scroll(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(left + 50);
    // The browser was free to scroll: no move was cancelled.
    expect((await touchMoves(page)).some(Boolean)).toBe(false);
    await page.waitForTimeout(500);
    expect(api.forecasts.length).toBe(first);
    expect(await tops(page)).toEqual(before);
  });

  test("two fingers pull nothing (REQ-638)", async ({ page }) => {
    await open(page);
    const before = await tops(page);
    const first = api.forecasts.length;
    const [x, y] = await start(page);
    const fingers = await Finger.down(page, x - 30, y, true);
    await fingers.move(0, 120);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    expect((await tops(page)).chart).toBe(before.chart);
    await fingers.up();
    await page.waitForTimeout(500);
    expect(api.forecasts.length).toBe(first);
  });
});

test.describe("phone, portrait, page scrolled down", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  ownDevice();

  test("a pull only reloads at the top of the page (REQ-638)", async ({ page }) => {
    await open(page);
    // The page fits on the screen (REQ-608); room below it lets it scroll, as where it does not fit.
    await page.addStyleTag({ content: "body::after { content: ''; display: block; height: 400px; }" });
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(40);
    await page.evaluate(() => window.scrollTo(0, 40));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(40);
    const first = api.forecasts.length;
    const [x, y] = await start(page);
    const finger = await Finger.down(page, x, Math.max(y, 100));
    await finger.move(0, 30, 3);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    // The page scrolls back up instead, as before.
    await finger.up();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(40);
    await page.waitForTimeout(500);
    expect(api.forecasts.length).toBe(first);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("has no pull to refresh (the refresh button reloads there, REQ-637)", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("meteogram-pull")).toHaveCount(0);
    await expect(card(page)).not.toHaveClass(/meteogram-card--pull/);
    await expect(page.getByTestId("meteogram-refresh")).toBeVisible();
  });
});
