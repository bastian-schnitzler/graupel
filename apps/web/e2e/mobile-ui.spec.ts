// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The website as on an iPhone (REQ-566): Chromium with the iPhone's size, touch and pixel density, so the tests run in
 * the cloud environment too. In the main views nothing reaches beyond the screen's sides, so the page can not be
 * scrolled sideways (Safari shows it shifted then); pictures of the phone view, light and dark, catch unintended moves
 * of edges, slider or meteogram. The pictures use a fixed time and fixed forecast data; after an intended change of the
 * look they are taken again with `pnpm test:e2e --update-snapshots`. Copy and save in the footer row leave the page
 * where it is (REQ-574).
 */
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { expectNoSidewaysOverflow } from "./phoneLayout.ts";

const APP = "http://localhost:4175/";
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
/** Fixed time of the pictures: Friday, 30 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 30, 11);

// Safari on the iPhone, with the room below the footer for its bar (REQ-581, REQ-611).
test.use({
  viewport: PORTRAIT,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: "en-GB",
  userAgent: IPHONE_SAFARI,
});
ownDevice();

test.beforeEach(async ({ page }) => {
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const results = name.startsWith("Inns")
      ? [{ name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, elevation: 574, country: "Austria" }]
      : [];
    return route.fulfill({ json: { results } });
  });
});

async function open(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

test.describe("no sideways overflow on the phone (REQ-566)", () => {
  test("start page with the forecast", async ({ page }) => {
    await open(page);
    await expectNoSidewaysOverflow(page);
  });

  test("in portrait the page does not move sideways: not by a swipe, not by scrolling", async ({ page }) => {
    await open(page);
    const scrolledSideways = () =>
      page.evaluate(() => Math.max(Math.abs(window.scrollX), Math.abs(document.scrollingElement!.scrollLeft)));
    // A finger swipes to the left over the top card, as when the page was pushed out to the left (not over the
    // meteogram or the day slider, which take sideways moves themselves; a swipe to the right is the browser's "back").
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (y: number, from: number, to: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
      for (let step = 1; step <= 10; step++) {
        const x = Math.round(from + ((to - from) * step) / 10);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await page.evaluate(() => window.scrollTo(0, 0));
    const top = (await page.locator('[data-region="location"]').boundingBox())!;
    const y = Math.round(top.y + top.height - 10);
    for (let swipes = 0; swipes < 3; swipes++) await swipe(y, 340, 40);
    expect(await scrolledSideways()).toBe(0);
    await cdp.detach();
    // Nor can a script scroll it sideways.
    await page.evaluate(() => window.scrollBy(200, 0));
    expect(await scrolledSideways()).toBe(0);
  });

  test("place search with suggestions", async ({ page }) => {
    await open(page);
    const region = page.locator('[data-region="location"]');
    await region.getByRole("combobox").fill("Inns");
    await expect(region.getByRole("option")).toHaveCount(1);
    await expectNoSidewaysOverflow(page);
  });

  test("info and settings dialogs", async ({ page }) => {
    await open(page);
    // On the phone both open from the menu at the end of the place row (REQ-575, REQ-580).
    const menu = page.locator('[data-region="location"]').getByRole("button", { name: "Menu" });
    await menu.click();
    await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Info" }).click();
    await expect(page.getByRole("dialog", { name: "Information" })).toBeVisible();
    await expectNoSidewaysOverflow(page);
    await page.keyboard.press("Escape");
    await menu.click();
    await expectNoSidewaysOverflow(page);
    await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expectNoSidewaysOverflow(page);
  });

  // At any time: a sliver of a first or last day no longer gets a label that sticks out (the meteogram's REQ-669, see
  // the test at 03 UTC below), so this test needs no fixed time any more.
  test("full screen in landscape", async ({ page }) => {
    await open(page);
    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => page.evaluate((query) => matchMedia(query).matches, PHONE_LANDSCAPE)).toBe(true);
    await expect(page.getByRole("dialog", { name: "Meteogram (full screen)" })).toBeVisible();
    await expectNoSidewaysOverflow(page);
  });

  // At 03 UTC the last day is a sliver of three hours at the screen's edge, too narrow for its label: the label is left
  // out, the day's cell stays, and no other label leaves the screen or its day (REQ-667 with the meteogram's REQ-669).
  test("full screen in landscape at 03 UTC: no day label outside the screen or its day (REQ-669)", async ({ page }) => {
    const now = Date.UTC(2026, 9, 30, 3);
    await page.clock.setFixedTime(now);
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now }));
    await open(page);
    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => page.evaluate((query) => matchMedia(query).matches, PHONE_LANDSCAPE)).toBe(true);
    const dialog = page.getByRole("dialog", { name: "Meteogram (full screen)" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("text.day-label-text").first()).toBeVisible();
    // Each label with the cell of its day: the cell whose middle is the label's anchor.
    const { width, cells, labels } = await dialog.evaluate((root) => {
      const edges = (element: Element) => {
        const { left, right } = element.getBoundingClientRect();
        return { left, right };
      };
      const cells = [...root.querySelectorAll('rect[data-testid="day-label-cell"]')].map((rect) => ({
        middle: Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2,
        ...edges(rect),
      }));
      return {
        width: document.documentElement.clientWidth,
        cells: cells.map(({ left, right }) => ({ left, right })),
        labels: [...root.querySelectorAll("text.day-label-text")].map((text) => {
          const cell = cells.find(({ middle }) => Math.abs(middle - Number(text.getAttribute("x"))) < 0.01);
          return { text: text.textContent ?? "", ...edges(text), cell: cell && { left: cell.left, right: cell.right } };
        }),
      };
    });
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const { text, left, right, cell } of labels) {
      expect(left, text).toBeGreaterThanOrEqual(-0.5);
      expect(right, text).toBeLessThanOrEqual(width + 0.5);
      expect(cell, text).toBeDefined();
      expect(left, text).toBeGreaterThanOrEqual(cell!.left - 0.5);
      expect(right, text).toBeLessThanOrEqual(cell!.right + 0.5);
    }
    // The sliver of the last day has its cell, but no label.
    const last = cells.reduce((a, b) => (b.left > a.left ? b : a));
    expect(last.right - last.left).toBeLessThan(20);
    expect(labels.some(({ cell }) => cell!.left === last.left)).toBe(false);
    await expectNoSidewaysOverflow(page);
  });
});

test.describe("copy and save at the end of the page (REQ-574)", () => {
  // A lower screen with the model chains shown, so the page scrolls: since REQ-608 the chart takes the height the rest
  // of the page leaves on the screen, at least 40 % of it, and where the page fits Safari keeps no room below the footer
  // (REQ-614).
  test.use({ viewport: { width: 390, height: 560 } });
  ownDevice();

  test("tapping copy or save in the footer row leaves the page where it is", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    // Share sheet stand-in: accepts PNG files and records them.
    await page.addInitScript(() => {
      const shared: string[] = [];
      Object.assign(window, { __shared: shared });
      Object.assign(navigator, {
        canShare: (data?: ShareData) => !!data?.files?.length && data.files.every((file) => file.type === "image/png"),
        share: async (data: ShareData) => {
          for (const file of data.files ?? []) shared.push(file.name);
        },
      });
      window.localStorage.setItem("graupel.showWeatherChain", "true");
      window.localStorage.setItem("graupel.showCloudChain", "true");
    });
    await open(page);
    // Safari has no scroll anchoring: there the page keeps a scroll position the browser pulled back while the page
    // was shorter for a moment. Chromium would put it back when the page grows again and so hide such a move.
    await page.addStyleTag({ content: "html, body, body * { overflow-anchor: none !important; }" });
    // Scrolled to the footer: the page can not go further down.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = () => page.evaluate(() => window.scrollY);
    const end = await scrolled();
    expect(end).toBeGreaterThan(0);
    expect(end).toBe(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight));

    const footer = page.getByRole("contentinfo");
    await footer.getByRole("button", { name: "Copy the meteogram as a picture" }).tap();
    await expect(footer.getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
    expect(await scrolled()).toBe(end);

    // Where files can be shared, the button shares the picture (REQ-680).
    await footer.getByRole("button", { name: "Share the picture" }).tap();
    await expect(footer.getByRole("status").filter({ hasText: "Picture shared" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __shared: string[] }).__shared)).toHaveLength(1);
    expect(await scrolled()).toBe(end);
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`pictures of the phone view, ${theme} (REQ-566)`, () => {
    test.use({ colorScheme: theme });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      // The fake forecast from the same fixed time.
      await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
    });

    test("top of the page: top card, day slider, start of the meteogram", async ({ page }) => {
      await open(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot(`phone-top-${theme}.png`, { maxDiffPixelRatio: 0.002 });
    });

    test("end of the page: meteogram and footer", async ({ page }) => {
      await open(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page).toHaveScreenshot(`phone-bottom-${theme}.png`, { maxDiffPixelRatio: 0.002 });
    });

    test("full screen in landscape", async ({ page }) => {
      await open(page);
      await page.setViewportSize(LANDSCAPE);
      const dialog = page.getByRole("dialog", { name: "Meteogram (full screen)" });
      await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
      await expect(page).toHaveScreenshot(`phone-fullscreen-${theme}.png`, { maxDiffPixelRatio: 0.002 });
    });
  });
}
