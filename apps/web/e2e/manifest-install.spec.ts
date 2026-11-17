// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Description and screenshots of the web app manifest (REQ-807), in every device class. Edge and Chrome build their
 * install dialog from the manifest; without a description and screenshots Edge showed only name, icon and general
 * points about apps. The manifest of the page now has a description and screenshots, wide for the desktop and narrow
 * for phones, and every screenshot loads as a PNG of the size the manifest gives. The page itself shows and loads none
 * of them: it stays as it was.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 3 November 2026, 12:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 12);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Screenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: string;
  label: string;
}

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The manifest the page links, and its URL. */
async function pageManifest(page: Page) {
  const url = await page.locator('link[rel="manifest"]').evaluate((link) => (link as HTMLLinkElement).href);
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  return { url, manifest: await response.json() };
}

test("the manifest has a description and screenshots for the install dialog of Edge and Chrome (REQ-807)", async ({
  page,
  deviceClass,
}) => {
  await page.goto(APP);
  const { manifest } = await pageManifest(page);
  expect(manifest.lang).toBe("en");
  expect(manifest.description).toMatch(/^Weather forecasts as meteograms\. .*history.*offline/);
  const screenshots = manifest.screenshots as Screenshot[];
  const forms = screenshots.map((shot) => shot.form_factor);
  // The desktop dialog takes the wide ones, Chrome on Android the narrow ones.
  expect(forms).toContain(deviceClass === "phone" ? "narrow" : "wide");
  expect([...forms].sort()).toEqual(["narrow", "wide"]);
  for (const shot of screenshots) {
    expect(shot.type).toBe("image/png");
    expect(shot.label).not.toBe("");
  }
});

test("every screenshot of the manifest loads as a PNG of the size the manifest gives (REQ-807)", async ({ page }) => {
  await page.goto(APP);
  const { url, manifest } = await pageManifest(page);
  for (const { src, sizes } of manifest.screenshots as Screenshot[]) {
    const address = new URL(src, url).href;
    expect(address.startsWith(`${APP}app-screenshots/`), address).toBe(true);
    const response = await page.request.get(address);
    expect(response.status(), address).toBe(200);
    expect(response.headers()["content-type"], address).toBe("image/png");
    const body = await response.body();
    expect([...body.subarray(0, 8)], address).toEqual(PNG_SIGNATURE);
    expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`, address).toBe(sizes);
  }
});

test("the page itself neither shows nor loads the screenshots (REQ-807)", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("app-screenshots/")) requested.push(request.url());
  });
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requested).toEqual([]);
  expect(await page.locator('[src*="app-screenshots"], [href*="app-screenshots"]').count()).toBe(0);
});
