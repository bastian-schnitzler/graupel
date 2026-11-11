// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The day slider's selection stays after a drag (REQ-752): the right end dragged from the 14th to the 20th and released
 * stays at the 20th, also 3 s later, after a new position of "My location" and after a reload of the forecast; the
 * meteogram shows the chosen days. On a Samsung phone the selection jumped back to the 14th: Chrome on Android may end
 * a touch with `pointercancel` instead of `pointerup`, and the slider threw the drag away then. The touch classes
 * therefore also end the drag with a cancelled touch (CDP `touchCancel`, the event Android's cancelled touch becomes).
 * Phone (iPhone 13 and a Samsung Galaxy with Chrome's Android user agent), tablet and desktop (REQ-745).
 */
import { devices, type CDPSession } from "@playwright/test";
import { expect, ownDevice, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 11 November 2026, 10:42 UTC, as on the phone's pictures (days from Tue 10th to Thu 26th). */
const FIXED_NOW = Date.UTC(2026, 10, 11, 10, 42);
/** End of the 20th, where the meteogram ends once the 20th is the last chosen day. */
const END_OF_20TH = Date.UTC(2026, 10, 21);
/** Days of the strip: 10th (yesterday) is index 0, so the 14th is 4 and the 20th is 10. */
const DAY_14 = 4;
const DAY_20 = 10;
const HOME = { latitude: 51.1806, longitude: 7.5093 };
const MOVED = { latitude: 51.2104, longitude: 7.4801 };

test.use({ timezoneId: "UTC", locale: "en-GB", geolocation: HOME, permissions: ["geolocation"] });

let errors: string[] = [];
let forecasts: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  forecasts = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    forecasts.push(route.request().url());
    return fakeForecast(route, { now: FIXED_NOW });
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [327] } }),
  );
  // The page starts at the device's own position ("My location"), as on the phone. The device's position is read
  // anew each time (no position cached for a minute), so a moved device is seen at once.
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.startLocation", "gps");
    const geolocation = navigator.geolocation;
    const read = geolocation.getCurrentPosition.bind(geolocation);
    geolocation.getCurrentPosition = (success, error, options) => read(success, error, { ...options, maximumAge: 0 });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const marker = (page: Page) => page.getByTestId("day-slider-marker");

async function open(page: Page) {
  await page.goto(APP);
  await expect(page.getByRole("combobox", { name: "Search for a place" })).toHaveValue("My location");
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("day-card")).toHaveCount(17);
}

/** Selects the 10th to the 14th: the 10th by the keyboard, then the right end four days on. */
async function selectTenthToFourteenth(page: Page) {
  await page.getByTestId("day-card").first().focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("day-slider-end").focus();
  for (let i = 0; i < DAY_14; i++) await page.keyboard.press("ArrowRight");
  await expectSelection(page, DAY_14);
  // Past the time of a double tap or click.
  await page.waitForTimeout(500);
}

/** The slider selects the 10th to the day `end`, and the meteogram ends with that day. */
async function expectSelection(page: Page, end: number) {
  await expect(marker(page)).toHaveAttribute("data-start", "0");
  await expect(marker(page)).toHaveAttribute("data-end", String(end));
  if (end === DAY_20) {
    await expect
      .poll(async () => Date.parse((await chart(page).getAttribute("data-visible-end-time")) ?? ""))
      .toBe(END_OF_20TH);
  }
}

type TouchType = "touchStart" | "touchMove" | "touchEnd" | "touchCancel";

/** A finger: sends its touch events, at (`x`, `y`) while it is on the screen. */
interface Finger {
  cdp: CDPSession;
  send: (type: TouchType, x?: number, y?: number) => Promise<void>;
}

/** One finger on the screen through Chromium's touch input (CDP), as on a phone. */
async function touch(page: Page): Promise<Finger> {
  const cdp = await page.context().newCDPSession(page);
  const send = async (type: TouchType, x = 0, y = 0) => {
    const up = type === "touchEnd" || type === "touchCancel";
    const points = up ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  };
  return { cdp, send };
}

/**
 * Drags the right end of the selection from the 14th to the 20th. With a touch screen a finger takes the grip and
 * moves six days on (the strip's grip follows the finger's travel, REQ-558); it is lifted, or the system cancels the
 * touch (`cancel`). With a mouse the grip goes to the 20th's right edge.
 */
