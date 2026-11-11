// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Loading message (REQ-737): "Loading forecast…" stands once on the page, in the day slider's box, with a turning
 * refresh symbol before it; the meteogram below has no second message. A reload from the desktop's refresh button
 * (REQ-637) shows the same box over the days, so nothing moves. With `prefers-reduced-motion` the symbol stands still.
 * The pull to refresh on a phone shows the same box: meteogram-pull-refresh.spec.ts.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

test.use({ timezoneId: "UTC" });

let errors: string[] = [];
/** While set, forecast answers wait for it. */
let hold: Promise<void> | null = null;
let release: () => void = () => {};

/** Lets Open-Meteo's answers wait until `release()`. */
function holdAnswers() {
  hold = new Promise((resolve) => (release = resolve));
}

test.beforeEach(async ({ page }) => {
  errors = [];
  hold = null;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    if (hold) await hold;
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  release();
  expect(errors).toEqual([]);
});

const message = (page: Page) => page.getByTestId("forecast-loading");
const icon = (page: Page) => message(page).locator(".day-slider__loading-icon");
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** How the symbol moves: its animation and its transform. */
const motion = (page: Page) =>
  icon(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, transform: style.transform };
  });

/** The one message in the day slider, the symbol right before the text on its line, none in the meteogram. */
async function expectOneMessage(page: Page) {
  await expect(page.getByText("Loading forecast…")).toHaveCount(1);
  await expect(message(page)).toHaveText("Loading forecast…");
  await expect(page.locator('[data-region="day-slider"]').getByTestId("forecast-loading")).toHaveCount(1);
  await expect(page.locator('[data-region="meteogram"]').getByText("Loading forecast…")).toHaveCount(0);
  await expect(icon(page)).toBeVisible();
  const symbol = (await icon(page).boundingBox())!;
  const text = await message(page).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.lastChild!);
    const box = range.getBoundingClientRect();
    return { x: box.x, y: box.y, height: box.height };
  });
  expect(symbol.x + symbol.width).toBeLessThanOrEqual(text.x);
  expect(Math.abs(symbol.y + symbol.height / 2 - (text.y + text.height / 2))).toBeLessThan(2);
}

for (const [device, use] of [
  ["desktop", { viewport: { width: 1280, height: 900 } }],
  ["phone", PHONE],
] as const) {
  test.describe(device, () => {
    test.use(use);
    ownDevice();

    test("the first load's message stands once, in the top box with a turning symbol", async ({ page }) => {
      holdAnswers();
      await page.goto(APP);
      await expectOneMessage(page);
      await expect(page.getByTestId("day-slider-empty")).toBeVisible();
      await page.waitForTimeout(600);
      await expectOneMessage(page);
      expect((await motion(page)).animation).toBe("day-slider-loading-turn");
      // Animations stand still in the picture.
      await expect(page.locator('[data-region="day-slider"]')).toHaveScreenshot(`loading-first-${device}.png`, {
        maxDiffPixelRatio: 0.01,
      });
      release();
      await expect(chart(page)).toBeVisible();
      await expect(message(page)).toHaveCount(0);
      await expect(page.getByText("Loading forecast…")).toHaveCount(0);
    });

    test("with prefers-reduced-motion the symbol stands still", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      holdAnswers();
      await page.goto(APP);
      await expectOneMessage(page);
      expect(await motion(page)).toEqual({ animation: "none", transform: "none" });
      // Still after a while.
      await page.waitForTimeout(300);
      expect(await motion(page)).toEqual({ animation: "none", transform: "none" });
    });
  });
}

test.describe("desktop reload", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("the refresh button's reload shows the same box over the days; nothing moves (REQ-637)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const box = page.getByTestId("day-slider-loading");
    await expect(box).toBeHidden();
    const slider = (await page.locator('[data-region="day-slider"]').boundingBox())!;
    const chartTop = (await page.getByTestId("meteogram-scroll").boundingBox())!.y;

    holdAnswers();
    await page.getByRole("button", { name: "Reload the forecast" }).click();
    await expectOneMessage(page);
    await expect(box).toBeVisible();
    expect((await motion(page)).animation).toBe("day-slider-loading-turn");
    // Over the strip of days, inside the slider, which keeps its size; the chart keeps its place.
    const covered = (await box.boundingBox())!;
    const strip = (await page.getByTestId("day-slider-track").boundingBox())!;
    expect(covered.y).toBeGreaterThanOrEqual(slider.y);
    expect(covered.y + covered.height).toBeLessThanOrEqual(slider.y + slider.height + 0.5);
    expect(covered.x).toBeCloseTo(strip.x, 0);
    expect(covered.width).toBeCloseTo(strip.width, 0);
    expect(await page.locator('[data-region="day-slider"]').boundingBox()).toEqual(slider);
    expect((await page.getByTestId("meteogram-scroll").boundingBox())!.y).toBe(chartTop);
    // Also once the load takes a while: no second message over the chart (REQ-497's delay is 400 ms).
    await page.waitForTimeout(600);
    await expectOneMessage(page);
    await expect(page.locator(".meteogram__status")).toHaveCount(0);
    await expect(page.locator('[data-region="day-slider"]')).toHaveScreenshot("loading-reload-desktop.png", {
      maxDiffPixelRatio: 0.01,
    });

    // Turned off with prefers-reduced-motion.
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await motion(page)).toEqual({ animation: "none", transform: "none" });

    release();
    await expect(message(page)).toHaveCount(0);
    await expect(box).toBeHidden();
    expect((await page.getByTestId("meteogram-scroll").boundingBox())!.y).toBe(chartTop);
  });
});
