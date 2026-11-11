// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Settings of REQ-470 to REQ-473 in a real browser: the model chain switched off leaves no card, the model headers
 * leave the meteogram, the day slider switched off gives way to a choice of days, and a start place chosen from the
 * favourites is used after a reload.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";
const DAY_MS = 24 * 3_600_000;

// Days are local days; in UTC every day has 24 hours.
test.use({ timezoneId: "UTC", locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Opens the settings popup at a tab (REQ-686). */
async function openSettings(page: Page, tab: string) {
  await (await headerControl(page, "button", "Settings")).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: tab }).click();
  return dialog;
}

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function visibleRange(page: Page): Promise<[number, number]> {
  const svg = chart(page);
  return [
    Date.parse((await svg.getAttribute("data-visible-start-time"))!),
    Date.parse((await svg.getAttribute("data-visible-end-time"))!),
  ];
}

test("the model chain switched off leaves no card on the page (REQ-471)", async ({ page }) => {
  // Shown from an earlier visit.
  await page.goto(APP);
  // The single switch of an earlier version is taken over for both cards (REQ-503).
  await page.evaluate(() => window.localStorage.setItem("graupel.showModelChain", "true"));
  await page.reload();
  const block = page.locator('[data-region="model-chain"]');
  await expect(block).toBeVisible();
  const meteogram = page.getByTestId("meteogram-card");
  const shownTop = (await meteogram.boundingBox())!.y;

  const dialog = await openSettings(page, "Models");
  await expect(page.locator(".model-chain-row")).toHaveCount(2);
  await dialog.getByRole("checkbox", { name: "Show the weather chain" }).uncheck();
  await expect(page.locator(".model-chain-row")).toHaveCount(1);
  await dialog.getByRole("checkbox", { name: "Show the cloud chain" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(block).toHaveCount(0);
  await expect(page.locator(".model-chain-row")).toHaveCount(0);
  // The day slider card and the meteogram card move up: the first cards in the main area, with no empty frame above.
  const main = page.locator(".app__main");
  await expect(main.locator("> *").first()).toHaveAttribute("data-region", "day-slider");
  // At 1280 px the legend's card stands between them (REQ-670).
  await expect(main.locator("> *").nth(1)).toHaveAttribute("data-testid", "meteogram-legend");
  await expect(main.locator("> *").nth(2)).toHaveAttribute("data-testid", "meteogram-card");
  expect((await meteogram.boundingBox())!.y).toBeLessThan(shownTop);

  await page.reload();
  await expect(page.locator('[data-region="meteogram"]')).toBeVisible();
  await expect(block).toHaveCount(0);
});

test("model headers switched off leave the meteogram (REQ-472)", async ({ page }) => {
  await page.goto(APP);
  const headers = page.locator('[data-region="meteogram"] [data-testid="model-header-shape"]');
  await expect(chart(page)).toBeVisible();
  await expect(headers.first()).toBeAttached();

  const dialog = await openSettings(page, "Models");
  const checkbox = dialog.getByRole("checkbox", { name: "Show model headers" });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await page.keyboard.press("Escape");
  await expect(headers).toHaveCount(0);
  await expect(chart(page)).toBeVisible();

  // Kept for the next visit.
  await page.reload();
  await expect(chart(page)).toBeVisible();
  await expect(headers).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("graupel.modelHeaders"))).toBe("false");
});

test("day slider switched off: the chosen number of days takes effect (REQ-473)", async ({ page }) => {
  await page.goto(APP);
  const slider = page.locator('[data-region="day-slider"]');
  await expect(slider).toBeVisible();
  await expect(chart(page)).toBeVisible();
  const [allStart, allEnd] = await visibleRange(page);

  const dialog = await openSettings(page, "Start");
  // The days stay in place, disabled while the slider is on: the popup keeps its height (REQ-500).
  const days = dialog.getByRole("combobox", { name: "Days shown" });
  await expect(days).toBeDisabled();
  const heightBefore = (await dialog.boundingBox())!.height;
  await dialog.getByRole("checkbox", { name: "Show the day slider" }).uncheck();
  await expect(slider).toHaveCount(0);
  await expect(days).toBeEnabled();
  expect((await dialog.boundingBox())!.height).toBe(heightBefore);
  await expect(days).toHaveValue("all");
  await days.selectOption("2");
  await page.keyboard.press("Escape");

  // Today and tomorrow (with the days before today): the axis ends at midnight after tomorrow.
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  await expect.poll(async () => (await visibleRange(page))[1]).toBe(today + 2 * DAY_MS);
  const [start, end] = await visibleRange(page);
  expect(start).toBe(allStart);
  expect(end).toBeLessThan(allEnd);

  // Kept for the next visit.
  await page.reload();
  await expect(chart(page)).toBeVisible();
  await expect(slider).toHaveCount(0);
  await expect.poll(async () => (await visibleRange(page))[1]).toBe(today + 2 * DAY_MS);

  // All days again.
  const again = await openSettings(page, "Start");
  await again.getByRole("combobox", { name: "Days shown" }).selectOption("all");
  await expect.poll(async () => (await visibleRange(page))[1]).toBe(allEnd);
});

test("a start place chosen from the favourites is used after a reload (REQ-470)", async ({ page }) => {
  await page.goto(APP);
  const search = page.locator('[data-region="location"]').getByRole("combobox", { name: "Search for a place" });
  await expect(search).toHaveValue("Mont Blanc");

  const dialog = await openSettings(page, "Start");
  const start = dialog.getByRole("combobox", { name: "Start place" });
  await expect(start.locator("option")).toHaveText([
    "Last selected place",
    "Current position (GPS)",
    "Großglockner",
    "Matterhorn",
    "Mont Blanc",
    "Gran Paradiso",
    "Ortler",
  ]);
  // Without an own choice: the place shown last (REQ-599).
  await expect(start.locator("option:checked")).toHaveText("Last selected place");
  await start.selectOption({ label: "Matterhorn" });
  await page.keyboard.press("Escape");
  // The place shown now stays until the next start.
  await expect(search).toHaveValue("Mont Blanc");

  await page.reload();
  await expect(search).toHaveValue("Matterhorn");
  const again = await openSettings(page, "Start");
  await expect(again.getByRole("combobox", { name: "Start place" }).locator("option:checked")).toHaveText("Matterhorn");
});
