// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The footer's row on phones and tablets (REQ-729): the data source "Weather data by Open-Meteo.com (time)" and the
 * buttons (copy, share, on a tablet full screen) stand in one row, the buttons close together. On a tablet the source
 * stands left and the buttons right; on a phone the buttons left and the source right-aligned. Nothing overlaps, also
 * on the iPhone SE; on a screen too narrow for the whole line the source is shortened with an ellipsis.
 */
import { devices } from "@playwright/test";
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);

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

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Row {
  row: Box;
  slot: Box;
  source: Box;
  /** The source's text (its range), without the ellipsis' cut. */
  text: Box;
  /** Whether the source's whole text is shown (not shortened). */
  whole: boolean;
  buttons: { id: string; box: Box; icon: Box }[];
  chart: Box;
  width: number;
}

/** Opens the page and waits for the chart and the footer's row with the source. */
async function open(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.locator("footer").getByTestId("meteogram-source")).toBeVisible();
  await expect(page.locator("footer").getByTestId("meteogram-source")).toContainText("(10/11/26, 11:00)");
}

/** The footer row's parts as on screen. */
function measure(page: Page): Promise<Row> {
  return page.evaluate(() => {
    const box = (element: Element): Box => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const footer = document.querySelector('footer[data-region="footer"]')!;
    const source = footer.querySelector<HTMLElement>('[data-testid="meteogram-source"]')!;
    const range = document.createRange();
    range.selectNodeContents(source);
    const { left, top, right, bottom } = range.getBoundingClientRect();
    return {
      row: box(footer.querySelector(".footer__row")!),
      slot: box(footer.querySelector('[data-testid="footer-slot"]')!),
      source: box(source),
      text: { left, top, right, bottom },
      whole: source.scrollWidth <= source.clientWidth,
      buttons: [...footer.querySelectorAll<HTMLElement>("button")].map((button) => ({
        id: button.dataset.testid ?? "",
        box: box(button),
        icon: box(button.querySelector("svg")!),
      })),
      chart: box(document.querySelector('[data-region="meteogram"] svg.meteogram-svg-integrated')!),
      width: document.documentElement.clientWidth,
    };
  });
}

const middle = (box: Box) => (box.top + box.bottom) / 2;

/** One row: source and buttons on one line, the source a single line, nothing beyond the screen or below the chart. */
function expectOneRow(row: Row) {
  for (const button of row.buttons) {
    // Icons and the source's text on one line: their middles at the same height.
    expect(Math.abs(middle(button.icon) - middle(row.text))).toBeLessThan(1.5);
    expect(button.box.left).toBeGreaterThanOrEqual(-0.5);
    expect(button.box.right).toBeLessThanOrEqual(row.width + 0.5);
  }
  // The source is a single line (14 px) within the row and the screen.
  expect(row.source.bottom - row.source.top).toBeLessThan(20);
  expect(row.source.top).toBeGreaterThanOrEqual(row.row.top - 0.5);
  expect(row.source.bottom).toBeLessThanOrEqual(row.row.bottom + 0.5);
  expect(row.source.left).toBeGreaterThanOrEqual(row.row.left - 0.5);
  expect(row.source.right).toBeLessThanOrEqual(row.row.right + 0.5);
  // The row stands below the chart, not over it.
  expect(row.row.top).toBeGreaterThanOrEqual(row.chart.bottom - 0.5);
}

/** The buttons side by side in this order, close together: no gap between them, 32 px from icon to icon. */
function expectButtonsClose(row: Row, ids: string[]) {
  expect(row.buttons.map((button) => button.id)).toEqual(ids);
  for (let index = 1; index < row.buttons.length; index++) {
    const before = row.buttons[index - 1]!;
    const after = row.buttons[index]!;
    expect(after.box.left).toBeGreaterThanOrEqual(before.box.right - 0.5);
    expect(after.box.left - before.box.right).toBeLessThan(1);
    expect(after.icon.left - before.icon.left).toBeLessThanOrEqual(32.5);
    // The buttons keep their touch height.
    expect(after.box.bottom - after.box.top).toBeGreaterThanOrEqual(29.5);
  }
}

