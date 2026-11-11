// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The line below the meteogram on a phone in portrait (REQ-616): only the data source with the data's time, at the
 * page's side margin, and it stays where it is while the chart scrolls sideways. Since REQ-729 it stands in the footer's
 * row after the copy and share buttons, right-aligned. Place and elevation stand between the
 * day slider's grips (REQ-562); the chart's own row with place, domain and source at its end is hidden there, but the
 * copied picture keeps it. Landscape, the full-screen view and the desktop keep the chart's own row.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const COPY = "Copy the meteogram as a picture";

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const source = (page: Page) => page.getByTestId("meteogram-source");

/** A page whose domain is shown in the middle of the chart's own row (REQ-464). */
async function openWithDomain(page: Page) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { domain: "graupel.eu" } }));
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

test.describe("phone in portrait", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  test("below the chart only the data source with the data's time, right-aligned at the page's side margin (REQ-616, REQ-729)", async ({
    page,
  }) => {
    await openWithDomain(page);
    await expect(source(page)).toBeVisible();
    await expect(source(page)).toHaveText(/^Weather data by Open-Meteo\.com \(\d\d\/\d\d\/\d\d, \d\d:\d\d\)$/);
    await expect(source(page).getByRole("link", { name: "Open-Meteo.com" })).toHaveAttribute(
      "href",
      "https://open-meteo.com/",
    );
    // The chart's own row (place, domain, source at the row's end) is not shown on the page.
    await expect(page.getByTestId("meteogram-footer-row")).toBeHidden();
    await expect(page.getByTestId("meteogram-footer-center")).toBeHidden();
    await expect(page.getByTestId("meteogram-attribution")).toBeHidden();
    await expect(page.getByText("graupel.eu", { exact: true })).toBeHidden();
    // The time is the one the chart's row puts after the place.
    const row = (await page.getByTestId("meteogram-footer-location").textContent()) ?? "";
    const time = /\(([^)]*)\)$/.exec(row)?.[1];
    expect(time).toBeTruthy();
    await expect(source(page)).toContainText(`(${time})`);
    // Its text ends at the day slider's right edge (REQ-729) and is as large as the place between the grips (REQ-562).
    const slider = (await page.locator('[data-region="day-slider"]').boundingBox())!;
    const textRight = await source(page).evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().right;
    });
    expect(Math.abs(textRight - (slider.x + slider.width))).toBeLessThan(0.5);
    const size = (selector: string) =>
      page.locator(selector).evaluate((element) => getComputedStyle(element).fontSize);
    expect(await size('[data-testid="meteogram-source"]')).toBe(await size('[data-testid="day-slider-caption"]'));
    // Below the chart, in the footer's row beside the buttons, in the middle of the row with them (REQ-729).
    const svg = (await chart(page).boundingBox())!;
    const line = (await source(page).boundingBox())!;
    const copy = (await page.locator("footer").getByTestId("meteogram-copy").boundingBox())!;
    await expect(page.locator("footer").getByTestId("meteogram-source")).toBeVisible();
    expect(line.y).toBeGreaterThanOrEqual(svg.y + svg.height - 0.5);
    expect(Math.abs(line.y + line.height / 2 - (copy.y + copy.height / 2))).toBeLessThan(1);
  });

  test("the line stays where it is while the chart scrolls sideways (REQ-616)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const before = (await source(page).boundingBox())!;
    const scroll = page.getByTestId("meteogram-scroll");
    expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth + 100)).toBe(true);
    await scroll.evaluate((element) => element.scrollTo({ left: 400 }));
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(300);
    const after = (await source(page).boundingBox())!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    await expect(source(page)).toBeInViewport({ ratio: 1 });
  });

  test("the copied picture keeps the chart's own row with place, domain and source (REQ-616)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    // Records the text the picture draws.
    await page.addInitScript(() => {
      const drawn: string[] = [];
      Object.assign(window, { __drawnText: drawn });
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, maxWidth?: number) {
        drawn.push(text);
        return maxWidth === undefined ? fillText.call(this, text, x, y) : fillText.call(this, text, x, y, maxWidth);
      };
    });
    await openWithDomain(page);
    const place = (await page.getByTestId("meteogram-place").textContent()) ?? "";
    expect(place).toMatch(/, \d+ m$/);
    await page.getByRole("button", { name: COPY }).click();
    await expect(page.getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
    const drawn = (await page.evaluate(() => (window as unknown as { __drawnText: string[] }).__drawnText)).join("|");
    expect(drawn).toContain(place);
    expect(drawn).toContain("graupel.eu");
    expect(drawn).toContain("Open-Meteo.com");
    // The page shows the line below the chart again, not the chart's row.
    await expect(source(page)).toBeVisible();
    await expect(page.getByTestId("meteogram-footer-row")).toBeHidden();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("keeps the chart's own row with place and source, without the phone's line (REQ-616)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    await expect(source(page)).toHaveCount(0);
    await expect(page.getByTestId("meteogram-footer-location")).toBeVisible();
    await expect(page.getByTestId("meteogram-attribution")).toBeVisible();
  });
});
