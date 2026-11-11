// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * History of the installed app (REQ-684): each fetch is archived per place (IndexedDB). On the desktop a clock split
 * button beside the favourites appears once the place has an earlier fetch: gold with the current values, with the
 * day and month of the fetch shown beside the clock, the current values' or an archived one's (REQ-726). On the phone
 * the menu has "History" with that day, which opens a dialog with the same choice. The choice names the current values
 * by the date and time of their fetch, in gold with a gold bar at the side (REQ-727). A choice loads the archived fetch; the day on the left before stays on the left when the fetch has it,
 * otherwise the meteogram starts at its front. The website has neither. The installed app is emulated by a matchMedia
 * stand-in (as in install.spec.ts); the earlier fetch is made by loading the page two days before.
 */
import { expect, test, type Page, ownDevice, onlyIn } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC; the earlier fetch Monday, 26 October 2026, 09:30 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const EARLIER = Date.UTC(2026, 9, 26, 9, 30);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];
/** The time the fake Open-Meteo answers from: the page's clock. */
let now = FIXED_NOW;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  now = EARLIER;
  await page.clock.setFixedTime(EARLIER);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The installed app: its display mode matches (Playwright cannot set it). */
async function installed(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
        : original(query);
  });
}

async function chartShown(page: Page) {
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

/** Number of fetches in the page's archive (IndexedDB); 0 while it has none. Never creates the database itself. */
const archivedCount = (page: Page) =>
  page.evaluate(
    async () => {
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
    },
  );

/** Loads the page two days before (the earlier fetch), then at the fixed time (the current one). */
async function twoFetches(page: Page) {
  await page.goto(APP);
  await chartShown(page);
  await expect(page.getByTestId("day-card").first()).toBeVisible();
  // The installed app archives the earlier fetch before the reload (it is written after the chart shows).
  if (await page.evaluate(() => window.matchMedia("(display-mode: standalone)").matches)) {
    await expect.poll(() => archivedCount(page)).toBeGreaterThan(0);
  }
  now = FIXED_NOW;
  await page.clock.setFixedTime(FIXED_NOW);
  await page.reload();
  await chartShown(page);
}

const dayStart = (page: Page) => page.getByTestId("day-slider-start");
const firstCard = (page: Page) => page.getByTestId("day-card").first();
const historyButton = (page: Page) => page.getByTestId("history-button");

test.describe("desktop", () => {
  onlyIn("desktop", "the history button with its arrow stands in the desktop's header bar; the phone's menu has its own block");
  test("clock split button only with an earlier fetch, gold with the current values", async ({ page }) => {
    await installed(page);
    await page.goto(APP);
    await chartShown(page);
    // Only the fetch shown: no earlier one, no button.
    await expect(page.getByTestId("day-card").first()).toBeVisible();
    await expect(historyButton(page)).toHaveCount(0);
    now = FIXED_NOW;
    await page.clock.setFixedTime(FIXED_NOW);
    await page.reload();
    await chartShown(page);
    await expect(historyButton(page)).toBeVisible();
    // Beside the favourites, after them.
    const favorites = (await page.locator(".location__favorites").boundingBox())!;
    const history = (await historyButton(page).boundingBox())!;
    expect(history.x).toBeGreaterThan(favorites.x + favorites.width);
    expect(Math.abs(history.y + history.height / 2 - (favorites.y + favorites.height / 2))).toBeLessThan(1);
    const main = page.getByTestId("history-main");
    // The day of the current values beside the clock (REQ-726).
    await expect(main).toHaveAccessibleName("Fetched on 28/10/2026, 11:00. Show history");
    await expect(page.getByTestId("history-day")).toHaveText("28/10");
    expect(await main.locator(".location__history-clock").evaluate((icon) => getComputedStyle(icon).color)).toBe(
      "rgb(183, 121, 31)",
    );
    await page.screenshot({ path: test.info().outputPath("history-button.png") });
  });

  test("a choice loads the archived fetch with its date at the button, the button goes back", async ({ page }) => {
    await installed(page);
    await twoFetches(page);
    await expect(page.getByTestId("history-day")).toHaveText("28/10");
    // Every day selected: yesterday (27 October) on the left.
    const left = await dayStart(page).getAttribute("aria-valuetext");
    const firstCurrent = await firstCard(page).textContent();
    await page.getByTestId("history-arrow").click();
    const list = page.getByTestId("history-list");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("history-current")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("history-current")).toBeFocused();
    // The current values by date and time (REQ-727).
    await expect(page.getByTestId("history-current")).toHaveText("28/10/2026, 11:00");
    const entries = page.getByTestId("history-fetch");
    await expect(entries).toHaveText(["26/10/2026, 09:30"]);
    await page.screenshot({ path: test.info().outputPath("history-menu.png") });
    await entries.first().click();
    await expect(list).toBeHidden();
    // The archived fetch starts two days earlier, 27 October stays on the left.
    await expect(page.getByTestId("history-day")).toHaveText("26/10");
    await expect(firstCard(page)).not.toHaveText(firstCurrent ?? "");
    await expect(dayStart(page)).toHaveAttribute("aria-valuetext", left ?? "");
    const main = page.getByTestId("history-main");
    await expect(main).toHaveAccessibleName(/Fetched on 26\/10\/2026, 09:30/);
    expect(await main.locator(".location__history-clock").evaluate((icon) => getComputedStyle(icon).color)).not.toBe(
      "rgb(183, 121, 31)",
    );
    await page.screenshot({ path: test.info().outputPath("history-archived.png") });
    // The menu marks the fetch shown.
    await page.getByTestId("history-arrow").click();
    await expect(entries.first()).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("history-arrow")).toBeFocused();
    // The main part goes back to the current values: every day again, 27 October on the left.
    await main.click();
    await expect(page.getByTestId("history-day")).toHaveText("28/10");
    await expect(firstCard(page)).toHaveText(firstCurrent ?? "");
    await expect(dayStart(page)).toHaveAttribute("aria-valuetext", left ?? "");
  });

  test("the current values stand in gold with a gold bar, the button names the day chosen", async ({ page }) => {
    await installed(page);
    await twoFetches(page);
    await page.getByTestId("history-arrow").click();
    const current = page.getByTestId("history-current");
    await expect(current).toHaveText("28/10/2026, 11:00");
    await expect(current).toHaveAccessibleName("Current values: 28/10/2026, 11:00");
    const style = await current.evaluate((entry) => {
      const computed = getComputedStyle(entry);
      return { color: computed.color, bar: computed.boxShadow };
    });
    expect(style.color).toBe("rgb(183, 121, 31)");
    expect(style.bar).toContain("rgb(183, 121, 31)");
    expect(style.bar).toContain("3px 0px 0px 0px inset");
    // An archived fetch is no gold.
    const entry = page.getByTestId("history-fetch").first();
    expect(await entry.evaluate((item) => getComputedStyle(item).color)).not.toBe("rgb(183, 121, 31)");
    await page.screenshot({ path: test.info().outputPath("history-current-gold.png") });
    await entry.click();
    await expect(page.getByTestId("history-day")).toHaveText("26/10");
    // Chosen again from the menu: the current values, their day at the button.
    await page.getByTestId("history-arrow").click();
    await current.click();
    await expect(page.getByTestId("history-day")).toHaveText("28/10");
  });

  test("starts at the front when the archived fetch lacks the day on the left", async ({ page }) => {
    await installed(page);
    await twoFetches(page);
    // The last day on the left: the earlier fetch ends before it.
    await dayStart(page).focus();
    await page.keyboard.press("End");
    const last = await page.getByTestId("day-card").last().textContent();
    await page.getByTestId("history-arrow").click();
    await page.getByTestId("history-fetch").first().click();
    await expect(page.getByTestId("history-day")).toHaveText("26/10");
    const first = (await firstCard(page).textContent()) ?? "";
    expect(first).not.toBe(last);
    // The meteogram starts at the archived fetch's first day.
    const label = await dayStart(page).getAttribute("aria-valuetext");
    expect(label).toContain("25");
  });

  test("website: no clock button", async ({ page }) => {
    await twoFetches(page);
    await expect(page.getByTestId("day-card").first()).toBeVisible();
    await expect(historyButton(page)).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use(PHONE);
  ownDevice();

  const menuButton = (page: Page) => page.locator('[data-region="location"]').getByRole("button", { name: "Menu" });
  const historyItem = (page: Page) => page.getByTestId("phone-menu-panel").getByRole("button", { name: /^History/ });

  test("menu entry History opens a dialog; a choice loads the fetch with the scroll rule", async ({ page }) => {
    await installed(page);
    await twoFetches(page);
    await expect(historyButton(page)).toHaveCount(0);
    const left = await dayStart(page).getAttribute("aria-valuetext");
    const firstCurrent = await firstCard(page).textContent();
    await menuButton(page).click();
    await expect(historyItem(page)).toBeVisible();
    // The day of the current values (REQ-726).
    await expect(historyItem(page)).toHaveText("History · 28/10");
    await page.screenshot({ path: test.info().outputPath("phone-menu.png") });
    await historyItem(page).click();
    const dialog = page.getByRole("dialog", { name: "History" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("history-current")).toHaveAttribute("aria-current", "true");
    await expect(dialog.getByTestId("history-fetch")).toHaveText(["26/10/2026, 09:30"]);
    await page.screenshot({ path: test.info().outputPath("phone-dialog.png") });
    await dialog.getByTestId("history-fetch").first().click();
    await expect(dialog).toBeHidden();
    await expect(firstCard(page)).not.toHaveText(firstCurrent ?? "");
    await expect(dayStart(page)).toHaveAttribute("aria-valuetext", left ?? "");
    // The menu names the day of the fetch shown; the dialog goes back to the current values.
    await menuButton(page).click();
    await expect(historyItem(page)).toHaveText("History · 26/10");
    await historyItem(page).click();
    await expect(dialog.getByTestId("history-fetch").first()).toHaveAttribute("aria-current", "true");
    await dialog.getByTestId("history-current").click();
    await expect(dialog).toBeHidden();
    await menuButton(page).click();
    await expect(historyItem(page)).toHaveText("History · 28/10");
    await menuButton(page).click();
    await expect(firstCard(page)).toHaveText(firstCurrent ?? "");
    await expect(dayStart(page)).toHaveAttribute("aria-valuetext", left ?? "");
  });

  test("starts at the front when the archived fetch lacks the day on the left", async ({ page }) => {
    await installed(page);
    await twoFetches(page);
    await dayStart(page).focus();
    await page.keyboard.press("End");
    await menuButton(page).click();
    await historyItem(page).click();
    await page.getByRole("dialog", { name: "History" }).getByTestId("history-fetch").first().click();
    await expect(page.getByRole("dialog", { name: "History" })).toBeHidden();
    await expect(dayStart(page)).toHaveAttribute("aria-valuetext", /25/);
  });

  test("website: no History entry", async ({ page }) => {
    await twoFetches(page);
    await menuButton(page).click();
    await expect(page.getByTestId("phone-menu-panel")).toBeVisible();
    await expect(historyItem(page)).toHaveCount(0);
  });
});
