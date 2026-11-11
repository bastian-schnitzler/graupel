// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Compact axis labels on a small chart (REQ-694, option `axisLabels.compact` of the library, REQ-696): where the
 * embedded chart on a phone held upright gets areas too low for the two-line labels (value, unit below), each axis
 * writes its unit once, below its drawing area, and its maximum and minimum stand in the area's upper and lower corner,
 * 1 px off its edges, the temperature's minimum included. Large charts keep their labels: the same phone with room for
 * the areas' full height, the full-screen view and the desktop. No two axis labels overlap.
 */
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { axisLabelAreas, expectAxisLabelsApart, leftExtremes, type AxisArea } from "./phoneLayout.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
/** An iPhone 13 with Safari's bars: the chart's areas get lower so the page fits the screen (REQ-608). */
const SMALL = { width: 390, height: 664 };
/** The same phone with room for the areas' full height. */
const TALL = { width: 390, height: 1400 };
/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";

let errors: string[] = [];

test.use({ timezoneId: "UTC", locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const fullscreenChart = (page: Page) =>
  page.getByRole("dialog", { name: "Meteogram (full screen)" }).locator('svg[data-render-mode="fullscreen"]');
const frames = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** Opens the page and waits until the chart keeps its height on two rendering steps in a row. */
async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  let previous = -1;
  await expect
    .poll(async () => {
      await frames(page);
      const height = await chart(page).evaluate((svg) => svg.getBoundingClientRect().height);
      const steady = height === previous;
      previous = height;
      return steady;
    })
    .toBe(true);
}

const byId = (areas: AxisArea[], id: string) => areas.find((area) => area.id === id)!;
const labelOf = (area: AxisArea, testid: string) => area.labels.find((label) => label.testid === testid);
const maxOf = (area: AxisArea) => leftExtremes(area).max!;
const minOf = (area: AxisArea) => leftExtremes(area).min!;

/** Labels as the non-compact narrow chart writes them: precipitation and wind with the unit below, no unit row. */
function expectTwoLineLabels(areas: AxisArea[]) {
  for (const area of areas) expect(area.labels.filter((label) => /-unit$/.test(label.testid))).toEqual([]);
  expect(maxOf(byId(areas, "precip"))!.lines).toEqual([expect.stringMatching(/^\d+(\.\d+)?$/), "mm"]);
  expect(minOf(byId(areas, "precip"))!.lines).toEqual(["0", "mm"]);
  expect(maxOf(byId(areas, "wind"))!.lines).toEqual([expect.stringMatching(/^\d+$/), "km/h"]);
}

test.describe("phone (REQ-694)", () => {
  test.use({ isMobile: true, hasTouch: true, userAgent: IPHONE_SAFARI, deviceScaleFactor: 3, viewport: SMALL });
  ownDevice();

  test("a small chart: the unit once below each area, maximum and minimum in its corners, nothing overlapping", async ({
    page,
  }, testInfo) => {
    await open(page);
    const areas = await axisLabelAreas(chart(page));
    expect(areas.map((area) => area.id)).toEqual(["temp", "precip", "wind"]);
    for (const area of areas) {
      const max = maxOf(area);
      const min = minOf(area);
      // Top edge of the maximum's digits 1 px below the area's top, the minimum standing 1 px above its bottom.
      expect(Math.abs(max.top - (area.top + 1)), `${area.id} maximum`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(min.bottom - (area.bottom - 1)), `${area.id} minimum`).toBeLessThanOrEqual(0.5);
      // One line each, values without unit.
      for (const label of [max, min]) expect(label.lines).toHaveLength(1);
    }
    // The temperature keeps its degree sign at each value and writes no unit below its area.
    const temp = byId(areas, "temp");
    expect(maxOf(temp)!.lines[0]).toMatch(/^-?\d+°$/);
    expect(minOf(temp)!.lines[0]).toMatch(/^-?\d+°$/);
    expect(labelOf(temp, "axis-unit")).toBeUndefined();
    // Precipitation and wind: the unit once, below the area (top of its letters 1 px below the area's bottom).
    for (const [id, unit] of [
      ["precip", "mm"],
      ["wind", "km/h"],
    ] as const) {
      const area = byId(areas, id);
      expect(maxOf(area)!.lines[0]).toMatch(/^\d+(\.\d+)?$/);
      expect(minOf(area)!.lines).toEqual(["0"]);
      const units = area.labels.filter((label) => label.testid === "axis-unit");
      expect(units.map((label) => label.lines)).toEqual([[unit]]);
      expect(Math.abs(units[0]!.top - (area.bottom + 1)), `${id} unit`).toBeLessThanOrEqual(0.5);
      expect(area.labels.filter((label) => label.lines.includes(unit) && label.testid !== "axis-unit")).toEqual([]);
    }
    // The cloud altitudes keep their unit, in their line, so they do not overlap in the low cloud area.
    const altitudes = byId(areas, "precip").labels.filter((label) => label.testid.startsWith("cloud-altitude-label-"));
    expect(altitudes.length).toBeGreaterThanOrEqual(3);
    for (const label of altitudes) expect(label.lines).toEqual([expect.stringMatching(/^\d+ km$/)]);
    await expectAxisLabelsApart(chart(page));
    await page.screenshot({ path: testInfo.outputPath("compact-390x664.png") });
  });

  test("the same phone with room for the areas' full height keeps the two-line labels", async ({ page }) => {
    await page.setViewportSize(TALL);
    await open(page);
    const areas = await axisLabelAreas(chart(page));
    expectTwoLineLabels(areas);
    await expectAxisLabelsApart(chart(page));
  });

  test("turned, the full-screen view keeps the two-line labels", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 844, height: 340 });
    await expect.poll(() => page.evaluate((query) => matchMedia(query).matches, PHONE_LANDSCAPE)).toBe(true);
    await expect(fullscreenChart(page)).toBeVisible();
    await frames(page);
    const areas = await axisLabelAreas(fullscreenChart(page));
    expectTwoLineLabels(areas);
    await expectAxisLabelsApart(fullscreenChart(page));
  });
});

test("desktop: labels beside the plot with the unit in the same line, as before", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const areas = await axisLabelAreas(chart(page));
  for (const area of areas) expect(area.labels.filter((label) => /-unit$/.test(label.testid))).toEqual([]);
  expect(maxOf(byId(areas, "precip"))!.lines).toEqual([expect.stringMatching(/^\d+(\.\d+)? mm$/)]);
  expect(minOf(byId(areas, "wind"))!.lines).toEqual(["0 km/h"]);
  await expectAxisLabelsApart(chart(page));
});
