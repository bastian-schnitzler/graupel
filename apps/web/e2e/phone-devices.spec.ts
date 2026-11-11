// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The website on a matrix of phones (REQ-693): three iPhones (SE, 13, 15 Pro Max) with Safari's sizes and three Android
 * phones with Chrome's (Pixel 7, Galaxy S24, and a Pixel 7 with 127 % page zoom, 324 px wide), each upright and turned,
 * light and dark. The tests run in Chromium with each phone's size, pixel density, touch and user agent (WebKit is not
 * installed); the layout rules of the phone page are checked on every phone:
 * - nothing beyond the screen's sides, no sideways scrolling (REQ-566);
 * - the place row in one row, the favourites in the middle between map and menu (REQ-691, REQ-689);
 * - the side margins the same share of the width (two thirds of 16 px of 390 px, REQ-722) for place row, day slider,
 *   legend, the chart's source line and the footer, the meteogram card from edge to edge (REQ-692, REQ-547);
 * - the day slider's grips and day labels on screen and inside their days, the legend card between slider and chart;
 * - the page fits the screen, or the chart keeps 40 % of it (REQ-608);
 * - no two axis labels of the chart overlap, compact on a small chart or not (REQ-694), upright and full screen;
 * - menu, favourites, settings and map within the screen;
 * - turned, the full-screen view from the top of the visible area down, nothing cut or scrolling (REQ-690, REQ-530),
 *   and with it closed the page in landscape clear of the camera (REQ-618).
 *
 * Chromium knows no browser bars, so the visible area is the viewport: on the iPhone the area below Safari's bars as
 * Playwright's device list gives it (the SE's estimated), on Android the area below Chrome's address bar. Safari on
 * iOS 26 lays the page out below its floating bottom bar too, where `svh` ends at the bar's top: that is copied by a
 * viewport higher by the bar with the chart's `svh` probe made lower (as in phone-height.spec.ts). In landscape the
 * iPhones with a notch or Dynamic Island report the camera's insets at both sides (viewport-fit=cover, as in
 * phone-safe-area.spec.ts). Pictures per phone, upright light and turned dark, catch unintended moves; after an
 * intended change of the look they are taken again with `pnpm test:e2e --update-snapshots`.
 */
import { devices } from "@playwright/test";
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { edges, expectAxisLabelsApart, expectNoSidewaysOverflow, expectWithin, type Area } from "./phoneLayout.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
/** The side margin's share of the screen's width (REQ-692): two thirds of 16 px of a 390 px iPhone (REQ-722). */
const SHARE = (16 / 390) * (2 / 3);
/** Bottom padding of the full-screen view below the row under the chart (MeteogramPanel.css, `--space-2`). */
const BOTTOM_PADDING = 8;
/** Room the core leaves above the model headers' boxes: about 1 px at these sizes. */
const TOP_TOLERANCE = 3;
/** Height of Safari's floating bottom bar on iOS 26 above which `svh` ends (as in phone-height.spec.ts). */
const SAFARI_BAR = 100;
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

interface Size {
  width: number;
  height: number;
}

interface Phone {
  /** Name, also in the pictures' file names. */
  name: string;
  ios: boolean;
  userAgent: string;
  deviceScaleFactor: number;
  /** Visible area upright (CSS px). */
  portrait: Size;
  /** Visible area turned (CSS px). */
  landscape: Size;
  /** The camera's inset at both sides in landscape (CSS px); 0 without a notch. */
  camera: number;
}

