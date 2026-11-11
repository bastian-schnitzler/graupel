// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Precipitation axis and wind guide line of the meteogram (REQ-652, REQ-654, from the library: REQ-651, REQ-653) in a
 * real browser, on the desktop and on a phone. With at most 1.2 mm of precipitation the precipitation axis reaches
 * 2 mm (DEC-059). The wind area shows a dashed guide line at half its axis maximum, labelled at the left with its
 * value rounded to a whole number (DEC-060): "38 km/h" on a line at 37.5 km/h of a 75 km/h axis. The chart on the
 * page, the full-screen view and the copied picture show both.
 *
 * The fake forecast keeps its precipitation (1.2 mm every 7th hour) and gets wind up to 35 km/h with gusts up to
 * 70 km/h, so the wind axis reaches 75 km/h. The picture is checked in the SVG the export rasterises (recorded from
 * `XMLSerializer`); that a PNG reached the clipboard is checked as well.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const COPY = "Copy the meteogram as a picture";

/** Wind (km/h) of these tests: 15 to 35 km/h, gusts 50 to 70 km/h. */
const wind = (index: number) => Math.round(250 + 100 * Math.sin(index / 5)) / 10;
const gusts = (index: number) => Math.round(600 + 100 * Math.sin(index / 5)) / 10;

/** What a chart (or a picture's SVG) shows of the two axes; two-line labels (value, unit below) joined by a space. */
interface Axes {
  /** Labels of the precipitation area. */
  precip: string[];
  /** Labels of the wind area, the guide line's among them. */
  wind: string[];
  /** The guide line's label(s) (`axis-mid`). */
  mid: string[];
  /** Values of the wind area's guide line(s). */
  midLines: number[];
}

/** The axes as the page, the full-screen view and the picture must show them. */
const EXPECTED: Axes = {
  precip: ["2 mm", "0 mm"],
  wind: ["75 km/h", "0 km/h", "38 km/h"],
  mid: ["38 km/h"],
  midLines: [37.5],
};

/** Reads the axes from a chart's root element (page, full-screen view or a picture's SVG document). */
function readAxes(root: ParentNode): Axes {
  const text = (element: Element) => {
    const spans = [...element.querySelectorAll("tspan")];
    const lines = spans.length > 0 ? spans.map((span) => span.textContent ?? "") : [element.textContent ?? ""];
    return lines.map((line) => line.trim()).join(" ");
  };
  const labels = (area: string) =>
    [...root.querySelectorAll(`[data-area-id="${area}"] text:not([data-halo])`)]
      .filter((element) => /^-?\d+([.,]\d+)? (mm|km\/h)$/.test(text(element)))
      .map(text);
  return {
    precip: labels("precip"),
    wind: labels("wind"),
    mid: [...root.querySelectorAll('[data-area-id="wind"] [data-testid="axis-mid"]')].map(text),
    midLines: [...root.querySelectorAll('[data-testid="wind-mid-line"]')].map((line) =>
      Number(line.getAttribute("data-value")),
    ),
  };
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Registered after the shared fake, so it answers first.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    fakeForecast(route, {
      values: { wind_speed: wind, wind_speed_10m: wind, wind_gusts: gusts, wind_gusts_10m: gusts },
    }),
  );
  // The SVG of every exported picture, reduced to what it shows of the axes.
  await page.addInitScript(`(() => {
    const readAxes = ${readAxes.toString()};
    const pictures = [];
    window.__pictures = pictures;
    const serialize = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (node) {
      const markup = serialize.call(this, node);
      if (markup.startsWith("<svg")) pictures.push(readAxes(new DOMParser().parseFromString(markup, "image/svg+xml")));
      return markup;
    };
  })()`);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const embedded = (page: Page) => page.getByTestId("meteogram-scroll");
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });

async function open(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

/** What the chart inside `scope` shows of the axes. */
const shown = (scope: Locator): Promise<Axes> => scope.evaluate(readAxes);

/**
 * Expects the guide line in the wind area of the chart inside `scope` dashed and across the plot, and its label
 * "38 km/h" centred on it at the left of the chart.
 */
async function expectGuideLine(scope: Locator) {
  const place = await scope.evaluate((root) => {
    const line = root.querySelector<SVGLineElement>('[data-testid="wind-mid-line"]')!;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
    };
    return {
      dash: line.getAttribute("stroke-dasharray"),
      line: box(line),
      label: box(root.querySelector('[data-area-id="wind"] [data-testid="axis-mid"]')!),
      svg: box(root.querySelector("svg")!),
    };
  });
  expect(place.dash).toBeTruthy();
  expect(place.line.width).toBeGreaterThan(place.svg.width * 0.5);
  const middle = (place.label.top + place.label.bottom) / 2;
  expect(Math.abs(middle - place.line.top)).toBeLessThanOrEqual(2);
  expect(place.label.left).toBeLessThan(place.svg.left + place.svg.width * 0.25);
}

