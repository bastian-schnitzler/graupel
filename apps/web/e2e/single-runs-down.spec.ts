// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A disrupted Single Runs API does not hold up the forecast (REQ-634, from DL-S2, REQ-633): while it answers 503, the
 * chart appears as soon as the forecast is there, instead of after almost a minute of retries, and the model headers
 * show no run changes. As in model-header-runs.spec.ts every model names a run 6 hours old in its `meta.json`, so the
 * website asks the Single Runs API for the older runs.
 */
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const HOUR_MS = 3_600_000;
/** Time the chart may take; the retries of the Single Runs API took about 50 s before. */
const PROMPT_MS = 8_000;

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The browser reports each 503 of the Single Runs API itself; that is the case under test.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');

const newestRunMs = () => Math.floor((Date.now() - 6 * HOUR_MS) / (6 * HOUR_MS)) * 6 * HOUR_MS;

function fakeMeta(route: Route) {
  if (route.request().url().includes("ensemble")) return route.fulfill({ json: {} });
  const init = newestRunMs();
  return route.fulfill({
    json: {
      last_run_initialisation_time: init / 1000,
      last_run_availability_time: init / 1000 + 3 * 3600,
      data_end_time: (Math.floor(Date.now() / HOUR_MS) * HOUR_MS + 24 * HOUR_MS) / 1000,
      update_interval_seconds: 6 * 3600,
      temporal_resolution_seconds: 3600,
    },
  });
}

test("the Single Runs API answering 503: the chart appears at once, the model headers without run changes", async ({
  page,
}) => {
  const singleRuns: string[] = [];
  // Registered after the fixture's routes, so these answer first.
  await page.route("https://api.open-meteo.com/data/**", fakeMeta);
  await page.route("https://single-runs-api.open-meteo.com/**", (route) => {
    singleRuns.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: true, reason: "The service is overloaded" } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const start = Date.now();
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible({ timeout: PROMPT_MS });
  const labels = meteogram(page).locator('[data-testid="model-header-label"]');
  await expect(labels.first()).toBeVisible({ timeout: PROMPT_MS });
  expect(Date.now() - start).toBeLessThan(PROMPT_MS);
  // The website did ask for the older runs, and got no answer.
  expect(singleRuns.length).toBeGreaterThan(0);
  // No run in any header: one part per model, named without its run.
  for (const text of await labels.allTextContents()) expect(text).not.toMatch(/\d\d\/\d\dZ\d\d/);
  // No error card: the forecast loaded.
  await expect(page.getByTestId("error-card")).toHaveCount(0);
});
