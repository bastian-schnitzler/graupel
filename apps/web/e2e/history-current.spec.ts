// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The newest fetch counts as the current values only while it is at most 20 minutes old (REQ-757): right after the
 * fetch the history shows it in gold on top with a gold clock (at the desktop's and tablet's button, in the phone's
 * menu entry); 21 minutes later, without a reload, there is no gold entry, the fetch stands among the earlier ones and
 * the clock is no longer gold. A reload makes the new fetch current again. In every device class, with the page's
 * clock installed (`page.clock.install`) so that its timers run on. The installed app is emulated by a matchMedia
 * stand-in (as in history.spec.ts); the earlier fetch is made by loading the page two days before.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Wednesday, 28 October 2026, 11:00 UTC; the earlier fetch Monday, 26 October 2026, 09:30 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const EARLIER = Date.UTC(2026, 9, 26, 9, 30);
const GOLD = "rgb(183, 121, 31)";

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];
/** The time the fake Open-Meteo answers from. */
let now = EARLIER;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  now = EARLIER;
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now }));
  // The installed app: its display mode matches (Playwright cannot set it).
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
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chartShown = (page: Page) =>
  expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();

/** Number of fetches in the page's archive (IndexedDB); 0 while it has none. Never creates the database itself. */
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

/** Loads the page at `time` and waits until its fetch is archived (`count` fetches in all). */
async function fetchAt(page: Page, time: number, count: number) {
  now = time;
  await page.clock.setSystemTime(time);
  await page.reload();
  await chartShown(page);
  await expect.poll(() => archivedCount(page)).toBe(count);
}

/**
 * The history in this device class: the desktop's split button beside the favourites (also on a tablet with the
 * header bar), else the phone's menu entry with its dialog (REQ-573, REQ-745).
 */
async function history(page: Page) {
  const button = page.getByTestId("history-button");
  const menu = page.getByTestId("phone-menu").getByRole("button", { name: "Menu" });
  await expect(button.or(menu).first()).toBeVisible();
  const split = (await button.count()) > 0;
  const entry = () => page.getByTestId("phone-menu-panel").getByRole("button", { name: /^History/ });
  return {
    /** The clock icon: at the button, or in the menu entry (opening the menu). */
    async clock(): Promise<Locator> {
      if (split) return page.getByTestId("history-main").locator(".location__history-clock");
      if (!(await page.getByTestId("phone-menu-panel").isVisible())) await menu.click();
      await expect(entry()).toBeVisible();
      return entry().locator(".icon");
    },
    /** Opens the choice and returns it. */
    async open(): Promise<Locator> {
      if (split) {
        await page.getByTestId("history-arrow").click();
        const list = page.getByTestId("history-button").getByTestId("history-list");
        await expect(list).toBeVisible();
        return list;
      }
      if (!(await page.getByTestId("phone-menu-panel").isVisible())) await menu.click();
      await entry().click();
      const dialog = page.getByRole("dialog", { name: "History" });
      await expect(dialog).toBeVisible();
      return dialog.getByTestId("history-list");
    },
    async close() {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("history-list")).toHaveCount(0);
      if (await page.getByTestId("phone-menu-panel").isVisible()) await page.keyboard.press("Escape");
    },
  };
}

const colorOf = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).color);

test("the newest fetch is gold only up to 20 minutes, without a reload; a reload makes it current again", async ({
  page,
}) => {
  await page.clock.install({ time: EARLIER });
  await page.goto(APP);
  await chartShown(page);
  await expect.poll(() => archivedCount(page)).toBe(1);
  await fetchAt(page, FIXED_NOW, 2);

  // Right after the fetch: gold entry on top, gold clock.
  const h = await history(page);
  expect(await colorOf(await h.clock())).toBe(GOLD);
  let list = await h.open();
  const current = list.getByTestId("history-current");
  await expect(current).toHaveText("28/10/2026, 11:00");
  expect(await colorOf(current)).toBe(GOLD);
  await expect(list.getByTestId("history-fetch")).toHaveText(["26/10/2026, 09:30"]);
  await page.screenshot({ path: test.info().outputPath("current.png") });
  await h.close();

  // 21 minutes later, the page open: no gold entry, the fetch among the earlier ones, the clock not gold.
  await page.clock.fastForward("21:00");
  expect(await colorOf(await h.clock())).not.toBe(GOLD);
  list = await h.open();
  await expect(list.getByTestId("history-current")).toHaveCount(0);
  const fetches = list.getByTestId("history-fetch");
  await expect(fetches).toHaveText(["28/10/2026, 11:00", "26/10/2026, 09:30"]);
  expect(await colorOf(fetches.first())).not.toBe(GOLD);
  // Still the values shown.
  await expect(fetches.first()).toHaveAttribute("aria-current", "true");
  await page.screenshot({ path: test.info().outputPath("old.png") });
  await h.close();

  // A reload fetches anew: current again, the fetch before among the earlier ones.
  await fetchAt(page, FIXED_NOW + 21 * 60_000, 3);
  const after = await history(page);
  expect(await colorOf(await after.clock())).toBe(GOLD);
  list = await after.open();
  await expect(list.getByTestId("history-current")).toHaveText("28/10/2026, 11:21");
  expect(await colorOf(list.getByTestId("history-current"))).toBe(GOLD);
  await expect(list.getByTestId("history-fetch")).toHaveText(["28/10/2026, 11:00", "26/10/2026, 09:30"]);
});
