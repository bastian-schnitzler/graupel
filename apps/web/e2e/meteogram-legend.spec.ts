// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Legend of the meteogram (REQ-639): it names what the chart draws, with the chart's colours and dashes, only in the
 * normal view. On the desktop it floats left of the meteogram in the page's free margin without covering it; where that
 * margin is too narrow (1280 and 1720 px) it is a card of its own directly above the meteogram, with several columns
 * (REQ-670). On a phone it is a card of its own directly above the meteogram, and the page
 * still fits the screen (REQ-608); a pull to refresh moves only the meteogram (REQ-638). An X closes it and switches the
 * setting "Show the legend" off, which stays after a reload; the settings popup switches it back on. It follows the dew
 * point and the relative humidity options (REQ-593, REQ-650). Its entries stand in groups by the areas of the
 * meteogram, set apart in every place it stands: temperature, precipitation and clouds, wind, the time marks last
 * (REQ-674). While the meteogram shows the model headers, the last group starts with an entry for them, "Weather model":
 * a box in the first model's header colour with its first letters (up to three) in white (REQ-677, REQ-678, DEC-071); then come now, sunrise and
 * sunset, daylight (REQ-679). On a tablet in landscape the card is as wide as the page, its groups always in four
 * columns, with or without the dew point and the relative humidity, in the legend's order: temperature,
 * precipitation, wind, time marks (REQ-756, REQ-763); upright it keeps the phone's two columns (REQ-756).
 */
import { devices } from "@playwright/test";
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Friday, 30 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 30, 11);
/** A desktop window wide enough for the legend left of the page (1920 px, the most common desktop). */
const WIDE = { width: 1920, height: 1080 };

test.use({ timezoneId: "UTC", locale: "en-GB" });

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

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const legend = (page: Page) => page.getByTestId("meteogram-legend");

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

/** Labels of the legend's entries in order (without the model header's letters in its symbol, REQ-677). */
const entries = (page: Page) => legend(page).locator("li > span").allTextContents();

test.describe("desktop", () => {
  test.use({ viewport: WIDE });
  ownDevice();

  test("floats left of the meteogram in the free margin and covers nothing of it", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    await expect(legend(page).getByRole("heading", { name: "Legend" })).toBeVisible();
    const box = (await legend(page).boundingBox())!;
    const card = (await page.getByTestId("meteogram-card").boundingBox())!;
    // Left of the card, at its top, within the window.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x);
    expect(Math.abs(box.y - card.y)).toBeLessThanOrEqual(1);
    // Nothing of it is over the chart: the point in the middle of each entry is the legend's own.
    const hits = await legend(page)
      .getByRole("listitem")
      .evaluateAll((items) =>
        items.map((item) => {
          const rect = item.getBoundingClientRect();
          return item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        }),
      );
    expect(hits.every(Boolean)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("desktop.png") });
  });

  test("names what the chart draws, in the chart's colours", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    // The fake forecast: temperature and the felt one, rain bars, its probability, clouds, wind, gusts and direction,
    // the current time. No dew point, no relative humidity (both off without a choice), no snow, no thunderstorm.
    expect(await entries(page)).toEqual([
      "Temperature",
      "Feels like",
      "Precipitation",
      "Precipitation probability",
      "Cloud cover (by height)",
      "Wind",
      "Gusts",
      "Wind direction",
      "Weather model",
      "Now",
    ]);
    // The symbol of the temperature in the colour of the chart's line, the gusts dashed as in the chart.
    const line = (key: string) => legend(page).locator(`[data-key="${key}"] line`);
    const temperature = await chart(page).getByTestId("temperature-path").first().getAttribute("stroke");
    await expect(line("temperature")).toHaveAttribute("stroke", temperature!);
    const gusts = chart(page).getByTestId("wind-gusts-path").first();
    await expect(line("gusts")).toHaveAttribute("stroke-dasharray", (await gusts.getAttribute("stroke-dasharray"))!);
    await expect(line("gusts")).toHaveAttribute("stroke", (await gusts.getAttribute("stroke"))!);
    const now = chart(page).getByTestId("current-time-cursor-line");
    await expect(line("now")).toHaveAttribute("stroke-dasharray", (await now.getAttribute("stroke-dasharray"))!);
  });

  test("follows the dew point and the relative humidity as the chart shows them", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("graupel.dewPoint", "on");
      window.localStorage.setItem("graupel.relativeHumidity", "on");
    });
    await open(page);
    await expect(legend(page).getByText("Dew point", { exact: true })).toBeVisible();
    await expect(legend(page).getByText("Relative humidity", { exact: true })).toBeVisible();
    const color = (key: string) => legend(page).locator(`[data-key="${key}"] line`).getAttribute("stroke");
    expect(await color("relativeHumidity")).toBe(
      await chart(page).getByTestId("relative-humidity-path").first().getAttribute("stroke"),
    );
    await page.screenshot({ path: test.info().outputPath("desktop-humidity.png") });

    // Both off in the settings: gone from chart and legend.
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("tab", { name: "Meteogram" }).click();
    await dialog.getByRole("radiogroup", { name: "Dew point" }).getByRole("radio", { name: "Off" }).check();
    await dialog.getByRole("radiogroup", { name: "Relative humidity" }).getByRole("radio", { name: "Off" }).check();
    await expect(legend(page).getByText("Dew point", { exact: true })).toHaveCount(0);
    await expect(legend(page).getByText("Relative humidity", { exact: true })).toHaveCount(0);
    await expect(chart(page).getByTestId("relative-humidity-path")).toHaveCount(0);
  });

  test("the X closes it for good; the settings popup brings it back", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    await legend(page).getByRole("button", { name: "Close the legend" }).click();
    await expect(legend(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("graupel.legend"))).toBe("false");

    // After a reload it stays closed.
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(legend(page)).toHaveCount(0);

    // "Show the legend" in the meteogram section of the settings (tab Meteogram, REQ-686), now off; switched on, the
    // legend is back.
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("tab", { name: "Meteogram" }).click();
    const show = dialog.getByRole("checkbox", { name: "Show the legend" });
    await expect(show).not.toBeChecked();
    await show.check();
    await expect(legend(page)).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("graupel.legend"))).toBeNull();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(legend(page)).toBeVisible();
  });

  test("not in the full-screen view", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    await page.getByRole("button", { name: "Show the meteogram full screen" }).click();
    const dialog = page.getByRole("dialog", { name: "Meteogram (full screen)" });
    await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    await expect(legend(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(legend(page)).toBeVisible();
  });
});

