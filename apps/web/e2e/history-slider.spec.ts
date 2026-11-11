// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * History slider of the phone (REQ-685): with the setting of the archive tab (REQ-686) the installed app on a phone
 * shows, once the place has earlier fetches, a strip like the day slider directly above it: today on the right, the
 * earlier days with fetches before it, each once; with fewer than 16 days the strip still spans the whole width. One day
 * is marked purple, today is gold. A tap loads the day's last fetch (today: the current values) with the scroll rule of
 * the history menu. The installed app is emulated by a matchMedia stand-in (as in history.spec.ts); the earlier fetches
 * are made by loading the page at earlier times.
 */
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
/** Earlier fetches: Sunday 25 October 09:00, Monday 26 October 08:00 and 17:00 UTC. */
const EARLIER = [Date.UTC(2026, 9, 25, 9), Date.UTC(2026, 9, 26, 8), Date.UTC(2026, 9, 26, 17)];
const PURPLE = "rgb(124, 58, 237)";
const GOLD = "rgb(240, 168, 69)";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: "en-GB",
  timezoneId: "UTC",
  userAgent: IPHONE_SAFARI,
});
ownDevice();

let errors: string[] = [];
/** The time the fake Open-Meteo answers from: the page's clock. */
let now = FIXED_NOW;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
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

/** The setting "Show the history slider" (REQ-686), stored before the page loads. */
async function sliderSetting(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("graupel.historySlider", "true"));
}

async function chartShown(page: Page) {
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.getByTestId("day-card").first()).toBeVisible();
}

/** Loads the page at `time`: one fetch archived (in the installed app). */
async function loadAt(page: Page, time: number, first = false) {
  now = time;
  await page.clock.setFixedTime(time);
  if (first) await page.goto(APP);
  else await page.reload();
  await chartShown(page);
}

/** The earlier fetches, then the current one at the fixed time. */
async function withHistory(page: Page) {
  for (const [index, time] of EARLIER.entries()) await loadAt(page, time, index === 0);
  await loadAt(page, FIXED_NOW);
}

const slider = (page: Page) => page.getByTestId("history-slider");
const historyDays = (page: Page) => page.getByTestId("history-slider-day");
const historyDay = (page: Page, key: string) => page.locator(`[data-testid="history-slider-day"][data-day="${key}"]`);
const dayStart = (page: Page) => page.getByTestId("day-slider-start");
const firstCard = (page: Page) => page.getByTestId("day-card").first();
const background = (page: Page, key: string) =>
  historyDay(page, key).evaluate((element) => getComputedStyle(element).backgroundColor);

test("only with the setting, in the installed app and once there is a history", async ({ page }) => {
  await installed(page);
  await loadAt(page, EARLIER[0]!, true);
  // Without the setting no slider, also with a history.
  await loadAt(page, FIXED_NOW);
  await expect(page.getByTestId("day-slider-track")).toBeVisible();
  await expect(slider(page)).toHaveCount(0);
  // Switched on in the archive tab of the settings.
  await page.locator('[data-region="location"]').getByRole("button", { name: "Menu" }).click();
  await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Archive" }).click();
  await dialog.getByRole("checkbox", { name: "Show the history slider" }).check();
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(slider(page)).toBeVisible();
  await expect(historyDays(page)).toHaveCount(2);
});

test("no slider without a history or on the website", async ({ page }) => {
  await sliderSetting(page);
  await installed(page);
  // Only the current fetch: no history yet.
  await loadAt(page, FIXED_NOW, true);
  await expect(slider(page)).toHaveCount(0);
});

test("website: no slider", async ({ page }) => {
  await sliderSetting(page);
  await withHistory(page);
  await expect(slider(page)).toHaveCount(0);
});

