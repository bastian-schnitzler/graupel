// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Try again" when the forecast could not be loaded (Open-Meteo answers every forecast request with 429, too many
 * concurrent requests):
 * - REQ-739: the button does not stick to the screen's edge. It starts at the left edge of the box "No forecast
 *   available." above it (±1 px), at least 8 px from the screen's edge, with room above it: on an iPhone 13, an
 *   Android phone 360×640, a tablet and the desktop.
 * - REQ-740: on a phone in landscape, opened so or turned from portrait, the message stands without the card with the
 *   label "Horizon" (it belongs to the day slider), and "Try again" stands right below it without a card of its own,
 *   as upright.
 * - The button loads the forecast anew. Pictures of the error state per device catch unintended moves; after an
 *   intended change of the look they are taken again with `pnpm test:e2e --update-snapshots`.
 */
import { devices } from "@playwright/test";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
/** Least room between the button and the screen's edge, and between the box and the button. */
const LEAST_ROOM = 8;

/** A Playwright device, upright or turned, with a screen as large as the page (as in tablet.spec.ts). */
function device(name: string, turned = false) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices[name]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  return { ...options, viewport, screen: viewport };
}

const ANDROID = {
  viewport: { width: 360, height: 640 },
  screen: { width: 360, height: 640 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

test.use({ locale: "en-GB", timezoneId: "UTC" });

/** Whether Open-Meteo is overloaded; while it is, every forecast request gets 429 (`overload`). */
let overloaded = true;

test.beforeEach(async ({ page }) => {
  overloaded = true;
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    overloaded
      ? route.fulfill({ status: 429, json: { error: true, reason: "Too many concurrent requests" } })
      : fakeForecast(route, { now: FIXED_NOW }),
  );
});

const retry = (page: Page) => page.getByTestId("forecast-error").getByRole("button", { name: "Try again" });
/** The box "No forecast available.": the day slider's region, which holds only the message without days. */
const box = (page: Page) => page.locator('[data-region="day-slider"]');
const message = (page: Page) => page.getByTestId("day-slider-empty");
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const rect = async (locator: Locator) => (await locator.boundingBox())!;

async function openFailing(page: Page) {
  await page.goto(APP);
  await expect(page.getByTestId("error-card")).toBeVisible();
  await expect(message(page)).toHaveText("No forecast available.");
  await expect(retry(page)).toBeVisible();
}

/** REQ-739: the button starts at the box's left edge, clear of the screen's edge, below the box with room between. */
async function expectAlignedBelow(page: Page) {
  const button = await rect(retry(page));
  const above = await rect(box(page));
  expect(Math.abs(button.x - above.x)).toBeLessThanOrEqual(1);
  expect(button.x).toBeGreaterThanOrEqual(LEAST_ROOM);
  expect(button.y - (above.y + above.height)).toBeGreaterThanOrEqual(LEAST_ROOM);
}

/**
 * REQ-740: no card with the label "Horizon" around the message, and none around the button, which follows right below
 * the message as upright (the page's gap, at most 16 px).
 */
async function expectBare(page: Page) {
  await expect(page.getByTestId("day-slider-label")).toBeHidden();
  const look = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return { border: style.borderTopWidth, background: style.backgroundColor, shadow: style.boxShadow };
    });
  const none = { border: "0px", background: "rgba(0, 0, 0, 0)", shadow: "none" };
  expect(await look(box(page))).toEqual(none);
  expect(await look(page.getByTestId("meteogram-card"))).toEqual(none);
  // The message's own box starts where the region does: no room for a label at its left.
  expect(Math.abs((await rect(message(page))).x - (await rect(box(page))).x)).toBeLessThanOrEqual(1);
  await expectAlignedBelow(page);
  const button = await rect(retry(page));
  const shown = await rect(message(page));
  expect(button.y - (shown.y + shown.height)).toBeLessThanOrEqual(16);
}

/** The page's main column, where message and button stand (the error card lies over the page's bottom corner). */
const main = (page: Page) => page.locator(".app__main");

const DEVICES: [string, Record<string, unknown>][] = [
  ["iphone-13", device("iPhone 13")],
  ["android-360", ANDROID],
  ["tablet", device("iPad Pro 11")],
  ["desktop", { viewport: { width: 1280, height: 800 } }],
];

for (const [name, use] of DEVICES) {
  test.describe(name, () => {
    test.use(use);
    ownDevice();

    test(`"Try again" starts at the left edge of the box above, not at the screen's edge (REQ-739)`, async ({
      page,
    }) => {
      await openFailing(page);
      await expectAlignedBelow(page);
      // No empty card around the button.
      expect(await page.getByTestId("meteogram-card").evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
        "0px",
      );
      await expect(main(page)).toHaveScreenshot(`retry-${name}.png`, { maxDiffPixelRatio: 0.01 });
    });
  });
}

test.describe("iPhone 13 in landscape", () => {
  test.use(device("iPhone 13", true));
  ownDevice();

  test("opened turned: no label \"Horizon\" around the message, no card around the button (REQ-740)", async ({ page }) => {
    await openFailing(page);
    expect(await page.evaluate((query) => matchMedia(query).matches, PHONE_LANDSCAPE)).toBe(true);
    await expectBare(page);
    await expect(main(page)).toHaveScreenshot("retry-iphone-13-landscape.png", { maxDiffPixelRatio: 0.01 });
  });
});

test.describe("iPhone 13 turned", () => {
  test.use(device("iPhone 13"));
  ownDevice();

  test("turned from portrait to landscape: the message alone and the button right below it (REQ-740)", async ({
    page,
  }) => {
    await openFailing(page);
    await expectBare(page);
    const upright = page.viewportSize()!;
    await page.setViewportSize({ width: upright.height, height: upright.width });
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
    await expect(message(page)).toHaveText("No forecast available.");
    await expectBare(page);
    // And back upright as before.
    await page.setViewportSize(upright);
    await expect.poll(() => page.evaluate((query) => matchMedia(query).matches, PHONE_LANDSCAPE)).toBe(false);
    await expectBare(page);
  });

  test('"Try again" loads the forecast once Open-Meteo answers again', async ({ page }) => {
    await openFailing(page);
    overloaded = false;
    await retry(page).click();
    await expect(chart(page)).toBeVisible();
    await expect(page.getByTestId("forecast-error")).toHaveCount(0);
    await expect(message(page)).toHaveCount(0);
  });
});
