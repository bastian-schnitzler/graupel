// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A model split into runs gets one header per run; a part too narrow for the name with its run shows only the run,
 * without brackets (REQ-515). The fake Open-Meteo names a run 6 hours old that ends 24 hours ahead in every model's
 * `meta.json`; the Single Runs API answers the older run with data, so every model reaching further is split. A run
 * is written without month (REQ-682): "03 Z06", or the date alone ("02/11", day and month in the order of the page's
 * language) where each run of the model is on a day of its own.
 */
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const HOUR_MS = 3_600_000;

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

/**
 * A run in a header without month (REQ-682, REQ-695): day, space, Z and hour in UTC ("03 Z06"), or the date alone
 * ("02/11") where each run of the model is on a day of its own (REQ-697).
 */
const RUN = /^(\d\d Z\d\d|\d\d\/\d\d)$/;
const RUN_IN_LABEL = /\d\d Z\d\d|\d\d\/\d\d/;

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');

/** Fixed time of the runs (REQ-666): the runs follow from it, so the parts must not depend on the hour of the test run. */
const NOW = Date.UTC(2026, 10, 3, 12);

const newestRunMs = (now: number) => Math.floor((now - 6 * HOUR_MS) / (6 * HOUR_MS)) * 6 * HOUR_MS;

function fakeMeta(route: Route, now: number) {
  if (route.request().url().includes("ensemble")) return route.fulfill({ json: {} });
  const init = newestRunMs(now);
  return route.fulfill({
    json: {
      last_run_initialisation_time: init / 1000,
      last_run_availability_time: init / 1000 + 3 * 3600,
      data_end_time: (Math.floor(now / HOUR_MS) * HOUR_MS + 24 * HOUR_MS) / 1000,
      update_interval_seconds: 6 * 3600,
      temporal_resolution_seconds: 3600,
    },
  });
}

/** A run older than the newest covers everything it is asked for; newer runs have no data yet. */
function fakeSingleRun(route: Route, now: number) {
  const params = new URL(route.request().url()).searchParams;
  const run = Date.parse(`${params.get("run")}Z`);
  const hours = run < newestRunMs(now) ? Number(params.get("forecast_hours") ?? 0) : 0;
  const time = Array.from({ length: hours }, (_, i) => new Date(run + i * HOUR_MS).toISOString().slice(0, 16));
  return route.fulfill({ json: { timezone: "GMT", hourly: { time, temperature_2m: time.map(() => 5) } } });
}

async function openSplit(page: Page, width: number, now = NOW) {
  // Registered after the fixture's routes, so these answer first.
  await page.clock.setFixedTime(now);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now }));
  await page.route("https://api.open-meteo.com/data/**", (route) => fakeMeta(route, now));
  await page.route("https://single-runs-api.open-meteo.com/**", (route) => fakeSingleRun(route, now));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  await expect.poll(() => meteogram(page).locator('[data-testid="model-header-label"]').allTextContents()).toContainEqual(
    expect.stringMatching(RUN_IN_LABEL),
  );
}

interface HeaderPart {
  text: string;
  runOnly: boolean;
  textWidth: number;
  boxWidth: number;
}

function headerParts(page: Page): Promise<HeaderPart[]> {
  return meteogram(page)
    .locator('[data-testid="model-label-segment"]')
    .evaluateAll((groups) =>
      groups.map((group) => {
        const label = group.querySelector('[data-testid="model-header-label"]')!;
        const shape = group.querySelector('[data-testid="model-header-shape"]')!;
        return {
          text: label.textContent ?? "",
          runOnly: label.getAttribute("data-run-only") === "true",
          textWidth: label.getBoundingClientRect().width,
          boxWidth: shape.getBoundingClientRect().width,
        };
      }),
    );
}


test("a narrow run part shows only its run, without brackets", async ({ page }, testInfo) => {
  await openSplit(page, 390);
  const parts = await headerParts(page);
  const runOnly = parts.filter((part) => part.runOnly);
  expect(runOnly.length).toBeGreaterThan(0);
  for (const part of runOnly) expect(part.text).toMatch(RUN);
  // Parts that keep name and run fit their box on screen.
  for (const part of parts.filter((p) => !p.runOnly && p.text.includes("("))) {
    expect(part.textWidth).toBeLessThanOrEqual(part.boxWidth);
  }
  await meteogram(page).screenshot({ path: testInfo.outputPath("model-header-runs-390.png") });
});

test("wide run parts keep name and run", async ({ page }, testInfo) => {
  await openSplit(page, 1600);
  const parts = await headerParts(page);
  // Without a part that keeps name and run there is nothing to check (REQ-666).
  const split = parts.filter((part) => part.text.includes("("));
  for (const part of split) {
    expect(part.text).toMatch(/^.+ \((\d\d Z\d\d|\d\d\/\d\d)\)$/);
    expect(part.textWidth).toBeLessThanOrEqual(part.boxWidth);
  }
  for (const part of parts.filter((p) => p.runOnly)) expect(part.text).toMatch(RUN);
  await meteogram(page).screenshot({ path: testInfo.outputPath("model-header-runs-1600.png") });
});

test.describe("in German (REQ-682)", () => {
  test.use({ locale: "de-DE", timezoneId: "UTC" });

  test("a split model shows its runs without month: day, Z and hour in UTC", async ({ page }, testInfo) => {
    // Runs 00 and 06 UTC of 3 November.
    await openSplit(page, 1600);
    const texts = (await headerParts(page)).map((part) => part.text);
    expect(texts).toContain("AROME HD (03 Z06)");
    expect(texts).toContain("03 Z00");
    for (const text of texts) expect(text).not.toMatch(/\d\d\/\d\dZ|11\//);
    await meteogram(page).screenshot({ path: testInfo.outputPath("model-header-runs-de.png") });
  });

  test("runs on days of their own show their date alone, day before month as in German", async ({ page }) => {
    // Runs 18 UTC of 2 November and 00 UTC of 3 November (REQ-697 of the library, locale of the page).
    await openSplit(page, 1600, Date.UTC(2026, 10, 3, 8));
    const texts = (await headerParts(page)).map((part) => part.text);
    expect(texts).toContain("AROME HD (03/11)");
    expect(texts).toContain("02/11");
  });
});
