// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The website on tablets (REQ-728, REQ-731, DEC-090): a device with a coarse pointer whose screen's short side measures
 * at least 600 px has the phone's design with its rules and controls (no cards around slider and chart, the phone's
 * strip with place and elevation between its grips, the copy and share buttons in the footer), but the desktop's header
 * bar beside the place row, without the menu, as long as its buttons fit there side by side; narrower, the phone's place
 * row with the menu. An unfolded foldable is a tablet, folded it is a phone. Turned to landscape a tablet shows the
 * phone's upright view over the page's whole width (REQ-750), the meteogram fitting the screen, nothing running over; a
 * double tap on the chart and a button in the footer beside copy and share open the full-screen view, which has a close
 * button. Upright and turned the day slider, the meteogram's scale and its axis font are those of an iPhone 13 upright,
 * with as many more days on the chart as the screen is wider (REQ-742, REQ-744, REQ-750).
 *
 * The tablets run in Chromium with each device's size, pixel density, touch and user agent (WebKit is not installed);
 * Playwright's screen follows the viewport, so a turn swaps the screen's sides as on Android. Pictures of an iPad upright
 * and turned and of a narrow tablet with the menu catch unintended moves; after an intended change of the look they are
 * taken again with `pnpm test:e2e --update-snapshots`.
 */
import { devices, type Browser } from "@playwright/test";
import { STORED_FAVORITES, expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast, mockOpenMeteo } from "./openMeteo.ts";
import { axisLabelAreas, edges, expectNoSidewaysOverflow } from "./phoneLayout.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 9);

interface Size {
  width: number;
  height: number;
}

/** A device of Playwright's list as a context's options, upright or turned, without its browser type. */
function device(name: string, turned = false) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices[name]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  // The screen as large as the page, as Playwright gives it without one; turned, its sides swap.
  return { ...options, viewport, screen: viewport, timezoneId: "UTC", locale: "en-GB" };
}

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
const header = (page: Page) => page.locator("header.header");
const menuButton = (page: Page) => page.getByRole("button", { name: "Menu" });
const searchField = (page: Page) => page.locator(".location__field");

async function open(page: Page) {
  await page.goto(APP);
  await expect(embedded(page)).toBeVisible();
}

