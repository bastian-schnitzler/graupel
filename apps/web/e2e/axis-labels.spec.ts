// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Axis labels and the zero line of the meteogram (REQ-600, REQ-601) in a real browser. On the phone the left labels
 * stand over the plot 1 px from the chart's left edge; the topmost temperature label hangs 1 px below a sunrise time
 * standing over it, else it stays in the corner above the row of sunrise times (REQ-734, REQ-738 of the core). The zero line (0 °C) gets the label "0°" in its blue and in the size of the other axis labels, on the
 * phone and on the desktop; a maximum or minimum it covers by more than 20 % of their height is left out. The drawing
 * belongs to @graupel/meteogram (MET-S8, REQ-602, REQ-603); here only that the website shows it. The right labels
 * (cloud altitudes) end 1 px before the chart's right edge, as far off it as the left ones start off the left edge, on
 * the phone and in its full-screen view (REQ-623, from MET-S9, REQ-622).
 *
 * The shared fake forecast has no sun times; these tests answer the request for them with a sunrise at 06:30 and a
 * sunset at 17:30 GMT on every day. Its temperature runs from −2 to 10 °C, so the zero line lies in the chart.
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const DAY_MS = 24 * 3_600_000;
/** Height of digits above their baseline, relative to the font size (DIGIT_ASCENT of @graupel/meteogram). */
const DIGIT_ASCENT = 0.72;

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Registered after the shared fake, so it answers first; everything but the sun times goes on to the fake.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    if (!new URL(route.request().url()).searchParams.has("daily")) return route.fallback();
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const days = Array.from({ length: 20 }, (_, i) => new Date(today + (i - 3) * DAY_MS).toISOString().slice(0, 10));
    return route.fulfill({
      json: {
        timezone: "GMT",
        daily: { time: days, sunrise: days.map((day) => `${day}T06:30`), sunset: days.map((day) => `${day}T17:30`) },
      },
    });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function open(page: Page, theme: "light" | "dark") {
  await page.addInitScript((mode) => window.localStorage.setItem("graupel.colorMode", mode), theme);
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(chart(page).locator('.panel-temperature [data-testid="sunrise"]').first()).toBeAttached();
}

/** A text of the chart: its position and size in viewBox units, its box on screen, its colour. */
interface Label {
  testid: string | null;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  anchor: string | null;
  fill: string | null;
  screenLeft: number;
  screenRight: number;
}

/**
 * The left labels of the temperature panel (maximum, minimum, zero), its sunrise times, its zero line and the chart's
 * left edge and scale on screen.
 */
const temperaturePanel = (page: Page) =>
  chart(page).evaluate((svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const panel = svg.querySelector(".panel-temperature")!;
    const label = (text: Element): Label => ({
      testid: text.getAttribute("data-testid"),
      text: text.textContent ?? "",
      x: Number(text.getAttribute("x")),
      y: Number(text.getAttribute("y")),
      fontSize: Number(text.getAttribute("font-size")),
      anchor: text.getAttribute("text-anchor"),
      fill: text.getAttribute("fill"),
      screenLeft: text.getBoundingClientRect().left,
      screenRight: text.getBoundingClientRect().right,
    });
    const zeroLine = panel.querySelector('[data-testid="freezing-line"]');
    // The left value labels: the zero label and the texts of degrees beside or over the plot's left edge.
    // Without the halos' stroked copies before their labels (REQ-746).
    const left = [...panel.querySelectorAll("text:not([data-halo])")]
      .filter((text) => /^[-−]?\d+°$/.test(text.textContent ?? "") && Number(text.getAttribute("x")) < 60)
      .map(label);
    return {
      svgLeft: box.left,
      scale: box.width / svg.viewBox.baseVal.width,
      left,
      zero: left.find((text) => text.testid === "axis-zero") ?? null,
      others: left.filter((text) => text.testid !== "axis-zero"),
      sunrise: [...panel.querySelectorAll('[data-testid="sunrise"]')].map(label),
      zeroLine: zeroLine
        ? { y: Number(zeroLine.getAttribute("y1")), stroke: zeroLine.getAttribute("stroke") }
        : null,
    };
  });

/**
 * The labels over the plot at the chart's sides, in viewBox units: how far the left ones start off the left edge and
 * the right ones (cloud altitudes) end off the right edge, by their position in the SVG and on screen.
 */
const sideLabels = (svg: SVGSVGElement) => {
  const box = svg.getBoundingClientRect();
  const width = svg.viewBox.baseVal.width;
  const scale = box.width / width;
  const texts = [...svg.querySelectorAll<SVGTextElement>("text")];
  const left = texts.filter((text) => text.getAttribute("text-anchor") !== "end" && text.getAttribute("x") === "1");
  const right = texts.filter((text) => text.getAttribute("data-testid")?.startsWith("cloud-altitude-label-"));
  return {
    left: left.map((text) => ({
      text: text.textContent ?? "",
      x: Number(text.getAttribute("x")),
      onScreen: (text.getBoundingClientRect().left - box.left) / scale,
    })),
    right: right.map((text) => ({
      text: text.textContent ?? "",
      anchor: text.getAttribute("text-anchor"),
      offEdge: width - Number(text.getAttribute("x")),
      onScreen: (box.right - text.getBoundingClientRect().right) / scale,
    })),
  };
};

/** Both sides' labels 1 unit off the chart's edges (REQ-602, REQ-623). */
function expectOneOffBothEdges(labels: ReturnType<typeof sideLabels>) {
  expect(labels.left.length).toBeGreaterThanOrEqual(2);
  for (const label of labels.left) {
    expect(label.x, label.text).toBe(1);
    expect(label.onScreen, label.text).toBeCloseTo(1, 0);
  }
  expect(labels.right.length).toBeGreaterThanOrEqual(3);
  for (const label of labels.right) {
    expect(label.anchor, label.text).toBe("end");
    expect(label.offEdge, label.text).toBeCloseTo(1, 3);
    expect(label.onScreen, label.text).toBeCloseTo(1, 0);
  }
}

