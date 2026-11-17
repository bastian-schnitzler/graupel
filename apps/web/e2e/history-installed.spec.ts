// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Switching to an older fetch in the installed app (REQ-782), as on the iPhone in the bug report: two fetches of the
 * same place 18 minutes apart, the newest still current (gold, REQ-757). The older one chosen: the meteogram shows its
 * data, the line of the data source names its time, and after the page went to the background and came back the
 * history marks it as shown, bold with a check; the newest stays gold with its gold bar at the side (REQ-727, DEC-145)
 * but has no check. In every device class: the desktop's and tablet's clock menu, the phone's dialog. The installed app is
 * emulated by a matchMedia stand-in for `(display-mode: standalone)` (Playwright cannot emulate the display mode, as in
 * history.spec.ts); the page's clock is fixed.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Thursday, 12 November 2026, 00:31 and 00:49 UTC. */
const OLDER = Date.UTC(2026, 10, 12, 0, 31);
const NEWER = Date.UTC(2026, 10, 12, 0, 49);
const GOLD = "rgb(183, 121, 31)";
/** Temperature of the older fetch, all hours: the meteogram's labels tell the two apart. */
const OLDER_TEMPERATURE = 23;

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];
/** The time the fake Open-Meteo answers from: the page's clock. */
let now = OLDER;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  now = OLDER;
  await page.clock.setFixedTime(OLDER);
  // The older fetch has its own temperature, the newer the fake's usual one (4 to 10 °C).
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    fakeForecast(route, {
      now,
      ...(now === OLDER
        ? { values: { temperature_2m: () => OLDER_TEMPERATURE, dew_point_2m: () => OLDER_TEMPERATURE - 3 } }
        : {}),
    }),
  );
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

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

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

/** The texts of the meteogram (labels of the extremes, axes, the data source). */
const chartText = (page: Page) => chart(page).evaluate((svg) => svg.textContent ?? "");

/**
 * The data source with the data's time: on a phone and a tablet in portrait the line below the chart, else the chart's
 * own footer row.
 */
async function sourceText(page: Page): Promise<string> {
  const line = page.getByTestId("meteogram-source");
  if ((await line.count()) > 0 && (await line.first().isVisible())) return (await line.first().textContent()) ?? "";
  return (await page.locator('[data-region="meteogram"]').textContent()) ?? "";
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
  return {
    /** Opens the choice and returns it. */
    async open(): Promise<Locator> {
      if (split) {
        await page.getByTestId("history-arrow").click();
        const list = page.getByTestId("history-button").getByTestId("history-list");
        await expect(list).toBeVisible();
        return list;
      }
      await menu.click();
      await page.getByTestId("phone-menu-panel").getByRole("button", { name: /^History/ }).click();
      const dialog = page.getByRole("dialog", { name: "History" });
      await expect(dialog).toBeVisible();
      return dialog.getByTestId("history-list");
    },
    async close() {
      if (split) await page.keyboard.press("Escape");
      else await page.getByRole("dialog", { name: "History" }).getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("history-list")).toHaveCount(0);
    },
  };
}

/** How an entry of the list looks: its colour, its bar at the side and whether it shows the check of the fetch shown. */
const look = (entry: Locator) =>
  entry.evaluate((element) => {
    const style = getComputedStyle(element);
    const check = element.querySelector(".history-list__check");
    return {
      color: style.color,
      bar: style.boxShadow,
      check: check !== null && getComputedStyle(check).display !== "none" && getComputedStyle(check).visibility !== "hidden",
    };
  });

/** The page goes to the background and comes back, as when switching apps on the phone. */
async function backgroundAndBack(page: Page) {
  await page.evaluate(() => {
    const set = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    set("visible");
  });
}

// REQ-782: the older fetch chosen in the installed app is shown, named and marked; the newest stays gold, unmarked.
test("installed app: an older fetch chosen is shown, named in the source line and marked on reopening (REQ-782)", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect.poll(() => archivedCount(page)).toBe(1);
  now = NEWER;
  await page.clock.setFixedTime(NEWER);
  await page.reload();
  await expect(chart(page)).toBeVisible();
  await expect.poll(() => archivedCount(page)).toBe(2);
  await expect.poll(() => sourceText(page)).toContain("00:49");
  expect(await chartText(page)).not.toContain(`${OLDER_TEMPERATURE}°`);

  const h = await history(page);
  let list = await h.open();
  const current = list.getByTestId("history-current");
  const older = list.getByTestId("history-fetch");
  await expect(current).toHaveText("12/11/2026, 00:49");
  await expect(older).toHaveText(["12/11/2026, 00:31"]);
  // The newest, shown: gold, marked.
  await expect(current).toHaveAttribute("aria-current", "true");
  expect(await look(current)).toEqual({ color: GOLD, bar: expect.stringContaining(GOLD), check: true });
  expect((await look(older)).check).toBe(false);
  await older.first().click();
  await expect(page.getByTestId("history-list")).toHaveCount(0);

  // The meteogram shows the older fetch, the source line names its time.
  await expect.poll(() => chartText(page)).toContain(`${OLDER_TEMPERATURE}°`);
  await expect.poll(() => sourceText(page)).toContain("00:31");

  // Background and back (switching apps), then the history again.
  await backgroundAndBack(page);
  list = await h.open();
  await expect(list.getByTestId("history-current")).toHaveText("12/11/2026, 00:49");
  // The older fetch is marked as shown: check, bold, accent colour, no bar of its own (DEC-145).
  const chosen = list.getByTestId("history-fetch").first();
  await expect(chosen).toHaveAttribute("aria-current", "true");
  const chosenLook = await look(chosen);
  expect(chosenLook.check).toBe(true);
  expect(chosenLook.bar).toBe("none");
  expect(await chosen.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("600");
  expect(chosenLook.color).not.toBe(GOLD);
  // The newest stays gold with its gold bar while it is current (REQ-727, DEC-145), but without the check.
  const newest = list.getByTestId("history-current");
  await expect(newest).not.toHaveAttribute("aria-current", "true");
  expect(await look(newest)).toEqual({ color: GOLD, bar: expect.stringContaining(GOLD), check: false });
  await page.screenshot({ path: test.info().outputPath("history-older-marked.png") });
  await h.close();

  // Still the older fetch after closing.
  expect(await chartText(page)).toContain(`${OLDER_TEMPERATURE}°`);
  expect(await sourceText(page)).toContain("00:31");
});
