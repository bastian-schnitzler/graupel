// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The focus ring of the search field on a phone in the browser (REQ-619): the place row starts at the page's top edge
 * (REQ-586), so the ring lies inside the field's border and is whole on all four sides, also at the top. The installed
 * app, which keeps the page's top margin, and the desktop keep the ring outside the field.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";

/** Focuses the search field and returns its ring: width, offset and its outer edges on the page. */
async function fieldRing(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".location__input").focus();
  return page.locator(".location__field").evaluate((field) => {
    const style = getComputedStyle(field);
    const box = field.getBoundingClientRect();
    const width = parseFloat(style.outlineWidth);
    const offset = parseFloat(style.outlineOffset);
    const outside = width + offset;
    return {
      style: style.outlineStyle,
      width,
      offset,
      top: box.top + window.scrollY - outside,
      bottom: box.bottom - box.top + 2 * outside,
    };
  });
}

test.describe("phone in the browser", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("the focused search field's ring is whole at the top of the page, inside its border (REQ-619)", async ({ page }) => {
    const ring = await fieldRing(page);
    expect(ring.style).toBe("solid");
    expect(ring.width).toBe(2);
    expect(ring.offset).toBe(-2);
    // The ring's outer edge is the field's edge, which is on the page.
    expect(ring.top).toBeGreaterThanOrEqual(0);
    // The buttons of the row too, when the keyboard focuses them.
    await page.keyboard.press("Tab");
    const offset = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active?.closest(".location__bar") && active.tagName === "BUTTON"
        ? getComputedStyle(active).outlineOffset
        : null;
    });
    if (offset !== null) expect(offset).toBe("-2px");
  });
});

test.describe("installed app on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("keeps the ring outside the field below the page's top margin (REQ-586, REQ-619)", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true }));
    const ring = await fieldRing(page);
    expect(ring.offset).toBe(0);
    expect(ring.top).toBeGreaterThan(0);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("keeps the ring outside the field (REQ-619 is for the phone in the browser)", async ({ page }) => {
    const ring = await fieldRing(page);
    expect(ring.offset).toBe(0);
    expect(ring.width).toBe(2);
  });
});
