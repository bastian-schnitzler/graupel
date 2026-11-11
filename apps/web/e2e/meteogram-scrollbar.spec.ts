// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The meteogram without a scroll bar and the phone's footer close to it (REQ-577): the sideways scrolling chart shows
 * no scroll bar and keeps no space for one, but still scrolls; on a phone the space between the chart's source line and
 * the footer row's text is a third of the 31 px it was. Since REQ-729 the source line stands in the footer row beside the
 * buttons: the row starts right below the chart, the buttons' icons a third of the 31 px below it. (Turned sideways, the
 * phone shows the chart in full screen.)
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
/** Space between the source line's text and the footer links' text before REQ-577, in CSS pixels (390 x 844). */
const GAP_BEFORE = 31.3;

const scroll = (page: Page) => page.getByTestId("meteogram-scroll");

async function open(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

/**
 * Space from the chart's lower edge to the top of the footer row's content, in CSS pixels: on a phone the copy button's
 * icon, whose footer has no links (REQ-582) and holds the source line beside the buttons (REQ-729).
 */
function textGap(page: Page) {
  return page.evaluate(() => {
    const chart = document.querySelector('[data-region="meteogram"] svg.meteogram-svg-integrated')!;
    const icon = document.querySelector('footer[data-region="footer"] [data-testid="meteogram-copy"] svg');
    return icon!.getBoundingClientRect().top - chart.getBoundingClientRect().bottom;
  });
}

async function expectNoScrollBar(page: Page) {
  const metrics = await scroll(page).evaluate((element: HTMLElement) => ({
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
    overflowX: getComputedStyle(element).overflowX,
    spare: element.offsetHeight - element.clientHeight,
    wider: element.scrollWidth > element.clientWidth,
  }));
  expect(metrics).toEqual({ scrollbarWidth: "none", overflowX: "auto", spare: 0, wider: true });
}

test.describe("phone, portrait", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  ownDevice();

  test("the chart scrolls sideways without a scroll bar (REQ-577)", async ({ page }) => {
    await open(page);
    await expectNoScrollBar(page);
    // A swipe to the left moves the chart.
    const box = (await scroll(page).boundingBox())!;
    const before = await scroll(page).evaluate((element) => element.scrollLeft);
    const session = await page.context().newCDPSession(page);
    const y = Math.round(box.y + box.height / 2);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 250, y }] });
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 250 - step * 15, y }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    await expect.poll(() => scroll(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 50);
  });

  test("the footer row with the source line stands right below the chart, its icons a third as far (REQ-577, REQ-729)", async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator("footer").getByTestId("meteogram-source")).toBeVisible();
    const gap = await textGap(page);
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThanOrEqual(GAP_BEFORE / 3);
    // The row does not reach up over the chart.
    const chart = (await page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated').boundingBox())!;
    const row = (await page.locator(".footer__row").boundingBox())!;
    expect(row.y).toBeGreaterThanOrEqual(chart.y + chart.height - 0.5);
    // The page does not scroll past the footer (REQ-561; in Safari on the iPhone the footer keeps room below its row
    // for Safari's bottom bar, REQ-581, REQ-611), and the buttons are where a tap reaches them.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await page.locator('footer[data-region="footer"]').boundingBox())!;
    const height = await page.evaluate(() => window.innerHeight);
    expect(footer.y + footer.height).toBeLessThanOrEqual(height + 1);
    if (await page.evaluate(() => window.scrollY > 0)) expect(footer.y + footer.height).toBeGreaterThan(height - 1);
    const copy = page.locator("footer").getByTestId("meteogram-copy");
    const target = (await copy.boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.dataset.testid,
      { x: target.x + target.width / 2, y: target.y + 2 },
    );
    expect(hit).toBe("meteogram-copy");
  });
});

test.describe("narrow desktop window", () => {
  test.use({ viewport: { width: 600, height: 900 } });
  ownDevice();

  test("the chart scrolls with the wheel, without a scroll bar; the footer keeps its distance (REQ-577)", async ({
    page,
  }) => {
    await open(page);
    await expectNoScrollBar(page);
    const box = (await scroll(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await scroll(page).evaluate((element) => element.scrollLeft);
    await page.mouse.wheel(200, 0);
    await expect.poll(() => scroll(page).evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 50);
    // Only the phone's footer moves up: here the page's gap stays between the chart card and the footer.
    const main = (await page.locator(".app__main").boundingBox())!;
    const footer = (await page.locator('footer[data-region="footer"]').boundingBox())!;
    expect(footer.y - (main.y + main.height)).toBeCloseTo(12, 0);
  });
});
