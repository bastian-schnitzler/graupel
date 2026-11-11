// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The tablet's top row as on the desktop (REQ-748, REQ-731): on an iPad, upright and turned, the place row and the
 * desktop's header bar stand in one row in the desktop's card, without the menu: search field, map, favourites, the
 * installed app's history with the day beside the clock, language, settings and info, nothing overlapping. The search
 * field is as wide as on a desktop of the same width (±10 %), it does not take the row's free width. The row does not
 * switch to the menu afterwards, when the forecast has loaded and the history's day appears. Only where the buttons do
 * not fit, on a narrow tablet, the phone's place row with the menu stands there as before.
 *
 * The tablets run in Chromium with each device's size, touch and user agent, in light mode (as tablet.spec.ts); the
 * installed app is emulated by a matchMedia stand-in and its earlier fetch made by loading the page two days before (as
 * history.spec.ts). The picture of the iPad's row catches unintended moves; after an intended change of the look it is
 * taken again with `pnpm test:e2e --update-snapshots`.
 */
import { devices, type Browser } from "@playwright/test";
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast, mockOpenMeteo } from "./openMeteo.ts";
import { edges } from "./phoneLayout.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC; the earlier fetch Monday, 26 October 2026, 09:30 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const EARLIER = Date.UTC(2026, 9, 26, 9, 30);
const LOOK = { timezoneId: "UTC", locale: "de-DE", colorScheme: "light" } as const;

/** The time the fake Open-Meteo answers from: the page's clock. */
let now = FIXED_NOW;

/** A device of Playwright's list as a context's options, upright or turned, without its browser type. */
function device(name: string, turned = false) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices[name]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  // The screen as large as the page, as Playwright gives it without one; turned, its sides swap.
  return { ...options, viewport, screen: viewport, ...LOOK };
}

let errors: string[] = [];

function watchErrors(page: Page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

test.beforeEach(async ({ page }) => {
  errors = [];
  watchErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The installed app: its display mode matches (Playwright cannot set it); the fake Open-Meteo at the page's clock. */
async function installed(page: Page) {
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now }));
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({
            ...original(query),
            media: query,
            matches: true,
            addEventListener() {},
            removeEventListener() {},
          } as MediaQueryList)
        : original(query);
  });
}

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** Number of fetches in the page's archive (IndexedDB); 0 while it has none. */
const archivedCount = (page: Page) =>
  page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === "graupel-archive")) return 0;
    return new Promise<number>((resolve) => {
      const request = indexedDB.open("graupel-archive");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("fetches")) {
          db.close();
          resolve(0);
          return;
        }
        const count = db.transaction("fetches").objectStore("fetches").count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => resolve(0);
      };
      request.onerror = () => resolve(0);
    });
  });

/**
 * Loads the page two days before (the earlier fetch), then at the fixed time (the current one, with its history); with
 * `day`, until the history's button shows the day beside the clock.
 */
async function twoFetches(page: Page, day = true) {
  now = EARLIER;
  await page.clock.setFixedTime(EARLIER);
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect.poll(() => archivedCount(page)).toBeGreaterThan(0);
  now = FIXED_NOW;
  await page.clock.setFixedTime(FIXED_NOW);
  await page.reload();
  await expect(chart(page)).toBeVisible();
  if (day) await expect(page.getByTestId("history-day")).toHaveText("28.10.");
}

const searchField = (page: Page) => page.locator(".location__search");
const phoneMenu = (page: Page) => page.getByTestId("phone-menu");

/**
 * The desktop's row (REQ-748): no menu; search field, map, favourites, history (with its day), language, settings and
 * info side by side in one row within the card, centred on one line, none overlapping the next.
 */
async function expectDesktopRow(page: Page) {
  await expect(phoneMenu(page)).toHaveCount(0);
  await expect(page.locator("header.header")).toBeVisible();
  const parts = [
    searchField(page),
    page.locator(".location__map"),
    page.locator(".location__favorites"),
    page.getByTestId("history-button"),
    page.locator(".header__language"),
    page.getByRole("button", { name: "Einstellungen" }),
    page.getByRole("button", { name: "Info", exact: true }),
  ];
  const card = await edges(page.locator(".app__top"));
  const boxes = [];
  for (const part of parts) {
    await expect(part).toBeVisible();
    boxes.push(await edges(part));
  }
  const middle = boxes[0]!.top + boxes[0]!.height / 2;
  for (const [index, box] of boxes.entries()) {
    expect(Math.abs(box.top + box.height / 2 - middle), `part ${index} on the row's line`).toBeLessThan(2);
    expect(box.left, `part ${index} within the card`).toBeGreaterThanOrEqual(card.left);
    expect(box.right, `part ${index} within the card`).toBeLessThanOrEqual(card.right);
    const next = boxes[index + 1];
    if (next) expect(box.right, `part ${index} before the next`).toBeLessThanOrEqual(next.left + 0.5);
  }
  await expect(page.getByTestId("history-button").getByTestId("history-day")).toBeVisible();
}