const PHONES: Phone[] = [
  // iPhone SE (3rd gen.), the smallest iPhone in use: Safari with its bars, estimated (no notch).
  {
    name: "iphone-se",
    ios: true,
    userAgent: IPHONE_SAFARI,
    deviceScaleFactor: 2,
    portrait: { width: 375, height: 548 },
    landscape: { width: 667, height: 325 },
    camera: 0,
  },
  // iPhone 13 (as 12, 14): Safari's sizes from Playwright's device list; turned, the page reaches the screen's
  // sides (viewport-fit=cover) and gets the camera's inset.
  {
    name: "iphone-13",
    ios: true,
    userAgent: IPHONE_SAFARI,
    deviceScaleFactor: 3,
    portrait: devices["iPhone 13"].viewport,
    landscape: { width: 844, height: devices["iPhone 13 landscape"].viewport.height },
    camera: 47,
  },
  // iPhone 15 Pro Max, the largest iPhone: Dynamic Island, 59 px inset in landscape.
  {
    name: "iphone-15-pro-max",
    ios: true,
    userAgent: IPHONE_SAFARI,
    deviceScaleFactor: 3,
    portrait: devices["iPhone 15 Pro Max"].viewport,
    landscape: {
      width: 932,
      height: devices["iPhone 15 Pro Max landscape"].viewport.height,
    },
    camera: 59,
  },
  // Pixel 7 with Chrome, from Playwright's device list.
  {
    name: "pixel-7",
    ios: false,
    userAgent: devices["Pixel 7"].userAgent,
    deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor,
    portrait: devices["Pixel 7"].viewport,
    landscape: devices["Pixel 7 landscape"].viewport,
    camera: 0,
  },
  // Galaxy S24 (360 px) with Chrome's address bar (56 px) and the status and navigation bars.
  {
    name: "galaxy-s24",
    ios: false,
    userAgent: devices["Galaxy S24"].userAgent,
    deviceScaleFactor: devices["Galaxy S24"].deviceScaleFactor,
    portrait: { width: 360, height: 700 },
    landscape: { width: 780, height: 304 },
    camera: 0,
  },
  // Pixel 7 with Chrome's page zoom at 127 %: 412 / 1.27 = 324 px wide, every other size smaller by as much.
  {
    name: "android-zoom",
    ios: false,
    userAgent: devices["Pixel 7"].userAgent,
    deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor * 1.27,
    portrait: { width: 324, height: 660 },
    landscape: { width: 680, height: 283 },
    camera: 0,
  },
];

let errors: string[] = [];

test.use({ isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "UTC" });
ownDevice();
// The phones' tests are independent of each other: spread over the workers, the matrix does not hold up the run.
test.describe.configure({ mode: "parallel" });

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  // No network for the map (as in map-picker.spec.ts): OpenTopoMap tiles are a transparent pixel.
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const location = (page: Page) => page.locator('[data-region="location"]');
const menuButton = (page: Page) => location(page).getByRole("button", { name: "Menu" });
const menuPanel = (page: Page) => page.getByTestId("phone-menu-panel");
const frames = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** Gives the page the screen's safe-area insets, as Safari reports them with viewport-fit=cover. */
async function setInsets(page: Page, insets: { left?: number; right?: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
  await cdp.detach();
}

/**
 * As Safari on iOS 26, whose `svh` ends `by` px above the window's bottom, at the top of its floating bar. Chromium's
 * `svh` is the window's height, so the chart's probe for it is made lower (as in phone-height.spec.ts).
 */
async function svhAboveBar(page: Page, by: number) {
  await page.addInitScript((by) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = `[data-portrait-probe] { height: calc(100vh - ${by}px) !important; }`;
      document.head.append(style);
    });
  }, by);
}

/** Opens the page upright in the colour mode `theme` and waits until the chart has taken its height. */
async function open(page: Page, theme: "light" | "dark") {
  await page.addInitScript((mode) => window.localStorage.setItem("graupel.colorMode", mode), theme);
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await settle(page, () => chart(page).evaluate((svg) => svg.getBoundingClientRect().height));
}

/** Waits until `read` gives the same value on two rendering steps in a row. */
async function settle(page: Page, read: () => Promise<unknown>) {
  let previous = "";
  await expect
    .poll(async () => {
      await frames(page);
      const next = JSON.stringify(await read());
      const steady = next === previous;
      previous = next;
      return steady;
    })
    .toBe(true);
}

/** Turns the phone: insets, then the size, until the media query of a phone in landscape follows. */
async function turn(page: Page, phone: Phone) {
  if (phone.camera > 0) await setInsets(page, { left: phone.camera, right: phone.camera });
  await page.setViewportSize(phone.landscape);
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

/** Place row in one row: field, map, favourites, menu side by side, all inside `area` (REQ-691). */
async function expectPlaceRow(page: Page, area: Area) {
  const row = location(page);
  const parts = [
    row.locator(".location__field"),
    row.getByRole("button", { name: "Map", exact: true }),
    row.locator(".location__favorites"),
    menuButton(page),
  ];
  const boxes = [];
  for (const part of parts) boxes.push(await expectWithin(part, area, "place row"));
  const centre = (b: { top: number; bottom: number }) => (b.top + b.bottom) / 2;
  for (const b of boxes) expect(Math.abs(centre(b) - centre(boxes[0]!))).toBeLessThan(1);
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index]!.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
  }
  // The field keeps room for its GPS and X buttons and some text.
  expect(boxes[0]!.width).toBeGreaterThan(100);
  return boxes;
}

