// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Smoke test of the vanilla demo page (`pnpm demo`): render, tooltip on
 * hover, wheel zoom, dark theme and PNG export in a real browser.
 */
import { expect, test, type Page } from "@playwright/test";

const DEMO = "http://localhost:4173/demo/";

async function visibleSpan(page: Page) {
  const svg = page.locator("svg.meteogram-svg-integrated");
  const start = Date.parse((await svg.getAttribute("data-visible-start-time"))!);
  const end = Date.parse((await svg.getAttribute("data-visible-end-time"))!);
  return { start, end, span: end - start };
}

// Errors on the page fail the test that caused them.
let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(DEMO);
  await expect(page.locator("svg.meteogram-svg-integrated")).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("renders the meteogram with areas, day header and label row", async ({ page }) => {
  const svg = page.locator("svg.meteogram-svg-integrated");
  await expect(svg.locator("g.panel[data-area-id]")).toHaveCount(4);
  expect(await svg.locator('[data-testid="day-label-cell"]').count()).toBeGreaterThan(0);
  await expect(page.getByTestId("meteogram-footer-location")).toContainText("Innsbruck");
  await expect(page.getByTestId("meteogram-attribution")).toContainText("Open-Meteo.com");
  const box = (await svg.boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  expect(box.height).toBeGreaterThan(200);
  // Day range 4 at the start.
  await expect(page.getByRole("button", { name: "4d", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("shows the cursor line and tooltip on hover and hides them on leave", async ({ page }) => {
  const svg = page.locator("svg.meteogram-svg-integrated");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  const tooltip = page.getByTestId("meteogram-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Temperature:");
  await expect(svg.getByTestId("hover-cursor-line")).toHaveCount(1);
  await expect(page.getByTestId("demo-chart")).toHaveAttribute("data-hover-timestamp", /Z$/);
  // Cursor in the left half: the tooltip sits on the right.
  const tipBox = (await tooltip.boundingBox())!;
  expect(tipBox.x).toBeGreaterThan(box.x + box.width * 0.3);

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 200);
  await expect(tooltip).toBeHidden();
  await expect(svg.getByTestId("hover-cursor-line")).toHaveCount(0);
});

test("zooms with the wheel over the chart and only there", async ({ page }) => {
  const svg = page.locator("svg.meteogram-svg-integrated");
  const before = await visibleSpan(page);
  const box = (await svg.boundingBox())!;

  // Wheel outside the chart scrolls the page, no zoom.
  await page.mouse.move(box.x + box.width / 2, 10);
  await page.mouse.wheel(0, -100);
  expect(await visibleSpan(page)).toEqual(before);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await visibleSpan(page)).span).toBeLessThan(before.span);
  await expect(page.getByTestId("demo-status")).toContainText("Visible:");
  // The day-range buttons follow: no fixed range is active any more.
  await expect(page.locator('#days button[aria-pressed="true"]')).toHaveCount(0);

  // Zoom out again with the wheel switched off: nothing changes.
  const zoomed = await visibleSpan(page);
  await page.locator("#zoom").click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  expect((await visibleSpan(page)).span).toBe(zoomed.span);

  // Day range "All" shows everything.
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect.poll(async () => (await visibleSpan(page)).span).toBeGreaterThan(before.span);
});

test("switches to the dark theme", async ({ page }) => {
  const label = page.getByTestId("meteogram-footer-row");
  const lightColour = await label.evaluate((element) => getComputedStyle(element).color);
  const fills = () =>
    page
      .locator("svg.meteogram-svg-integrated")
      .evaluate((svg) => [...svg.querySelectorAll("text, [data-testid='day-label-cell']")].map((node) => node.getAttribute("fill")));
  const lightFills = await fills();

  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => label.evaluate((element) => getComputedStyle(element).color)).not.toBe(lightColour);
  // Day header and texts take the colours of the dark theme.
  expect(await fills()).not.toEqual(lightFills);
  const background = await page.evaluate(
    () => (window as unknown as { meteogram: { getScene(): { theme: { background: string } } } }).meteogram.getScene().theme.background,
  );
  expect(background).not.toBe("#ffffff");

  // Hover still works in the dark theme.
  const box = (await page.locator("svg.meteogram-svg-integrated").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.getByTestId("meteogram-tooltip")).toBeVisible();
});

test("exports the chart as PNG", async ({ page }) => {
  await page.locator("#png").click();
  const image = page.getByTestId("demo-png");
  await expect(image).toBeVisible();
  const info = await image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const bytes = new Uint8Array(await (await fetch(element.src)).arrayBuffer());
    return {
      width: element.naturalWidth,
      height: element.naturalHeight,
      signature: Array.from(bytes.slice(0, 8)),
    };
  });
  expect(info.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chartWidth = (await page.locator("svg.meteogram-svg-integrated").boundingBox())!.width;
  // At least twice the on-screen size.
  expect(info.width).toBeGreaterThanOrEqual(Math.floor(chartWidth * 2));
  expect(info.height).toBeGreaterThan(0);
});
