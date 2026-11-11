// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Website or installed app (REQ-425): the download button shows only on the website. Playwright cannot set the
 * display mode, so the installed app is emulated by a matchMedia stand-in and the install prompt by a synthetic
 * `beforeinstallprompt` event.
 */
import { expect, test, type Page, ownDevice, onlyIn } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

test.use({ locale: "en-GB" });

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

/** Fires a fake install prompt; `window.__prompted` counts calls of `prompt()`. */
async function offerInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    const win = window as unknown as { __prompted: number };
    win.__prompted = 0;
    Object.assign(event, {
      prompt: async () => {
        win.__prompted++;
      },
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    window.dispatchEvent(event);
  });
}

const downloadButton = (page: Page) => page.locator('[data-region="header"]').getByRole("button", { name: "Download" });

test("links a web app manifest", async ({ page }) => {
  await page.goto(APP);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await page.request.get(new URL(href ?? "", APP).href);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Graupel",
    start_url: "./",
    // REQ-755: fullscreen on Android (no navigation and status bar), standalone on iPhone, iPad and desktops.
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    // REQ-750: the page's background colour (e2e/page-background.spec.ts), no longer the icons' light blue.
    background_color: "#f4f6f8",
  });
  // REQ-516: app icons for "any" and "maskable" (Android), each on the light blue background.
  expect(manifest.icons.map((icon: { src: string; purpose: string }) => [icon.src, icon.purpose])).toEqual([
    ["icons/icon-192.png", "any"],
    ["icons/icon-512.png", "any"],
    ["icons/icon-192-maskable.png", "maskable"],
    ["icons/icon-512-maskable.png", "maskable"],
  ]);
  for (const icon of manifest.icons as { src: string }[]) {
    const image = await page.request.get(new URL(icon.src, APP).href);
    expect(image.status(), icon.src).toBe(200);
  }
});

test.describe("header bar", () => {
  onlyIn(["desktop", "tablet"], "the header bar's download button; the phone's menu has the entry Install app instead");

  test("website: download button opens the install prompt", async ({ page }) => {
    await page.goto(APP);
    await expect(page.locator('[data-region="header"]').getByRole("button", { name: "Info" })).toBeVisible();
    // Chromium without an install prompt (not installable or already installed): no button.
    await expect(downloadButton(page)).toHaveCount(0);
    await offerInstallPrompt(page);
    await expect(downloadButton(page)).toBeVisible();
    await downloadButton(page).click();
    expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    await expect(downloadButton(page)).toHaveCount(0);

    await offerInstallPrompt(page);
    await expect(downloadButton(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(downloadButton(page)).toHaveCount(0);
  });
});

test("phone: download only as icon right of info, in one row (REQ-501)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(APP);
  await offerInstallPrompt(page);
  const download = downloadButton(page);
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute("title", "Download");
  const info = (await page.locator('[data-region="header"]').getByRole("button", { name: "Info" }).boundingBox())!;
  const box = (await download.boundingBox())!;
  expect(box.width).toBeLessThan(48);
  expect(Math.abs(box.y - info.y)).toBeLessThan(2);
  expect(box.x).toBeGreaterThan(info.x + info.width - 1);
  // No sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test.describe("header bar of the installed app", () => {
  onlyIn(["desktop", "tablet"], "the header bar's download button; the phone's menu has the entry Install app instead");

  test("installed app (standalone): no download button", async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
          : original(query);
    });
    await page.goto(APP);
    await expect(page.locator('[data-region="header"]').getByRole("button", { name: "Info" })).toBeVisible();
    await offerInstallPrompt(page);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(downloadButton(page)).toHaveCount(0);
  });
});

test.describe("Chromium on the desktop without install prompt", () => {
  onlyIn("desktop", "the instructions follow the browser; those of iPhone, iPad and Mac are tested by their user agents below");

  test("browser without install prompt: download button shows instructions", async ({ page }) => {
    await withoutInstallPrompt(page);
    await page.goto(APP);
    await downloadButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Install Graupel as an app" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("This browser cannot install Graupel as an app.", { exact: false })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(downloadButton(page)).toBeFocused();
  });
});

/** Like Safari and Firefox, which do not know beforeinstallprompt. */
async function withoutInstallPrompt(page: Page) {
  await page.addInitScript(() => {
    // Event handler attributes of the global object live on window itself (WebIDL [Global]).
    delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
    delete (Window.prototype as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
  });
}

/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);

/** The install hint of a browser without install prompt, by user agent: only what works on this device (REQ-658). */
async function installHint(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await withoutInstallPrompt(page);
  await page.goto(APP);
  await downloadButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Install Graupel as an app" });
  await expect(dialog).toBeVisible();
  return dialog.locator("[data-platform]");
}

test.describe("install hint on Windows in Firefox (REQ-658)", () => {
  test.use({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    timezoneId: "UTC",
  });
  ownDevice();

  test("names Chrome and Edge, but no iPhone, iPad or Mac", async ({ page }) => {
    const hint = await installHint(page);
    await expect(hint).toHaveAttribute("data-platform", "desktop");
    await expect(hint).toHaveText(
      "This browser cannot install Graupel as an app. Open the page in Chrome or Edge and use “Install” in the address bar or the menu.",
    );
    await expect(hint).not.toContainText(/iPhone|iPad|Mac|Safari/);
  });
});

test.describe("install hint on a Mac in Firefox (REQ-658)", () => {
  test.use({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0",
    timezoneId: "UTC",
  });
  ownDevice();

  test("names Safari's Add to Dock and Chrome or Edge, but no iPhone or iPad", async ({ page }) => {
    const hint = await installHint(page);
    await expect(hint).toHaveAttribute("data-platform", "macosOther");
    await expect(hint).toHaveText(
      "This browser cannot install Graupel as an app. Open the page in Safari and choose File › Add to Dock, or use “Install” in Chrome or Edge.",
    );
    await expect(hint).not.toContainText(/iPhone|iPad|Windows/);
  });
});

test.describe("install hint on the iPhone in Chrome (REQ-658)", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    timezoneId: "UTC",
  });
  ownDevice();

  test("shows Share › Add to Home Screen, no Mac and no other browser to switch to", async ({ page }) => {
    const hint = await installHint(page);
    await expect(hint).toHaveAttribute("data-platform", "ios");
    await expect(hint).toContainText("Add to Home Screen");
    await expect(hint).not.toContainText(/Mac|Windows|Chrome|Edge/);
  });
});