/** Waits two rendering steps, in which the page sees a new size, and the layout settles. */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** The phone's design (REQ-728): no cards, no label "Horizon", place and elevation between the slider's grips. */
async function expectPhoneDesign(page: Page) {
  await expect(page.getByTestId("day-slider-label")).toBeHidden();
  await expect(page.getByTestId("meteogram-place")).toBeVisible();
  await expect(page.getByTestId("meteogram-source")).toBeVisible();
  const card = page.getByTestId("meteogram-card");
  expect(await card.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
  // Copy and share stand in the footer's row, not in a column beside the chart.
  await expect(page.getByTestId("footer-slot").getByTestId("meteogram-save")).toBeVisible();
  await expect(page.getByTestId("meteogram-tools")).toHaveCount(0);
}

/** The desktop's header bar in the place row's row, without the menu (REQ-731). */
async function expectDesktopHeaderInRow(page: Page) {
  await expect(header(page)).toBeVisible();
  await expect(menuButton(page)).toHaveCount(0);
  const field = await edges(searchField(page));
  const settings = await edges(page.getByRole("button", { name: "Settings" }));
  // Side by side: same row, the header bar right of the place row, nothing overlapping.
  expect(Math.abs(settings.top + settings.height / 2 - (field.top + field.height / 2))).toBeLessThan(2);
  const placeRow = await edges(page.locator(".location__bar"));
  const bar = await edges(page.locator(".header__language"));
  expect(bar.left).toBeGreaterThanOrEqual(placeRow.right - 0.5);
}

/** The phone's place row with the menu at its end, no header bar (REQ-731). */
async function expectPhoneHeader(page: Page) {
  await expect(header(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeVisible();
}

const TABLETS: { name: string; device: string; turned: boolean }[] = [
  { name: "iPad Pro 11 upright", device: "iPad Pro 11", turned: false },
  { name: "iPad Pro 11 turned", device: "iPad Pro 11", turned: true },
  { name: "iPad Mini upright", device: "iPad Mini", turned: false },
  { name: "Galaxy Tab S4 upright", device: "Galaxy Tab S4", turned: false },
  { name: "Galaxy Tab S9 upright", device: "Galaxy Tab S9", turned: false },
  { name: "Galaxy Z Fold 6 unfolded", device: "Galaxy Z Fold 6", turned: false },
];

for (const tablet of TABLETS) {
  test.describe(tablet.name, () => {
    test.use(device(tablet.device, tablet.turned));
    ownDevice();

    test("the phone's design with the desktop's header bar beside the place row, no menu (REQ-728, REQ-731)", async ({
      page,
    }) => {
      await open(page);
      await expectPhoneDesign(page);
      await expectDesktopHeaderInRow(page);
      await expectNoSidewaysOverflow(page);
    });
  });
}

test.describe("Galaxy Z Fold 6 folded", () => {
  test.use(device("Galaxy Z Fold 6 Cover"));
  ownDevice();

  test("is a phone: the phone's place row with the menu (REQ-728)", async ({ page }) => {
    await open(page);
    await expectPhoneDesign(page);
    await expectPhoneHeader(page);
    // A phone opens the full-screen view by turning, it has no button for it.
    await expect(page.getByTestId("meteogram-fullscreen-open")).toHaveCount(0);
    await expectNoSidewaysOverflow(page);
  });
});

test.describe("narrow tablet", () => {
  /** A tablet whose short side just makes it one (DEC-090), too narrow upright for the desktop's header row. */
  const NARROW: Size = { width: 600, height: 960 };
  test.use({ viewport: NARROW, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: "UTC", locale: "en-GB" });
  ownDevice();

  test("upright the phone's place row with the menu; turned, with room, the desktop's header bar again (REQ-731)", async ({
    page,
  }) => {
    await open(page);
    await expectPhoneDesign(page);
    await expectPhoneHeader(page);
    // The search field takes the row's free width, the menu stands at its end.
    const menu = await edges(menuButton(page));
    expect(menu.right).toBeGreaterThan(NARROW.width - 20);
    await expectNoSidewaysOverflow(page);
    await expect(page).toHaveScreenshot("tablet-narrow-upright.png", { maxDiffPixelRatio: 0.002 });

    await page.setViewportSize({ width: NARROW.height, height: NARROW.width });
    await settle(page);
    await expectDesktopHeaderInRow(page);
    // Low as it is turned, its column still lets nothing run over the screen's bottom (REQ-728).
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(NARROW.width);
    await expectNoSidewaysOverflow(page);

    await page.setViewportSize(NARROW);
    await settle(page);
    await expectPhoneHeader(page);
  });

  test("a wider language field that no longer fits switches to the menu as well (REQ-731)", async ({ page }) => {
    await page.setViewportSize({ width: 660, height: 960 });
    await open(page);
    await expectDesktopHeaderInRow(page);
    // Wider buttons than the row has room for: as with a long language name or a narrower screen.
    await page.addStyleTag({ content: ".header__language .header__select { min-width: 15rem; }" });
    await settle(page);
    await expectPhoneHeader(page);
  });
});

test.describe("tablet turned", () => {
  test.use(device("iPad Pro 11", true));
  ownDevice();

  test("the phone's upright view over the whole width, the chart fits, nothing runs over (REQ-728, REQ-750)", async ({
    page,
  }) => {
    await open(page);
    const viewport = page.viewportSize()!;
    // The page does not scroll: the chart takes the height left, its areas lowered as on a phone where needed.
    await expect(page.getByTestId("meteogram-scroll")).toHaveClass(/meteogram__scroll--fits/);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
    const footer = await edges(page.getByTestId("footer-slot"));
    expect(footer.bottom).toBeLessThanOrEqual(viewport.height + 0.5);
    // No column in the middle as wide as a phone (REQ-750): the main part as wide as the place row, the page's width.
    const main = await edges(page.locator(".app__main"));
    const top = await edges(page.locator(".app__top"));
    expect(main.width).toBeGreaterThan(viewport.width * 0.95);
    expect(Math.abs(main.left - top.left)).toBeLessThan(1);
    expect(Math.abs(main.right - top.right)).toBeLessThan(1);
    // The chart shows more days than the phone's 4.5 on the page's width, it scrolls sideways within its own box.
    await expectNoSidewaysOverflow(page);
    await expect(page).toHaveScreenshot("tablet-ipad-landscape.png", { maxDiffPixelRatio: 0.002 });
  });

  test("a double tap on the chart opens the full-screen view, the close button closes it (REQ-728)", async ({ page }) => {
    await open(page);
    const box = (await embedded(page).boundingBox())!;
    const x = box.x + 120;
    const y = box.y + box.height / 3;
    // A single tap opens nothing.
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(450);
    await expect(dialog(page)).toHaveCount(0);
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    // The phone's view with a close button; copy and share stay in the page's footer.
    await expect(dialog(page).getByTestId("meteogram-save")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("the button in the footer beside copy and share opens the full-screen view (REQ-728)", async ({ page }) => {
    await open(page);
    const slot = page.getByTestId("footer-slot");
    const buttons = slot.locator("button");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveAttribute("data-testid", "meteogram-copy");
    await expect(buttons.nth(1)).toHaveAttribute("data-testid", "meteogram-save");
    await expect(buttons.nth(2)).toHaveAttribute("data-testid", "meteogram-fullscreen-open");
    await slot.getByTestId("meteogram-fullscreen-open").tap();
    await expect(dialog(page)).toBeVisible();
    // Turning the tablet back upright does not close the view (only a phone's view closes so); Escape does.
    await page.setViewportSize({ width: 834, height: 1194 });
    await settle(page);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("turning upright gives the page its whole width back", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 834, height: 1194 });
    await settle(page);
    await expect
      .poll(async () => (await edges(page.locator(".app__main"))).width)
      .toBeGreaterThan(800);
    await expectPhoneDesign(page);
    await expectNoSidewaysOverflow(page);
  });
});

test.describe("tablet upright", () => {
  test.use(device("iPad Pro 11"));
  ownDevice();

  test("the footer's button and a double tap open the full-screen view upright as well (REQ-728)", async ({ page }) => {
    await open(page);
    await expect(page).toHaveScreenshot("tablet-ipad-portrait.png", { maxDiffPixelRatio: 0.002 });
    await page.getByTestId("footer-slot").getByTestId("meteogram-fullscreen-open").tap();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
    const box = (await embedded(page).boundingBox())!;
    await page.touchscreen.tap(box.x + 120, box.y + 200);
    await page.touchscreen.tap(box.x + 120, box.y + 200);
    await expect(dialog(page)).toBeVisible();
  });
});

/** What a tablet shares with the iPhone 13 upright, measured on the page. */
interface Measures {
  /** Visible width of the chart's scrolling box (CSS px). */
  chartWidth: number;
  /** CSS px per viewBox unit of the embedded chart. */
  pxPerUnit: number;
  /** Font size of the chart's axis labels on the screen (CSS px), from the height of their digits. */
  axisFont: number;
  /** Computed font sizes of the day slider's weekday and date labels (CSS px). */
  weekdayFont: number;
  dateFont: number;
  /** Day slider labels that overlap their neighbour (weekday or date). */
  overlapping: string[];
  /** The chart scrolls sideways in its own box. */
  swipeable: boolean;
}

async function measure(page: Page): Promise<Measures> {
  const areas = await axisLabelAreas(embedded(page));
  // One-line labels: from the top of their digits (0.72 of the font size above the baseline) to the baseline.
  const heights = areas
    .flatMap((area) => area.labels)
    .filter((label) => label.lines.length === 1)
    .map((label) => (label.bottom - label.top) / 0.72)
    .sort((a, b) => a - b);
  const axisFont = heights[Math.floor(heights.length / 2)]!;
  const rest = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('[data-testid="meteogram-scroll"]')!;
    const svg = scroll.querySelector<SVGSVGElement>("svg.meteogram-svg-integrated")!;
    const font = (selector: string) =>
      parseFloat(getComputedStyle(document.querySelector(`.day-slider__track ${selector}`)!).fontSize);
    const overlapping: string[] = [];
    for (const selector of [".day-card__weekday", ".day-card__date"]) {
      const boxes = [...document.querySelectorAll(`.day-slider__track ${selector}`)]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0);
      boxes.forEach((box, index) => {
        if (index > 0 && box.left < boxes[index - 1]!.right - 0.5) overlapping.push(`${selector} ${index}`);
      });
    }
    const overflow = getComputedStyle(scroll).overflowX;
    return {
      chartWidth: scroll.clientWidth,
      pxPerUnit: svg.getBoundingClientRect().width / svg.viewBox.baseVal.width,
      weekdayFont: font(".day-card__weekday"),
      dateFont: font(".day-card__date"),
      overlapping,
      swipeable: (overflow === "auto" || overflow === "scroll") && scroll.scrollWidth > scroll.clientWidth,
    };
  });
  return { ...rest, axisFont };
}

/** The measures of the iPhone 13 upright, in a context of its own. */
async function phoneMeasures(browser: Browser): Promise<Measures> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices["iPhone 13"]!;
  const context = await browser.newContext({ ...options, timezoneId: "UTC", locale: "en-GB" });
  const page = await context.newPage();
  // As the fixtures do for the test's own page: the place's favourites and no request to Open-Meteo itself.
  await mockOpenMeteo(page);
  await page.addInitScript((favorites) => {
    localStorage.setItem("graupel.favorites", JSON.stringify(favorites));
  }, STORED_FAVORITES);
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await open(page);
  const measures = await measure(page);
  await context.close();
  return measures;
}

/** Swipes the chart to the left with a finger (Chromium's touch events); its scroll position afterwards. */
async function swipeChart(page: Page) {
  const scroll = page.getByTestId("meteogram-scroll");
  const box = (await scroll.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width * 0.7);
  const y = Math.round(box.y + box.height / 2);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - step * 15, y }] });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