async function dragEndToTwentieth(page: Page, hasTouch: boolean, cancel = false) {
  const grip = (await page.getByTestId("day-slider-end").boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  if (!hasTouch) {
    const target = (await page.getByTestId("day-card").nth(DAY_20).boundingBox())!;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width - 1, y, { steps: 12 });
    await expect(marker(page)).toHaveAttribute("data-end", String(DAY_20));
    await page.mouse.up();
    return;
  }
  const day = (await page.getByTestId("day-card").first().boundingBox())!.width;
  const finger = await touch(page);
  await finger.send("touchStart", x, y);
  const steps = 20;
  for (let step = 1; step <= steps; step++) {
    await finger.send("touchMove", x + (6.2 * day * step) / steps, y);
    await page.waitForTimeout(16);
  }
  // While the finger is down the slider shows the 20th.
  await expect(marker(page)).toHaveAttribute("data-end", String(DAY_20));
  await finger.send(cancel ? "touchCancel" : "touchEnd");
  await finger.cdp.detach();
}

/** A new position of "My location": the device moved, and the place row takes its position again. */
async function moveMyLocation(page: Page) {
  await page.context().setGeolocation(MOVED);
  const before = forecasts.length;
  await page.getByRole("button", { name: "Current location" }).click();
  await expect.poll(() => forecasts.slice(before).some((url) => url.includes(`latitude=${MOVED.latitude}`))).toBe(true);
  await expect(page.getByRole("combobox", { name: "Search for a place" })).toHaveValue("My location");
  await page.waitForLoadState("networkidle");
}

/**
 * Loads the forecast anew: the refresh button where there is one (desktop, REQ-637), else by pulling the chart down
 * (REQ-638).
 */
async function reloadForecast(page: Page) {
  const before = forecasts.length;
  const refresh = page.getByTestId("meteogram-refresh");
  if ((await refresh.count()) > 0) await refresh.click();
  else {
    const box = (await page.getByTestId("meteogram-scroll").boundingBox())!;
    const x = Math.round(box.x + box.width * 0.4);
    const y = Math.round(box.y + box.height * 0.3);
    const finger = await touch(page);
    await finger.send("touchStart", x, y);
    for (let step = 1; step <= 10; step++) await finger.send("touchMove", x, y + step * 10);
    await finger.send("touchEnd");
    await finger.cdp.detach();
  }
  await expect.poll(() => forecasts.length).toBeGreaterThan(before);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("day-slider-loading")).not.toHaveAttribute("data-loading");
}

/** The released selection stays: after 3 s, after a new position of "My location" and after a reload. */
async function expectSelectionStays(page: Page) {
  await expectSelection(page, DAY_20);
  await page.waitForTimeout(3000);
  await expectSelection(page, DAY_20);
  await moveMyLocation(page);
  await expectSelection(page, DAY_20);
  await reloadForecast(page);
  await expectSelection(page, DAY_20);
}

test("the right end dragged from the 14th to the 20th stays there (REQ-752)", async ({ page, hasTouch }) => {
  await open(page);
  await selectTenthToFourteenth(page);
  await dragEndToTwentieth(page, hasTouch);
  await expectSelectionStays(page);
  await page.screenshot({ path: test.info().outputPath("kept.png") });
});

test.describe("touch screen", () => {
  test.skip(({ hasTouch }) => !hasTouch, "a touch the system cancels exists on touch screens only");

  test("a drag whose touch the system cancels keeps the selection it shows (REQ-752)", async ({ page }) => {
    await open(page);
    await selectTenthToFourteenth(page);
    await dragEndToTwentieth(page, true, true);
    await expectSelectionStays(page);
  });
});

// A Samsung Galaxy with Chrome on Android, as on the pictures of REQ-752.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...GALAXY } = devices["Galaxy S9+"]!;

test.describe("Android phone (Galaxy S9+)", () => {
  test.use({ ...GALAXY });
  ownDevice();

  test("the right end dragged from the 14th to the 20th stays there (REQ-752)", async ({ page }) => {
    await open(page);
    await selectTenthToFourteenth(page);
    await dragEndToTwentieth(page, true);
    await expectSelectionStays(page);
  });

  test("a drag whose touch the system cancels keeps the selection it shows (REQ-752)", async ({ page }) => {
    await open(page);
    await selectTenthToFourteenth(page);
    await dragEndToTwentieth(page, true, true);
    await expectSelectionStays(page);
    await page.screenshot({ path: test.info().outputPath("galaxy-kept.png") });
  });
});