test.describe("desktop with a narrow margin (REQ-670)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  ownDevice();

  /** Boxes of legend, day slider and meteogram card. */
  async function boxes(page: Page) {
    return {
      legend: (await legend(page).boundingBox())!,
      card: (await page.getByTestId("meteogram-card").boundingBox())!,
      slider: (await page.locator('[data-region="day-slider"]').boundingBox())!,
    };
  }

  /** Rows of the legend's entries: their tops, rounded, with the number of entries on each. */
  const rows = (page: Page) =>
    legend(page)
      .getByRole("listitem")
      .evaluateAll((items) => {
        const counts = new Map<number, number>();
        for (const item of items) {
          const top = Math.round(item.getBoundingClientRect().top);
          counts.set(top, (counts.get(top) ?? 0) + 1);
        }
        return [...counts.values()];
      });

  for (const width of [1280, 1720]) {
    test(`a card directly above the meteogram at ${width} px, with several columns; it covers nothing`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 1000 });
      await open(page);
      await expect(legend(page)).toBeVisible();
      await expect(legend(page)).toHaveAttribute("data-variant", "card");
      // Outside the meteogram card, right before it.
      expect(await page.getByTestId("meteogram-card").getByTestId("meteogram-legend").count()).toBe(0);
      const { legend: box, card, slider } = await boxes(page);
      // Between the day slider and the meteogram at the page's gap, as wide as the meteogram.
      expect(box.y).toBeGreaterThanOrEqual(slider.y + slider.height);
      expect(box.y + box.height).toBeLessThanOrEqual(card.y);
      expect(card.y - (box.y + box.height)).toBeLessThan(20);
      expect(Math.abs(box.x - card.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - card.width)).toBeLessThanOrEqual(1);
      // Low: the ten entries of the fake forecast in two rows, in their groups side by side (REQ-674): the first row
      // with the first entry of each column, the second with the rest (the current time below the weather model).
      expect(await rows(page)).toEqual([6, 4]);
      expect(box.height).toBeLessThan(60);
      // Each entry and the X are the legend's own where they are, and the meteogram is not under the legend.
      const hits = await legend(page)
        .locator("li, button")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }),
        );
      expect(hits.every(Boolean)).toBe(true);
      // The page does not get wider than the window.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: test.info().outputPath(`desktop-${width}.png`) });
    });
  }

  test("beside the meteogram where the margin is wide enough, a card again where it is not", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
    await page.setViewportSize(WIDE);
    await expect(legend(page)).toHaveAttribute("data-variant", "side");
    const { legend: box, card } = await boxes(page);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x);
    // The setting stays on throughout.
    expect(await page.evaluate(() => window.localStorage.getItem("graupel.legend"))).toBeNull();
    await page.setViewportSize({ width: 1720, height: 1000 });
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
  });

  test("the X closes the card and the meteogram moves up; the settings popup brings it back", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    const before = (await page.getByTestId("meteogram-card").boundingBox())!.y;
    await legend(page).getByRole("button", { name: "Close the legend" }).click();
    await expect(legend(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("graupel.legend"))).toBe("false");
    expect((await page.getByTestId("meteogram-card").boundingBox())!.y).toBeLessThan(before - 20);

    // Closed in the card, also closed beside the meteogram on a wider window.
    await page.setViewportSize(WIDE);
    await expect(chart(page)).toBeVisible();
    await expect(legend(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("tab", { name: "Meteogram" }).click();
    const show = page.getByRole("dialog", { name: "Settings" }).getByRole("checkbox", { name: "Show the legend" });
    await expect(show).not.toBeChecked();
    await show.check();
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
  });

  test("not in the full-screen view", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    await page.getByRole("button", { name: "Show the meteogram full screen" }).click();
    const dialog = page.getByRole("dialog", { name: "Meteogram (full screen)" });
    await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    await expect(legend(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(legend(page)).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("a card of its own directly above the meteogram; the page still fits the screen", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
    const box = (await legend(page).boundingBox())!;
    const card = (await page.getByTestId("meteogram-card").boundingBox())!;
    const slider = (await page.locator('[data-region="day-slider"]').boundingBox())!;
    // Between the day slider and the meteogram, within the page's side margins.
    expect(box.y).toBeGreaterThanOrEqual(slider.y + slider.height);
    expect(box.y + box.height).toBeLessThanOrEqual(card.y);
    expect(card.y - (box.y + box.height)).toBeLessThan(20);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(390);
    // Two columns: the wind's group (REQ-674) stands at the top of the second, beside the temperature's.
    const first = (await legend(page).locator('[data-key="temperature"]').boundingBox())!;
    const second = (await legend(page).locator('[data-key="wind"]').boundingBox())!;
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(second.x).toBeGreaterThan(first.x + 100);
    // The page fits the screen without scrolling; the chart keeps at least 40 % of it (REQ-608).
    const sizes = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      screen: document.documentElement.clientHeight,
    }));
    expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.screen);
    expect((await chart(page).boundingBox())!.height).toBeGreaterThanOrEqual(0.4 * sizes.screen);
    await page.screenshot({ path: test.info().outputPath("phone.png") });

    // A lower screen (740 px, as in phone-height.spec.ts): the card stays, the chart gets lower, the page still fits.
    await page.setViewportSize({ width: 390, height: 740 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight))
      .toBeLessThanOrEqual(0);
    await expect(legend(page)).toBeVisible();
    const low = (await chart(page).boundingBox())!.height;
    expect(low).toBeGreaterThanOrEqual(0.4 * 740);
    const footer = (await page.locator('[data-region="footer"]').boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(740);
    await page.screenshot({ path: test.info().outputPath("phone-740.png") });
  });

  test("left out where the page would not fit with it; the setting stays", async ({ page }) => {
    // The model chains shown on a low screen: the chart keeps 40 % of it and the page scrolls anyway (REQ-608).
    await page.addInitScript(() => {
      window.localStorage.setItem("graupel.showWeatherChain", "true");
      window.localStorage.setItem("graupel.showCloudChain", "true");
    });
    await page.setViewportSize({ width: 390, height: 560 });
    await open(page);
    await expect(page.locator('[data-region="model-chain"] .model-chain-row')).toHaveCount(2);
    await expect(legend(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("graupel.legend"))).toBeNull();
    // A higher screen has room for it again.
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect(legend(page)).toBeVisible();
  });

  test("the X closes the card and the chart takes its room", async ({ page }) => {
    // A screen where the chart gets lower to fit (REQ-608).
    await page.setViewportSize({ width: 390, height: 740 });
    await open(page);
    await expect(legend(page)).toBeVisible();
    const before = (await chart(page).boundingBox())!.height;
    await legend(page).getByRole("button", { name: "Close the legend" }).tap();
    await expect(legend(page)).toHaveCount(0);
    await expect.poll(async () => (await chart(page).boundingBox())!.height).toBeGreaterThan(before + 20);
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(legend(page)).toHaveCount(0);
  });

  test("stays in place while the meteogram is pulled down", async ({ page }) => {
    await open(page);
    await expect(legend(page)).toBeVisible();
    const before = (await legend(page).boundingBox())!;
    const chartBefore = (await chart(page).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    // In the chart's temperature area, left of the screen's middle (the chart is wider than the screen).
    const x = 150;
    const y = Math.round(chartBefore.y + 60);
    const point = (dy: number) => [{ x, y: y + dy, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(0) });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(step * 5) });
    }
    // Pulled: the chart moved down, the legend did not.
    await expect(page.getByTestId("meteogram-card")).toHaveAttribute("data-pull", "pulling");
    expect((await chart(page).boundingBox())!.y).toBeGreaterThan(chartBefore.y + 10);
    expect((await legend(page).boundingBox())!.y).toBeCloseTo(before.y, 0);
    await page.screenshot({ path: test.info().outputPath("phone-pull.png") });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  });
});

