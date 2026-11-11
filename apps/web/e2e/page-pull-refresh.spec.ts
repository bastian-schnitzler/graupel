// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pull to refresh on the whole page (REQ-750): on a phone and a tablet, pulling the page down at its top, from the
 * header (the place row) or the day slider, loads the forecast anew as pulling the meteogram does (REQ-638): released
 * after about 64 px one reload with the day slider's box saying "Loading forecast…" with the turning symbol (REQ-737);
 * a shorter pull does nothing. A pull on the meteogram reloads once, as before; a sideways swipe over the days pulls
 * nothing; an open menu or dialog and the tablet's full-screen meteogram are not pulled. The desktop has the refresh button
 * instead (REQ-637).
 */
import { expect, onlyIn, test, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";
import { Finger } from "./touch.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);

test.use({ timezoneId: "UTC" });
onlyIn(["phone", "tablet"], "pull to refresh is a touch gesture of the phone's design; the desktop has a button");

let errors: string[] = [];

/** Forecast requests to Open-Meteo, and while set, a promise their answers wait for. */
let api: { forecasts: string[]; hold: Promise<void> | null };

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  api = { forecasts: [], hold: null };
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    api.forecasts.push(route.request().url());
    if (api.hold) await api.hold;
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const card = (page: Page) => page.getByTestId("meteogram-card");
/** The day slider's box over the days: the refresh symbol while pulling, the message while it loads (REQ-737). */
const box = (page: Page) => page.getByTestId("day-slider-loading");
const icon = (page: Page) => box(page).locator(".day-slider__loading-icon");

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect.poll(() => api.forecasts.length).toBeGreaterThan(0);
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

type Start = "header" | "slider" | "chart";

/** Where a pull starts: the header bar or, on a phone, the place row at the top; a day of the slider; the chart. */
async function point(page: Page, where: Start): Promise<[number, number]> {
  const header = page.locator('[data-region="header"]');
  const top = (await header.isVisible()) ? header : page.locator('[data-region="location"]');
  const element =
    where === "header"
      ? top
      : where === "slider"
        ? page.getByTestId("day-slider-track").locator(".day-card").nth(1)
        : page.getByTestId("meteogram-scroll");
  const area = (await element.boundingBox())!;
  // The header's left edge, clear of its buttons; the middle of a day; the chart's temperature area.
  if (where === "header") return [Math.round(area.x + 4), Math.round(area.y + area.height / 2)];
  if (where === "slider") return [Math.round(area.x + area.width / 2), Math.round(area.y + area.height / 2)];
  return [Math.round(area.x + area.width * 0.4), Math.round(area.y + area.height * 0.3)];
}

/** Pulls straight down by `distance` px from `where` and releases. */
async function pull(page: Page, where: Start | [number, number], distance: number) {
  const [x, y] = typeof where === "string" ? await point(page, where) : where;
  const finger = await Finger.down(page, x, y);
  await finger.move(0, distance);
  return finger;
}

/** Waits a moment and returns how many forecast requests were made since `first`. */
async function newRequests(page: Page, first: number) {
  await page.waitForTimeout(600);
  return api.forecasts.length - first;
}

test.describe("pull to refresh on the whole page (REQ-750)", () => {
  for (const where of ["header", "slider"] as const) {
    test(`a pull of 80 px at the top of the page, over the ${where}, reloads the forecast`, async ({ page }) => {
      await open(page);
      const first = api.forecasts.length;
      const finger = await pull(page, where, 80);
      // As on the chart: the box shows the symbol, the chart follows the finger, the browser does not pull itself.
      await expect(card(page)).toHaveAttribute("data-pull", "ready");
      await expect(box(page)).toBeVisible();
      await expect(icon(page)).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("none");
      let release: () => void = () => {};
      api.hold = new Promise((resolve) => (release = resolve));
      await finger.up();

      // The box says "Loading forecast…" with the turning symbol while the forecast loads anew (REQ-737).
      await expect(page.getByTestId("forecast-loading")).toHaveText("Loading forecast…");
      await expect(box(page)).toHaveAttribute("data-loading", "");
      await expect(icon(page)).toBeVisible();
      expect(await icon(page).evaluate((element) => getComputedStyle(element).animationName)).toBe(
        "day-slider-loading-turn",
      );
      await expect(card(page)).not.toHaveAttribute("data-pull");
      api.hold = null;
      release();
      await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
      // One reload: the requests of the first load (one per model of the chain) once more, not twice.
      expect(await newRequests(page, first)).toBe(first);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }

  test("a pull of 30 px does nothing", async ({ page }) => {
    await open(page);
    const first = api.forecasts.length;
    for (const where of ["header", "slider"] as const) {
      const finger = await pull(page, where, 30);
      await expect(card(page)).toHaveAttribute("data-pull", "pulling");
      await finger.up();
      await expect(card(page)).not.toHaveAttribute("data-pull");
    }
    expect(await newRequests(page, first)).toBe(0);
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
    await expect(box(page)).toBeHidden();
  });

  test("a pull on the meteogram reloads once, as before (REQ-638)", async ({ page }) => {
    await open(page);
    const first = api.forecasts.length;
    const finger = await pull(page, "chart", 100);
    await expect(card(page)).toHaveAttribute("data-pull", "ready");
    await finger.up();
    await expect.poll(() => api.forecasts.length).toBeGreaterThan(first);
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
    expect(await newRequests(page, first)).toBe(first);
  });

  test("a sideways swipe over the days pulls nothing", async ({ page }) => {
    await open(page);
    const first = api.forecasts.length;
    const [x, y] = await point(page, "slider");
    const finger = await Finger.down(page, x, y);
    await finger.move(120, 20);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    await finger.up();
    expect(await newRequests(page, first)).toBe(0);
  });

  test("not with a menu or a dialog open", async ({ page }) => {
    await open(page);
    const first = api.forecasts.length;
    // The favourites' menu in the place row.
    await page.getByRole("button", { name: "Show favourites" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    let finger = await pull(page, "slider", 100);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    await finger.up();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    // The settings: neither over the dialog nor at the page's top beside it.
    await (await headerControl(page, "button", "Settings")).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const area = (await dialog.boundingBox())!;
    finger = await pull(page, [Math.round(area.x + area.width / 2), Math.round(area.y + 20)], 100);
    expect(await card(page).getAttribute("data-pull")).toBeNull();
    await finger.up();
    expect(await newRequests(page, first)).toBe(0);
  });
});

test.describe("tablet: full-screen meteogram (REQ-750)", () => {
  onlyIn("tablet", "the phone opens the full-screen view by turning");

  test("a pull in the full-screen view reloads nothing", async ({ page }) => {
    await open(page);
    const first = api.forecasts.length;
    await page.getByTestId("meteogram-fullscreen-open").click();
    const view = page.getByTestId("meteogram-fullscreen");
    await expect(view).toBeVisible();
    const area = (await view.boundingBox())!;
    // At the view's top and over its chart.
    for (const y of [area.y + 30, area.y + area.height / 3]) {
      const finger = await pull(page, [Math.round(area.x + area.width / 2), Math.round(y)], 100);
      await finger.up();
    }
    expect(await page.evaluate(() => document.documentElement.dataset.meteogramPull)).toBeUndefined();
    expect(await newRequests(page, first)).toBe(0);
  });
});
