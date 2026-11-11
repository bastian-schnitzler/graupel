// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Phone edges (REQ-540, REQ-542, REQ-547). The day slider strip reaches from the top card's left edge to its right
 * edge, its grips stand out into the page's margin and stay on screen. The meteogram reaches from the screen's left
 * edge to its right edge, over the page's side margins; its axis labels show the value and below it the unit and
 * stand over the plot, the left legend at the left edge, the right one (cloud altitudes) at the right edge, with a
 * halo. At desktop width slider and legend are as before.
 */
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { mockOpenMeteo } from "./openMeteo.ts";

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

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function open(page: Page, width: number, theme: "light" | "dark") {
  await page.addInitScript((mode) => window.localStorage.setItem("graupel.colorMode", mode), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Left and right edge of an element on screen. */
const edges = async (page: Page, selector: string, index: "first" | "last" = "first") => {
  const locator = index === "first" ? page.locator(selector).first() : page.locator(selector).last();
  const box = (await locator.boundingBox())!;
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
};

/** The chart's axis labels: left (x 1, 1 px from the edge, REQ-602), right (x 1000), their lines and boxes, and the plot's edges on screen. */
const legend = (page: Page) =>
  chart(page).evaluate((svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    // Without the halos' stroked copies (REQ-746): each stands right before its filled text.
    const texts = [...svg.querySelectorAll<SVGTextElement>("text:not([data-halo])")];
    const label = (text: SVGTextElement) => {
      const rect = text.getBoundingClientRect();
      const spans = [...text.querySelectorAll("tspan")];
      return {
        lines: spans.length > 0 ? spans.map((span) => span.textContent ?? "") : [text.textContent ?? ""],
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        // A halo is its own stroked copy right before the text, the text itself without stroke (REQ-746).
        halo:
          text.previousElementSibling?.getAttribute("data-halo") === "true" &&
          !text.hasAttribute("stroke") &&
          !text.hasAttribute("paint-order"),
        testid: text.getAttribute("data-testid"),
      };
    };
    // The plot's clip rectangle in the temperature panel, in viewBox units.
    const clip = svg.querySelector<SVGRectElement>(".panel-temperature clipPath rect")!;
    const plotX = Number(clip.getAttribute("x"));
    const plotWidth = Number(clip.getAttribute("width"));
    return {
      svgLeft: box.left,
      svgRight: box.right,
      plotLeft: box.left + plotX * scale,
      plotRight: box.left + (plotX + plotWidth) * scale,
      scale,
      left: texts.filter((text) => text.getAttribute("x") === "1").map(label),
      // The right labels end 1 unit before the chart's right edge (REQ-623).
      right: texts.filter((text) => text.getAttribute("x") === "999").map(label),
      beside: texts
        .filter((text) => text.getAttribute("text-anchor") === "end" && Number(text.getAttribute("x")) < 60)
        .map(label),
    };
  });

for (const width of [360, 375]) {
  for (const theme of ["light", "dark"] as const) {
    test(`phone ${width} px, ${theme}: slider edge to edge with the top card, grips on screen (REQ-540)`, async ({
      page,
    }) => {
      await open(page, width, theme);
      const top = await edges(page, ".app__top");
      const first = await edges(page, '[data-testid="day-card"]');
      const last = await edges(page, '[data-testid="day-card"]', "last");
      expect(Math.abs(first.left - top.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(last.right - top.right)).toBeLessThanOrEqual(1);

      // All days selected (the start): both grips at the strip's ends, whole and on screen, with a touch area of
      // 44 px across.
      const marker = page.getByTestId("day-slider-marker");
      await expect(marker).toHaveClass(/day-slider__marker--first/);
      await expect(marker).toHaveClass(/day-slider__marker--last/);
      for (const testId of ["day-slider-start", "day-slider-end"]) {
        const grip = page.getByTestId(testId);
        await expect(grip).toBeVisible();
        const box = (await grip.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThan(first.bottom - 8);
        const hit = await grip.evaluate((element, viewport) => {
          const rect = element.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          let across = 0;
          for (let x = 0; x < viewport; x++) if (element.contains(document.elementFromPoint(x, cy))) across++;
          return across;
        }, width);
        expect(hit).toBeGreaterThanOrEqual(44);
      }
      // The grips lie inside the selection, their outer sides flush with the first and last day (REQ-555).
      expect(Math.abs((await page.getByTestId("day-slider-start").boundingBox())!.x - first.left)).toBeLessThan(1);
      const end = (await page.getByTestId("day-slider-end").boundingBox())!;
      expect(Math.abs(end.x + end.width - last.right)).toBeLessThan(1);

      // Only the first day (a tap on it): the grips stay apart.
      await page.mouse.click((first.left + first.right) / 2, (first.top + first.bottom) / 2);
      await expect(marker).toHaveAttribute("data-end", "0");
      await expect(marker).toHaveClass(/day-slider__marker--first/);
      await expect(marker).not.toHaveClass(/day-slider__marker--last/);
      const start = (await page.getByTestId("day-slider-start").boundingBox())!;
      const oneDayEnd = (await page.getByTestId("day-slider-end").boundingBox())!;
      expect(start.x).toBeGreaterThanOrEqual(0);
      expect(start.x + start.width).toBeLessThanOrEqual(oneDayEnd.x + 0.5);
      // Each takes half the day, flush with its edges (REQ-555).
      expect(Math.abs(start.x - first.left)).toBeLessThan(1);
      expect(Math.abs(oneDayEnd.x + oneDayEnd.width - first.right)).toBeLessThan(1);

      // Nothing sticks out of the page.
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      await page.screenshot({
        path: test.info().outputPath(`slider-${width}-${theme}.png`),
      });
    });

    test(`phone ${width} px, ${theme}: two-line axis labels at the chart's edges (REQ-542)`, async ({ page }) => {
      await open(page, width, theme);
      const top = await edges(page, ".app__top");
      const labels = await legend(page);
      // Nothing beside the plot in the old place.
      expect(labels.beside).toEqual([]);

      // Left legend: temperature with its degree sign in one line, precipitation and wind with the unit below; the
      // wind's guide line at half its axis has its label too, at half the axis maximum (REQ-654, DEC-060).
      const left = labels.left;
      expect(left.length).toBeGreaterThanOrEqual(7);
      const twoLine = left.filter((label) => label.lines.length === 2);
      expect(twoLine.map((label) => [label.lines[1], label.testid])).toEqual([
        ["mm", null],
        ["mm", null],
        ["km/h", null],
        ["km/h", null],
        ["km/h", "axis-mid"],
      ]);
      expect(Number(twoLine[4]!.lines[0])).toBe(Math.round(Number(twoLine[2]!.lines[0]) / 2));
      for (const label of twoLine) expect(label.lines[0]).toMatch(/^\d+(\.\d+)?$/);
      for (const label of left.filter((label) => label.lines.length === 1)) expect(label.lines[0]).toMatch(/°$/);
      // It starts at the screen's left edge (the chart's), without padding, over the plot, with a halo.
      expect(Math.abs(labels.svgLeft)).toBeLessThanOrEqual(1);
      expect(Math.min(...left.map((label) => label.left))).toBeLessThanOrEqual(1);
      expect(Math.min(...left.map((label) => label.left))).toBeGreaterThanOrEqual(-2);
      for (const label of [...left, ...labels.right]) expect(label.halo).toBe(true);

      // The plot (model header and drawing areas) reaches from the screen's left edge to the chart's right edge, the
      // scroll area from the screen's left edge to its right edge, over the page's side margins (REQ-547).
      expect(Math.abs(labels.plotLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(labels.plotRight - labels.svgRight)).toBeLessThanOrEqual(1);
      const scrollArea = await edges(page, '[data-testid="meteogram-scroll"]');
      const meteogramCard = await edges(page, '[data-testid="meteogram-card"]');
      expect(Math.abs(scrollArea.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(meteogramCard.right - width)).toBeLessThanOrEqual(1);
      expect(top.left).toBeGreaterThan(8);

      // Right legend: cloud altitudes with "km" below, ending 1 px before the chart's right edge (REQ-623), after the
      // plot.
      const right = labels.right;
      expect(right.length).toBeGreaterThanOrEqual(3);
      for (const label of right) expect(label.lines).toEqual([expect.stringMatching(/^\d+$/), "km"]);
      expect(Math.abs(Math.max(...right.map((label) => label.right)) - labels.svgRight)).toBeLessThanOrEqual(2);

      // Scrolled to its end, the right legend ends at the scroll area's right edge.
      const scroll = page.getByTestId("meteogram-scroll");
      await scroll.evaluate((element) => (element.scrollLeft = element.scrollWidth));
      const after = await legend(page);
      const area = await edges(page, '[data-testid="meteogram-scroll"]');
      expect(Math.abs(Math.max(...after.right.map((label) => label.right)) - area.right)).toBeLessThanOrEqual(2);
      await scroll.evaluate((element) => (element.scrollLeft = 0));
      await page.screenshot({
        path: test.info().outputPath(`legend-${width}-${theme}.png`),
      });
    });
  }
}

test("desktop 1280 px: slider in its card and legend beside the plot as before", async ({ page }) => {
  await open(page, 1280, "light");
  const card = await edges(page, 'section[data-region="day-slider"]');
  const first = await edges(page, '[data-testid="day-card"]');
  // The label "Horizon" keeps its room at the left of the card.
  expect(first.left - card.left).toBeGreaterThan(15);
  await expect(page.getByTestId("day-slider-label")).toBeVisible();

  const labels = await legend(page);
  expect(labels.left).toEqual([]);
  expect(labels.right).toEqual([]);
  expect(labels.beside.map((label) => label.lines[0])).toEqual([
    expect.stringMatching(/°$/),
    expect.stringMatching(/°$/),
    // The zero line's own label (REQ-603).
    "0°",
    expect.stringMatching(/ mm$/),
    "0 mm",
    expect.stringMatching(/ km\/h$/),
    "0 km/h",
    // The wind's guide line at half its axis (REQ-654, DEC-060).
    expect.stringMatching(/ km\/h$/),
  ]);
  const wind = labels.beside.slice(-3);
  expect(wind.map((label) => label.testid)).toEqual([null, null, "axis-mid"]);
  expect(parseInt(wind[2]!.lines[0]!)).toBe(Math.round(parseInt(wind[0]!.lines[0]!) / 2));
  for (const label of labels.beside) expect(label.left).toBeGreaterThan(labels.svgLeft + 5);
  await expect(chart(page).locator("text[data-lines]")).toHaveCount(0);
  await expect(page.getByTestId("meteogram-footer-row")).toHaveCSS("padding-left", /px$/);
  expect(await page.getByTestId("meteogram-footer-row").evaluate((row) => row.style.paddingLeft)).toBe("5%");
});

/**
 * Phone in portrait (REQ-554, REQ-583, REQ-585): the chart shows 4.5 days on the screen's width (wider for a longer
 * range, at least the screen's width) and starts at the first selected day at the left edge, with all days at
 * yesterday; a new selection starts there again. Whatever the selection it keeps the height and scale of all days.
 */
test.describe("phone portrait, 375 px", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    // Days are local days; in UTC every day starts at a multiple of 24 hours.
    timezoneId: "UTC",
  });
  ownDevice();

  const DAY_MS = 86_400_000;

  /** Visible time range of the chart and where its scroll container stands. */
  const view = async (page: Page) => {
    const svg = chart(page);
    const start = Date.parse((await svg.getAttribute("data-visible-start-time"))!);
    const end = Date.parse((await svg.getAttribute("data-visible-end-time"))!);
    const metrics = await page.getByTestId("meteogram-scroll").evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      chartWidth: element.querySelector("svg.meteogram-svg-integrated")!.getBoundingClientRect().width,
    }));
    return { start, end, days: (end - start) / DAY_MS, ...metrics };
  };

  const marker = async (page: Page) => {
    const element = page.getByTestId("day-slider-marker");
    return [Number(await element.getAttribute("data-start")), Number(await element.getAttribute("data-end"))];
  };

  /**
   * The chart's size on screen, its scale (CSS px per viewBox unit), the font sizes (CSS px) of yesterday's label in the
   * day header and of the axis labels.
   */
  const drawing = (page: Page) =>
    chart(page).evaluate((svg: SVGSVGElement) => {
      const box = svg.getBoundingClientRect();
      const scale = box.height / svg.viewBox.baseVal.height;
      const px = (text: SVGTextElement | null) => Number(text?.getAttribute("font-size")) * scale;
      return {
        width: box.width,
        height: box.height,
        viewBoxWidth: svg.viewBox.baseVal.width,
        scale,
        dayLabel: px(svg.querySelector<SVGTextElement>("text.day-label-text")),
        axisLabel: px(svg.querySelector<SVGTextElement>('text[x="1"][font-size]')),
      };
    });

  /** Scrolls the chart away from its left edge, as a swipe would. */
  const scrollAway = async (page: Page) => {
    const scroll = page.getByTestId("meteogram-scroll");
    await scroll.evaluate((element) => {
      element.scrollLeft = element.clientWidth;
    });
    expect(await scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  };

  test("4.5 days on the screen, the first selected day whole at the left edge (REQ-554, REQ-583)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    await expect(page.getByTestId("meteogram-scroll")).toHaveClass(/meteogram__scroll--portrait/);
    await expect(page.getByTestId("day-card").nth(1)).toHaveAttribute("aria-current", "date");

    // All days: the chart starts at the start of the first day, yesterday 00:00, at the left edge.
    const all = await view(page);
    expect(all.days).toBeGreaterThan(4.5);
    // 4.5 days on the screen's width.
    expect((all.clientWidth / all.chartWidth) * all.days).toBeCloseTo(4.5, 1);
    expect(all.scrollWidth).toBeGreaterThan(all.clientWidth);
    expect(all.scrollLeft).toBe(0);
    expect(all.start % DAY_MS).toBe(0);
    expect(Date.now() - all.start).toBeGreaterThan(DAY_MS);
    expect(Date.now() - all.start).toBeLessThanOrEqual(2 * DAY_MS);

    // A new selection (here by the key that removes yesterday, REQ-533) starts at its first day, today, also after the
    // chart was scrolled away.
    const count = await page.getByTestId("day-card").count();
    await scrollAway(page);
    await page.keyboard.press("Minus");
    await expect.poll(() => marker(page)).toEqual([1, count - 1]);
    await expect.poll(async () => (await view(page)).start).toBe(all.start + DAY_MS);
    const fromToday = await view(page);
    expect(fromToday.scrollWidth).toBeGreaterThan(fromToday.clientWidth);
    expect((fromToday.clientWidth / fromToday.chartWidth) * fromToday.days).toBeCloseTo(4.5, 1);
    expect(fromToday.scrollLeft).toBe(0);

    // Back to all days: yesterday whole at the left edge again.
    await scrollAway(page);
    await page.keyboard.press("Backquote");
    await expect.poll(() => marker(page)).toEqual([0, count - 1]);
    await expect.poll(async () => (await view(page)).start).toBe(all.start);
    expect((await view(page)).scrollLeft).toBe(0);
  });

  test("keeps the height and drawing size of all days with fewer days, only narrower (REQ-585)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    await expect(page.getByTestId("day-card").nth(1)).toHaveAttribute("aria-current", "date");
    const all = { ...(await view(page)), ...(await drawing(page)) };
    expect(all.days).toBeGreaterThan(7);
    // At the fixed scale of the full forecast (REQ-741): 4.5 days on the screen's width, the viewBox as wide as the
    // default one per 17 days; the fake forecast has 17 or 18 days, by the hour of the run.
    const reference = (1000 * (all.chartWidth / all.clientWidth) * 4.5) / 17;
    expect(Math.abs(all.viewBoxWidth / reference - 1)).toBeLessThan(0.01);
    await page.screenshot({ path: test.info().outputPath("portrait-all-days.png") });

    // 7 days (yesterday to today + 5, REQ-533): narrower, still 4.5 days on the screen's width, as high, the day header
    // and the axis labels as large.
    await page.keyboard.press("Digit6");
    await expect.poll(() => marker(page)).toEqual([0, 6]);
    await expect.poll(async () => (await view(page)).days).toBe(7);
    const week = { ...(await view(page)), ...(await drawing(page)) };
    expect((week.clientWidth / week.chartWidth) * week.days).toBeCloseTo(4.5, 1);
    expect(week.width).toBeLessThan(all.width / 2);
    expect(Math.abs(week.height - all.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(week.dayLabel - all.dayLabel)).toBeLessThanOrEqual(1);
    expect(Math.abs(week.axisLabel - all.axisLabel)).toBeLessThanOrEqual(1);
    expect(week.scrollLeft).toBe(0);
    await page.screenshot({ path: test.info().outputPath("portrait-7-days.png") });

    // 2 days (yesterday and today): the screen's width with wider days, as high, the axis labels as large. Each day now
    // has room for the day header's full size, which narrow days draw smaller (`DAY_HEADER_FONT_SIZE` 11 instead of
    // 9.5 viewBox units): never smaller than with all days.
    await page.keyboard.press("Digit1");
    await expect.poll(() => marker(page)).toEqual([0, 1]);
    await expect.poll(async () => (await view(page)).days).toBe(2);
    const two = { ...(await view(page)), ...(await drawing(page)) };
    expect(Math.abs(two.width - two.clientWidth)).toBeLessThanOrEqual(1);
    expect(two.scrollWidth).toBe(two.clientWidth);
    expect(Math.abs(two.height - all.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(two.axisLabel - all.axisLabel)).toBeLessThanOrEqual(1);
    expect(Math.abs(two.scale - all.scale)).toBeLessThan(0.01);
    expect(two.dayLabel).toBeGreaterThanOrEqual(all.dayLabel - 1);
    expect(Math.abs(two.dayLabel - 11 * all.scale)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath("portrait-2-days.png") });

    // Turned to landscape, the full-screen view and the chart behind it draw as before, with the default viewBox.
    await page.setViewportSize({ width: 844, height: 390 });
    const big = page
      .getByRole("dialog", { name: "Meteogram (full screen)" })
      .locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    await expect(page.getByTestId("meteogram-scroll")).not.toHaveClass(/meteogram__scroll--portrait/);
    expect(await big.evaluate((svg: SVGSVGElement) => svg.viewBox.baseVal.width)).toBe(1000);
    const embedded = page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
    expect(await embedded.evaluate((svg: SVGSVGElement) => svg.viewBox.baseVal.width)).toBe(1000);

    // Back in portrait, all days again: as at the start.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(big).toHaveCount(0);
    await page.keyboard.press("Backquote");
    await expect.poll(async () => (await view(page)).days).toBe(all.days);
    const again = await drawing(page);
    expect(again.viewBoxWidth).toBeCloseTo(all.viewBoxWidth, 3);
    expect(Math.abs(again.height - all.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(again.width - all.width)).toBeLessThanOrEqual(1);
  });
});

/** Phone in portrait: the page stays where it is once a forecast has loaded (REQ-570, no longer REQ-556). */
test.describe("phone portrait, after loading", () => {
  test.use({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  ownDevice();

  test("the page stays at the top after the forecast loaded (REQ-570)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("place and elevation stand centred between the day slider's grips, as large as the line below the chart (REQ-562, REQ-616)", async ({
    page,
  }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const place = page.getByTestId("meteogram-place");
    await expect(place).toHaveText(/^.+, \d+ m$/);
    const caption = page.getByTestId("day-slider-caption");
    await expect(caption).toBeVisible();
    const captionBox = (await caption.boundingBox())!;
    const placeBox = (await place.boundingBox())!;
    const track = (await page.getByTestId("day-slider-track").boundingBox())!;
    const grip = (await page.getByTestId("day-slider-end").boundingBox())!;
    // Centred across the strip and on the grips' row.
    expect(Math.abs(placeBox.x + placeBox.width / 2 - (track.x + track.width / 2))).toBeLessThan(1);
    expect(Math.abs(captionBox.y + captionBox.height / 2 - (grip.y + grip.height / 2))).toBeLessThan(1);
    // As large as the line below the chart, which names only the data source there (REQ-616); the chart's own row with
    // the place is hidden on the page and kept for the picture.
    const line = page.getByTestId("meteogram-source");
    const size = (locator: typeof line) => locator.evaluate((element) => getComputedStyle(element).fontSize);
    expect(await size(caption)).toBe(await size(line));
    await expect(page.getByTestId("meteogram-footer-location")).toBeHidden();
    await expect(page.getByTestId("meteogram-footer-location")).toContainText(await place.innerText());
  });

  // On the desktop: without the touch screen of this describe, which at this size is a tablet's (REQ-728).
  test("on the desktop no place between the grips (REQ-562 is for phones)", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
    const page = await context.newPage();
    await mockOpenMeteo(page);
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    await expect(page.getByTestId("meteogram-place")).toHaveCount(0);
    await expect(page.getByTestId("day-slider-caption")).toBeHidden();
    await context.close();
  });

  test("nothing reaches beyond the screen's sides, so the page can not scroll sideways (REQ-547)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const outside = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return [...document.querySelectorAll("body *")]
        // The wide chart scrolls inside its own box; the measured copies are clipped by their empty box.
        .filter((element) => !element.closest(".meteogram__scroll > *, .day-slider__measure > *, .visually-hidden"))
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
        })
        .map((element) => `${element.tagName}.${element.getAttribute("class") ?? ""}`);
    });
    expect(outside).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test.describe("Safari on the iPhone", () => {
    test.use({ userAgent: IPHONE_SAFARI });
    ownDevice();

    test("where the page scrolls, the footer row ends 80 px above its end, for Safari's bottom bar (REQ-581, REQ-614)", async ({
      page,
    }) => {
      // A page that scrolls: both model chains on a low screen (where it fits, see phone-height.spec.ts).
      await page.addInitScript(() => {
        window.localStorage.setItem("graupel.showWeatherChain", "true");
        window.localStorage.setItem("graupel.showCloudChain", "true");
      });
      await page.setViewportSize({ width: 375, height: 560 });
      await page.goto(APP);
      await expect(chart(page)).toBeVisible();
      await expect(page.locator('[data-region="model-chain"] .model-chain-row')).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
      // Scrolled to the end, at least the 75 px the bar covers on iOS 26 lie between the row and the screen's bottom.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const below = await page.evaluate(
        () => window.innerHeight - document.querySelector(".footer__row")!.getBoundingClientRect().bottom,
      );
      expect(below).toBeGreaterThanOrEqual(75);
      expect(below).toBeLessThanOrEqual(81);
    });
  });

  test("another browser (here Chromium, as Chrome on Android) ends with the footer row (REQ-611)", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const footer = page.locator('footer[data-region="footer"]');
    await expect(footer).toHaveClass(/footer--phone/);
    await expect(footer).not.toHaveClass(/footer--safari/);
    const below = await page.evaluate(() => {
      const row = document.querySelector(".footer__row")!.getBoundingClientRect();
      return document.documentElement.scrollHeight - (row.bottom + window.scrollY);
    });
    expect(below).toBeLessThanOrEqual(1);
  });

  test("the installed app ends with the footer row: nothing below it to scroll to (REQ-561, REQ-581)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
          : original(query);
    });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const below = await page.evaluate(() => {
      const row = document.querySelector(".footer__row")!.getBoundingClientRect();
      return document.documentElement.scrollHeight - (row.bottom + window.scrollY);
    });
    expect(below).toBeLessThanOrEqual(1);
  });
});