/** The legend's groups (REQ-674): id, entries, box and the lines that set them apart. */
const groups = (page: Page) =>
  legend(page)
    .locator("ul[data-group]")
    .evaluateAll((lists) =>
      lists.map((list) => {
        const style = getComputedStyle(list);
        const rect = list.getBoundingClientRect();
        return {
          id: list.getAttribute("data-group"),
          keys: [...list.querySelectorAll("li")].map((item) => item.getAttribute("data-key")),
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          lineTop: style.borderTopStyle === "solid" ? parseFloat(style.borderTopWidth) : 0,
          lineLeft: style.borderLeftStyle === "solid" ? parseFloat(style.borderLeftWidth) : 0,
          lineColor: style.borderTopStyle === "solid" ? style.borderTopColor : style.borderLeftColor,
        };
      }),
    );

/** The fake forecast's entries in their groups. */
const GROUPS = [
  { id: "temp", keys: ["temperature", "apparentTemperature"] },
  { id: "precip", keys: ["precipitation", "precipitationProbability", "clouds"] },
  { id: "wind", keys: ["wind", "gusts", "windDirection"] },
  // REQ-679: the weather model first, then the current time (the fake forecast has no sun times).
  { id: "time", keys: ["modelHeader", "now"] },
];

test.describe("groups (REQ-674)", () => {
  test("one below the other with a fine line between them, left of the meteogram (1920 px)", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-variant", "side");
    const found = await groups(page);
    expect(found.map(({ id, keys }) => ({ id, keys }))).toEqual(GROUPS);
    const border = await legend(page).evaluate((element) => getComputedStyle(element).borderTopColor);
    for (const [index, group] of found.entries()) {
      if (index === 0) {
        expect(group.lineTop).toBe(0);
        continue;
      }
      // Below the group before, at a gap, with a line in the colour of the card's border.
      const before = found[index - 1]!;
      expect(group.top - before.bottom).toBeGreaterThanOrEqual(4);
      expect(group.lineTop).toBe(1);
      expect(group.lineColor).toBe(border);
    }
    await legend(page).screenshot({ path: test.info().outputPath("groups-side.png") });
  });

  test("side by side with an upright line between them in the card above the meteogram (1280 px)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
    const found = await groups(page);
    expect(found.map(({ id, keys }) => ({ id, keys }))).toEqual(GROUPS);
    const box = (await legend(page).boundingBox())!;
    for (const [index, group] of found.entries()) {
      // All in one row, within the card, each with its line.
      expect(Math.abs(group.top - found[0]!.top)).toBeLessThanOrEqual(1);
      expect(group.lineLeft).toBe(1);
      expect(group.lineTop).toBe(0);
      if (index > 0) expect(group.left).toBeGreaterThanOrEqual(found[index - 1]!.right - 1);
    }
    expect(found.at(-1)!.right).toBeLessThanOrEqual(box.x + box.width);
    // The first group's line is cut off (nothing of the group where it would be); the others' lines show.
    const shown = await legend(page)
      .locator("ul[data-group]")
      .evaluateAll((lists) =>
        lists.map((list) => {
          const rect = list.getBoundingClientRect();
          return document.elementFromPoint(rect.left + 0.5, rect.top + rect.height / 2) === list;
        }),
      );
    expect(shown).toEqual([false, true, true, true]);
    await legend(page).screenshot({ path: test.info().outputPath("groups-wide.png") });
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    ownDevice();

    test("in two columns, one below the other with a fine line between them; the page still fits", async ({ page }) => {
      await open(page);
      await expect(legend(page)).toHaveAttribute("data-variant", "card");
      const found = await groups(page);
      expect(found.map(({ id, keys }) => ({ id, keys }))).toEqual(GROUPS);
      const [temp, precip, wind, time] = found;
      // Read down the first column, then the second: temperature, precipitation | wind, now.
      expect(Math.abs(precip!.left - temp!.left)).toBeLessThan(1);
      expect(precip!.top).toBeGreaterThanOrEqual(temp!.bottom - 1);
      expect(wind!.left).toBeGreaterThan(temp!.right - 1);
      expect(Math.abs(wind!.top - temp!.top)).toBeLessThan(1);
      expect(Math.abs(time!.left - wind!.left)).toBeLessThan(1);
      expect(time!.top).toBeGreaterThanOrEqual(wind!.bottom - 1);
      // Each with a line above it; at the top of a column it is cut off.
      expect(found.every((group) => group.lineTop === 1)).toBe(true);
      const shown = await legend(page)
        .locator("ul[data-group]")
        .evaluateAll((lists) =>
          lists.map((list) => {
            const rect = list.getBoundingClientRect();
            return document.elementFromPoint(rect.left + rect.width / 2, rect.top + 0.5) === list;
          }),
        );
      expect(shown).toEqual([false, true, false, true]);
      // Low: as high as the taller column's entries and one line between its two groups (7 px), nothing more.
      const extent = await legend(page)
        .getByRole("listitem")
        .evaluateAll((items) => {
          const rects = items.map((item) => item.getBoundingClientRect());
          const columns = new Map<number, number>();
          for (const rect of rects) {
            const left = Math.round(rect.left);
            columns.set(left, (columns.get(left) ?? 0) + rect.height);
          }
          return {
            height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
            column: Math.max(...columns.values()),
            columns: columns.size,
          };
        });
      expect(extent.columns).toBe(2);
      expect(extent.height).toBeLessThanOrEqual(extent.column + 5 * 1 + 7 + 1);
      // The page fits the screen without scrolling; the chart keeps at least 40 % of it (REQ-608).
      const sizes = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        screen: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.screen);
      expect(sizes.scrollWidth).toBeLessThanOrEqual(390);
      expect((await chart(page).boundingBox())!.height).toBeGreaterThanOrEqual(0.4 * sizes.screen);
      await legend(page).screenshot({ path: test.info().outputPath("groups-phone.png") });
    });
  });
});