/** Pictures exported so far. */
const pictures = (page: Page) => page.evaluate(() => (window as unknown as { __pictures: Axes[] }).__pictures);

/** Whether a PNG is on the clipboard. */
const clipboardHasPng = (page: Page) =>
  page.evaluate(async () => (await navigator.clipboard.read()).some((item) => item.types.includes("image/png")));

/**
 * Taps or clicks the copy button in `scope` (the card, the full-screen view or the phone's footer row) and returns what
 * the picture shows of the axes, from the SVG the export rasterised, once the page says it copied it.
 */
async function copyPicture(page: Page, scope: Locator, tap = false): Promise<Axes> {
  const button = scope.getByRole("button", { name: COPY });
  const status = scope.getByTestId("meteogram-image-feedback");
  await expect(status).toHaveText("");
  const before = (await pictures(page)).length;
  await page.evaluate(() => navigator.clipboard.writeText(""));
  if (tap) await button.tap();
  else await button.click();
  // Drawing the picture takes a while on a loaded machine.
  await expect(status).toHaveText("Meteogram copied", { timeout: 15_000 });
  const exported = await pictures(page);
  expect(exported).toHaveLength(before + 1);
  expect(await clipboardHasPng(page)).toBe(true);
  return exported[before]!;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: "en-GB" });
  ownDevice();

  test("precipitation axis to 2 mm and the wind guide line with 38 km/h on the page, full screen and in the picture", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);
    const card = page.getByTestId("meteogram-card");

    // The page: the labels beside the plot, the line across it.
    expect(await shown(embedded(page))).toEqual(EXPECTED);
    await expect(embedded(page).getByTestId("axis-mid")).toBeVisible();
    await expectGuideLine(embedded(page));

    // The picture of the card.
    expect(await copyPicture(page, card)).toEqual(EXPECTED);

    // The full-screen view and its picture.
    await card.getByRole("button", { name: "Show the meteogram full screen" }).click();
    const view = fullscreen(page);
    await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    const big = view.getByTestId("meteogram-fullscreen");
    expect(await shown(big)).toEqual(EXPECTED);
    await expect(big.getByTestId("axis-mid")).toBeVisible();
    await expectGuideLine(big);
    expect(await copyPicture(page, view)).toEqual(EXPECTED);
    await view.getByRole("button", { name: "Close" }).click();
    await expect(fullscreen(page)).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  const LANDSCAPE = { width: 844, height: 390 };
  const PORTRAIT = { width: 390, height: 844 };
  const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";

  /** Turns the phone and waits until the page saw the new orientation (as in meteogram-fullscreen.spec.ts). */
  async function turn(page: Page, size: { width: number; height: number }) {
    await page.setViewportSize(size);
    const landscape = size.width > size.height;
    await expect
      .poll(() =>
        page.evaluate(
          (query) =>
            new Promise<boolean>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(matchMedia(query).matches))),
            ),
          PHONE_LANDSCAPE,
        ),
      )
      .toBe(landscape);
  }

  test("the same axes over the plot, in the full-screen view and in the picture", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);

    // The page: the labels over the plot, the unit below the value ("38" over "km/h").
    expect(await shown(embedded(page))).toEqual(EXPECTED);
    expect(
      await embedded(page)
        .getByTestId("axis-mid")
        .evaluate((label) => [...label.querySelectorAll("tspan")].map((span) => span.textContent)),
    ).toEqual(["38", "km/h"]);
    await expectGuideLine(embedded(page));

    // The picture from the footer row.
    expect(await copyPicture(page, page.getByRole("contentinfo"), true)).toEqual(EXPECTED);

    // Turned to landscape, the full-screen view.
    await turn(page, LANDSCAPE);
    const view = fullscreen(page);
    await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    const big = view.getByTestId("meteogram-fullscreen");
    expect(await shown(big)).toEqual(EXPECTED);
    await expectGuideLine(big);
    await turn(page, PORTRAIT);
    await expect(fullscreen(page)).toHaveCount(0);
  });
});
