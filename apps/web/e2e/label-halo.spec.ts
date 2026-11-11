// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Labels with a halo on the iPad and the iPhone (REQ-746, REQ-747 of the core): the daily maximum and minimum, the axis
 * and cloud altitude labels over the plot and the terrain's elevation keep a stroke in the background's colour behind
 * their text. Safari painted the stroke of `paint-order: stroke` over the fill of stretched texts, so the values turned
 * into dark spots on the iPad. The halo is therefore a stroked copy of the text right before it; the text itself has no
 * stroke and no paint order. Chromium did not show the fault (WebKit is not installed), so the tests check that build of
 * the labels, embedded and in the full-screen view, light and dark.
 */
import { devices } from "@playwright/test";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 9);

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

/** A device of Playwright's list as a context's options, upright or turned, without its browser type. */
function device(name: string, turned: boolean, colorScheme: "light" | "dark") {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices[name]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  return { ...options, viewport, screen: viewport, colorScheme, timezoneId: "UTC", locale: "en-GB" };
}

const embedded = (page: Page) => page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const big = (page: Page) => dialog(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');

/** How the chart `svg` builds its labels with a halo. */
function halos(svg: Locator) {
  return svg.evaluate((root: SVGSVGElement) => {
    const copies = [...root.querySelectorAll<SVGTextElement>("text[data-halo]")];
    const wrong = copies.flatMap((copy) => {
      const text = copy.nextElementSibling;
      const problems: string[] = [];
      if (!(text instanceof SVGTextElement)) problems.push("no text after the halo");
      else {
        if (text.textContent !== copy.textContent) problems.push("another text than the halo's");
        if (text.hasAttribute("stroke") || text.hasAttribute("paint-order")) problems.push("text with stroke");
        if (!text.getAttribute("fill") || text.getAttribute("fill") === "none") problems.push("text without fill");
      }
      if (copy.getAttribute("fill") !== "none" || !copy.getAttribute("stroke")) problems.push("halo not a stroke");
      if (copy.getAttribute("aria-hidden") !== "true") problems.push("halo not hidden");
      if (!copy.parentElement?.classList.contains("label-halo")) problems.push("halo outside its group");
      return problems.map((problem) => `${problem}: ${copy.textContent}`);
    });
    // No text of the chart is painted with a stroke under its fill (Safari's dark spots).
    const painted = [...root.querySelectorAll<SVGElement>("text, tspan")]
      .filter((element) => element.hasAttribute("paint-order") || getComputedStyle(element).paintOrder !== "normal")
      .map((element) => element.textContent);
    const values = copies.map((copy) => copy.textContent ?? "");
    return { count: copies.length, wrong, painted, values };
  });
}

/** Every label with a halo has its stroked copy right before it, the daily extremes among them (REQ-746). */
async function expectHalos(svg: Locator) {
  await expect(svg).toBeVisible();
  const { count, wrong, painted, values } = await halos(svg);
  expect(wrong).toEqual([]);
  expect(painted).toEqual([]);
  // The daily maximum and minimum of the temperature (e.g. "10°C", "-2°C") stand among them.
  expect(count).toBeGreaterThan(4);
  expect(values.some((value) => /^-?\d+°C$/.test(value.trim()))).toBe(true);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`iPad Pro 11 turned, ${colorScheme}`, () => {
    test.use(device("iPad Pro 11", true, colorScheme));
    ownDevice();

    test("each label with a halo has its stroked copy before it, embedded and in the full-screen view (REQ-746)", async ({
      page,
    }) => {
      await page.goto(APP);
      await expectHalos(embedded(page));
      await page.getByTestId("footer-slot").getByTestId("meteogram-fullscreen-open").tap();
      await expectHalos(big(page));
    });
  });

  test.describe(`iPhone 13, ${colorScheme}`, () => {
    test.use(device("iPhone 13", false, colorScheme));
    ownDevice();

    test("upright embedded and turned in the full-screen view, each label with a halo has its copy before it (REQ-746)", async ({
      page,
    }) => {
      await page.goto(APP);
      await expectHalos(embedded(page));
      const { width, height } = page.viewportSize()!;
      await page.setViewportSize({ width: height, height: width });
      await expectHalos(big(page));
    });
  });
}