/** The day slider, the chart's scale and axis font of the iPhone 13 (REQ-742, REQ-744, REQ-750). */
function expectPhoneMeasures(tablet: Measures, phone: Measures) {
  expect(tablet.overlapping).toEqual([]);
  expect(tablet.weekdayFont).toBe(phone.weekdayFont);
  expect(tablet.dateFont).toBe(phone.dateFont);
  // CSS px per viewBox unit as on the phone, well within the 10 % the acceptance allows.
  expect(tablet.pxPerUnit).toBeCloseTo(phone.pxPerUnit, 2);
  expect(Math.abs(tablet.axisFont / phone.axisFont - 1)).toBeLessThan(0.1);
  expect(tablet.swipeable).toBe(true);
}

/** Side margin of the page on a tablet (AppLayout.css, `--page-gutter`: 16 px × 2/3). */
const TABLET_GUTTER = (16 * 2) / 3;

/**
 * The element reaches over the page's whole width, to its side margins or beyond them to the screen's edges, and not
 * past the screen (REQ-750).
 */
async function expectWholeWidth(page: Page, testid: string) {
  const viewport = page.viewportSize()!;
  const box = await edges(page.getByTestId(testid).first());
  expect(box.left, testid).toBeGreaterThanOrEqual(-0.5);
  expect(box.right, testid).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.left, testid).toBeLessThanOrEqual(TABLET_GUTTER + 0.5);
  expect(box.right, testid).toBeGreaterThanOrEqual(viewport.width - TABLET_GUTTER - 0.5);
}

