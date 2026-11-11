// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The header of the last model reaches the right edge of the meteogram's drawing area, even when the model's series
 * ends before it (REQ-462): the fake Open-Meteo answers every model 10 hours short of its horizon.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');

async function rightEdge(page: Page, selector: string): Promise<number> {
  const boxes = await meteogram(page)
    .locator(selector)
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
  expect(boxes.length).toBeGreaterThan(0);
  return Math.max(...boxes);
}

test("the last model header reaches the edge when the data ends before it", async ({ page }) => {
  // Registered after the fixture's route, so this one answers first.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { cutHours: 10 }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  const segments = meteogram(page).locator('[data-testid="model-label-segment"]');
  await expect.poll(() => segments.count()).toBeGreaterThan(0);

  // The edge of the drawing area: the right border line of its panels.
  const edgeX = Number(
    await meteogram(page).locator('[data-testid="outer-right-day-separator-line"]').first().getAttribute("x1"),
  );
  const last = segments.last();
  expect(Number(await last.getAttribute("data-end-x"))).toBe(edgeX);
  const shape = last.locator('[data-testid="model-header-shape"]');
  expect(Number(await shape.getAttribute("data-x")) + Number(await shape.getAttribute("data-width"))).toBe(edgeX);

  // On screen too, while the temperature curve ends clearly before the edge.
  const edge = await rightEdge(page, '[data-testid="outer-right-day-separator-line"]');
  const header = await rightEdge(page, '[data-testid="model-header-shape"]');
  const curve = await rightEdge(page, '[data-testid="temperature-path"]');
  expect(Math.abs(header - edge)).toBeLessThan(1.5);
  expect(curve).toBeLessThan(edge - 10);
});
