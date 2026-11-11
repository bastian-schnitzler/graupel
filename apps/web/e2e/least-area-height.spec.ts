// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The meteogram never draws a shape of negative height (REQ-749): with the weather and cloud chains and the legend
 * the turned iPad Pro 11 leaves the upright chart in its column little height, its areas get lower, but the area with
 * the cloud background stays high enough for the ground of the terrain mask. The console stays without errors, and no
 * rect gets a negative height or width at any time while the page settles. In every device class.
 */
import { expect, test } from "./fixtures.ts";

const APP = "http://localhost:4175/";

test.use({ timezoneId: "UTC", locale: "en-GB" });

test("with both chains and the legend no area of the chart gets a negative height (REQ-749)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // A place 1200 m high draws the terrain mask over the cloud background.
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1200] } }),
  );
  // Every negative height or width set on an element of the page, also one set and changed again before a check.
  await page.addInitScript(() => {
    const negative: string[] = [];
    (window as unknown as { negativeSizes: string[] }).negativeSizes = negative;
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name: string, value: string) {
      if ((name === "height" || name === "width") && Number(value) < 0) {
        negative.push(`${this.tagName} ${name}=${value}`);
      }
      return setAttribute.call(this, name, value);
    };
  });
  await page.goto(APP);
  await page.evaluate(() => {
    window.localStorage.setItem("graupel.showModelChain", "true");
    window.localStorage.removeItem("graupel.legend");
  });
  await page.reload();
  await expect(page.locator(".model-chain-row")).toHaveCount(2);
  // The legend is switched on; whether its card has room (REQ-608) is the page's choice.
  expect(await page.evaluate(() => window.localStorage.getItem("graupel.legend"))).toBeNull();
  const chart = page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
  const mask = chart.locator('[data-testid="terrain-mask"] > rect');
  await expect(mask).toBeAttached();
  // The chart has settled at its height.
  await expect.poll(async () => (await chart.boundingBox())?.height).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(Number(await mask.getAttribute("height"))).toBeGreaterThanOrEqual(0);
  const rects = await chart
    .locator("rect")
    .evaluateAll((all) => all.map((rect) => [Number(rect.getAttribute("height")), Number(rect.getAttribute("width"))]));
  for (const [height, width] of rects) {
    expect(height).toBeGreaterThanOrEqual(0);
    expect(width).toBeGreaterThanOrEqual(0);
  }
  expect(await page.evaluate(() => (window as unknown as { negativeSizes: string[] }).negativeSizes)).toEqual([]);
  expect(errors).toEqual([]);
});
