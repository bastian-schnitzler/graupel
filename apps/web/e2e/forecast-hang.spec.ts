// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-861: the forecast does not stay at "Loading forecast…" until another place is chosen. On a phone, a tablet
 * (upright and turned) and a desktop, at the place the page opened with:
 * - Open-Meteo answers the models' requests with 429 ("Too many concurrent requests") while the cloud requests hang:
 *   the error card names too many concurrent requests within a few seconds (OVERLOAD_GRACE_MS), not after the time
 *   limit of the hung requests; "Try again" stands below "No forecast available." and loads the forecast.
 * - The forecast requests never answer: after the time limit of a load (LOAD_TIMEOUT_MS, the page's clock moved on)
 *   the error card says Open-Meteo did not answer in time, the loading message is gone, and "Try again" loads.
 * Every forecast request is for that one place.
 */
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
/** Time limit of a load (LOAD_TIMEOUT_MS in src/state/forecast.ts). */
const LOAD_TIMEOUT_MS = 45_000;
/** How long a load may run on after a 429 (OVERLOAD_GRACE_MS), and some room for the page to show the card. */
const OVERLOAD_WAIT_MS = 5_000 + 5_000;

type Behaviour = "answer" | "429" | "hang";

/**
 * Routes the forecast requests: `behaviour` decides per request until `recover()`, then all get the fake forecast.
 * A hanging request is held without an answer. Returns the URLs of all forecast requests.
 */
async function routeForecast(page: Page, behaviour: (url: string) => Behaviour) {
  let failing = true;
  const urls: string[] = [];
  const held: Route[] = [];
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const url = route.request().url();
    urls.push(url);
    const kind = failing ? behaviour(url) : "answer";
    if (kind === "429") {
      return route.fulfill({ status: 429, json: { error: true, reason: "Too many concurrent requests" } });
    }
    if (kind === "hang") {
      held.push(route);
      return;
    }
    return fakeForecast(route, { now: FIXED_NOW });
  });
  return {
    urls,
    held,
    recover: () => {
      failing = false;
    },
  };
}

const search = (page: Page) =>
  page.locator('[data-region="location"]').getByRole("combobox", { name: "Search for a place" });
const card = (page: Page) => page.getByTestId("error-card");
const empty = (page: Page) => page.getByTestId("day-slider-empty");
const retry = (page: Page) => page.getByTestId("forecast-error").getByRole("button", { name: "Try again" });
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const latitude = (url: string) => new URL(url).searchParams.get("latitude");

/** The error state: the card with `reason`, "No forecast available.", "Try again", no loading, the same place. */
async function expectError(page: Page, reason: string, place: string, timeout?: number) {
  await expect(card(page).locator(".error-card__text")).toHaveText("The forecast could not be loaded.", { timeout });
  await expect(card(page).getByTestId("error-card-detail")).toHaveText(reason);
  await expect(empty(page)).toHaveText("No forecast available.");
  await expect(retry(page)).toBeVisible();
  await expect(page.locator('[data-region="meteogram"]')).toHaveAttribute("aria-busy", "false");
  await expect(search(page)).toHaveValue(place);
}

/** "Try again" loads the forecast of the same place; card and button go. */
async function expectRetryLoads(page: Page, urls: string[]) {
  const before = urls.length;
  await retry(page).click();
  await expect(chart(page)).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("forecast-error")).toHaveCount(0);
  expect(urls.length).toBeGreaterThan(before);
  expect(new Set(urls.map(latitude)).size).toBe(1);
}

test.use({ locale: "en-GB", timezoneId: "UTC" });

test("429 while the cloud requests hang: the error comes at once at the same place and 'Try again' loads (REQ-861)", async ({
  page,
}) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const forecast = await routeForecast(page, (url) => (url.includes("geopotential_height") ? "hang" : "429"));
  await page.goto(APP);
  await expect(empty(page)).toHaveText("Loading forecast…");
  const place = await search(page).inputValue();
  expect(place).not.toBe("");
  await expectError(
    page,
    "Open-Meteo is receiving too many concurrent requests. Please try again in a moment.",
    place,
    OVERLOAD_WAIT_MS,
  );
  // The cloud requests were really held, and every request was for the one place.
  expect(forecast.held.length).toBeGreaterThan(0);
  expect(new Set(forecast.urls.map(latitude)).size).toBe(1);

  forecast.recover();
  await expectRetryLoads(page, forecast.urls);
});

test("forecast requests that never answer: after the time limit the error and 'Try again', which loads (REQ-861)", async ({
  page,
}) => {
  await page.clock.install({ time: FIXED_NOW });
  const forecast = await routeForecast(page, () => "hang");
  await page.goto(APP);
  await expect(empty(page)).toHaveText("Loading forecast…");
  await expect.poll(() => forecast.held.length).toBeGreaterThan(0);
  const place = await search(page).inputValue();
  // Still loading shortly before the time limit, no card yet.
  await page.clock.fastForward(LOAD_TIMEOUT_MS - 5_000);
  await expect(empty(page)).toHaveText("Loading forecast…");
  await expect(card(page)).toHaveCount(0);
  await page.clock.fastForward(5_000);
  await expectError(page, "Open-Meteo did not answer in time. Please try again in a moment.", place);
  expect(new Set(forecast.urls.map(latitude)).size).toBe(1);

  forecast.recover();
  await expectRetryLoads(page, forecast.urls);
});
