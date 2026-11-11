// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's full-screen view in landscape uses the room at its top (REQ-690): no empty strip between the top of the
 * visible area (below Safari's tab bar on the iPhone, below the address bar on Android) and the chart. The chart begins
 * right at the safe area's top (`safe-area-inset-top`, 0 in Chromium) and is that much higher; the model headers, the
 * chart and the row below it stand in full on the screen, nothing scrolls (REQ-530).
 *
 * Chromium knows no browser bars: a visible area lowered by Safari's tab bar or Chrome's address bar is a viewport that
 * much lower, as the page sees it there (the dialog is as high as `100dvh`, which then ends at the area's bottom).
 */
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 9);

/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";

/** Bottom padding of the view below the row under the chart (MeteogramPanel.css, `--space-2`). */
const BOTTOM_PADDING = 8;
/** Room the core leaves above the model headers' boxes: 2 viewBox units, about 1 px at these sizes. */
const TOP_TOLERANCE = 3;

interface Phone {
  name: string;
  userAgent?: string;
  portrait: { width: number; height: number };
  landscape: { width: number; height: number };
}

const PHONES: Phone[] = [
  // iPhone (Safari, iOS 26) without bars: 844 x 390.
  {
    name: "iPhone",
    userAgent: IPHONE_SAFARI,
    portrait: { width: 390, height: 844 },
    landscape: { width: 844, height: 390 },
  },
  // iPhone with Safari's address and tab bars at the top (REQ-690, image): the page shows below them, 280 px high.
  {
    name: "iPhone with tab bar",
    userAgent: IPHONE_SAFARI,
    portrait: { width: 390, height: 844 },
    landscape: { width: 844, height: 280 },
  },
  // Android phone (Chrome, Pixel 7 size) without and with the address bar (56 px) at the top.
  {
    name: "Android",
    portrait: { width: 412, height: 915 },
    landscape: { width: 915, height: 412 },
  },
  {
    name: "Android with address bar",
    portrait: { width: 412, height: 859 },
    landscape: { width: 915, height: 356 },
  },
];

let errors: string[] = [];

test.use({
  timezoneId: "UTC",
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
ownDevice();

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

/** Turns the phone to landscape: the view opens (REQ-454); waits two frames, in which the page sees the new size. */
async function turn(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await expect
    .poll(() =>
      page.evaluate(
        (query) =>
          new Promise<boolean>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(matchMedia(query).matches))),
          ),
        PHONE_LANDSCAPE,
      ),
    )
    .toBe(true);
}

/** Where the view, its chart, the model headers' boxes and the row below the chart stand; what scrolls. */
function measure(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("dialog.meteogram-fullscreen")!;
    const svg = dialog.querySelector<SVGSVGElement>('svg[data-render-mode="fullscreen"]')!;
    const box = (element: Element) => {
      const { top, bottom, left, right, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, height };
    };
    const headers = [...svg.querySelectorAll('[data-testid="model-header-shape"]')].map(box);
    const labels = [...svg.querySelectorAll('[data-testid="model-header-label"]')].map(box);
    const row = dialog.querySelector('[data-testid="meteogram-footer-row"]')!;
    const scrolling = [document.scrollingElement!, dialog, dialog.querySelector(".dialog__body")!]
      .filter((element) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
      .map((element) => element.className || element.tagName);
    return {
      screen: { width: window.innerWidth, height: window.innerHeight },
      dialog: box(dialog),
      chart: box(svg),
      headers,
      labels,
      row: box(row),
      scrolling,
    };
  });
}

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({
      viewport: phone.portrait,
      ...(phone.userAgent ? { userAgent: phone.userAgent } : {}),
    });
    ownDevice();

    test(`in landscape the full-screen view's chart begins at the top of the visible area and takes its height (REQ-690)`, async ({
      page,
    }) => {
      await page.goto(APP);
      await expect(page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated")).toBeVisible();
      await turn(page, phone.landscape);
      const dialog = page.locator("dialog.meteogram-fullscreen");
      await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
      await expect(dialog.locator('[data-testid="model-header-shape"]').first()).toBeVisible();
      // The chart settles once its row below took the size of the extremes (REQ-587).
      let previous = "";
      await expect
        .poll(async () => {
          const next = JSON.stringify(await measure(page));
          const settled = next === previous;
          previous = next;
          return settled;
        })
        .toBe(true);
      const view = await measure(page);
      const { height } = phone.landscape;
      expect(view.screen).toEqual(phone.landscape);

      // The view covers the visible area from its top edge.
      expect(Math.abs(view.dialog.top)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(view.dialog.bottom - height)).toBeLessThanOrEqual(0.5);

      // No strip above the chart: it begins at the top, its model headers at most a few px below it, all in full.
      expect(view.chart.top).toBeGreaterThanOrEqual(0);
      expect(view.chart.top).toBeLessThanOrEqual(0.5);
      expect(view.headers.length).toBeGreaterThan(0);
      for (const header of view.headers) {
        expect(header.top).toBeGreaterThanOrEqual(0);
        expect(header.top).toBeLessThanOrEqual(TOP_TOLERANCE);
      }
      for (const label of view.labels) {
        expect(label.top).toBeGreaterThanOrEqual(0);
        expect(label.height).toBeGreaterThan(0);
      }

      // The chart takes the whole height down to the row below it: higher by the strip that used to stand above it.
      expect(Math.abs(view.chart.bottom - view.row.top)).toBeLessThanOrEqual(1);
      expect(view.chart.height).toBeGreaterThanOrEqual(height - view.row.height - BOTTOM_PADDING - 1);

      // Nothing cut at the bottom and nothing scrolls (REQ-530).
      expect(view.row.bottom).toBeLessThanOrEqual(height - BOTTOM_PADDING + 0.5);
      expect(view.row.height).toBeGreaterThan(0);
      expect(view.scrolling).toEqual([]);
    });
  });
}

test.describe("iPhone with a safe area at the top", () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_SAFARI });
  ownDevice();

  test("the chart begins right at the safe area's top, not further down (REQ-690)", async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated")).toBeVisible();
    // An inset at the top, as a browser reports it that lays the page out under its bar (viewport-fit=cover).
    const inset = 20;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: inset } });
    await cdp.detach();
    await turn(page, { width: 844, height: 390 });
    const dialog = page.locator("dialog.meteogram-fullscreen");
    await expect(dialog.locator('[data-testid="model-header-shape"]').first()).toBeVisible();
    await expect.poll(async () => Math.round((await measure(page)).chart.top)).toBe(inset);
    const view = await measure(page);
    for (const header of view.headers) {
      expect(header.top).toBeGreaterThanOrEqual(inset);
      expect(header.top).toBeLessThanOrEqual(inset + TOP_TOLERANCE);
    }
    expect(view.row.bottom).toBeLessThanOrEqual(390 - BOTTOM_PADDING + 0.5);
    expect(view.scrolling).toEqual([]);
  });
});
