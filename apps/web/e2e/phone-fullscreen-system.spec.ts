// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's full-screen meteogram and the system around it: a double tap in the view zooms back out to the range it
 * opened with, in the card it changes nothing (REQ-715). The back button does not leave the view in landscape, only
 * turning the phone back closes it (REQ-716): the view adds a history entry and holds Android's close request on the
 * dialog. A tap in the view asks the browser for its own full screen without its bars (REQ-717, DEC-089), which ends
 * with the view.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 9);

/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
const PORTRAIT = { width: 412, height: 915 };
const LANDSCAPE = { width: 915, height: 412 };

test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true, timezoneId: "UTC", locale: "en-GB" });
ownDevice();

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

const embedded = (page: Page) => page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const big = (page: Page) => dialog(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');

/** Turns the phone and waits two rendering steps, in which the page sees the turn (as in meteogram-fullscreen.spec). */
async function turn(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  const landscape = size.width > size.height;
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
    .toBe(landscape);
}

/** Visible range of a chart. */
async function range(svg: Locator) {
  const [start, end] = await Promise.all([
    svg.getAttribute("data-visible-start-time"),
    svg.getAttribute("data-visible-end-time"),
  ]);
  return { start: Date.parse(start!), end: Date.parse(end!) };
}

/** Two fingers spread from `from` to `to` px from the chart's middle (REQ-563). */
async function pinch(page: Page, chart: Locator, from: number, to: number) {
  const box = (await chart.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  const mid = box.x + box.width / 2;
  const points = (d: number) => [
    { x: Math.round(mid - d), y, id: 1 },
    { x: Math.round(mid + d), y, id: 2 },
  ];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(from + ((to - from) * step) / 8) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Part of the pixels that differ between two screenshots of the same size (compared on a canvas in the page). */
async function differingPixels(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (data: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [one, two] = await Promise.all([load(a!), load(b!)]);
      if (one.length !== two.length) return 1;
      let differing = 0;
      for (let index = 0; index < one.length; index += 4) {
        const delta =
          Math.abs(one[index]! - two[index]!) +
          Math.abs(one[index + 1]! - two[index + 1]!) +
          Math.abs(one[index + 2]! - two[index + 2]!);
        if (delta > 24) differing++;
      }
      return differing / (one.length / 4);
    },
    [first.toString("base64"), second.toString("base64")],
  );
}

/** A double tap: two taps at the same point right after each other. */
async function doubleTap(page: Page, x: number, y: number) {
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
}

test("a double tap in the view zooms back out to the range it opened with; in the card it changes nothing (REQ-715)", async ({
  page,
}) => {
  await page.goto(APP);
  const card = embedded(page);
  await expect(card).toBeVisible();

  // In the card: no zoom, no view.
  const cardRange = await range(card);
  const cardBox = (await card.boundingBox())!;
  await doubleTap(page, cardBox.x + 150, cardBox.y + cardBox.height / 3);
  await page.waitForTimeout(400);
  expect(await range(card)).toEqual(cardRange);
  await expect(dialog(page)).toHaveCount(0);

  await turn(page, LANDSCAPE);
  const chart = big(page);
  await expect(chart).toBeVisible();
  const opened = await range(chart);
  const span = async () => {
    const shown = await range(chart);
    return shown.end - shown.start;
  };

  // Zoomed in with two fingers.
  await pinch(page, chart, 60, 180);
  await expect.poll(span).toBeLessThan((opened.end - opened.start) * 0.5);
  const zoomed = await range(chart);
  const box = (await chart.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;

  // One tap only moves the cursor line.
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(500);
  expect(await range(chart)).toEqual(zoomed);
  await expect(dialog(page).getByTestId("hover-cursor-line")).toHaveCount(1);

  // A double tap zooms back out, to the range the view opened with; the view stays, the page is not zoomed.
  await doubleTap(page, x, y);
  await expect.poll(() => range(chart)).toEqual(opened);
  await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // Back in the card nothing changed there.
  await turn(page, PORTRAIT);
  await expect(dialog(page)).toHaveCount(0);
  expect(await range(embedded(page))).toEqual(cardRange);
});

test("the back button leaves the view open in landscape; turning back closes it and takes its history entry (REQ-716)", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(embedded(page)).toBeVisible();
  const entries = await page.evaluate(() => history.length);

  await turn(page, LANDSCAPE);
  await expect(dialog(page)).toBeVisible();
  // Opening added an entry.
  await expect.poll(() => page.evaluate(() => history.length)).toBe(entries + 1);

  // Back, twice: the page and the view stay.
  for (let press = 0; press < 2; press++) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          addEventListener("popstate", () => setTimeout(resolve, 100), { once: true });
          history.back();
        }),
    );
    await expect(page).toHaveURL(APP);
    await expect(dialog(page)).toBeVisible();
    await expect(big(page)).toBeVisible();
  }

  // Android's back button closes a modal dialog: as a close request (`cancel`) the view refuses, and closed by the
  // browser anyway (no touch before) it opens again.
  const held = await page.evaluate(async () => {
    const element = document.querySelector<HTMLDialogElement>("dialog.meteogram-fullscreen")!;
    const refused = !element.dispatchEvent(new Event("cancel", { cancelable: true }));
    element.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { refused, open: element.open, modal: element.matches(":modal"), connected: element.isConnected };
  });
  expect(held).toEqual({ refused: true, open: true, modal: true, connected: true });
  await expect(dialog(page)).toBeVisible();

  // Turned back, the view closes and its entry goes: one back leaves the page as before the view.
  await turn(page, PORTRAIT);
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (history.state as Record<string, unknown> | null)?.graupelMeteogramFullscreen ?? null))
    .toBeNull();
  await expect(embedded(page)).toBeVisible();

  // Opened and turned back again: still one entry for the view at a time.
  await turn(page, LANDSCAPE);
  await expect(dialog(page)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (history.state as Record<string, unknown> | null)?.graupelMeteogramFullscreen ?? null))
    .toBe(true);
  await turn(page, PORTRAIT);
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (history.state as Record<string, unknown> | null)?.graupelMeteogramFullscreen ?? null))
    .toBeNull();
});

