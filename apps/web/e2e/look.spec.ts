// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Look of footer, header and popups after the review (REQ-449, REQ-450, REQ-451), in light and dark mode at phone
 * and desktop width: the footer lies right-aligned on the page background without underlines; place and header bar
 * share one card with the controls at the top edge; favourites are a split button usable by keyboard; popups and the
 * meteogram tooltip have the card colour of the page.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

test.use({ locale: "en-GB" });

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

const style = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** Relative luminance (0 dark … 1 light) of an `rgb(…)` colour. */
function luminance(color: string): number {
  const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** A colour token of the page as computed `rgb(…)`. */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const TRANSPARENT = "rgba(0, 0, 0, 0)";

for (const scheme of ["light", "dark"] as const) {
  for (const { name, width, height } of [
    { name: "phone", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    test.describe(`${scheme}, ${name}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });
      ownDevice();

      test.beforeEach(async ({ page }) => {
        await page.goto(APP);
        await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
      });

      test("footer: right-aligned on the page background, links without underline", async ({ page }) => {
        const footer = page.locator('[data-region="footer"]');
        expect(await style(footer, "background-color")).toBe(TRANSPARENT);
        expect(await style(footer, "border-top-width")).toBe("0px");
        expect(await style(footer, "box-shadow")).toBe("none");

        const links = footer.getByRole("navigation").getByRole("button");
        await expect(links).toHaveText(["Info", "Legal notice", "Privacy"]);
        const footerBox = await box(footer);
        const last = await box(links.last());
        const first = await box(links.first());
        // Right edge of the links on the right edge of the footer, the links in the right half.
        expect(footerBox.x + footerBox.width - (last.x + last.width)).toBeLessThan(2);
        expect(first.x).toBeGreaterThan(footerBox.x + footerBox.width / 2 - (width < 600 ? 120 : 0));
        for (const link of await links.all()) {
          expect(await style(link, "text-decoration-line")).toBe("none");
          expect(await style(link, "color")).toBe(await tokenColor(page, "--color-text-muted"));
        }
        await expectNoHorizontalScroll(page);
      });

      test("header: one card with the place, controls at the top edge", async ({ page }) => {
        const top = page.locator(".app__top");
        const location = page.locator('[data-region="location"]');
        const header = page.locator('[data-region="header"]');
        // The card is the wrapper; the two regions inside have no card of their own, so nothing separates them.
        expect(await style(top, "background-color")).toBe(await tokenColor(page, "--color-surface"));
        expect(luminance(await style(top, "background-color")) > 0.5).toBe(scheme === "light");
        for (const region of [location, header]) {
          expect(await style(region, "background-color")).toBe(TRANSPARENT);
          expect(await style(region, "border-left-width")).toBe("0px");
          expect(await style(region, "box-shadow")).toBe("none");
        }

        const topBox = await box(top);
        const locationBox = await box(location);
        const headerBox = await box(header);
        const settings = await box(header.getByRole("button", { name: "Settings" }));
        const language = await box(header.getByRole("combobox", { name: "Language" }));
        for (const b of [locationBox, headerBox]) {
          expect(b.x).toBeGreaterThanOrEqual(topBox.x);
          expect(b.x + b.width).toBeLessThanOrEqual(topBox.x + topBox.width + 0.5);
        }
        if (name === "desktop") {
          // Side by side, the controls at the top edge of the card (not centred in its height).
          expect(headerBox.x).toBeGreaterThanOrEqual(locationBox.x + locationBox.width - 0.5);
          expect(Math.abs(headerBox.y - locationBox.y)).toBeLessThan(1);
          expect(settings.y - topBox.y).toBeLessThan(24);
          expect(Math.abs(language.y + language.height / 2 - (settings.y + settings.height / 2))).toBeLessThan(2);
          expect(topBox.height - (settings.y - topBox.y + settings.height)).toBeGreaterThan(40);
        } else {
          // Phone: language, settings and info above the place (REQ-459).
          expect(locationBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 0.5);
          expect(headerBox.y - topBox.y).toBeLessThan(2);
        }
        await expectNoHorizontalScroll(page);
      });

      test("favourites: split button with a menu, by keyboard", async ({ page }) => {
        const location = page.locator('[data-region="location"]');
        const input = location.getByRole("combobox", { name: "Search for a place" });
        await expect(location.getByRole("navigation", { name: "Favourites" })).toHaveCount(0);
        await expect(location.getByRole("button", { name: "Matterhorn" })).toHaveCount(0);

        const star = location.getByRole("button", { name: "Remove Mont Blanc from favourites" });
        const arrow = location.getByRole("button", { name: "Show favourites" });
        const starBox = await box(star);
        const arrowBox = await box(arrow);
        // The two parts touch: one button with two parts.
        expect(Math.abs(arrowBox.x - (starBox.x + starBox.width))).toBeLessThan(2);
        expect(Math.abs(arrowBox.y - starBox.y)).toBeLessThan(1);
        await expect(arrow).toHaveAttribute("aria-expanded", "false");

        await arrow.focus();
        await page.keyboard.press("ArrowDown");
        const menu = location.getByRole("menu", { name: "Favourites" });
        await expect(menu).toBeVisible();
        await expect(arrow).toHaveAttribute("aria-expanded", "true");
        const items = menu.getByRole("menuitem");
        await expect(items).toHaveText(["Großglockner", "Matterhorn", "Mont Blanc", "Gran Paradiso", "Ortler"]);
        await expect(items.first()).toBeFocused();
        // The menu stays on the page and has the card colour.
        const menuBox = await box(menu);
        expect(menuBox.x).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
        expect(await style(menu, "background-color")).toBe(await style(page.locator(".app__top"), "background-color"));
        await expectNoHorizontalScroll(page);

        await page.keyboard.press("End");
        await expect(items.last()).toBeFocused();
        await page.keyboard.press("ArrowDown");
        await expect(items.first()).toBeFocused();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(menu).toBeHidden();
        await expect(input).toHaveValue("Matterhorn");
        await expect(arrow).toBeFocused();

        await page.keyboard.press("Enter");
        await expect(menu).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(arrow).toBeFocused();
        await expect(input).toHaveValue("Matterhorn");

        // The main part still marks the place.
        await location.getByRole("button", { name: "Remove Matterhorn from favourites" }).press("Enter");
        await expect(location.getByRole("button", { name: "Add Matterhorn to favourites" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        await arrow.click();
        await expect(items).toHaveText(["Großglockner", "Mont Blanc", "Gran Paradiso", "Ortler"]);
        await page.mouse.click(2, 2);
        await expect(menu).toBeHidden();
      });

      test("popups and the meteogram tooltip have the card colour of the page", async ({ page }) => {
        const card = await style(page.locator(".app__top"), "background-color");
        expect(luminance(card) > 0.5).toBe(scheme === "light");

        await page.getByRole("button", { name: "Settings" }).click();
        const settings = page.getByRole("dialog", { name: "Settings" });
        await expect(settings).toBeVisible();
        expect(await style(settings, "background-color")).toBe(card);
        await page.keyboard.press("Escape");
        await expect(settings).toBeHidden();

        await page.getByRole("banner").getByRole("button", { name: "Info" }).click();
        const info = page.getByRole("dialog", { name: "Information" });
        await expect(info).toBeVisible();
        expect(await style(info, "background-color")).toBe(card);
        await page.keyboard.press("Escape");
        await expect(info).toBeHidden();

        const chart = page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
        await chart.scrollIntoViewIfNeeded();
        const chartBox = await box(chart);
        await page.mouse.move(chartBox.x + Math.min(chartBox.width, width) / 3, chartBox.y + chartBox.height / 3);
        const tooltip = page.getByTestId("meteogram-tooltip");
        await expect(tooltip).toBeVisible();
        expect(await style(tooltip, "background-color")).toBe(card);
        expect(await style(tooltip, "color")).toBe(await style(page.locator("body"), "color"));
      });
    });
  }
}
