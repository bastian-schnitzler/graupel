// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Installed app on Android without the system's bars (REQ-755, DEC-102): the manifest opens it in fullscreen, so the
 * navigation bar with back, home and recent apps (blue on the Samsung tablet, from the old theme_color) and the status
 * bar are gone; in the browser they stay. Playwright cannot set the display mode, so the installed app is emulated by a
 * matchMedia stand-in for `(display-mode: fullscreen)` (as in install.spec.ts) and Chrome on Android by its user
 * agent, on each project's phone or tablet with its touch screen. The page counts it as the installed app and lays out
 * without bars: nothing wider than the screen, the footer whole above the bottom edge (where the page ends with it,
 * REQ-561), and at that edge only the page's background, no blue, light and dark; with a camera cutout the page keeps
 * clear of it. A desktop browser in fullscreen (F11) is no app.
 */
import { expect, test, type Page, onlyIn } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 11 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 11, 11);
/** Page background (`--color-bg`) per colour scheme, and the blue the bars had before (REQ-750, REQ-755). */
const BACKGROUND = { light: [0xf4, 0xf6, 0xf8], dark: [0x11, 0x16, 0x1c] } as const;
const OLD_BLUE = [0x1f, 0x6f, 0xb2] as const;
/** The page's top margin on phones and tablets (`--space-3`, 0.75rem), below a camera cutout. */
const PAGE_TOP = 12;
/**
 * The strip at the screen's bottom edge that shows only the page's background: phones and tablets end with the footer
 * row (REQ-561), whose buttons keep their 2.5rem touch height with the icons in the middle.
 */
const EDGE = 4;
/** Chrome on an Android phone and on a Samsung tablet (no "Mobile"). */
const ANDROID_UA = {
  phone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile " +
    "Safari/537.36",
  tablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
} as const;
const androidAgent = (deviceClass: string) => ANDROID_UA[deviceClass === "phone" ? "phone" : "tablet"];

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

/** Chrome on Android: its user agent on the project's phone or tablet. */
async function android(page: Page, deviceClass: string) {
  const agent = androidAgent(deviceClass);
  await page.addInitScript((ua) => Object.defineProperty(navigator, "userAgent", { get: () => ua }), agent);
}

/** The installed app in fullscreen: `(display-mode: fullscreen)` matches. */
async function fullscreenApp(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    const matching = (query: string): MediaQueryList =>
      ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never;
    window.matchMedia = (query: string) =>
      query === "(display-mode: fullscreen)" ? matching(query) : original(query);
  });
}

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function load(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

/** Whether the settings show the archive tab, which only the installed app has (REQ-684). */
async function hasArchiveTab(page: Page): Promise<boolean> {
  await (await headerControl(page, "button", "Settings")).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  const count = await dialog.getByRole("tab", { name: "Archive", exact: true }).count();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return count > 0;
}

/** RGB of each pixel in the bottom `height` CSS px of the screen. */
async function bottomPixels(page: Page, height: number): Promise<number[][]> {
  const { width, height: screen } = page.viewportSize()!;
  const shot = await page.screenshot({ clip: { x: 0, y: screen - height, width, height }, scale: "css" });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    const pixels: number[][] = [];
    for (let i = 0; i < rgba.length; i += 4) pixels.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
    return pixels;
  }, shot.toString("base64"));
}

const near = (pixel: number[], colour: readonly number[]) =>
  pixel.every((value, i) => Math.abs(value - colour[i]!) <= 3);

/** Scrolls to the page's end and checks width, footer and bottom edge. */
async function expectLayoutWithoutBars(page: Page, scheme: "light" | "dark") {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const { width, height } = page.viewportSize()!;
  const layout = await page.evaluate(() => {
    const footer = document.querySelector('[data-region="footer"]')!.getBoundingClientRect();
    const items = [...document.querySelectorAll('[data-region="footer"] button, [data-region="footer"] a')].map(
      (item) => item.getBoundingClientRect(),
    );
    return {
      scrollWidth: document.documentElement.scrollWidth,
      footer: { top: footer.top, bottom: footer.bottom, left: footer.left, right: footer.right },
      items: items.filter((box) => box.width > 0).map((box) => ({ top: box.top, bottom: box.bottom })),
    };
  });
  // Nothing wider than the screen.
  expect(layout.scrollWidth).toBeLessThanOrEqual(width);
  expect(layout.footer.left).toBeGreaterThanOrEqual(0);
  expect(layout.footer.right).toBeLessThanOrEqual(width);
  // The footer and each of its buttons whole on the screen.
  expect(layout.footer.top).toBeGreaterThanOrEqual(0);
  expect(layout.footer.bottom).toBeLessThanOrEqual(height + 0.5);
  expect(layout.items.length).toBeGreaterThan(0);
  for (const item of layout.items) {
    expect(item.top).toBeGreaterThanOrEqual(0);
    expect(item.bottom).toBeLessThanOrEqual(height + 0.5);
  }
  // At the bottom edge only the page's background, no blue.
  const pixels = await bottomPixels(page, EDGE);
  expect(pixels.filter((pixel) => near(pixel, OLD_BLUE))).toEqual([]);
  expect(pixels.filter((pixel) => !near(pixel, BACKGROUND[scheme]))).toEqual([]);
}

test.describe("installed app on Android in fullscreen (REQ-755)", () => {
  onlyIn(["phone", "tablet"], "Android opens the installed app in fullscreen; desktops install it as standalone");

  test("counts as the installed app", async ({ page, deviceClass }) => {
    await android(page, deviceClass);
    await fullscreenApp(page);
    await load(page);
    expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(await hasArchiveTab(page)).toBe(true);
    // The place row keeps the page's top margin, as in the installed app below the status bar (REQ-586).
    await expect(page.locator(".app__inner--flush-top")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: no sideways overflow, footer whole above the bottom edge, no blue there`, async ({
      page,
      deviceClass,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await android(page, deviceClass);
    await fullscreenApp(page);
      await load(page);
      await expectLayoutWithoutBars(page, scheme);
    });
  }

  test("keeps clear of a camera cutout at the top edge", async ({ page, deviceClass }) => {
    const cutout = 32;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: cutout } });
    await android(page, deviceClass);
    await fullscreenApp(page);
    await load(page);
    const top = await page.evaluate(() => document.querySelector(".app__top")!.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(cutout + PAGE_TOP - 1);
    await expectLayoutWithoutBars(page, "light");
  });

  test("in the browser it stays the website", async ({ page, deviceClass }) => {
    await android(page, deviceClass);
    await load(page);
    expect(await hasArchiveTab(page)).toBe(false);
  });
});

test.describe("desktop browser in fullscreen (REQ-755)", () => {
  onlyIn("desktop", "F11 fullscreen of a desktop browser, with a mouse; the installed desktop app is standalone");

  test("is the website, not the installed app", async ({ page }) => {
    await fullscreenApp(page);
    await load(page);
    expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(false);
    expect(await hasArchiveTab(page)).toBe(false);
  });
});
