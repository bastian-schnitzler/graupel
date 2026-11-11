// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Runtime configuration in a real browser: config.json is fetched next to the page, its switches take
 * effect, and a broken file falls back to the defaults without breaking the page.
 */
import { expect, test } from "./fixtures.ts";

const APP = "http://localhost:4175/";

test("loads the shipped config.json and shows all regions", async ({ page }) => {
  // With the model chain switched on in the settings (hidden by default, then without a card).
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = page.waitForResponse((r) => r.url() === `${APP}config.json`);
  await page.goto(APP);
  expect((await response).status()).toBe(200);
  for (const region of ["model-chain", "day-slider", "meteogram"]) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("switches off model chain and day slider", async ({ page }) => {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { modelChain: false, daySlider: { enabled: false } } }),
  );
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"]')).toBeVisible();
  await expect(page.locator('[data-region="model-chain"]')).toHaveCount(0);
  await expect(page.locator('[data-region="day-slider"]')).toHaveCount(0);
});

test("invalid config: warning in the console, defaults in the page", async ({ page }) => {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/config.json", (route) => route.fulfill({ contentType: "application/json", body: "{ broken" }));
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  });
  await page.goto(APP);
  await expect(page.locator('[data-region="model-chain"]')).toBeVisible();
  await expect(page.locator('[data-region="day-slider"]')).toBeVisible();
  expect(warnings.some((text) => text.includes("config.json"))).toBe(true);
  expect(errors).toEqual([]);
});