test.describe("model header (REQ-677)", () => {
  /** The first model header the chart draws: its box's colour and its name. */
  const firstHeader = (page: Page) =>
    chart(page)
      .locator('[data-testid="model-label-segment"]')
      .first()
      .evaluate((segment) => ({
        color: segment.querySelector('[data-testid="model-header-shape"]')!.getAttribute("fill"),
        label: segment.querySelector('[data-testid="model-header-label"]')!.textContent ?? "",
      }));

  /** The legend's model header entry: its group, place in it, text, box colour and letters with their colour and size. */
  const entry = (page: Page) =>
    legend(page)
      .locator('[data-key="modelHeader"]')
      .evaluate((item) => {
        const list = item.closest("ul")!;
        const box = item.querySelector("svg path")!;
        const text = item.querySelector("svg text")!;
        const boxRect = box.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        return {
          group: list.getAttribute("data-group"),
          lastGroup: list.parentElement!.lastElementChild === list,
          first: list.firstElementChild === item,
          label: item.querySelector(":scope > span")!.textContent,
          color: box.getAttribute("fill"),
          letters: text.textContent,
          lettersColor: getComputedStyle(text).fill,
          // The letters inside the box, with room to its sides.
          inside:
            textRect.left >= boxRect.left + 1.5 &&
            textRect.right <= boxRect.right - 1.5 &&
            textRect.top >= boxRect.top - 1 &&
            textRect.bottom <= boxRect.bottom + 1,
          // The text beside the box on one line.
          oneLine: item.querySelector(":scope > span")!.getClientRects().length === 1,
        };
      });

  /**
   * The entry "Weather model" first in the last group (REQ-679), in the first header's colour, the weather chain's first
   * shade, with the first model's letters (up to three) in white (REQ-678, DEC-071).
   */
  /** The first word's first three letters or digits, as the legend takes them from the header (DEC-071). */
  const firstLetters = (label: string) =>
    [...(label.trim().split(/\s+/)[0] ?? "")].filter((char) => /[\p{L}\p{N}]/u.test(char)).slice(0, 3).join("");

  async function expectEntry(page: Page) {
    const header = await firstHeader(page);
    const found = await entry(page);
    expect(found).toEqual({
      group: "time",
      lastGroup: true,
      first: true,
      label: "Weather model",
      color: header.color,
      letters: firstLetters(header.label),
      lettersColor: "rgb(255, 255, 255)",
      inside: true,
      oneLine: true,
    });
    // The first model's shade of the weather chain (REQ-443, REQ-456: 72 % of #1f6fd1 over the white card).
    expect(header.color).toBe("#5e97de");
    // The fixture's first model is AROME.
    expect(firstLetters(header.label)).toBe("ARO");
  }

  /** The model headers switched off in the settings before the page loads. */
  const withoutHeaders = (page: Page) =>
    page.addInitScript(() => window.localStorage.setItem("graupel.modelHeaders", "false"));

  test("in the last group left of the meteogram (1920 px); none without model headers", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-variant", "side");
    await expectEntry(page);
    await legend(page).screenshot({ path: test.info().outputPath("header-side.png") });
    await withoutHeaders(page);
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(legend(page)).toHaveAttribute("data-variant", "side");
    await expect(chart(page).getByTestId("model-label-segment")).toHaveCount(0);
    await expect(legend(page).locator('[data-key="now"]')).toBeVisible();
    await expect(legend(page).locator('[data-key="modelHeader"]')).toHaveCount(0);
  });

  test("in the last group of the card above the meteogram (1280 px); none without model headers", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-variant", "card");
    await expectEntry(page);
    await legend(page).screenshot({ path: test.info().outputPath("header-wide.png") });
    // Switched off in the settings: gone at once.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("tab", { name: "Models" }).click();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("checkbox", { name: "Show model headers" }).uncheck();
    await expect(chart(page).getByTestId("model-label-segment")).toHaveCount(0);
    await expect(legend(page).locator('[data-key="modelHeader"]')).toHaveCount(0);
    await expect(legend(page).locator('[data-key="now"]')).toBeVisible();
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    ownDevice();

    test("in the last group of the card; the card is no higher; none without model headers", async ({ page }) => {
      await open(page);
      await expect(legend(page)).toHaveAttribute("data-variant", "card");
      await expectEntry(page);
      // Above the current time in the second column, one line high as it; the column is no longer than the first: the
      // card keeps its height.
      const now = (await legend(page).locator('[data-key="now"]').boundingBox())!;
      const header = (await legend(page).locator('[data-key="modelHeader"]').boundingBox())!;
      expect(Math.abs(header.x - now.x)).toBeLessThan(1);
      expect(now.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(Math.abs(header.height - now.height)).toBeLessThan(1);
      const box = (await legend(page).boundingBox())!;
      expect(now.y + now.height).toBeLessThanOrEqual(box.y + box.height);
      const lastOfFirst = (await legend(page).locator('[data-group="precip"] li').last().boundingBox())!;
      expect(now.y + now.height).toBeLessThanOrEqual(lastOfFirst.y + lastOfFirst.height + 1);
      await legend(page).screenshot({ path: test.info().outputPath("header-phone.png") });
      const withHeader = box.height;

      await withoutHeaders(page);
      await page.reload();
      await expect(chart(page)).toBeVisible();
      await expect(legend(page)).toHaveAttribute("data-variant", "card");
      await expect(legend(page).locator('[data-key="now"]')).toBeVisible();
      await expect(legend(page).locator('[data-key="modelHeader"]')).toHaveCount(0);
      expect(Math.abs((await legend(page).boundingBox())!.height - withHeader)).toBeLessThan(1);
    });
  });
});

