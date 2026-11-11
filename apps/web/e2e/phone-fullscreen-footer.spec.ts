// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The row below the chart in the phone's full-screen view (REQ-587): place with elevation and time, graupel.eu and the
 * data source stand in the size of the temperature extremes in the chart as they show on screen, measured on opening
 * and on a new screen size; the lines shrink with the text, the chart takes the height and the view still fits the
 * screen without scroll bars (REQ-530). On the desktop's full-screen view and in the embedded chart the row stays at
 * 11 px.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";

/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
const PORTRAIT = { width: 375, height: 812 };
const LANDSCAPE = { width: 844, height: 390 };

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const embedded = (page: Page) => page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });

/** Changes the viewport and waits two rendering steps, in which the page sees the new size (as in the view's tests). */
async function resize(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await expect
    .poll(() =>
      page.evaluate(
        (query) =>
          new Promise<boolean>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(matchMedia(query).matches))),
          ),
        PHONE_LANDSCAPE,
      ),
    )
    .toBe(size.width > size.height);
}

/**
 * The full-screen view's row below the chart and the chart: the row's font size and line height, the temperature
 * extremes' size on screen (their `font-size` in viewBox units, scaled by the chart's height), where row, chart and
 * chart wrapper stand, and what in the row or the view does not fit its box.
 */
function measure(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("dialog.meteogram-fullscreen")!;
    const svg = dialog.querySelector<SVGSVGElement>("svg.meteogram-svg-integrated")!;
    const extremes = [...svg.querySelectorAll<SVGTextElement>(".daily-temp-extremes text")];
    const chart = svg.getBoundingClientRect();
    const scale = chart.height / svg.viewBox.baseVal.height;
    const row = dialog.querySelector<HTMLElement>('[data-testid="meteogram-footer-row"]')!;
    const style = getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const wrapper = dialog.querySelector(".meteogram-fullscreen__scroll")!.getBoundingClientRect();
    const cut = [row, ...row.querySelectorAll<HTMLElement>("*")]
      .filter((element) => element.scrollWidth > element.clientWidth + 0.5 && element.clientWidth > 0)
      .map((element) => element.className || element.tagName);
    const scrolling = [document.scrollingElement!, dialog, dialog.querySelector(".dialog__body")!]
      .filter((element) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
      .map((element) => element.className || element.tagName);
    return {
      extremes: extremes.map((text) => Number(text.getAttribute("font-size")) * scale),
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      row: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height },
      chart: { top: chart.top, bottom: chart.bottom, height: chart.height },
      wrapper: { top: wrapper.top, bottom: wrapper.bottom },
      text: row.innerText,
      cut,
      scrolling,
      property: document.documentElement.style.getPropertyValue("--meteogram-extremes-font-size"),
    };
  });
}

/** Font size and line height of the row below a chart. */
/**
 * Size of the row below the chart. The embedded chart draws itself anew once the legend card has taken its room above it
 * (REQ-639), so callers poll it until the row stays.
 */
const rowSize = (page: Page, scope: "embedded" | "fullscreen") =>
  page
    .locator(scope === "embedded" ? '[data-testid="meteogram-scroll"]' : "dialog.meteogram-fullscreen")
    .getByTestId("meteogram-footer-row")
    .evaluate((row) => {
      const style = getComputedStyle(row);
      return { fontSize: style.fontSize, lineHeight: style.lineHeight };
    });

const ELEVEN = { fontSize: "11px", lineHeight: "14px" };

/** Checks the open phone view: the row as large as the extremes, everything in its box, the chart over the rest. */
async function expectRowLikeExtremes(page: Page, screen: { width: number; height: number }) {
  // Measured after the chart drew itself; the size settles after a frame or two.
  await expect
    .poll(async () => {
      const { extremes, fontSize } = await measure(page);
      return extremes.length > 0 && extremes.every((size) => Math.abs(size - fontSize) <= 0.5);
    })
    .toBe(true);
  const view = await measure(page);
  // All extremes have one size, well below the 11 px of the row elsewhere.
  expect(Math.max(...view.extremes) - Math.min(...view.extremes)).toBeLessThan(0.01);
  expect(view.fontSize).toBeLessThan(9);
  expect(view.property).toBe(`${view.fontSize}px`);
  // The lines shrink with the text, in the row's own proportion.
  expect(Math.abs(view.lineHeight - (view.fontSize * 14) / 11)).toBeLessThanOrEqual(0.05);
  // The row is one line and its padding (2 px above, 3 px below), lower than the 14 px lines and padding elsewhere.
  expect(view.row.height).toBeLessThanOrEqual(view.lineHeight + 5 + 0.5);
  expect(view.row.height).toBeLessThan(14 + 5 - 3);
  // Nothing overflows: the place, graupel.eu and the source stand in full on one line, inside the screen.
  expect(view.text).toMatch(/^.+, \d+ m \(.+\)[\s\S]*Weather data by Open-Meteo\.com$/);
  expect(view.cut).toEqual([]);
  expect(view.row.left).toBeGreaterThanOrEqual(0);
  expect(view.row.right).toBeLessThanOrEqual(screen.width + 0.5);
  expect(view.row.bottom).toBeLessThanOrEqual(screen.height);
  // The chart takes the rest of the height, down to the row; nothing scrolls (REQ-530).
  expect(Math.abs(view.chart.top - view.wrapper.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(view.chart.bottom - view.row.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(view.row.bottom - view.wrapper.bottom)).toBeLessThanOrEqual(1);
  expect(view.scrolling).toEqual([]);
  return view;
}

test.describe("phone", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  ownDevice();

  test("in the full-screen view the row below the chart is as large as the temperature extremes, also at a new screen size (REQ-587)", async ({
    page,
  }) => {
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    // The embedded chart's row keeps its size.
    await expect.poll(() => rowSize(page, "embedded")).toEqual(ELEVEN);

    await resize(page, LANDSCAPE);
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    const first = await expectRowLikeExtremes(page, LANDSCAPE);

    // A smaller screen in landscape: measured again, the row follows the smaller extremes.
    const smaller = { width: 740, height: 340 };
    await resize(page, smaller);
    await expect(fullscreen(page)).toBeVisible();
    const second = await expectRowLikeExtremes(page, smaller);
    expect(second.fontSize).toBeLessThan(first.fontSize);

    // Turned back the view closes; the embedded chart's row is as it was and the size is gone from the page.
    await resize(page, PORTRAIT);
    await expect(fullscreen(page)).toHaveCount(0);
    await expect.poll(() => rowSize(page, "embedded")).toEqual(ELEVEN);
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("--meteogram-extremes-font-size")),
    ).toBe("");
  });
});

test("desktop: the full-screen view and the embedded chart keep the row at 11 px (REQ-587 is for phones)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(APP);
  await expect(embedded(page)).toBeVisible();
  await expect.poll(() => rowSize(page, "embedded")).toEqual(ELEVEN);
  await embedded(page).dblclick();
  await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
  // A few frames, in which a phone's view would have measured the chart.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
  );
  expect(await rowSize(page, "fullscreen")).toEqual(ELEVEN);
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue("--meteogram-extremes-font-size")),
  ).toBe("");
});