test("a tap in the view hides the system bars again with the browser's full screen, which ends with the view (REQ-717, DEC-089)", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(embedded(page)).toBeVisible();
  await turn(page, LANDSCAPE);
  const chart = big(page);
  await expect(chart).toBeVisible();
  // Android's back button leaves the browser's full screen first (DEC-089): the view stays.
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(dialog(page)).toBeVisible();
  // A tap asks for it again.
  const calls = await page.evaluate(() => {
    const log: unknown[] = [];
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (options?: FullscreenOptions) {
      log.push({ element: this.tagName, navigationUI: options?.navigationUI ?? null });
      return original.call(this, options);
    };
    (window as unknown as { fullscreenCalls: unknown[] }).fullscreenCalls = log;
    return log.length;
  });
  expect(calls).toBe(0);

  const box = (await chart.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 3);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { fullscreenCalls: unknown[] }).fullscreenCalls))
    .toEqual([{ element: "HTML", navigationUI: "hide" }]);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBe("HTML");
  // The view stays on top, open and in landscape: the screen looks the same with and without the browser's full
  // screen, not the page laid over the view (the page's full screen enters the top layer after the dialog).
  await expect(dialog(page)).toBeVisible();
  await page.waitForTimeout(300);
  const inFullscreen = await page.screenshot();
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(dialog(page)).toBeVisible();
  await page.waitForTimeout(300);
  const without = await page.screenshot();
  expect(await differingPixels(page, inFullscreen, without)).toBeLessThan(0.002);

  // Asked for again with the next tap.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 3);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBe("HTML");
  await expect(dialog(page)).toBeVisible();

  // Turned back, the browser's full screen ends with the view.
  await turn(page, PORTRAIT);
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});
