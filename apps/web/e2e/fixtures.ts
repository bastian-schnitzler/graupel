// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * `test` and `expect` of every end-to-end test of the website: each page gets the fake Open-Meteo (`openMeteo.ts`), so
 * the forecast the page loads at start never leaves the browser and logs no network errors.
 *
 * The domains start without favourites (REQ-708). Most tests need some to pick from, so each page starts as if an
 * earlier visit had stored five mountains (`STORED_FAVORITES`) unless the test turns `storedFavorites` off; the list
 * is only written while nothing is stored, so what a test marks or unmarks stays across reloads.
 */
import { test as base } from "@playwright/test";
import { mockOpenMeteo } from "./openMeteo.ts";

/** Favourites of an earlier visit that most tests start with (localStorage `graupel.favorites`). */
export const STORED_FAVORITES = [
  { name: "Großglockner", lat: 47.0742, lon: 12.6947, elevation: 3798 },
  { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 },
  { name: "Mont Blanc", lat: 45.8326, lon: 6.8652, elevation: 4806 },
  { name: "Gran Paradiso", lat: 45.5175, lon: 7.2669, elevation: 4061 },
  { name: "Ortler", lat: 46.5086, lon: 10.5447, elevation: 3905 },
];

/** Class of the device a test runs as (REQ-745, DEC-090): its Playwright project. */
export type DeviceClass = "phone" | "tablet" | "desktop";

/**
 * Class of a page `size` CSS px large (REQ-745, DEC-090): a phone below 600 px on its short side (also a window that
 * narrow, which has the phone's design), from there a tablet with a touch screen, else a desktop.
 */
export function classOf(size: { width: number; height: number }, touch: boolean): DeviceClass {
  if (Math.min(size.width, size.height) < 600) return "phone";
  return touch ? "tablet" : "desktop";
}

/** Options of the projects in playwright.config.ts. */
export interface DeviceClassOptions {
  /** Class of the project's device (REQ-745). */
  deviceClass: DeviceClass;
}

export const test = base.extend<
  { openMeteo: string[]; storedFavorites: boolean; seedFavorites: void },
  DeviceClassOptions
>({
  deviceClass: ["desktop", { option: true, scope: "worker" }],
  /**
   * A test that sets its window's size itself (`page.setViewportSize`) has its own device as well (`ownDevice`): in the
   * phone and tablet projects it stops there, skipped, and runs once in the desktop project (REQ-745).
   */
  page: async ({ page, deviceClass, isMobile, hasTouch }, provide, testInfo) => {
    // The classes the test sees, as an annotation of its result, for COVERAGE.md (REQ-745).
    const seen = (size: { width: number; height: number } | null) => {
      const description = size ? classOf(size, isMobile || hasTouch) : deviceClass;
      if (!testInfo.annotations.some((note) => note.type === "device-class" && note.description === description)) {
        testInfo.annotations.push({ type: "device-class", description });
      }
    };
    seen(page.viewportSize());
    const setViewportSize = page.setViewportSize.bind(page);
    page.setViewportSize = (size) => {
      if (deviceClass !== "desktop") testInfo.skip(true, "sets its own window size, runs once in the desktop project");
      seen(size);
      return setViewportSize(size);
    };
    await provide(page);
  },
  /** Forecast requests the page made (URLs). */
  openMeteo: [
    async ({ page }, use) => {
      await use(await mockOpenMeteo(page));
    },
    { auto: true },
  ],
  /** Whether the page starts with `STORED_FAVORITES`; off for tests of a first visit. */
  storedFavorites: [true, { option: true }],
  seedFavorites: [
    async ({ page, storedFavorites }, use) => {
      if (storedFavorites) {
        await page.addInitScript((favorites) => {
          try {
            if (localStorage.getItem("graupel.favorites") === null) {
              localStorage.setItem("graupel.favorites", JSON.stringify(favorites));
            }
          } catch {
            // No storage: the page starts without favourites.
          }
        }, STORED_FAVORITES);
      }
      await use();
    },
    { auto: true },
  ],
});

/**
 * User agent of Safari on the iPhone (iOS 26): only there the page leaves room below the footer for Safari's bottom bar
 * (REQ-581, REQ-611). Playwright's phones otherwise run with Chromium's user agent, as Chrome on Android would.
 */
export const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 " +
  "Mobile/15E148 Safari/604.1";

/**
 * Limits the tests of the file or describe block it is called in to `classes` (REQ-745): each website test runs in the
 * phone, tablet and desktop projects, unless what it tests exists only in some classes (the phone's menu, a desktop's
 * keyboard) or it pins its own device or window, which belongs to one class. `reason` says why, in the test's code and
 * in the report of the skipped runs.
 */
export function onlyIn(classes: DeviceClass | DeviceClass[], reason: string) {
  const allowed = Array.isArray(classes) ? classes : [classes];
  test.skip(({ deviceClass }) => !allowed.includes(deviceClass), `${allowed.join(", ")} only: ${reason}`);
}

/**
 * Marks the tests of the describe block (or file) it follows as having their own device (REQ-745): a `test.use` right
 * before it sets their window, touch screen or browser (a phone, a tablet, a narrow or wide desktop window). Such a test
 * belongs to the class of that device already and runs once, in the desktop project, whose options it overrides; the
 * phone and tablet projects, whose options it would only partly take over, skip it. It names its class in its
 * describe block or title.
 */
export function ownDevice() {
  test.skip(({ deviceClass }) => deviceClass !== "desktop", "sets its own device, runs once in the desktop project");
}

export { expect } from "@playwright/test";
export type { Locator, Page } from "@playwright/test";