/** On a phone: the buttons at the row's start, the source after them, right-aligned at the row's end. */
function expectPhoneOrder(row: Row) {
  const first = row.buttons[0]!;
  const last = row.buttons.at(-1)!;
  expect(Math.abs(first.box.left - row.row.left)).toBeLessThan(1);
  // No overlap: the source's box starts after the last button.
  expect(row.source.left).toBeGreaterThanOrEqual(last.box.right - 0.5);
  expect(Math.abs(row.source.right - row.row.right)).toBeLessThan(1);
  if (row.whole) {
    expect(Math.abs(row.text.right - row.row.right)).toBeLessThan(1);
    expect(row.text.left).toBeGreaterThan(last.box.right);
  }
}

const PHONE_BUTTONS = ["meteogram-copy", "meteogram-save"];

for (const { name, viewport, userAgent, locale, whole } of [
  { name: "phone 390 px, English", viewport: { width: 390, height: 844 }, locale: "en-GB", whole: true },
  { name: "phone 390 px, German", viewport: { width: 390, height: 844 }, locale: "de-DE", whole: true },
  // iPhone SE (3rd gen.) in Safari, with its bottom bar's room (REQ-617).
  {
    name: "iPhone SE, Safari, English",
    viewport: { width: 375, height: 548 },
    userAgent: IPHONE_SAFARI,
    locale: "en-GB",
    whole: true,
  },
  {
    name: "iPhone SE, Safari, German",
    viewport: { width: 375, height: 548 },
    userAgent: IPHONE_SAFARI,
    locale: "de-DE",
    whole: true,
  },
  // A screen 320 px wide (iPhone SE, 1st gen.): the German line is shortened, nothing overlaps.
  { name: "phone 320 px, German", viewport: { width: 320, height: 568 }, locale: "de-DE", whole: false },
]) {
  test.describe(name, () => {
    test.use({
      viewport,
      ...(userAgent ? { userAgent } : {}),
      locale,
      timezoneId: "UTC",
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    ownDevice();

    test("the buttons left, close together, the source right-aligned, in one row without overlap (REQ-729)", async ({
      page,
    }) => {
      await page.goto(APP);
      await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
      const source = page.locator("footer").getByTestId("meteogram-source");
      await expect(source).toBeVisible();
      await expect(source).toContainText(locale === "de-DE" ? "Wetterdaten von" : "Weather data by");
      // Not below the chart any more: only in the footer's row.
      await expect(page.getByTestId("meteogram-source")).toHaveCount(1);
      const row = await measure(page);
      expect(row.whole).toBe(whole);
      expectButtonsClose(row, PHONE_BUTTONS);
      expectPhoneOrder(row);
      expectOneRow(row);
      // The page does not scroll sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
  });
}

/** A device of Playwright's list as a context's options, upright or turned, without its browser type. */
function device(name: string, turned = false) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices[name]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  return { ...options, viewport, screen: viewport, timezoneId: "UTC", locale: "en-GB" };
}

const TABLET_BUTTONS = ["meteogram-copy", "meteogram-save", "meteogram-fullscreen-open"];

for (const turned of [false, true]) {
  test.describe(`tablet ${turned ? "turned" : "upright"}`, () => {
    test.use(device("iPad Pro 11", turned));
    ownDevice();

    test("the source left, the buttons with full screen right, close together, in one row (REQ-729)", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.assign(navigator, {
          canShare: (data?: ShareData) => !!data?.files?.length,
          share: async () => undefined,
        });
      });
      await open(page);
      const row = await measure(page);
      expect(row.whole).toBe(true);
      expectButtonsClose(row, TABLET_BUTTONS);
      expectOneRow(row);
      // The source at the row's start, the buttons at its end, nothing overlapping.
      expect(Math.abs(row.source.left - row.row.left)).toBeLessThan(1);
      expect(Math.abs(row.text.left - row.row.left)).toBeLessThan(1);
      expect(row.source.right).toBeLessThanOrEqual(row.buttons[0]!.box.left + 0.5);
      expect(Math.abs(row.buttons.at(-1)!.box.right - row.row.right)).toBeLessThan(1);

      // The message after sharing stands above the buttons, right-aligned with the last one (REQ-589).
      const footer = page.locator("footer");
      await footer.getByTestId("meteogram-save").tap();
      const message = footer.getByRole("status").filter({ hasText: "Picture shared" });
      await expect(message).toBeVisible();
      const box = (await message.boundingBox())!;
      const last = (await footer.getByTestId("meteogram-fullscreen-open").boundingBox())!;
      expect(Math.abs(box.x + box.width - (last.x + last.width))).toBeLessThan(1);
      expect(box.y + box.height).toBeLessThanOrEqual(last.y + 0.5);
    });
  });
}