/**
 * iPads upright and turned: the iPad Mini as wide as the iPad Air 2 (768 × 1024 CSS px) the wish came from (REQ-750),
 * and the iPad Pro 11 of the tablet projects.
 */
const IPADS: { name: string; device: string; turned: boolean }[] = [
  { name: "iPad Pro 11 turned", device: "iPad Pro 11", turned: true },
  { name: "iPad Mini turned", device: "iPad Mini", turned: true },
  { name: "iPad Pro 11 upright", device: "iPad Pro 11", turned: false },
  { name: "iPad Mini upright", device: "iPad Mini", turned: false },
];

for (const ipad of IPADS) {
  test.describe(`${ipad.name} at the iPhone 13's scale`, () => {
    test.use(device(ipad.device, ipad.turned));
    ownDevice();

    // Upright and turned (REQ-744, REQ-750).
    test("slider, legend and chart over the whole width, the iPhone 13's scale and fonts, swiping in its card", async ({
      page,
      browser,
    }) => {
      const phone = await phoneMeasures(browser);
      await open(page);
      const tablet = await measure(page);
      expectPhoneMeasures(tablet, phone);
      // As many more days as the chart is wider than the phone's: its visible width is the screen's.
      const viewport = page.viewportSize()!;
      expect(tablet.chartWidth).toBeGreaterThan(viewport.width - 2 * TABLET_GUTTER - 0.5);
      // Slider, legend card and the chart's card over the page's whole width, not in a column as wide as a phone.
      await expect(page.getByTestId("meteogram-legend")).toBeVisible();
      for (const testid of ["day-slider-track", "meteogram-legend", "meteogram-card"]) {
        await expectWholeWidth(page, testid);
      }
      await expectNoSidewaysOverflow(page);
      // A swipe moves the chart in its box; the page and its header stay where they are.
      const headerBefore = await edges(page.locator(".app__top"));
      const before = await page.getByTestId("meteogram-scroll").evaluate((element) => element.scrollLeft);
      await swipeChart(page);
      await expect
        .poll(() => page.getByTestId("meteogram-scroll").evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(before + 50);
      const page_ = await page.evaluate(() => ({
        scrollX: window.scrollX,
        scrollWidth: document.scrollingElement!.scrollWidth,
        width: window.innerWidth,
      }));
      expect(page_.scrollX).toBe(0);
      expect(page_.scrollWidth).toBeLessThanOrEqual(page_.width);
      expect((await edges(page.locator(".app__top"))).left).toBeCloseTo(headerBefore.left, 1);
      await expectNoSidewaysOverflow(page);
    });
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 }, timezoneId: "UTC", locale: "en-GB" });
  ownDevice();

  test("without a coarse pointer the desktop's page as before: cards, the header bar, buttons beside the chart", async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByTestId("day-slider-label")).toBeVisible();
    await expect(page.getByTestId("meteogram-tools")).toBeVisible();
    await expect(header(page)).toBeVisible();
    await expect(menuButton(page)).toHaveCount(0);
  });
});