/** Menu, favourites and settings open within `area` and leave the page without sideways overflow. */
async function expectMenusWithin(page: Page, area: Area) {
  const button = await edges(menuButton(page));
  await menuButton(page).tap();
  const panel = await expectWithin(menuPanel(page), area, "menu");
  expect(panel.top).toBeGreaterThanOrEqual(button.bottom - 0.5);
  await expectNoSidewaysOverflow(page, "menu");
  await menuPanel(page).getByRole("button", { name: "Settings" }).tap();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expectWithin(settings, area, "settings");
  await expectNoSidewaysOverflow(page, "settings");
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  await location(page).getByRole("button", { name: "Show favourites" }).tap();
  await expectWithin(location(page).getByRole("menu"), area, "favourites");
  await expectNoSidewaysOverflow(page, "favourites");
  await page.keyboard.press("Escape");
  await expect(location(page).getByRole("menu")).toBeHidden();
}

/** The map opens within `area`, its buttons and attribution too; Cancel closes it. */
async function expectMapWithin(page: Page, area: Area, screen: Size) {
  await location(page).getByRole("button", { name: "Map", exact: true }).tap();
  const map = page.getByRole("dialog", { name: "Map" });
  await expect(map).toBeVisible();
  await expectWithin(map, { left: 0, top: 0, right: screen.width, bottom: screen.height }, "map");
  const attribution = map.locator(".leaflet-control-attribution");
  await expect(attribution).toBeVisible();
  for (const [name, part] of [
    ["map area", map.locator(".map-dialog__map")],
    ["OK", map.getByRole("button", { name: "OK" })],
    ["Cancel", map.getByRole("button", { name: "Cancel" })],
    ["zoom", map.locator(".leaflet-control-zoom")],
    ["attribution", attribution],
  ] as const) {
    await expect.poll(async () => (await edges(part)).width, name).toBeGreaterThan(0);
    await expectWithin(part, area, name);
  }
  await expectNoSidewaysOverflow(page, "map");
  await map.getByRole("button", { name: "Cancel" }).tap();
  await expect(map).toHaveCount(0);
}

/** Where the full-screen view, its chart, the model headers and the row below the chart stand; what scrolls. */
function measureFullscreen(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("dialog.meteogram-fullscreen")!;
    const svg = dialog.querySelector<SVGSVGElement>('svg[data-render-mode="fullscreen"]')!;
    const box = (element: Element) => {
      const { top, bottom, left, right, height, width } = element.getBoundingClientRect();
      return { top, bottom, left, right, height, width };
    };
    const row = dialog.querySelector('[data-testid="meteogram-footer-row"]')!;
    const scrolling = [document.scrollingElement!, dialog, dialog.querySelector(".dialog__body")!]
      .filter((element) => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
      .map((element) => element.className || element.tagName);
    return {
      dialog: box(dialog),
      chart: box(svg),
      headers: [...svg.querySelectorAll('[data-testid="model-header-shape"]')].map(box),
      row: box(row),
      scrolling,
    };
  });
}