test("desktop 1280 px: the page stays at the top after the forecast loaded (REQ-570)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("desktop 1280 px: fewer days keep the chart's size and viewBox, also in full screen (REQ-585)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("day-card").nth(1)).toHaveAttribute("aria-current", "date");
  const size = () =>
    chart(page).evaluate((svg: SVGSVGElement) => {
      const box = svg.getBoundingClientRect();
      const days =
        (Date.parse(svg.dataset.visibleEndTime!) - Date.parse(svg.dataset.visibleStartTime!)) / 86_400_000;
      return { width: box.width, height: box.height, viewBoxWidth: svg.viewBox.baseVal.width, days };
    });
  const all = await size();
  expect(all.viewBoxWidth).toBe(1000);
  expect(all.days).toBeGreaterThan(7);

  // Nothing focused: the day slider's shortcut selects yesterday and today (REQ-533).
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await size()).days).toBeLessThanOrEqual(2);
  const two = await size();
  expect(two.viewBoxWidth).toBe(1000);
  expect(Math.abs(two.width - all.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(two.height - all.height)).toBeLessThanOrEqual(1);

  await page.getByTestId("meteogram-fullscreen-open").click();
  const big = page
    .getByRole("dialog", { name: "Meteogram (full screen)" })
    .locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
  await expect(big).toBeVisible();
  expect(await big.evaluate((svg: SVGSVGElement) => svg.viewBox.baseVal.width)).toBe(1000);
});

test("desktop 1280 px: no room for a browser bar below the footer (REQ-581)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const footer = page.locator('footer[data-region="footer"]');
  await expect(footer).not.toHaveClass(/footer--safari/);
  expect(await footer.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe("4px");
});
