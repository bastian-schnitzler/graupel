// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The relative humidity does not narrow the desktop meteogram (REQ-672): with the option on, the chart and its plot are
 * as wide as with it off, and the humidity's axis (100 % at the top) stands in the room right of the plot under the
 * copy, save, refresh and full-screen buttons. There the buttons are translucent and become opaque when pointed at or
 * focused with the keyboard; without labels under them they stay as they were. The full-screen view keeps its buttons.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 4 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 4, 11);

test.use({ timezoneId: "UTC" });

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

async function open(page: Page, humidity: "on" | "off") {
  await page.addInitScript((value) => {
    if (value === "on") window.localStorage.setItem("graupel.relativeHumidity", "on");
    else window.localStorage.removeItem("graupel.relativeHumidity");
  }, humidity);
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.getByTestId("meteogram-card")).toHaveClass(/meteogram-card--tools-over/);
  // The measured room is applied before the next frames.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** The chart's and the plot's edges, the button column, and the labels right of the plot, in CSS px. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="meteogram-card"]')!.getBoundingClientRect();
    const svg = document.querySelector<SVGSVGElement>('[data-region="meteogram"] svg.meteogram-svg-integrated')!;
    const chart = svg.getBoundingClientRect();
    const plot = svg.querySelector(".temperature-plot-area")!.getBoundingClientRect();
    const tools = document.querySelector('[data-testid="meteogram-tools"]')!.getBoundingClientRect();
    const right = [...svg.querySelectorAll("text")]
      .filter((text) => text.getBoundingClientRect().left > plot.right)
      .map((text) => {
        const box = text.getBoundingClientRect();
        return { text: (text.textContent ?? "").replace(/\s/g, ""), left: box.left, right: box.right, top: box.top };
      });
    return {
      chart: { left: chart.left, top: chart.top, width: chart.width, height: chart.height },
      plot: { left: plot.left, right: plot.right },
      tools: { left: tools.left, right: tools.right, top: tools.top, bottom: tools.bottom },
      cardInnerRight: card.right - 1 - 16,
      right,
    };
  });

const buttons = (page: Page) => page.getByTestId("meteogram-tools").getByRole("button");

const opacity = (button: Locator) => button.evaluate((element) => Number(getComputedStyle(element).opacity));

for (const width of [1000, 1280, 1600]) {
  test(`${width} px: as wide with the relative humidity as without, its axis under the buttons`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "off");
    const off = await measure(page);
    await expect(page.getByTestId("meteogram-card")).not.toHaveClass(/meteogram-card--tools-translucent/);
    expect(off.right.some((label) => label.text === "100%")).toBe(false);

    await open(page, "on");
    await expect(page.getByTestId("meteogram-card")).toHaveClass(/meteogram-card--tools-translucent/);
    const on = await measure(page);
    // The same chart and plot as without the relative humidity.
    expect(Math.abs(on.chart.width - off.chart.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(on.chart.height - off.chart.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(on.chart.left - off.chart.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(on.plot.left - off.plot.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(on.plot.right - off.plot.right)).toBeLessThanOrEqual(0.5);
    // The buttons stand where they stood on the chart, right of the plot (a legend above may move both down).
    expect(on.tools.left).toBe(off.tools.left);
    expect(on.tools.right).toBe(off.tools.right);
    expect(Math.abs(on.tools.top - on.chart.top - (off.tools.top - off.chart.top))).toBeLessThanOrEqual(0.5);
    expect(on.tools.left).toBeGreaterThanOrEqual(on.plot.right + 4);
    // The humidity's axis right of the plot, "100 %" beside the buttons, under them; within the card.
    const top = on.right.find((label) => label.text === "100%");
    expect(top).toBeDefined();
    expect(top!.top).toBeLessThan(on.tools.bottom);
    expect(top!.right).toBeGreaterThan(on.tools.left);
    for (const label of on.right) expect(label.right).toBeLessThanOrEqual(on.cardInnerRight + 1);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: test.info().outputPath(`card-${width}.png`),
      clip: { x: on.tools.left - 200, y: on.tools.top - 20, width: 260, height: 260 },
    });
  });
}

test("the buttons over the humidity's axis are translucent, opaque when pointed at or focused", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "on");
  await page.mouse.move(0, 0);
  const all = buttons(page);
  await expect(all).toHaveCount(4);
  for (const button of await all.all()) {
    await expect.poll(() => opacity(button)).toBeLessThan(0.7);
    await expect.poll(() => opacity(button)).toBeGreaterThan(0.2);
  }

  // Pointed at: opaque, on a background that covers the label below; the others stay translucent.
  const refresh = page.getByTestId("meteogram-refresh");
  await refresh.hover();
  await expect.poll(() => opacity(refresh)).toBe(1);
  const background = await refresh.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => opacity(page.getByTestId("meteogram-fullscreen-open"))).toBeLessThan(0.7);
  await page.mouse.move(0, 0);
  await expect.poll(() => opacity(refresh)).toBeLessThan(0.7);

  // Focused with the keyboard: from the refresh button one step on to the full-screen button.
  await refresh.focus();
  await page.keyboard.press("Tab");
  const full = page.getByTestId("meteogram-fullscreen-open");
  await expect(full).toBeFocused();
  await expect.poll(() => opacity(full)).toBe(1);
  expect(await full.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => opacity(refresh)).toBeLessThan(0.7);
  await page.keyboard.press("Shift+Tab");
  await expect(refresh).toBeFocused();
  await expect.poll(() => opacity(refresh)).toBe(1);
  await expect.poll(() => opacity(full)).toBeLessThan(0.7);
});

test("without labels under them the buttons stay opaque", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "off");
  await page.mouse.move(0, 0);
  for (const button of await buttons(page).all()) expect(await opacity(button)).toBe(1);
});

test("the full-screen view keeps its buttons opaque with the relative humidity", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "on");
  await page.getByTestId("meteogram-fullscreen-open").click();
  const dialog = page.getByRole("dialog", { name: "Meteogram (full screen)" });
  await expect(dialog).toBeVisible();
  await page.mouse.move(0, 0);
  const inDialog = dialog.getByRole("button");
  expect(await inDialog.count()).toBeGreaterThan(0);
  for (const button of await inDialog.all()) expect(await opacity(button)).toBe(1);
});