for (const phone of PHONES) {
  test.describe(`${phone.name} (REQ-693)`, () => {
    test.use({
      viewport: phone.portrait,
      userAgent: phone.userAgent,
      deviceScaleFactor: phone.deviceScaleFactor,
    });
    ownDevice();

    for (const theme of ["light", "dark"] as const) {
      test(`upright, ${theme}: place row, margins, day slider, legend, meteogram card, menus, map`, async ({
        page,
      }) => {
        await open(page, theme);
        const { width, height } = phone.portrait;
        const screen: Area = { left: 0, top: 0, right: width, bottom: height };
        await expectNoSidewaysOverflow(page);

        // The place row in one row, the favourites in the middle between map and menu (REQ-689, REQ-691).
        const [, map, favourites, menu] = await expectPlaceRow(page, screen);
        const before = favourites!.left - map!.right;
        const after = menu!.left - favourites!.right;
        expect(Math.abs(before - after)).toBeLessThanOrEqual(2);
        expect(before).toBeGreaterThan(4);

        // Side margins the same share of the width (REQ-692).
        const margin = width * SHARE;
        const near = (actual: number, expected: number, name: string) =>
          expect(Math.abs(actual - expected), name).toBeLessThanOrEqual(0.75);
        for (const [name, selector] of [
          ["place row", ".location__bar"],
          ["day slider", '[data-region="day-slider"]'],
          ["footer", ".footer__row"],
        ] as const) {
          const b = await edges(page.locator(selector));
          near(b.left, margin, name);
          near(width - b.right, margin, name);
        }
        const source = page.locator(".meteogram__source");
        await expect(source).toBeVisible();
        // In the footer's row after the buttons, right-aligned at the margin (REQ-729).
        const padding = await source.evaluate((element) => parseFloat(getComputedStyle(element).paddingRight));
        near(width - ((await edges(source)).right - padding), margin, "source line");

        // The day slider's grips on screen; each day's weekday and date inside its day.
        for (const grip of ["day-slider-start", "day-slider-end"]) {
          await expectWithin(page.getByTestId(grip), screen, grip);
        }
        const days = await page.getByTestId("day-card").evaluateAll((cards) =>
          cards.map((card) => {
            const box = card.getBoundingClientRect();
            const texts = [...card.querySelectorAll(".day-card__weekday, .day-card__date")].map((text) =>
              text.getBoundingClientRect(),
            );
            return {
              left: box.left,
              right: box.right,
              textLeft: Math.min(...texts.map((text) => text.left)),
              textRight: Math.max(...texts.map((text) => text.right)),
            };
          }),
        );
        expect(days.length).toBeGreaterThanOrEqual(5);
        for (const day of days) {
          expect(day.textLeft).toBeGreaterThanOrEqual(day.left - 0.5);
          expect(day.textRight).toBeLessThanOrEqual(day.right + 0.5);
          expect(day.left).toBeGreaterThanOrEqual(-0.5);
          expect(day.right).toBeLessThanOrEqual(width + 0.5);
        }

        // The meteogram card from the screen's left edge to its right edge (REQ-547).
        const card = await edges(page.getByTestId("meteogram-card"));
        near(card.left, 0, "meteogram card");
        near(card.right, width, "meteogram card");
        const slider = await edges(page.locator('[data-region="day-slider"]'));

        // The legend card between the day slider and the chart, within the margins (REQ-692).
        const legend = page.getByTestId("meteogram-legend");
        await expect(legend).toBeVisible();
        const legendBox = await edges(legend);
        near(legendBox.left, margin, "legend");
        near(width - legendBox.right, margin, "legend");
        expect(legendBox.top).toBeGreaterThanOrEqual(slider.bottom);
        expect(legendBox.bottom).toBeLessThanOrEqual(card.top + 0.5);

        // The page fits the screen with the footer on it, or the chart keeps 40 % of the screen (REQ-608).
        const sizes = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        }));
        const chartHeight = (await edges(chart(page))).height;
        if (sizes.scrollHeight > sizes.clientHeight) {
          expect(Math.abs(chartHeight - 0.4 * height)).toBeLessThanOrEqual(1);
        } else {
          expect(chartHeight).toBeGreaterThanOrEqual(0.4 * height - 1);
          expect((await edges(page.locator('[data-region="footer"]'))).bottom).toBeLessThanOrEqual(height + 0.5);
        }

        // No two axis labels overlap (REQ-694).
        await expectAxisLabelsApart(chart(page), "upright chart");

        if (theme === "light") {
          await page.evaluate(() => window.scrollTo(0, 0));
          await expect(page).toHaveScreenshot(`${phone.name}-portrait-${theme}.png`, { maxDiffPixelRatio: 0.002 });
        }

        // Menu, favourites, settings and map within the screen.
        await expectMenusWithin(page, screen);
        await expectMapWithin(page, screen, phone.portrait);
      });

      test(`turned, ${theme}: full-screen view from the top, nothing cut; closed, the page clear of the camera`, async ({
        page,
      }) => {
        await open(page, theme);
        await turn(page, phone);
        const { width, height } = phone.landscape;
        const dialog = fullscreen(page);
        await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
        await expect(dialog.locator('[data-testid="model-header-shape"]').first()).toBeVisible();
        // The chart settles once its row below took the size of the extremes (REQ-587).
        await settle(page, () => measureFullscreen(page));
        const view = await measureFullscreen(page);

        // The view covers the screen; the chart begins at the top, its model headers right below it (REQ-690).
        expect(Math.abs(view.dialog.top)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(view.dialog.bottom - height)).toBeLessThanOrEqual(0.5);
        expect(view.dialog.left).toBeGreaterThanOrEqual(-0.5);
        expect(view.dialog.right).toBeLessThanOrEqual(width + 0.5);
        expect(view.chart.top).toBeGreaterThanOrEqual(0);
        expect(view.chart.top).toBeLessThanOrEqual(0.5);
        expect(view.chart.left).toBeGreaterThanOrEqual(-0.5);
        expect(view.chart.right).toBeLessThanOrEqual(width + 0.5);
        // At most the camera's inset at each side left free (REQ-606).
        expect(view.chart.width).toBeGreaterThanOrEqual(width - 2 * phone.camera - 1);
        expect(view.headers.length).toBeGreaterThan(0);
        for (const header of view.headers) {
          expect(header.top).toBeGreaterThanOrEqual(0);
          expect(header.top).toBeLessThanOrEqual(TOP_TOLERANCE);
        }
        // The chart takes the height down to the row below it; nothing cut at the bottom, nothing scrolls (REQ-530).
        expect(Math.abs(view.chart.bottom - view.row.top)).toBeLessThanOrEqual(1);
        expect(view.row.height).toBeGreaterThan(0);
        expect(view.row.bottom).toBeLessThanOrEqual(height - BOTTOM_PADDING + 0.5);
        expect(view.scrolling).toEqual([]);
        await expectNoSidewaysOverflow(page, "full screen");
        await expectAxisLabelsApart(dialog.locator('svg[data-render-mode="fullscreen"]'), "full screen");
        if (theme === "dark") {
          await expect(page).toHaveScreenshot(`${phone.name}-landscape-${theme}.png`, { maxDiffPixelRatio: 0.002 });
        }

        // Closed, the page in landscape: no sideways overflow, the place row in one row, menus and map clear of the
        // camera (REQ-618).
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(chart(page)).toBeVisible();
        await frames(page);
        await expectNoSidewaysOverflow(page, "landscape page");
        const beside: Area = { left: phone.camera, top: 0, right: width - phone.camera, bottom: height };
        await page.evaluate(() => window.scrollTo(0, 0));
        await expectPlaceRow(page, beside);
        for (const selector of ['[data-region="day-slider"]', '[data-testid="meteogram-card"]']) {
          const b = await edges(page.locator(selector));
          expect(b.left, selector).toBeGreaterThanOrEqual(phone.camera - 0.5);
          expect(b.right, selector).toBeLessThanOrEqual(width - phone.camera + 0.5);
        }
        // The menu is taller than a low landscape screen may be: it scrolls with the page; only its sides count.
        await expectMenusWithin(page, { ...beside, bottom: Number.POSITIVE_INFINITY });
        await expectMapWithin(page, beside, phone.landscape);
      });
    }

    if (phone.ios) {
      test("upright in Safari on iOS 26: svh ends at the floating bar, the footer stands on it (REQ-608, REQ-614)", async ({
        page,
      }) => {
        // The window reaches below the bar; `svh` ends at its top, where the visible area ended above.
        await page.setViewportSize({ width: phone.portrait.width, height: phone.portrait.height + SAFARI_BAR });
        await svhAboveBar(page, SAFARI_BAR);
        await open(page, "light");
        const { width } = phone.portrait;
        await expectNoSidewaysOverflow(page);
        await expectPlaceRow(page, { left: 0, top: 0, right: width, bottom: phone.portrait.height });
        const measured = await page.evaluate(() => {
          const footer = document.querySelector<HTMLElement>('[data-region="footer"]')!;
          const room = parseFloat(getComputedStyle(footer).paddingBottom) || 0;
          return {
            svh: document.querySelector("[data-portrait-probe]")!.getBoundingClientRect().height,
            footerRow: footer.getBoundingClientRect().bottom - room + window.scrollY,
            scrollHeight: document.documentElement.scrollHeight,
            clientHeight: document.documentElement.clientHeight,
            chart: document
              .querySelector('[data-region="meteogram"] svg.meteogram-svg-integrated')!
              .getBoundingClientRect().height,
          };
        });
        expect(Math.abs(measured.svh - phone.portrait.height)).toBeLessThanOrEqual(0.5);
        if (measured.scrollHeight <= measured.clientHeight) {
          // The page fits: the footer's row ends at the bar's top, not behind it.
          expect(measured.footerRow).toBeLessThanOrEqual(measured.svh + 0.5);
          expect(measured.footerRow).toBeGreaterThan(measured.svh - 2);
        } else {
          expect(Math.abs(measured.chart - 0.4 * measured.svh)).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}
