// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The page reaches the screen's edges (REQ-618): its viewport meta tag has viewport-fit=cover, so Safari on the iPhone
 * no longer keeps the whole page out of the camera's area in landscape and reports the safe-area insets. Chromium
 * reports none of its own; here it is given them (`Emulation.setSafeAreaInsetsOverride`), 47 px at both sides as iOS
 * reports the camera's inset in landscape. On a phone in landscape the page keeps clear of the camera itself: place
 * row, day slider, model chains, meteogram card and footer stand where they stood on a screen narrower by the insets,
 * as Safari showed the page before; menu, settings, map and the model chain's info popover as well. The full-screen
 * meteogram reaches the camera on its side and the screen's edge on the other (REQ-606). In portrait the installed app
 * starts below the status bar and ends above the home indicator with the page's margins as before (REQ-586); Safari
 * keeps its room below the footer as it was, without the home indicator's inset on top (REQ-581, REQ-614).
 */
import { expect, IPHONE_SAFARI, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** The camera's inset iOS reports at both sides in landscape (iPhone, iOS 26). */
const CAMERA = 47;
const LANDSCAPE = { width: 844, height: 390 };
/** The screen beside the camera at both sides, as Safari laid out the page before (viewport-fit auto). */
const BESIDE_CAMERA = { width: LANDSCAPE.width - 2 * CAMERA, height: LANDSCAPE.height };
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test.use({ isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC", userAgent: IPHONE_SAFARI });
ownDevice();

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const box = async (locator: Locator) => (await locator.boundingBox())!;

interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Gives the page the screen's safe-area insets, as Safari reports them with viewport-fit=cover. */
async function setInsets(page: Page, insets: Insets) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
  await cdp.detach();
  // Two rendering steps, so the layout follows.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Starts the page with the weather chain shown (the stored choice of an earlier visit, as in model-chain.spec.ts). */
async function showChain(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("graupel.showWeatherChain", "true"));
}

/**
 * Opens the page on a phone in landscape and closes the full-screen view the turn opens (Escape), so the page shows.
 * A view closed in landscape stays closed until the next turn (REQ-454).
 */
async function openLandscapePage(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(APP);
  await expect(fullscreen(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fullscreen(page)).toHaveCount(0);
  await expect(chart(page)).toBeVisible();
}

/** The page's parts in landscape: their left and right edges on screen. */
const PARTS = {
  "place row": ".location__bar",
  "day slider": '[data-region="day-slider"]',
  "model chain": '[data-region="model-chain"]',
  "meteogram card": '[data-testid="meteogram-card"]',
  footer: '[data-region="footer"]',
  "footer buttons": ".meteogram-actions--footer",
} as const;

async function partEdges(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const entries = await Promise.all(
    Object.entries(PARTS).map(async ([name, selector]) => {
      const { x, width } = await box(page.locator(selector).first());
      return [name, { left: x, right: x + width }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<keyof typeof PARTS, { left: number; right: number }>;
}

test("the viewport meta tag lets the page reach the screen's edges (viewport-fit=cover)", async ({ page }) => {
  await page.goto(APP);
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  const entries = content!.split(",").map((entry) => entry.trim());
  expect(entries).toEqual(expect.arrayContaining(["width=device-width", "initial-scale=1.0", "viewport-fit=cover"]));
});

test("in landscape the page keeps clear of the camera at both sides, as Safari showed it before (REQ-618)", async ({
  page,
}) => {
  await showChain(page);
  // Before: Safari laid the page out beside the camera, on a screen narrower by the insets, which reported none.
  await openLandscapePage(page, BESIDE_CAMERA);
  const before = await partEdges(page);
  await page.screenshot({ path: test.info().outputPath("before.png") });

  // Now: the whole screen, with the insets reported.
  await setInsets(page, { left: CAMERA, right: CAMERA });
  await page.setViewportSize(LANDSCAPE);
  await expect(fullscreen(page)).toHaveCount(0);
  await expect
    .poll(async () => (await box(page.locator(".app"))).width)
    .toBe(LANDSCAPE.width);
  const after = await partEdges(page);
  await page.screenshot({ path: test.info().outputPath("after.png") });
  for (const name of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
    // Clear of the camera, with the page's own margin inside, exactly where it stood before.
    expect(after[name].left, name).toBeGreaterThan(CAMERA);
    expect(after[name].right, name).toBeLessThan(LANDSCAPE.width - CAMERA);
    expect(Math.abs(after[name].left - (before[name].left + CAMERA)), name).toBeLessThan(0.5);
    expect(Math.abs(after[name].right - (before[name].right + CAMERA)), name).toBeLessThan(0.5);
  }
  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(LANDSCAPE.width);
});

test("in landscape menu, popups, map and the model info keep clear of the camera (REQ-618)", async ({ page }) => {
  // No network for the map (as in map-picker.spec.ts): OpenTopoMap tiles are a transparent pixel.
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
  await showChain(page);
  await openLandscapePage(page, LANDSCAPE);
  await setInsets(page, { left: CAMERA, right: CAMERA });
  const within = async (locator: Locator, margin = 0) => {
    const { x, width } = await box(locator);
    expect(x).toBeGreaterThanOrEqual(CAMERA + margin - 0.5);
    expect(x + width).toBeLessThanOrEqual(LANDSCAPE.width - CAMERA - margin + 0.5);
    return { x, width };
  };

  // The menu at the end of the place row.
  const menuButton = page.locator('[data-region="location"]').getByRole("button", { name: "Menu" });
  await menuButton.tap();
  const panel = page.getByTestId("phone-menu-panel");
  await expect(panel).toBeVisible();
  await within(panel);

  // The settings, centred with the popup's margin beside the camera.
  await panel.getByRole("button", { name: "Settings" }).tap();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await within(settings, 16);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  // The info, and over it the wider popup with the third-party licenses, which the screen's width limits.
  await menuButton.tap();
  await panel.getByRole("button", { name: "Info" }).tap();
  const about = page.getByRole("dialog", { name: "Information" });
  await expect(about).toBeVisible();
  await within(about, 16);
  await about.getByRole("button", { name: "Third-party licenses" }).tap();
  const licenses = page.getByRole("dialog", { name: "Third-party licenses" });
  await expect(licenses.getByTestId("third-party-licenses")).toBeVisible();
  expect(await within(licenses, 16)).toEqual({ x: CAMERA + 16, width: LANDSCAPE.width - 2 * (CAMERA + 16) });
  await page.keyboard.press("Escape");
  await expect(licenses).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);

  // On a narrower screen, where its width limits the settings too.
  await page.setViewportSize({ width: 700, height: LANDSCAPE.height });
  await menuButton.tap();
  await panel.getByRole("button", { name: "Settings" }).tap();
  await expect(settings).toBeVisible();
  const narrow = await box(settings);
  expect(narrow).toMatchObject({ x: CAMERA + 16, width: 700 - 2 * (CAMERA + 16) });
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await page.setViewportSize(LANDSCAPE);

  // The map with its buttons beside the camera, as wide as the screen there.
  await page.getByRole("button", { name: "Map", exact: true }).tap();
  const map = page.getByRole("dialog", { name: "Map" });
  await expect(map).toBeVisible();
  expect(await within(map.locator(".map-dialog__map"))).toEqual({ x: CAMERA, width: LANDSCAPE.width - 2 * CAMERA });
  await within(map.getByRole("button", { name: "OK" }));
  await within(map.getByRole("button", { name: "Cancel" }));
  await page.screenshot({ path: test.info().outputPath("map.png") });
  await map.getByRole("button", { name: "Cancel" }).tap();
  await expect(map).toHaveCount(0);

  // The info popover of the chain's last card, shifted to stay on screen, stops at the camera.
  const info = page.locator('[data-region="model-chain"]').getByRole("button", { name: /^Details for / }).last();
  await info.tap();
  const popover = page.getByTestId("model-info-popover");
  await expect(popover).toBeVisible();
  await within(popover, 8);
});

test("the full-screen view reaches the camera on its side and the screen's edge on the other (REQ-606)", async ({
  page,
}) => {
  // The phone turned to the left (90°): the camera at the left (as in meteogram-fullscreen.spec.ts).
  await page.addInitScript(() => {
    Object.defineProperty(ScreenOrientation.prototype, "angle", { configurable: true, get: () => 90 });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await setInsets(page, { left: CAMERA, right: CAMERA });
  await page.setViewportSize(LANDSCAPE);
  const dialog = fullscreen(page);
  await expect(dialog).toHaveClass(/meteogram-fullscreen--camera-left/);
  const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
  await expect(big).toBeVisible();
  // The view covers the whole screen, the page's margins beside the camera do not apply to it.
  expect(await box(dialog)).toMatchObject({ x: 0, width: LANDSCAPE.width });
  await expect
    .poll(async () => {
      const { x, width } = await box(big);
      return { left: Math.round(x), right: Math.round(LANDSCAPE.width - x - width) };
    })
    .toEqual({ left: CAMERA, right: 0 });
  await page.screenshot({ path: test.info().outputPath("fullscreen.png") });
});

/** The page's top and bottom margin, the place row's top and the footer's bottom, the screen's and the page's height. */
const portrait = (page: Page) =>
  page.evaluate(() => {
    const inner = getComputedStyle(document.querySelector(".app__inner")!);
    const footer = document.querySelector<HTMLElement>('[data-region="footer"]')!;
    return {
      top: inner.paddingTop,
      bottom: inner.paddingBottom,
      room: getComputedStyle(footer).paddingBottom,
      row: document.querySelector(".location__bar")!.getBoundingClientRect().top + window.scrollY,
      footerBottom: footer.getBoundingClientRect().bottom + window.scrollY,
      screen: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });

/** Measures once the chart's height has not changed for a few frames (it takes the room the page leaves, REQ-608). */
async function settled(page: Page) {
  let last = -1;
  await expect
    .poll(async () => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const now = (await box(chart(page))).height;
      const steady = Math.abs(now - last) < 0.5;
      last = now;
      return steady;
    })
    .toBe(true);
  return portrait(page);
}

/** Status bar and home indicator of an iPhone in portrait, where the installed app reaches under them. */
const STATUS_BAR = 47;
const HOME_INDICATOR = 34;
/**
 * Fixed time: Monday, 2 November 2026, 18:00 UTC. The chart's height depends on the hour; at this one the page without
 * insets ends at its content, exactly at the screen's bottom, so only its padding grows with the insets and the chart
 * has to follow that (REQ-635).
 */
const INSETS_NOW = Date.UTC(2026, 10, 2, 18);

test.describe("portrait", () => {
  test.use({ viewport: { width: 390, height: 740 } });
  ownDevice();

  test("the installed app starts below the status bar and ends above the home indicator, margins as before", async ({
    page,
  }) => {
    await page.clock.setFixedTime(INSETS_NOW);
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: INSETS_NOW }));
    await page.addInitScript(() =>
      Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true }),
    );
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    // Without insets as before (REQ-586): 12 px above the place row, the page ends with the footer's row.
    const plain = await settled(page);
    expect(plain).toMatchObject({ top: "12px", bottom: "0px", room: "0px" });
    expect(Math.abs(plain.row - 12)).toBeLessThan(0.5);
    expect(plain.scrollHeight).toBeLessThanOrEqual(plain.screen);

    // Reaching under status bar and home indicator: the same margins below and above them; the page still fits, the
    // chart takes the room left.
    await setInsets(page, { top: STATUS_BAR, bottom: HOME_INDICATOR });
    const covered = await settled(page);
    expect(covered).toMatchObject({ top: `${STATUS_BAR + 12}px`, bottom: `${HOME_INDICATOR}px`, room: "0px" });
    expect(Math.abs(covered.row - (STATUS_BAR + 12))).toBeLessThan(0.5);
    expect(covered.scrollHeight).toBeLessThanOrEqual(covered.screen);
    expect(covered.footerBottom).toBeLessThanOrEqual(covered.screen - HOME_INDICATOR + 0.5);
    expect(covered.footerBottom).toBeGreaterThan(covered.screen - HOME_INDICATOR - 2);
    await page.screenshot({ path: test.info().outputPath("installed.png") });
  });

  test("in Safari the room below the footer stays as it was, the home indicator's inset not on top", async ({
    page,
  }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const plain = await settled(page);
    await setInsets(page, { bottom: HOME_INDICATOR });
    const covered = await settled(page);
    // The place row at the page's top edge (REQ-586); where the page fits, no room below the footer (REQ-614).
    for (const measured of [plain, covered]) {
      expect(measured).toMatchObject({ top: "0px", bottom: "0px", room: "0px" });
      expect(measured.row).toBeLessThanOrEqual(1);
      expect(measured.scrollHeight).toBeLessThanOrEqual(measured.screen);
    }
    expect(covered.footerBottom).toBeCloseTo(plain.footerBottom, 0);

    // Where the page scrolls (model chains on a low screen) the bar's room, 80 px as before.
    await showChain(page);
    await page.addInitScript(() => window.localStorage.setItem("graupel.showCloudChain", "true"));
    await page.setViewportSize({ width: 390, height: 560 });
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await setInsets(page, { bottom: HOME_INDICATOR });
    const scrolling = await settled(page);
    expect(scrolling).toMatchObject({ top: "0px", bottom: "0px", room: "80px" });
  });
});
