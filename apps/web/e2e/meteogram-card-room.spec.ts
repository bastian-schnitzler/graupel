// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Room beside the plot in the desktop meteogram card (REQ-613): left and right as wide, only as wide as the left labels
 * need, narrower on the right than before. The chart takes the card's whole width; the copy, save and full-screen
 * buttons stay at the top right, in the room right of the plot, and the right labels (cloud altitudes in km) stand
 * below them without touching them. Where the chart scrolls sideways the column stays beside it as before.
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The card's edges, the plot's edges, the button column and the right labels, in CSS px. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="meteogram-card"]')!.getBoundingClientRect();
    const svg = document.querySelector<SVGSVGElement>('[data-region="meteogram"] svg.meteogram-svg-integrated')!;
    const plot = svg.querySelector(".temperature-plot-area")!.getBoundingClientRect();
    const tools = document.querySelector('[data-testid="meteogram-tools"]')!.getBoundingClientRect();
    const right = [...svg.querySelectorAll("text")]
      .map((text) => text.getBoundingClientRect())
      .filter((box) => box.left > plot.right);
    const chartBox = svg.getBoundingClientRect();
    return {
      leftRoom: plot.left - card.left,
      rightRoom: card.right - plot.right,
      cardWidth: card.width,
      plotRight: plot.right,
      tools: { left: tools.left, right: tools.right, top: tools.top, bottom: tools.bottom },
      cardInnerRight: card.right - 1 - 16,
      chartTop: chartBox.top,
      rightLabels: right.map((box) => ({ left: box.left, right: box.right, top: box.top })),
    };
  });

for (const width of [1280, 1000, 1600]) {
  test(`${width} px: as much room left as right of the plot, the buttons in it above the right labels`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(APP);
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    await expect(page.getByTestId("meteogram-card")).toHaveClass(/meteogram-card--tools-over/);
    const room = await measure(page);
    // Left and right as wide; on the right narrower than before (default room and the column beside the chart).
    expect(Math.abs(room.leftRoom - room.rightRoom)).toBeLessThanOrEqual(2);
    // Before: the card's padding and border, the column (32 px) with its gap (8 px), 50 of 1000 units of the chart.
    const before = 16 + 1 + 8 + 32 + (room.cardWidth - 2 - 2 * 16 - 32 - 8) * 0.05;
    expect(room.rightRoom).toBeLessThan(before - 20);
    // The buttons stay at the top right of the card's content, in the room right of the plot.
    expect(room.tools.left).toBeGreaterThanOrEqual(room.plotRight + 4);
    expect(Math.abs(room.tools.right - room.cardInnerRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(room.tools.top - room.chartTop)).toBeLessThanOrEqual(1);
    // The right labels stand in that room below the buttons.
    expect(room.rightLabels.length).toBeGreaterThan(0);
    for (const label of room.rightLabels) {
      expect(label.top).toBeGreaterThanOrEqual(room.tools.bottom + 4);
      expect(label.right).toBeLessThanOrEqual(room.cardInnerRight + 1);
    }
    await page.screenshot({ path: test.info().outputPath(`card-${width}.png`) });
  });
}

test("where the chart scrolls sideways the buttons stay beside it", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 900 });
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.getByTestId("meteogram-card")).not.toHaveClass(/meteogram-card--tools-over/);
  const scroll = (await page.getByTestId("meteogram-scroll").boundingBox())!;
  const tools = (await page.getByTestId("meteogram-tools").boundingBox())!;
  expect(tools.x).toBeGreaterThanOrEqual(scroll.x + scroll.width);
});