test("today on the right, each day once, across the whole width above the day slider", async ({ page }) => {
  await sliderSetting(page);
  await installed(page);
  await withHistory(page);
  await expect(slider(page)).toBeVisible();
  // Two fetches on Monday: one field.
  await expect(historyDays(page)).toHaveCount(3);
  expect(await historyDays(page).evaluateAll((days) => days.map((day) => (day as HTMLElement).dataset.day))).toEqual([
    "2026-10-25",
    "2026-10-26",
    "2026-10-28",
  ]);
  await expect(historyDays(page)).toHaveText(["Su25", "Mo26", "We28"]);
  // The strip as wide as the day slider, directly above it; the three days fill the last three of 16 fields.
  const strip = (await page.locator(".history-slider__track").boundingBox())!;
  const days = (await page.getByTestId("day-slider-track").boundingBox())!;
  expect(Math.abs(strip.x - days.x)).toBeLessThan(0.5);
  expect(Math.abs(strip.width - days.width)).toBeLessThan(0.5);
  expect(strip.y + strip.height).toBeLessThan(days.y);
  expect(days.y - (strip.y + strip.height)).toBeLessThan(12);
  const field = strip.width / 16;
  const first = (await historyDays(page).first().boundingBox())!;
  const today = (await historyDay(page, "2026-10-28").boundingBox())!;
  expect(Math.abs(first.x - (strip.x + 13 * field))).toBeLessThan(1);
  expect(Math.abs(today.x + today.width - (strip.x + strip.width))).toBeLessThan(1);
  expect(Math.abs(today.width - field)).toBeLessThan(1);
});

test("a tap loads the day's last fetch with the scroll rule; one day marked purple, today gold", async ({ page }) => {
  await sliderSetting(page);
  await installed(page);
  await withHistory(page);
  // The current values: today marked (purple, with a gold ring).
  await expect(historyDay(page, "2026-10-28")).toHaveAttribute("aria-pressed", "true");
  expect(await background(page, "2026-10-28")).toBe(PURPLE);
  expect(
    await historyDay(page, "2026-10-28").evaluate((element) => getComputedStyle(element).boxShadow),
  ).toContain(GOLD);
  // Every day selected: yesterday (27 October) on the left.
  const left = await dayStart(page).getAttribute("aria-valuetext");
  const firstCurrent = await firstCard(page).textContent();
  await historyDay(page, "2026-10-26").click();
  // The fetch shown is Monday's last one, 17:00; 27 October stays on the left.
  await expect(historyDay(page, "2026-10-26")).toHaveAttribute("aria-pressed", "true");
  await expect(firstCard(page)).not.toHaveText(firstCurrent ?? "");
  await expect(dayStart(page)).toHaveAttribute("aria-valuetext", left ?? "");
  await expect(historyDays(page).and(page.locator('[aria-pressed="true"]'))).toHaveCount(1);
  expect(await background(page, "2026-10-26")).toBe(PURPLE);
  expect(await background(page, "2026-10-28")).toBe(GOLD);
  expect(await background(page, "2026-10-25")).toBe("rgba(0, 0, 0, 0)");
  await page.locator('[data-region="location"]').getByRole("button", { name: "Menu" }).click();
  await page.getByTestId("phone-menu-panel").getByRole("button", { name: /^History/ }).click();
  const dialog = page.getByRole("dialog", { name: "History" });
  await expect(dialog.locator('[data-testid="history-fetch"][aria-current="true"]')).toHaveText("26/10/2026, 17:00");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Today goes back to the current values, 27 October on the left again.
  await historyDay(page, "2026-10-28").click();
  await expect(historyDay(page, "2026-10-28")).toHaveAttribute("aria-pressed", "true");
  await expect(firstCard(page)).toHaveText(firstCurrent ?? "");
  await expect(dayStart(page)).toHaveAttribute("aria-valuetext", left ?? "");
});

test("starts at the front when the day's fetch lacks the day on the left", async ({ page }) => {
  await sliderSetting(page);
  await installed(page);
  await withHistory(page);
  // The last day on the left: Sunday's fetch ends before it.
  await dayStart(page).focus();
  await page.keyboard.press("End");
  await historyDay(page, "2026-10-25").click();
  await expect(historyDay(page, "2026-10-25")).toHaveAttribute("aria-pressed", "true");
  // The meteogram starts at the first day of Sunday's fetch, 24 October.
  await expect(dayStart(page)).toHaveAttribute("aria-valuetext", /24/);
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`pictures of the history slider, ${theme}`, () => {
    test.use({ colorScheme: theme });

    test("a day of the history shown", async ({ page }) => {
      await sliderSetting(page);
      await installed(page);
      await withHistory(page);
      await historyDay(page, "2026-10-26").click();
      await expect(historyDay(page, "2026-10-26")).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot(`history-slider-${theme}.png`, {
        clip: { x: 0, y: 0, width: 390, height: 240 },
        maxDiffPixelRatio: 0.002,
      });
    });

    test("the current values", async ({ page }) => {
      await sliderSetting(page);
      await installed(page);
      await withHistory(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot(`history-slider-current-${theme}.png`, {
        clip: { x: 0, y: 0, width: 390, height: 240 },
        maxDiffPixelRatio: 0.002,
      });
    });
  });
}