/** Sunrise 06:30 and sunset 16:30 UTC on every day around the fixed time, for daylight and sun times in the chart. */
const withSunTimes = (page: Page) =>
  page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    if (!new URL(route.request().url()).searchParams.has("daily")) return route.fallback();
    const days = Array.from({ length: 21 }, (_, index) =>
      new Date(Date.UTC(2026, 9, 27 + index)).toISOString().slice(0, 10),
    );
    return route.fulfill({
      json: {
        timezone: "GMT",
        daily: {
          time: days,
          sunrise: days.map((day) => `${day}T06:30`),
          sunset: days.map((day) => `${day}T16:30`),
        },
      },
    });
  });

test.describe("last group with the sun times (REQ-679)", () => {
  test.beforeEach(async ({ page }) => {
    await withSunTimes(page);
  });

  /** The last group: its entries in order; the box of the weather model with its letters. */
  const lastGroup = (page: Page) =>
    legend(page)
      .locator("ul[data-group]")
      .last()
      .evaluate((list) => ({
        id: list.getAttribute("data-group"),
        keys: [...list.querySelectorAll("li")].map((item) => item.getAttribute("data-key")),
        labels: [...list.querySelectorAll("li > span")].map((label) => label.textContent),
        letters: list.querySelector('[data-key="modelHeader"] svg text')?.textContent,
      }));

  const LAST = {
    id: "time",
    keys: ["modelHeader", "now", "sunTimes", "daylight"],
    labels: ["Weather model", "Now", "Sunrise/sunset", "Daylight"],
    letters: "ARO", // the fixture's first model, AROME (DEC-071)
  };

  async function expectLastGroup(page: Page, variant: "side" | "card") {
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-variant", variant);
    await expect(legend(page).locator('[data-key="daylight"]')).toBeVisible();
    await expect(chart(page).getByTestId("daylight-stripe").first()).toBeAttached();
    expect(await lastGroup(page)).toEqual(LAST);
  }

  test("weather model, now, sunrise and sunset, daylight left of the meteogram (1920 px)", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await expectLastGroup(page, "side");
    // One below the other in this order.
    const tops = await legend(page)
      .locator('ul[data-group="time"] li')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await legend(page).screenshot({ path: test.info().outputPath("sun-side.png") });
  });

  test("in this order in the card above the meteogram (1280 px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await expectLastGroup(page, "card");
    await legend(page).screenshot({ path: test.info().outputPath("sun-wide.png") });
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    ownDevice();

    test("in this order in the card above the meteogram", async ({ page }) => {
      await expectLastGroup(page, "card");
      await legend(page).screenshot({ path: test.info().outputPath("sun-phone.png") });
    });
  });
});

