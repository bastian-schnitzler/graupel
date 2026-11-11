// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Typing in the place search on a phone does not open the full-screen meteogram (REQ-628). Some browsers on the iPhone
 * make the whole page lower while the keyboard is open, not only the part shown; the portrait page is then wider than
 * high and lower than 500 px, as if the phone were turned (REQ-454). The view used to open, took the focus from the
 * field, the keyboard closed, the page was high again, the view closed and gave the focus back, the keyboard opened
 * again: the keyboard flickered up and down and the page hung. Here the test controls what the browser tells about the
 * screen (`screen.width` and `screen.height`, which stay put on a turn as on the iPhone, and `screen.orientation.type`,
 * `window.orientation`) and makes the page lower as such a keyboard does. Chromium on its own makes the screen as large
 * as the page.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const PORTRAIT = { width: 393, height: 852 };
/** The page with the keyboard open in a browser that makes the page lower (iPhone 16, keyboard about 470 px). */
const WITH_KEYBOARD = { width: 393, height: 380 };
const LANDSCAPE = { width: 852, height: 393 };
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";

test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true, locale: "en-GB" });
ownDevice();

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // The screen as the test sets it (`__screen`: "portrait", "landscape", or null when the browser tells nothing),
  // and every full-screen view that opens, however briefly (`__fullscreenOpened`).
  await page.addInitScript(
    ({ width, height }) => {
      const state = window as unknown as { __screen: "portrait" | "landscape" | null; __fullscreenOpened: number };
      state.__screen = "portrait";
      state.__fullscreenOpened = 0;
      Object.defineProperty(Screen.prototype, "width", {
        configurable: true,
        get: () => (state.__screen === null ? 0 : width),
      });
      Object.defineProperty(Screen.prototype, "height", {
        configurable: true,
        get: () => (state.__screen === null ? 0 : height),
      });
      Object.defineProperty(ScreenOrientation.prototype, "type", {
        configurable: true,
        get: () => (state.__screen === null ? undefined : `${state.__screen}-primary`),
      });
      Object.defineProperty(ScreenOrientation.prototype, "angle", {
        configurable: true,
        get: () => (state.__screen === "landscape" ? 90 : 0),
      });
      Object.defineProperty(window, "orientation", {
        configurable: true,
        get: () => (state.__screen === null ? undefined : state.__screen === "landscape" ? 90 : 0),
      });
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches(".meteogram-fullscreen") || node.querySelector(".meteogram-fullscreen")) {
              state.__fullscreenOpened += 1;
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    },
    PORTRAIT,
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const search = (page: Page) => page.locator('[data-region="location"]').getByRole("combobox");
const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fullscreenOpened: number }).__fullscreenOpened);

/** Sets what the browser tells about the screen, with the orientation's `change` as a real turn sends it. */
async function screenIs(page: Page, value: "portrait" | "landscape" | null) {
  await page.evaluate((next) => {
    (window as unknown as { __screen: typeof next }).__screen = next;
    screen.orientation.dispatchEvent(new Event("change"));
  }, value);
}

/** Resizes the page and waits until the media query of a phone in landscape follows (two rendering steps). */
async function resize(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  const shape = size.width > size.height;
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
    .toBe(shape);
  // A few more frames for the view to open, if it would.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200)))),
  );
}

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

test("the keyboard making the page lower does not open the full-screen view; the field keeps the focus (REQ-628)", async ({
  page,
}) => {
  await open(page);
  await search(page).click();
  await expect(search(page)).toBeFocused();
  // The keyboard opens and the browser makes the page lower: wider than high, but no wider than the screen upright.
  await resize(page, WITH_KEYBOARD);
  expect(await opened(page)).toBe(0);
  await expect(fullscreen(page)).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  // The page stays a portrait page: the data source's line below the chart is the portrait one (REQ-616).
  await expect(page.getByTestId("meteogram-source")).toHaveCount(1);
  // The keyboard closes and opens again: nothing changes.
  await resize(page, PORTRAIT);
  await resize(page, WITH_KEYBOARD);
  await resize(page, PORTRAIT);
  expect(await opened(page)).toBe(0);
  await expect(search(page)).toBeFocused();
});

test("a real turn still opens and closes the view, also when the screen tells a moment before the page (REQ-454)", async ({
  page,
}) => {
  await open(page);
  // Turned to landscape: the screen and then the page.
  await screenIs(page, "landscape");
  await resize(page, LANDSCAPE);
  await expect(fullscreen(page)).toBeVisible();
  expect(await opened(page)).toBe(1);
  // Turned back: the view closes.
  await screenIs(page, "portrait");
  await resize(page, PORTRAIT);
  await expect(fullscreen(page)).toHaveCount(0);
  await expect(chart(page)).toBeVisible();
});

test("a turn while typing does not open the view; the next turn without the keyboard does (REQ-628)", async ({
  page,
}) => {
  await open(page);
  await search(page).click();
  await screenIs(page, "landscape");
  await resize(page, LANDSCAPE);
  expect(await opened(page)).toBe(0);
  await expect(search(page)).toBeFocused();
  // Back to portrait, the field left, turned again: the view opens as before.
  await screenIs(page, "portrait");
  await resize(page, PORTRAIT);
  await search(page).blur();
  await screenIs(page, "landscape");
  await resize(page, LANDSCAPE);
  await expect(fullscreen(page)).toBeVisible();
});

test("a browser that tells nothing about the screen: no view while typing, the page's shape otherwise (REQ-628)", async ({
  page,
}) => {
  await open(page);
  await screenIs(page, null);
  await search(page).click();
  await resize(page, WITH_KEYBOARD);
  expect(await opened(page)).toBe(0);
  await expect(search(page)).toBeFocused();
  await resize(page, PORTRAIT);
  await search(page).blur();
  // Without the field focused the page's shape counts, as before.
  await resize(page, LANDSCAPE);
  await expect(fullscreen(page)).toBeVisible();
});