/** Top and bottom edge of a label's digits (viewBox units), from its baseline. */
const digits = (label: Label) => ({ top: label.y - DIGIT_ASCENT * label.fontSize, bottom: label.y });

/** Share of the height of `label`'s digits that `zero`'s digits cover. */
const overlap = (zero: Label, label: Label) => {
  const a = digits(zero);
  const b = digits(label);
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) / (b.bottom - b.top);
};

for (const theme of ["light", "dark"] as const) {
  test.describe(`phone portrait, ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
    ownDevice();

    test("left labels 1 px from the edge, the top one clear of the sunrise times, the zero line labelled in blue", async ({
      page,
    }) => {
      await open(page, theme);
      const panel = await temperaturePanel(page);

      // Every left label starts 1 unit from the chart's left edge, over the plot.
      const left = panel.left;
      expect(left.length).toBeGreaterThanOrEqual(2);
      for (const label of left) {
        expect(label).toMatchObject({ x: 1, anchor: "start" });
        expect(label.screenLeft - panel.svgLeft).toBeCloseTo(panel.scale, 0);
      }

      // The topmost one (the maximum) hangs 1 unit below a sunrise time standing over it: the top of its digits 1 unit
      // below that time's baseline. Without one over it (the first sunrise time moves right of the maximum, REQ-734)
      // it stays in the corner, above the row of sunrise times (REQ-738).
      const zero = panel.zero!;
      expect(zero).not.toBeNull();
      const others = panel.others;
      expect(others.length).toBeGreaterThanOrEqual(1);
      const max = others.reduce((top, label) => (label.y < top.y ? label : top));
      expect(panel.sunrise.length).toBeGreaterThan(0);
      const over = panel.sunrise.filter(
        (sunrise) => sunrise.screenLeft < max.screenRight && sunrise.screenRight > max.screenLeft,
      );
      if (over.length > 0) for (const sunrise of over) expect(digits(max).top - sunrise.y).toBeCloseTo(1, 1);
      else for (const sunrise of panel.sunrise) expect(digits(max).top).toBeLessThan(sunrise.y);

      // The zero line's label: "0°" in the line's blue, as large as the other labels, on the line unless at an edge.
      expect(panel.zeroLine).not.toBeNull();
      expect(zero.text).toBe("0°");
      expect(zero.fill).toBe(panel.zeroLine!.stroke);
      expect(zero.fill).not.toBe(max.fill);
      expect(zero.fontSize).toBe(max.fontSize);
      const middle = (digits(zero).top + digits(zero).bottom) / 2;
      const lowest = Math.max(...others.map((label) => label.y));
      const atEdge = Math.abs(digits(zero).top - digits(max).top) < 0.5 || zero.y >= lowest;
      if (!atEdge) expect(middle).toBeCloseTo(panel.zeroLine!.y, 0);
      // A maximum or minimum it covers by more than 20 % is gone; the ones left are covered by 20 % at most.
      for (const label of others) expect(overlap(zero, label)).toBeLessThanOrEqual(0.2);

      await page.screenshot({
        path: test.info().outputPath(`axis-labels-phone-${theme}.png`),
        clip: { x: 0, y: (await chart(page).boundingBox())!.y, width: 200, height: 260 },
      });
    });

    test("right labels end 1 px before the right edge, as far off it as the left ones (REQ-623)", async ({ page }) => {
      await open(page, theme);
      expectOneOffBothEdges(await chart(page).evaluate(sideLabels));
      // Scrolled to the chart's end, as on the screen of the pictures.
      const scroll = page.getByTestId("meteogram-scroll");
      await scroll.evaluate((element) => (element.scrollLeft = element.scrollWidth));
      const box = (await chart(page).boundingBox())!;
      const area = (await scroll.boundingBox())!;
      expect(Math.abs(box.x + box.width - (area.x + area.width))).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: test.info().outputPath(`axis-labels-phone-right-${theme}.png`),
        clip: { x: area.x + area.width - 200, y: box.y, width: 200, height: 260 },
      });
    });
  });
}

test("desktop 1280 px: the zero line labelled beside the plot in its blue, as large as the other labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "light");
  const panel = await temperaturePanel(page);
  const zero = panel.zero!;
  expect(zero).not.toBeNull();
  expect(zero.text).toBe("0°");
  // Beside the plot, right-aligned as the maximum and minimum.
  const others = panel.others;
  expect(others.length).toBeGreaterThanOrEqual(1);
  for (const label of [zero, ...others]) expect(label).toMatchObject({ anchor: "end", x: zero.x });
  expect(zero.fill).toBe(panel.zeroLine!.stroke);
  expect(zero.fontSize).toBe(others[0]!.fontSize);
  for (const label of others) expect(overlap(zero, label)).toBeLessThanOrEqual(0.2);
  await page.screenshot({
    path: test.info().outputPath("axis-labels-desktop.png"),
    clip: { x: 0, y: (await chart(page).boundingBox())!.y, width: 400, height: 300 },
  });
});

test.describe("phone, full screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  test("in the full-screen view both sides' labels stand 1 px off the edges (REQ-623)", async ({ page }) => {
    await open(page, "light");
    await page.setViewportSize({ width: 844, height: 390 });
    const big = page
      .getByRole("dialog", { name: "Meteogram (full screen)" })
      .locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    expectOneOffBothEdges(await big.evaluate(sideLabels));
    await page.screenshot({ path: test.info().outputPath("axis-labels-fullscreen.png") });
  });
});