/** iPad Pro 11 as Playwright's list has it, upright or turned (as in tablet.spec.ts), without its browser type. */
function ipad(turned: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices["iPad Pro 11"]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  return { ...options, viewport, screen: viewport };
}

/**
 * The legend's columns on a tablet in landscape (REQ-756, REQ-763): box, upright line before it and its groups with
 * entries.
 */
const columns = (page: Page) =>
  legend(page)
    .locator(".meteogram-legend__column")
    .evaluateAll((list) =>
      list.map((column) => {
        const rect = column.getBoundingClientRect();
        const style = getComputedStyle(column);
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          lineLeft: style.borderLeftStyle === "solid" ? parseFloat(style.borderLeftWidth) : 0,
          groups: [...column.querySelectorAll("ul[data-group]")].map((group) => {
            const box = group.getBoundingClientRect();
            return {
              id: group.getAttribute("data-group"),
              keys: [...group.querySelectorAll("li")].map((item) => item.getAttribute("data-key")),
              top: box.top,
              bottom: box.bottom,
              lineTop: getComputedStyle(group).borderTopStyle === "solid" ? 1 : 0,
            };
          }),
        };
      }),
    );

/** Height of the legend's entries from the first one's top to the last one's bottom. */
const entriesHeight = (page: Page) =>
  legend(page)
    .getByRole("listitem")
    .evaluateAll((items) => {
      const rects = items.map((item) => item.getBoundingClientRect());
      return Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top));
    });