/** Width of the search field on a desktop (no coarse pointer) of the same size, installed app with its history. */
async function desktopFieldWidth(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, ...LOOK });
  try {
    const page = await context.newPage();
    watchErrors(page);
    await mockOpenMeteo(page);
    await installed(page);
    await twoFetches(page);
    await expect(phoneMenu(page)).toHaveCount(0);
    return (await edges(searchField(page))).width;
  } finally {
    await context.close();
  }
}

const IPADS: { name: string; device: string; turned: boolean }[] = [
  { name: "iPad Pro 11 upright", device: "iPad Pro 11", turned: false },
  { name: "iPad Pro 11 turned", device: "iPad Pro 11", turned: true },
  { name: "iPad (gen 7) upright", device: "iPad (gen 7)", turned: false },
  { name: "iPad (gen 7) turned", device: "iPad (gen 7)", turned: true },
  { name: "iPad Mini upright", device: "iPad Mini", turned: false },
];

for (const ipad of IPADS) {
  test.describe(ipad.name, () => {
    test.use(device(ipad.device, ipad.turned));
    ownDevice();

    test("the desktop's row with the history's day, no menu, the search field as on the desktop (REQ-748)", async ({
      page,
      browser,
    }) => {
      await installed(page);
      await twoFetches(page);
      await expectDesktopRow(page);
      const field = (await edges(searchField(page))).width;
      const desktop = await desktopFieldWidth(browser, page.viewportSize()!);
      expect(field).toBeGreaterThanOrEqual(desktop * 0.9);
      expect(field).toBeLessThanOrEqual(desktop * 1.1);
    });
  });
}

test.describe("iPad upright, loading", () => {
  test.use(device("iPad (gen 7)"));
  ownDevice();

  test("stays in the desktop's row when the forecast has loaded and the history's day appears (REQ-748)", async ({
    page,
  }) => {
    await installed(page);
    // Each state the top row takes from the first drawing on: the desktop's row or the phone's row with the menu.
    await page.addInitScript(() => {
      const states: string[] = [];
      (window as Window & { topRowStates?: string[] }).topRowStates = states;
      const record = () => {
        const top = document.querySelector(".app__top");
        if (!top) return;
        const menu = top.querySelector("[data-testid=phone-menu]");
        const state = menu ? "menu" : top.querySelector(".header") ? "row" : "";
        if (state && states.at(-1) !== state) states.push(state);
      };
      new MutationObserver(record).observe(document, { childList: true, subtree: true });
    });
    await twoFetches(page);
    const states = () => page.evaluate(() => (window as Window & { topRowStates?: string[] }).topRowStates);
    expect(await states()).toEqual(["row"]);
    await page.waitForTimeout(2000);
    expect(await states()).toEqual(["row"]);
    await expectDesktopRow(page);
  });
});

test.describe("iPad Pro 11 upright, picture", () => {
  test.use(device("iPad Pro 11"));
  ownDevice();

  test("picture of the row in the desktop's card (REQ-748)", async ({ page }) => {
    await installed(page);
    await twoFetches(page);
    await expectDesktopRow(page);
    await expect(page.locator(".app__top")).toHaveScreenshot("tablet-header-ipad-portrait.png", {
      maxDiffPixelRatio: 0.002,
    });
  });
});

test.describe("narrow tablet", () => {
  test.use(device("Galaxy Tab S9"));
  ownDevice();

  test("where the buttons do not fit, the phone's place row with the menu as before, history in it (REQ-731)", async ({
    page,
  }) => {
    await installed(page);
    await twoFetches(page, false);
    await expect(phoneMenu(page)).toBeVisible();
    await expect(page.locator("header.header")).toHaveCount(0);
    await expect(page.getByTestId("history-button")).toHaveCount(0);
    // The search field takes the row's free width, the menu stands at its end.
    const menu = await edges(phoneMenu(page));
    expect(menu.right).toBeGreaterThan(page.viewportSize()!.width - 20);
    await page.getByRole("button", { name: "Menü" }).tap();
    await expect(page.getByTestId("phone-menu-panel").getByText("Historie · 28.10.")).toBeVisible();
  });
});
