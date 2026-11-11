// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Look of the meteogram in a real browser: snow bars in the card's background colour, in dark mode as well (REQ-486),
 * tooltip text as large as the left axis labels, in the card and in the full-screen view (REQ-487), and no divider
 * after the tooltip's last group (REQ-495).
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Snow in every precipitation hour of the fake (every 7th hour); this route wins over the fixture's.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    fakeForecast(route, { values: { snowfall: (index) => (index % 7 === 0 ? 0.8 : 0) } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const card = (page: Page) => page.getByTestId("meteogram-card");
const cardChart = (page: Page) => page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
const fullscreenDialog = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });

/** Fill colours of the drawn snow bars (precipitation bars of snow hours, drawn with an outline). */
const snowBarFills = (chart: Locator) =>
  chart.evaluate((svg) =>
    Array.from(svg.querySelectorAll<SVGRectElement>('[data-testid="precip-bar"]'))
      .filter((bar) => bar.getAttribute("stroke") !== "none")
      .map((bar) => getComputedStyle(bar).fill),
  );

for (const scheme of ["dark", "light"] as const) {
  test(`snow bars take the card's background colour (${scheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(APP);
    await expect(cardChart(page)).toBeVisible();
    const background = await card(page).evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe(scheme === "dark" ? "rgb(26, 33, 41)" : "rgb(255, 255, 255)");
    await expect.poll(async () => (await snowBarFills(cardChart(page))).length).toBeGreaterThan(0);
    const fills = await snowBarFills(cardChart(page));
    expect(new Set(fills)).toEqual(new Set([background]));
  });
}

/**
 * Font sizes (CSS px) of the left axis label of the wind area as drawn (`49 km/h`, or `49` over `km/h` in the full-screen
 * view, REQ-553; viewBox size times the chart's vertical scale) and of a tooltip label, with the font families of both
 * and every font size in the tooltip.
 */
async function fontSizes(page: Page, chart: Locator) {
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  const tooltip = page.getByTestId("meteogram-tooltip").filter({ visible: true });
  await expect(tooltip).toBeVisible();
  return chart.evaluate((svg, tip) => {
    const label = Array.from(svg.querySelectorAll("text")).find((text) => /\d ?km\/h$/.test(text.textContent ?? ""))!;
    const viewBoxHeight = (svg as SVGSVGElement).viewBox.baseVal.height;
    const scale = svg.getBoundingClientRect().height / viewBoxHeight;
    const tooltipLabel = tip!.querySelector<HTMLElement>(".tooltip-row .label")!;
    return {
      legend: Number(label.getAttribute("font-size")) * scale,
      legendFont: getComputedStyle(label).fontFamily,
      tooltip: parseFloat(getComputedStyle(tooltipLabel).fontSize),
      tooltipFont: getComputedStyle(tooltipLabel).fontFamily,
      // Every text of the box has the same size.
      sizes: [
        ...new Set(
          Array.from(tip!.querySelectorAll<HTMLElement>(".tooltip-header, .tooltip-section-title, .label, .val")).map(
            (node) => getComputedStyle(node).fontSize,
          ),
        ),
      ],
    };
  }, await tooltip.elementHandle());
}

test("the tooltip text is as large as the left axis labels, in the card and full-screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(cardChart(page)).toBeVisible();

  const inCard = await fontSizes(page, cardChart(page));
  expect(inCard.tooltip).toBeCloseTo(inCard.legend, 1);
  expect(inCard.tooltipFont).toBe(inCard.legendFont);
  expect(inCard.sizes).toEqual([`${inCard.tooltip}px`]);

  await cardChart(page).dblclick();
  const fullscreenChart = fullscreenDialog(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
  await expect(fullscreenChart).toBeVisible();
  const inFullscreen = await fontSizes(page, fullscreenChart);
  expect(inFullscreen.tooltip).toBeCloseTo(inFullscreen.legend, 1);
  expect(inFullscreen.tooltipFont).toBe(inFullscreen.legendFont);
  expect(inFullscreen.sizes).toEqual([`${inFullscreen.tooltip}px`]);
  // The full-screen chart is taller, so both are larger there.
  expect(inFullscreen.tooltip).toBeGreaterThan(inCard.tooltip);
});

test("the tooltip ends without a divider, with or without snow in the hovered hour", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(cardChart(page)).toBeVisible();
  const box = (await cardChart(page).boundingBox())!;
  const tooltip = page.getByTestId("meteogram-tooltip").filter({ visible: true });
  const seen = { snow: 0, noSnow: 0 };
  // Step in small moves over the chart until snowy and dry hours both came up.
  for (let x = box.x + box.width * 0.3; x < box.x + box.width * 0.9 && (!seen.snow || !seen.noSnow); x += 2) {
    await page.mouse.move(x, box.y + box.height * 0.4);
    await expect(tooltip).toBeVisible();
    const result = await tooltip.evaluate((tip) => {
      const grid = tip.querySelector(".tooltip-grid")!;
      const children = Array.from(grid.children);
      return {
        snow: grid.querySelector('[data-testid="snowfall-row"]') !== null,
        rows: children.length,
        lastIsDivider: children.at(-1)!.classList.contains("tooltip-group-divider"),
        firstIsDivider: children[0]!.classList.contains("tooltip-group-divider"),
        dividers: grid.querySelectorAll(".tooltip-group-divider").length,
      };
    });
    expect(result.rows).toBeGreaterThan(0);
    expect(result.lastIsDivider).toBe(false);
    expect(result.firstIsDivider).toBe(false);
    expect(result.dividers).toBeGreaterThan(0);
    seen[result.snow ? "snow" : "noSnow"]++;
  }
  expect(seen.snow).toBeGreaterThan(0);
  expect(seen.noSnow).toBeGreaterThan(0);
});