/** Dew point and relative humidity on or off before the page loads (REQ-593, REQ-650). */
const withLines = (page: Page, dewPoint: boolean, humidity: boolean) =>
  page.addInitScript(
    ([dew, relative]) => {
      window.localStorage.setItem("graupel.dewPoint", dew ? "on" : "off");
      window.localStorage.setItem("graupel.relativeHumidity", relative ? "on" : "off");
    },
    [dewPoint, humidity],
  );

const TIME_MARKS = { id: "time", keys: ["modelHeader", "now", "sunTimes", "daylight"] };

test.describe("tablet in landscape (REQ-756, REQ-763)", () => {
  test.use({ ...ipad(true), timezoneId: "UTC", locale: "en-GB" });
  ownDevice();

  test.beforeEach(async ({ page }) => {
    await withSunTimes(page);
  });

  /** The columns side by side at one height, each but the first after an upright line. */
  async function expectSideBySide(page: Page, count: number) {
    const found = await columns(page);
    expect(found).toHaveLength(count);
    for (const [index, column] of found.entries()) {
      expect(Math.abs(column.top - found[0]!.top)).toBeLessThan(1);
      expect(column.lineLeft).toBe(index === 0 ? 0 : 1);
      if (index > 0) expect(column.left).toBeGreaterThanOrEqual(found[index - 1]!.right - 1);
    }
    return found;
  }

  for (const [name, dewPoint, humidity] of [
    ["without the dew point and the relative humidity", false, false],
    ["with the dew point", true, false],
    ["with the relative humidity", false, true],
    ["with both", true, true],
  ] as const) {
    test(`four columns ${name}: temperature, precipitation, wind, weather model`, async ({ page }) => {
      await withLines(page, dewPoint, humidity);
      await open(page);
      await expect(legend(page)).toHaveAttribute("data-variant", "card");
      await expect(legend(page)).toHaveAttribute("data-columns", "4");
      await expect(legend(page).locator('[data-key="daylight"]')).toBeVisible();
      const found = await expectSideBySide(page, 4);
      const temperature = [
        "temperature",
        "apparentTemperature",
        ...(dewPoint ? ["dewPoint"] : []),
        ...(humidity ? ["relativeHumidity"] : []),
      ];
      expect(found.map((column) => column.groups.map(({ id, keys }) => ({ id, keys })))).toEqual([
        [{ id: "temp", keys: temperature }],
        [{ id: "precip", keys: ["precipitation", "precipitationProbability", "clouds"] }],
        [{ id: "wind", keys: ["wind", "gusts", "windDirection"] }],
        [TIME_MARKS],
      ]);
      // One group in each column, no line above it.
      expect(found.map((column) => column.groups.map((group) => group.lineTop))).toEqual([[0], [0], [0], [0]]);
      // As wide as the page and as high as its longest column: four entries (the time marks).
      const box = (await legend(page).boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.width).toBeGreaterThan(viewport.width * 0.95);
      const item = (await legend(page).locator('[data-key="temperature"]').boundingBox())!;
      expect(await entriesHeight(page)).toBeLessThanOrEqual(4 * item.height + 3 * 1 + 1);
      // The page fits the screen, the chart takes the height left (REQ-608).
      await expect(page.getByTestId("meteogram-scroll")).toHaveClass(/meteogram__scroll--fits/);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
      if (!dewPoint && !humidity) {
        await expect(legend(page)).toHaveScreenshot("legend-tablet-landscape.png", { maxDiffPixelRatio: 0.002 });
      } else if (dewPoint && humidity) {
        await expect(legend(page)).toHaveScreenshot("legend-tablet-landscape-four.png", { maxDiffPixelRatio: 0.002 });
      } else await legend(page).screenshot({ path: test.info().outputPath("tablet-landscape-four.png") });
    });
  }

  test("turned upright the phone's two columns again, turned back the four", async ({ page }) => {
    await withLines(page, false, false);
    await open(page);
    await expect(legend(page)).toHaveAttribute("data-columns", "4");
    const turned = (await columns(page)).map((column) => column.groups.map((group) => group.id));
    await page.setViewportSize(ipad(false).viewport);
    await expect(legend(page)).not.toHaveAttribute("data-columns");
    await expect(legend(page).locator(".meteogram-legend__column")).toHaveCount(0);
    // The groups in the phone's newspaper columns: temperature and precipitation | wind and the time marks.
    const first = (await legend(page).locator('[data-key="temperature"]').boundingBox())!;
    const second = (await legend(page).locator('[data-key="wind"]').boundingBox())!;
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(second.x).toBeGreaterThan(first.x + 100);
    // Upright the same groups in the same order, one column each when turned.
    const upright = await legend(page)
      .locator("ul[data-group]")
      .evaluateAll((lists) => lists.map((list) => list.getAttribute("data-group")));
    expect(upright).toEqual(["temp", "precip", "wind", "time"]);
    expect(turned).toEqual(upright.map((id) => [id]));
    await page.setViewportSize(ipad(true).viewport);
    await expect(legend(page)).toHaveAttribute("data-columns", "4");
  });
});
