// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Dialogs on a phone (iPhone with Safari's user agent, Android with Chrome's):
 * - the model info (info button of a chain card and of the meteogram's model header) opens as a dialog exactly as big
 *   as the settings, with its title in the heading row and an X at the top right that closes it (REQ-719);
 * - while a dialog is open (settings, model info, info) a swipe over it, over its edge or past the end of what scrolls
 *   inside does not move the page behind: `scrollY` stays (REQ-730).
 *
 * Swipes are touch events of Chromium (`Input.dispatchTouchEvent`), which the browser scrolls with as with a finger;
 * the same swipe over the page without a dialog scrolls it, so the swipe is known to reach the page. Without the lock
 * the swipes over the dialog scrolled the page behind (checked once by hand).
 */
import { devices, type CDPSession } from "@playwright/test";
import { expect, IPHONE_SAFARI, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);

const PHONES = [
  { name: "iphone", userAgent: IPHONE_SAFARI, deviceScaleFactor: 3, viewport: devices["iPhone 13"].viewport },
  {
    name: "android",
    userAgent: devices["Pixel 7"].userAgent,
    deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor,
    viewport: devices["Pixel 7"].viewport,
  },
];

let errors: string[] = [];

test.use({ isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC" });
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

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const weatherChain = (page: Page) => page.locator('[data-region="model-chain"]').first();
const modelInfo = (page: Page) => page.getByTestId("model-info-popover");

/** Opens the page, with the weather chain's cards shown or hidden (then the info buttons sit in the chart's header). */
async function open(page: Page, chain: boolean) {
  await page.addInitScript((shown) => {
    window.localStorage.setItem("graupel.showWeatherChain", String(shown));
    window.localStorage.setItem("graupel.showCloudChain", String(shown));
  }, chain);
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

/**
 * The phone's page fits its screen (REQ-608); room below it makes it longer than the screen, as a page with more
 * content is, so it scrolls.
 */
async function makeScrollable(page: Page, height: number) {
  await page.addStyleTag({ content: `body::after { content: ""; display: block; height: ${height}px; }` });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(height + 100);
}

/** Opens the settings from the phone's menu. */
async function openSettings(page: Page) {
  await page.locator('[data-region="location"]').getByRole("button", { name: "Menu", exact: true }).tap();
  await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Settings" }).tap();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the info of the menu. */
async function openInfo(page: Page) {
  await page.locator('[data-region="location"]').getByRole("button", { name: "Menu", exact: true }).tap();
  await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Info" }).tap();
  const dialog = page.getByRole("dialog", { name: "Info" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function box(locator: Locator) {
  const b = (await locator.boundingBox())!;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/** The dialog's size and place on screen once it stands still. */
async function settledBox(locator: Locator) {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await box(locator));
      const steady = now === last;
      last = now;
      return steady;
    })
    .toBe(true);
  return box(locator);
}

/** X at the top right of the dialog: the last control of its heading row, in the top right corner. */
async function expectCloseTopRight(dialog: Locator) {
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(close).toBeVisible();
  const header = dialog.locator(".dialog__header");
  await expect(header.locator("> :last-child")).toHaveAccessibleName("Close");
  const d = await box(dialog);
  const c = await box(close);
  expect(d.x + d.width - (c.x + c.width)).toBeLessThan(16);
  expect(c.y - d.y).toBeLessThan(16);
  // The title takes the room before it, nothing else to its right.
  const title = await box(header.getByRole("heading", { level: 2 }));
  expect(title.x + title.width).toBeLessThanOrEqual(c.x + 0.5);
  return close;
}

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({ userAgent: phone.userAgent, deviceScaleFactor: phone.deviceScaleFactor, viewport: phone.viewport });
    ownDevice();

    test("model info of a chain card: as big as the settings, X at the top right closes it (REQ-719)", async ({
      page,
    }, testInfo) => {
      await open(page, true);
      const settings = await openSettings(page);
      const size = await settledBox(settings);
      await settings.getByRole("button", { name: "Close" }).tap();
      await expect(settings).toHaveCount(0);

      const info = weatherChain(page).getByRole("button", { name: /^Details for / }).first();
      await info.tap();
      const dialog = modelInfo(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveJSProperty("tagName", "DIALOG");
      // The page behind is inert, the dialog is the only one.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      const own = await settledBox(dialog);
      expect(Math.abs(own.width - size.width)).toBeLessThan(1);
      expect(Math.abs(own.height - size.height)).toBeLessThan(1);
      expect(Math.abs(own.x - size.x)).toBeLessThan(1);
      expect(Math.abs(own.y - size.y)).toBeLessThan(1);
      // Title "model (publisher, coverage)" in the heading row, the details below it.
      const heading = dialog.getByRole("heading", { level: 2 });
      await expect(heading).toHaveText(/^.+ \(.+\)$/);
      await expect(dialog.getByTestId("model-info-title")).toHaveCount(1);
      await expect(dialog.getByTestId("model-info-specs")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`model-info-dialog-${phone.name}.png`) });

      const close = await expectCloseTopRight(dialog);
      await close.tap();
      await expect(modelInfo(page)).toHaveCount(0);
      await expect(info).toBeFocused();
    });

    test("model info of the meteogram's header: the same dialog (REQ-719)", async ({ page }) => {
      await open(page, false);
      const settings = await openSettings(page);
      const size = await settledBox(settings);
      await settings.getByRole("button", { name: "Close" }).tap();

      const button = page.locator('[data-region="meteogram"]').getByTestId("model-header-info-button").first();
      await button.tap();
      const dialog = modelInfo(page);
      await expect(dialog).toBeVisible();
      const own = await settledBox(dialog);
      expect(Math.abs(own.width - size.width)).toBeLessThan(1);
      expect(Math.abs(own.height - size.height)).toBeLessThan(1);
      // A tap in the dialog opens neither the full-screen meteogram nor closes the dialog.
      await dialog.getByTestId("model-info-specs").tap();
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Meteogram (full screen)" })).toHaveCount(0);
      const close = await expectCloseTopRight(dialog);
      await close.tap();
      await expect(modelInfo(page)).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Meteogram (full screen)" })).toHaveCount(0);
    });

    test("a swipe in the open settings does not move the page behind (REQ-730)", async ({ page }) => {
      await open(page, true);
      const cdp = await page.context().newCDPSession(page);
      const scrollY = () => page.evaluate(() => window.scrollY);
      const height = phone.viewport.height;
      const middle = phone.viewport.width / 2;
      // The same swipe over the page scrolls it, so the swipe reaches the page.
      await makeScrollable(page, height);
      await swipe(cdp, middle, height * 0.7, -200);
      await expect.poll(scrollY).toBeGreaterThan(50);

      // The menu's button is at the page's top, where a tap on it scrolls the page back to: the page behind the open
      // dialog is scrolled down afterwards.
      await page.evaluate(() => window.scrollTo(0, 0));
      const dialog = await openSettings(page);
      await page.evaluate(() => window.scrollTo(0, 60));
      await expect.poll(scrollY).toBe(60);
      const d = await settledBox(dialog);
      // Over the short Design tab (nothing to scroll inside), up and down.
      const body = await box(dialog.locator(".dialog__body"));
      await swipe(cdp, middle, body.y + body.height * 0.7, -250);
      await swipe(cdp, middle, body.y + body.height * 0.3, 250);
      // Over the heading row and over the backdrop beside and below the dialog.
      await swipe(cdp, middle, d.y + 20, -150);
      await swipe(cdp, d.x / 2 + 0.5, d.y + d.height / 2, -250);
      if (height - (d.y + d.height) > 20) await swipe(cdp, middle, (d.y + d.height + height) / 2, -10);
      expect(await scrollY()).toBe(60);

      // Closed, the page is where it was and scrolls again.
      await dialog.getByRole("button", { name: "Close" }).tap();
      await expect(dialog).toHaveCount(0);
      expect(await scrollY()).toBe(60);
      await expect(page.locator("html")).not.toHaveClass(/dialog-open/);
      await swipe(cdp, middle, height * 0.7, -200);
      await expect.poll(scrollY).toBeGreaterThan(60);
      await cdp.detach();
    });

    test("nor in the open model info or info (REQ-730)", async ({ page }) => {
      await open(page, true);
      const cdp = await page.context().newCDPSession(page);
      const scrollY = () => page.evaluate(() => window.scrollY);
      const middle = phone.viewport.width / 2;
      await makeScrollable(page, phone.viewport.height);
      await page.evaluate(() => window.scrollTo(0, 40));
      await expect.poll(scrollY).toBe(40);

      await weatherChain(page).getByRole("button", { name: /^Details for / }).first().tap();
      const dialog = modelInfo(page);
      await expect(dialog).toBeVisible();
      let d = await settledBox(dialog);
      for (let i = 0; i < 3; i += 1) await swipe(cdp, middle, d.y + d.height * 0.8, -400);
      await swipe(cdp, middle, d.y + d.height * 0.3, 300);
      await swipe(cdp, d.x / 2 + 0.5, d.y + d.height / 2, -250);
      expect(await scrollY()).toBe(40);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);

      const info = await openInfo(page);
      await page.evaluate(() => window.scrollTo(0, 40));
      await expect.poll(scrollY).toBe(40);
      d = await settledBox(info);
      for (let i = 0; i < 3; i += 1) await swipe(cdp, middle, d.y + d.height * 0.8, -400);
      await swipe(cdp, d.x / 2 + 0.5, d.y + d.height / 2, -250);
      expect(await scrollY()).toBe(40);

      // A tab longer than the dialog scrolls inside and stops at its ends; a swipe beyond them does not reach the page.
      const scroller = info.locator(".dialog__body");
      const inner = () => scroller.evaluate((element) => element.scrollTop);
      let room = 0;
      for (const tab of await info.getByRole("tab").all()) {
        await tab.tap();
        room = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
        if (room > 0) break;
      }
      expect(room, "a tab longer than the dialog").toBeGreaterThan(0);
      const body = await box(scroller);
      for (let i = 0; i < 20 && (await inner()) < room - 1; i += 1) {
        await swipe(cdp, middle, body.y + body.height * 0.9, -body.height * 0.8);
      }
      expect(await inner()).toBeGreaterThanOrEqual(room - 1);
      await swipe(cdp, middle, body.y + body.height * 0.9, -300);
      expect(await scrollY()).toBe(40);
      for (let i = 0; i < 20 && (await inner()) > 0; i += 1) {
        await swipe(cdp, middle, body.y + body.height * 0.1, body.height * 0.8);
      }
      expect(await inner()).toBe(0);
      await swipe(cdp, middle, body.y + body.height * 0.1, 300);
      expect(await scrollY()).toBe(40);
      await info.getByRole("button", { name: "Close" }).first().tap();
      await expect(info).toHaveCount(0);
      expect(await scrollY()).toBe(40);
      await cdp.detach();
    });
  });
}

/**
 * A finger swiping `distance` px from (x, y): negative up (the content follows it, the page scrolls down). Waits a
 * moment after lifting it, for the scrolling to come to rest.
 */
async function swipe(cdp: CDPSession, x: number, y: number, distance: number) {
  const at = (top: number) => [{ x: Math.round(x), y: Math.round(top), radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(y) });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(y + (distance * step) / 10) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

test.describe("iphone, picture", () => {
  test.use({ userAgent: IPHONE_SAFARI, deviceScaleFactor: 3, viewport: devices["iPhone 13"].viewport });
  ownDevice();

  test("model info dialog on the iPhone", async ({ page }) => {
    await open(page, true);
    await weatherChain(page).getByRole("button", { name: /^Details for / }).first().tap();
    const dialog = modelInfo(page);
    await expect(dialog).toBeVisible();
    await settledBox(dialog);
    await expect(page).toHaveScreenshot("model-info-dialog-iphone.png", { animations: "disabled" });
  });
});
