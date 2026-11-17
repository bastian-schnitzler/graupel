// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * App icon and logo on the built site, in every device class (REQ-777, REQ-779). Version 0.4.0 kept them in icons/,
 * which Apache maps to its own symbols (Alias /icons/): on the domains the iPhone's "Add to Home Screen" showed a
 * letter instead of the app icon and the About tab a broken logo. The site now keeps them in app-icons/; the last
 * test answers every request to /icons/ with 404, as the hoster's Apache does.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 3 November 2026, 12:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 12);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

/** URLs of the apple-touch-icon, the favicons and the manifest's icons, as the page names them. */
async function iconUrls(page: Page) {
  const links = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((elements) => elements.map((link) => [link.getAttribute("rel"), (link as HTMLLinkElement).href]));
  const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((link) => (link as HTMLLinkElement).href);
  const manifest = await (await page.request.get(manifestUrl)).json();
  const fromManifest = (manifest.icons as { src: string }[]).map((icon) => new URL(icon.src, manifestUrl).href);
  return { links: links as [string, string][], fromManifest };
}

/** Opens Info › About and returns the logo. */
async function openAboutLogo(page: Page) {
  await (await headerControl(page, "button", "Info")).click();
  const dialog = page.getByRole("dialog", { name: "Information" });
  await expect(dialog.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
  const logo = dialog.getByRole("img", { name: "Graupel logo" });
  await expect(logo).toBeVisible();
  return logo;
}

test("apple-touch-icon and the manifest's icons answer 200 with a PNG (REQ-777)", async ({ page }) => {
  await page.goto(APP);
  const { links, fromManifest } = await iconUrls(page);
  const touch = links.filter(([rel]) => rel === "apple-touch-icon").map(([, href]) => href);
  expect(touch).toEqual([`${APP}app-icons/apple-touch-icon.png`]);
  expect(fromManifest).toHaveLength(4);
  const pngs = [...touch, ...links.filter(([, href]) => href.endsWith(".png")).map(([, href]) => href), ...fromManifest];
  for (const url of new Set(pngs)) {
    const response = await page.request.get(url);
    expect(response.status(), url).toBe(200);
    expect(response.headers()["content-type"], url).toBe("image/png");
    expect([...(await response.body()).subarray(0, 8)], url).toEqual(PNG_SIGNATURE);
  }
});

test("Info › About shows the logo (REQ-779)", async ({ page }) => {
  await page.goto(APP);
  const logo = await openAboutLogo(page);
  await expect(logo).toHaveAttribute("src", "./app-icons/logo-192.png");
  // The image may still be loading alongside the model data.
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const response = await page.request.get(new URL("app-icons/logo-192.png", APP).href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("icons and logo load where the server keeps /icons/ for itself, like Apache (REQ-777, REQ-779)", async ({
  page,
}) => {
  const aliased: string[] = [];
  await page.route(/^http:\/\/localhost:4175\/icons\//, (route) => {
    aliased.push(route.request().url());
    return route.fulfill({ status: 404, contentType: "text/html", body: "<h1>Not Found</h1>" });
  });
  await page.goto(APP);
  const logo = await openAboutLogo(page);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  // Fetched by the page, through the same 404 for /icons/, as a home screen or an install prompt would ask for them.
  const { links, fromManifest } = await iconUrls(page);
  const statuses = await page.evaluate(
    (urls) => Promise.all(urls.map(async (url) => [url, (await fetch(url)).status] as const)),
    [...links.map(([, href]) => href), ...fromManifest],
  );
  for (const [url, status] of statuses) expect(status, url).toBe(200);
  expect(aliased).toEqual([]);
});
