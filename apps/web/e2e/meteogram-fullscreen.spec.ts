// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Full-screen meteogram in a real browser (REQ-454): a double-click on desktop opens it and Escape or the close button
 * closes it; on a phone, turning to landscape (viewport change) opens it and turning back to portrait closes it. A
 * landscape desktop window does not open it. No scroll bars in the view (REQ-530). On a phone the embedded chart shows
 * no tooltip and no cursor line (REQ-531) and only the turn opens the view: no double-tap, no button (REQ-532). On a
 * phone the view has no close, copy or save buttons (REQ-537); the copy and save buttons stand in the page footer's
 * row (REQ-541). There the tooltip is a side bar (REQ-557) in a font that fills the screen's height (REQ-576) as far as
 * its fixed width allows (REQ-584); every label stands on one line with its value, nothing wraps, and a model name too
 * long for one line gives way to its short name (REQ-588). In landscape the chart keeps clear of the camera only on the
 * camera's side and reaches the screen's other edge (REQ-606).
 */
import type { Route } from "@playwright/test";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

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

const embedded = (page: Page) => page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });

/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
const PORTRAIT = { width: 375, height: 812 };
/** Buttons in `scope` but the info buttons in the model headers, which stand in the chart also on a phone (REQ-643). */
const buttonsBesideModelInfo = (scope: Locator) =>
  scope.getByRole("button").and(scope.page().locator(':not([data-testid="model-header-info-button"])'));
const LANDSCAPE = { width: 844, height: 390 };
/** A lower landscape screen, as with Safari's bars: the side bar's rows with snow no longer fit its height. */
const LOW_LANDSCAPE = { width: 844, height: 280 };

/**
 * Turns the phone: changes the viewport and waits until the page has run two rendering steps with the new size, in
 * which the browser evaluates media queries and fires their `change` and `resize`. Without that wait two quick turns
 * fall into one rendering step, the page never sees the turn in between, and the test races the browser.
 */
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

/**
 * Nothing in or behind the open view scrolls (REQ-530): the page's scrolling element, the dialog, its body and the
 * chart's wrapper all fit their boxes; the page's body clips the rest of the page.
 */
async function expectNoScrollbars(page: Page) {
  const boxes = await page.evaluate(() => {
    const dialog = document.querySelector("dialog.meteogram-fullscreen")!;
    const elements: [string, Element | null][] = [
      ["page", document.scrollingElement],
      ["dialog", dialog],
      ["dialog body", dialog.querySelector(".dialog__body")],
      ["chart wrapper", dialog.querySelector(".meteogram-fullscreen__scroll")],
    ];
    return elements.map(([name, el]) => ({
      name,
      scrollHeight: el!.scrollHeight,
      clientHeight: el!.clientHeight,
      scrollWidth: el!.scrollWidth,
      clientWidth: el!.clientWidth,
    }));
  });
  for (const box of boxes) {
    expect(box.scrollHeight, `${box.name} height`).toBeLessThanOrEqual(box.clientHeight);
    expect(box.scrollWidth, `${box.name} width`).toBeLessThanOrEqual(box.clientWidth);
  }
  // The body clips the page behind; it is no scroll container a finger can move.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

/** A finger touching the chart: down, a short move as a real finger makes, up. */
async function touch(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  const point = (dx: number) => [{ x: x + dx, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(0),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: point(1),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

/** Left and right edge of the plot on screen: the temperature panel's clip rectangle in viewBox units, scaled (REQ-553). */
const plotEdges = (chart: Locator) =>
  chart.evaluate((svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const clip = svg.querySelector<SVGRectElement>(".panel-temperature clipPath rect")!;
    const x = Number(clip.getAttribute("x"));
    const width = Number(clip.getAttribute("width"));
    return {
      left: box.left + x * scale,
      right: box.left + (x + width) * scale,
    };
  });

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The fake forecast with values rounded as Open-Meteo sends them (the built-in wind values are not), dry until
 * `snowFrom` (ms), then snowing: four rows more, the sums of precipitation and snow among them, and long values
 * (REQ-584): "-21.5 °C" felt, gusts of "100.5 km/h" from "337° NNW".
 */
async function forecastWithSnowFrom(page: Page, now: number, snowFrom: number) {
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const past = Number(new URL(route.request().url()).searchParams.get("past_hours") ?? 0);
    const snowy = (index: number) => (Math.floor(now / HOUR_MS) + index - past) * HOUR_MS >= snowFrom;
    return fakeForecast(route, {
      now,
      values: {
        apparent_temperature: (index) => (snowy(index) ? -21.5 : -8.2),
        wind_speed_10m: (index) => Math.round(150 + 80 * Math.sin(index / 5)) / 10,
        wind_gusts_10m: (index) => (snowy(index) ? 100.5 : Math.round(300 + 100 * Math.sin(index / 5)) / 10),
        wind_direction_10m: (index) => (snowy(index) ? 337 : 184),
        precipitation: (index) => (snowy(index) ? 0.4 : 0),
        snowfall: (index) => (snowy(index) ? 1.5 : 0),
        snow_depth: (index) => (snowy(index) ? 0.3 : 0),
      },
    });
  });
}

/**
 * The side bar's layout (REQ-576, REQ-584, REQ-588): its font size and the tooltip's own (the left axis labels as the
 * chart sets it, REQ-487), its width, each row's label and value, how far its text reaches compared with the room
 * inside the padding, and the lines of the date, the model name and the run.
 */
const sideBarLayout = (tooltip: Locator) =>
  tooltip.evaluate((el: HTMLElement) => {
    /** Lines a part takes: the different tops of its text's boxes. */
    const linesOf = (part: Node | null) => {
      if (!part) return 0;
      const text = document.createRange();
      text.selectNodeContents(part);
      const rects = [...text.getClientRects()].filter((rect) => rect.width > 0);
      return new Set(rects.map((rect) => Math.round(rect.top))).size;
    };
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const content = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const rect = (part: Element) => {
      const { top, bottom, left, right } = part.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const title = el.querySelector(".tooltip-section-title")!;
    const name = title.firstChild!;
    range.selectNodeContents(name);
    const run = el.querySelector(".tooltip-run-info");
    return {
      font: parseFloat(style.fontSize),
      own: parseFloat(/([\d.]+)px\)$/.exec(el.style.fontSize)?.[1] ?? "NaN"),
      height: box.height,
      width: box.width,
      // Inside the border and the padding.
      inner: {
        left: box.left + el.clientLeft + parseFloat(style.paddingLeft),
        right: box.left + el.clientLeft + el.clientWidth - parseFloat(style.paddingRight),
        bottom: box.top + el.clientTop + el.clientHeight - parseFloat(style.paddingBottom),
      },
      reach: {
        right: Math.max(...content.map((part) => part.right)),
        bottom: Math.max(...content.map((part) => part.bottom)),
      },
      rows: [...el.querySelectorAll(".tooltip-row")].map((row) => ({
        text: row.querySelector(".label")!.textContent ?? "",
        label: rect(row.querySelector(".label")!),
        value: rect(row.querySelector(".val")!),
        lines: Math.max(linesOf(row.querySelector(".label")), linesOf(row.querySelector(".val"))),
      })),
      date: {
        text: el.querySelector(".tooltip-header")!.textContent ?? "",
        lines: linesOf(el.querySelector(".tooltip-header")),
      },
      model: {
        text: name.textContent ?? "",
        lines: linesOf(name),
        right: range.getBoundingClientRect().right,
        // Room for the name: the bar's width inside the padding.
        room: title.getBoundingClientRect().right,
      },
      run: run ? { text: run.textContent ?? "", lines: linesOf(run), fits: run.scrollWidth <= run.clientWidth } : null,
    };
  });

type SideBarLayout = Awaited<ReturnType<typeof sideBarLayout>>;

/**
 * Every label stands on one line with its value, the label at the left, the value at the right, and nothing wraps:
 * date, model name and run take a line each (REQ-588). The text stays inside the bar, in a larger font than the
 * tooltip's own (REQ-576); the bar takes at most a quarter of the screen (REQ-584, no notch here).
 */
function expectFittedSideBar(layout: SideBarLayout) {
  expect(layout.rows.length).toBeGreaterThanOrEqual(6);
  for (const { text, label, value, lines } of layout.rows) {
    expect(lines, text).toBe(1);
    expect(value.top, text).toBeLessThan(label.bottom);
    expect(value.bottom, text).toBeGreaterThan(label.top);
    expect(value.left, text).toBeGreaterThan(label.right);
    expect(Math.abs(label.left - layout.inner.left), text).toBeLessThanOrEqual(0.5);
    expect(Math.abs(value.right - layout.inner.right), text).toBeLessThanOrEqual(0.5);
  }
  expect(layout.date.lines, layout.date.text).toBe(1);
  expect(layout.model.lines, layout.model.text).toBe(1);
  expect(layout.model.right, layout.model.text).toBeLessThanOrEqual(layout.model.room + 0.5);
  if (layout.run) {
    expect(layout.run.lines, layout.run.text).toBe(1);
    expect(layout.run.fits, layout.run.text).toBe(true);
  }
  expect(layout.font).toBeGreaterThan(layout.own);
  expect(layout.reach.bottom).toBeLessThanOrEqual(layout.inner.bottom + 0.5);
  expect(layout.reach.right).toBeLessThanOrEqual(layout.inner.right + 0.5);
  expect(layout.width).toBeLessThanOrEqual(LANDSCAPE.width / 4 + 0.5);
}

/** Screen position of a time in the full-screen chart and a height in it: the plot reaches from edge to edge (REQ-553). */
async function chartPlaces(chart: Locator) {
  const start = Date.parse((await chart.getAttribute("data-visible-start-time"))!);
  const end = Date.parse((await chart.getAttribute("data-visible-end-time"))!);
  const plot = await plotEdges(chart);
  const box = (await chart.boundingBox())!;
  return {
    x: (time: number) => plot.left + ((time - start) / (end - start)) * (plot.right - plot.left),
    y: box.y + box.height / 3,
  };
}

/** Whether a model name fits the side bar's line in its font, as wide as the bar is inside its padding. */
const fitsTheLine = (tooltip: Locator, name: string) =>
  tooltip.evaluate((el: HTMLElement, text) => {
    const title = el.querySelector(".tooltip-section-title")!;
    const probe = document.createElement("span");
    probe.textContent = text;
    title.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width <= title.getBoundingClientRect().width;
  }, name);

/** One of the favourites: its chain starts with a model of a long name (REQ-588). */
const ORTLER = { name: "Ortler", lat: 46.5086, lon: 10.5447, elevation: 3905 };

/** Each model's `meta.json` names a run 6 to 12 hours before `now` that reaches far enough for the whole chain. */
function fakeMeta(route: Route, now: number) {
  if (route.request().url().includes("ensemble")) return route.fulfill({ json: {} });
  const init = Math.floor((now - 6 * HOUR_MS) / (6 * HOUR_MS)) * 6 * HOUR_MS;
  return route.fulfill({
    json: {
      last_run_initialisation_time: init / 1000,
      last_run_availability_time: init / 1000 + 3 * 3600,
      data_end_time: (init + 400 * HOUR_MS) / 1000,
      update_interval_seconds: 6 * 3600,
      temporal_resolution_seconds: 3600,
    },
  });
}

test.describe("desktop", () => {
  test("a double-click opens the meteogram on the whole screen; Escape and the close button close it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    // A desktop window in landscape does not open it by itself.
    await expect(fullscreen(page)).toHaveCount(0);

    await embedded(page).dblclick();
    const dialog = fullscreen(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    const chart = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(chart).toBeVisible();
    // Fills the viewport, the chart most of it.
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(1270);
    expect(box.height).toBeGreaterThanOrEqual(890);
    const chartBox = (await chart.boundingBox())!;
    expect(chartBox.width).toBeGreaterThan(1200);
    expect(chartBox.height).toBeGreaterThan(500);
    // On the desktop the legend stands beside the plot, not over it, with the units next to the values (REQ-568).
    const plot = await plotEdges(chart);
    const labels = await chart.evaluate((svg: SVGSVGElement) =>
      [...svg.querySelectorAll<SVGTextElement>("text")]
        .filter((text) => text.getAttribute("text-anchor") === "end" && Number(text.getAttribute("x")) < 60)
        .map((text) => ({ right: text.getBoundingClientRect().right, lines: text.querySelectorAll("tspan").length })),
    );
    expect(labels.length).toBeGreaterThanOrEqual(6);
    for (const label of labels) {
      expect(label.right).toBeLessThanOrEqual(plot.left + 1);
      expect(label.lines).toBeLessThanOrEqual(1);
    }
    expect(plot.left).toBeGreaterThan(chartBox.x + 20);
    expect(plot.right).toBeLessThan(chartBox.x + chartBox.width - 20);
    // Same time axis as the card.
    for (const name of ["data-visible-start-time", "data-visible-end-time"]) {
      expect(await chart.getAttribute(name)).toBe(await embedded(page).getAttribute(name));
    }
    // The tooltip works there as well.
    await chart.hover({
      position: { x: chartBox.width / 2, y: chartBox.height / 3 },
    });
    await expect(dialog.getByTestId("meteogram-tooltip")).toBeVisible();
    // Label and value stand side by side, as in the phone's side bar, but in the tooltip's own font size (REQ-576).
    const row = await dialog
      .getByTestId("meteogram-tooltip")
      .locator(".tooltip-row")
      .first()
      .evaluate((el) => {
        const label = el.querySelector(".label")!.getBoundingClientRect();
        const value = el.querySelector(".val")!.getBoundingClientRect();
        return { labelTop: label.top, labelRight: label.right, valueTop: value.top, valueLeft: value.left };
      });
    expect(Math.abs(row.valueTop - row.labelTop)).toBeLessThanOrEqual(1);
    expect(row.valueLeft).toBeGreaterThan(row.labelRight);
    expect(
      await dialog
        .getByTestId("meteogram-tooltip")
        .evaluate((el: HTMLElement) => el.style.getPropertyValue("--graupel-tooltip-font-size")),
    ).toBe("");
    await expectNoScrollbars(page);

    await page.keyboard.press("Escape");
    await expect(fullscreen(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Show the meteogram full screen" }).click();
    await expect(fullscreen(page)).toBeVisible();
    await fullscreen(page).getByRole("button", { name: "Close" }).click();
    await expect(fullscreen(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show the meteogram full screen" })).toBeFocused();
  });
});

test("desktop: the view has no scroll bars at common window sizes (REQ-568)", async ({ page }) => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    await embedded(page).dblclick();
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    await expectNoScrollbars(page);
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll("dialog.meteogram-fullscreen, dialog.meteogram-fullscreen *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
        })
        .map((element) => element.className),
    );
    expect(overflow).toEqual([]);
  }
});

test.describe("phone", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  ownDevice();

  test("turning to landscape opens the meteogram on the whole screen, turning back closes it", async ({ page }) => {
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await expect(fullscreen(page)).toHaveCount(0);

    await turn(page, LANDSCAPE);
    const dialog = fullscreen(page);
    await expect(dialog).toBeVisible();
    const chart = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(chart).toBeVisible();
    const chartBox = (await chart.boundingBox())!;
    expect(chartBox.width).toBeGreaterThan(700);
    expect(chartBox.height).toBeGreaterThan(200);
    // The plot takes the whole width, from edge to edge (REQ-553).
    const plot = await plotEdges(chart);
    expect(plot.left).toBeLessThanOrEqual(1);
    expect(plot.right).toBeGreaterThanOrEqual(LANDSCAPE.width - 1);

    await turn(page, PORTRAIT);
    await expect(fullscreen(page)).toHaveCount(0);

    // No buttons in the view on a phone (REQ-537): turning back closes it.
    await turn(page, LANDSCAPE);
    await expect(fullscreen(page)).toBeVisible();
    await expect(buttonsBesideModelInfo(fullscreen(page))).toHaveCount(0);
    // Closed by hand in landscape (Escape, a keyboard), it stays closed until the next turn.
    await page.keyboard.press("Escape");
    await expect(fullscreen(page)).toHaveCount(0);
    await turn(page, PORTRAIT);
    await turn(page, LANDSCAPE);
    await expect(fullscreen(page)).toBeVisible();
  });
});

test.describe("phone, portrait and landscape", () => {
  test.use({
    viewport: PORTRAIT,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  ownDevice();

  test("the embedded chart only scrolls; only turning opens the view, which has the tooltip and no scroll bars", async ({
    page,
  }) => {
    await page.goto(APP);
    const chart = embedded(page);
    await expect(chart).toBeVisible();
    const card = page.getByTestId("meteogram-card");
    // No full-screen button (REQ-532); copy and save stand in the page footer's row (REQ-541).
    await expect(page.getByRole("button", { name: "Show the meteogram full screen" })).toHaveCount(0);
    await expect(page.getByTestId("meteogram-fullscreen-open")).toHaveCount(0);
    await expect(buttonsBesideModelInfo(card)).toHaveCount(0);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("button", { name: "Copy the meteogram as a picture" })).toBeVisible();

    // A touch shows neither tooltip nor cursor line in the card (REQ-531).
    const box = (await chart.boundingBox())!;
    await touch(page, box.x + 120, box.y + box.height / 3);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("meteogram-tooltip").filter({ visible: true })).toHaveCount(0);
    await expect(page.getByTestId("hover-cursor-line")).toHaveCount(0);
    // Nor does a moving touch pointer, as iOS reports it under the finger.
    await chart.dispatchEvent("pointermove", {
      pointerType: "touch",
      clientX: box.x + 160,
      clientY: box.y + box.height / 3,
      bubbles: true,
    });
    await page.waitForTimeout(300);
    await expect(page.getByTestId("meteogram-tooltip").filter({ visible: true })).toHaveCount(0);
    await expect(page.getByTestId("hover-cursor-line")).toHaveCount(0);

    // A double-tap does not open the view (REQ-532).
    await page.touchscreen.tap(box.x + 150, box.y + box.height / 3);
    await page.touchscreen.tap(box.x + 150, box.y + box.height / 3);
    await chart.dispatchEvent("dblclick");
    await page.waitForTimeout(300);
    await expect(fullscreen(page)).toHaveCount(0);

    // The wide chart still scrolls sideways under the finger.
    const scroll = page.getByTestId("meteogram-scroll");
    const before = await scroll.evaluate((el) => ({
      left: el.scrollLeft,
      max: el.scrollWidth - el.clientWidth,
    }));
    expect(before.max).toBeGreaterThan(0);
    const cdp = await page.context().newCDPSession(page);
    const y = Math.round(box.y + box.height / 2);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 250, y }],
    });
    for (let step = 1; step <= 10; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 250 - step * 15, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before.left + 50);

    // Turning opens the view; there a touch shows the cursor line and the tooltip.
    await turn(page, LANDSCAPE);
    const dialog = fullscreen(page);
    await expect(dialog).toBeVisible();
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    // No close, copy or save buttons (REQ-537); the chart takes the whole width but for the margins.
    await expect(buttonsBesideModelInfo(dialog)).toHaveCount(0);
    await expectNoScrollbars(page);
    const bigBox = (await big.boundingBox())!;
    expect(bigBox.x + bigBox.width).toBeLessThanOrEqual(LANDSCAPE.width);
    expect(bigBox.width).toBeGreaterThan(LANDSCAPE.width - 40);
    expect(bigBox.y + bigBox.height).toBeLessThanOrEqual(LANDSCAPE.height);
    await touch(page, bigBox.x + bigBox.width / 2, bigBox.y + bigBox.height / 3);
    await expect(dialog.getByTestId("meteogram-tooltip")).toBeVisible();
    await expect(dialog.getByTestId("hover-cursor-line")).toHaveCount(1);
    // A moving touch pointer moves the line there.
    const lineTime = await dialog.getByTestId("hover-cursor-line").getAttribute("data-hover-time");
    await big.dispatchEvent("pointermove", {
      pointerType: "touch",
      clientX: bigBox.x + bigBox.width * 0.7,
      clientY: bigBox.y + bigBox.height / 3,
      bubbles: true,
    });
    await expect(dialog.getByTestId("hover-cursor-line")).not.toHaveAttribute("data-hover-time", lineTime!);
    // Two taps do not close it.
    await page.touchscreen.tap(bigBox.x + bigBox.width / 2, bigBox.y + bigBox.height / 3);
    await page.touchscreen.tap(bigBox.x + bigBox.width / 2, bigBox.y + bigBox.height / 3);
    await big.dispatchEvent("dblclick");
    await expect(dialog).toBeVisible();

    // Back in portrait the view closes and the card is as before.
    await turn(page, PORTRAIT);
    await expect(fullscreen(page)).toHaveCount(0);
    await expect(page.getByTestId("meteogram-tooltip").filter({ visible: true })).toHaveCount(0);
  });

  test("in the view the tooltip is a narrow side bar at the screen's edge over the whole height, with short labels (REQ-557)", async ({
    page,
  }) => {
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    await turn(page, LANDSCAPE);
    const dialog = fullscreen(page);
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const bigBox = (await big.boundingBox())!;
    const tooltip = dialog.getByTestId("meteogram-tooltip");
    // A touch on the left: the bar stands at the right edge of the screen, from its top to its bottom, square.
    await touch(page, bigBox.x + bigBox.width / 4, bigBox.y + bigBox.height / 3);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute("data-side", "right");
    let box = (await tooltip.boundingBox())!;
    expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - LANDSCAPE.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x + box.width - LANDSCAPE.width)).toBeLessThanOrEqual(1);
    expect(await tooltip.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
    // Narrow: at most a quarter of the screen (REQ-584); every label and the header on one line (the test data's values
    // are not rounded, so they are left out).
    const lines = await tooltip.evaluate((el) =>
      Math.max(
        ...[...el.querySelectorAll(".label, .tooltip-header strong")].map((part) => {
          const range = document.createRange();
          range.selectNodeContents(part);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        }),
      ),
    );
    expect(box.width).toBeLessThanOrEqual(LANDSCAPE.width / 4 + 0.5);
    expect(lines).toBe(1);
    // Short labels.
    await expect(tooltip).toContainText("Wind:");
    await expect(tooltip).not.toContainText("Wind speed");
    // A touch on the right: the bar goes to the left edge, again over the whole height.
    await touch(page, bigBox.x + (bigBox.width * 3) / 4, bigBox.y + bigBox.height / 3);
    await expect(tooltip).toHaveAttribute("data-side", "left");
    box = (await tooltip.boundingBox())!;
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - LANDSCAPE.height)).toBeLessThanOrEqual(1);
  });

  test("in the side bar every label stands on one line with its value and nothing wraps; the width stays at every time point, the font fills the height as far as it allows and then only shrinks (REQ-576, REQ-584, REQ-588)", async ({
    page,
  }) => {
    // A fixed time: the same dates, model names and rows in every run. In German, as the user sees it.
    const now = Date.UTC(2026, 9, 30, 11);
    await page.clock.setFixedTime(now);
    await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
    await forecastWithSnowFrom(page, now, now + 8 * DAY_MS);
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    await turn(page, LANDSCAPE);
    const dialog = page.getByRole("dialog", { name: "Meteogramm (Vollbild)" });
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const tooltip = dialog.getByTestId("meteogram-tooltip");
    const line = dialog.getByTestId("hover-cursor-line");
    const { x, y } = await chartPlaces(big);
    /** Moves the finger to `time` and waits for the cursor line to follow. */
    const moveTo = async (time: number) => {
      const shown = await line.getAttribute("data-hover-time");
      await big.dispatchEvent("pointermove", { pointerType: "touch", clientX: x(time), clientY: y, bubbles: true });
      await expect(line).not.toHaveAttribute("data-hover-time", shown!);
    };

    // Without snow: every label on one line with its value, the long ones too.
    const day6 = now + 6 * DAY_MS;
    await touch(page, x(day6), y);
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByTestId("snowfall-row")).toHaveCount(0);
    const plain = await sideBarLayout(tooltip);
    expectFittedSideBar(plain);
    expect(plain.rows.map(({ text }) => text)).toEqual(
      expect.arrayContaining(["Temperatur:", "Gefühlt:", "Wind:", "Böen:", "Richtung:", "N.-Wahrsch.:", "Niederschl.:"]),
    );
    // Much larger than the tooltip's own size, filling the height or as wide as it may be.
    expect(plain.font).toBeGreaterThan(plain.own * 1.5);
    expect(plain.reach.bottom > plain.height * 0.9 || plain.width > LANDSCAPE.width / 4 - 4).toBe(true);
    // Moving the finger over hours with the same rows changes neither size nor width.
    for (const hours of [3, 6, 9, 12]) {
      await moveTo(day6 + hours * HOUR_MS);
      const moved = await sideBarLayout(tooltip);
      expectFittedSideBar(moved);
      expect(moved.font).toBe(plain.font);
      expect(moved.width).toBe(plain.width);
    }

    // With snow four rows more and long values ("-21.5 °C", "100.5 km/h", "337° NNW"), on a later, other date: the
    // width stays, the long values fit next to their label, the font does not grow.
    const day10 = now + 10 * DAY_MS;
    await touch(page, x(day10), y);
    await expect(tooltip.getByTestId("snowfall-row")).toBeVisible();
    await expect(tooltip).toContainText("337° NNW");
    await expect(tooltip).toContainText("100.5 km/h");
    await expect(tooltip).toContainText("-21.5 °C");
    const snowy = await sideBarLayout(tooltip);
    expectFittedSideBar(snowy);
    expect(snowy.rows.map(({ text }) => text)).toEqual(
      expect.arrayContaining(["Summe:", "Schneefall:", "Schneehöhe:", "Schneesumme:"]),
    );
    expect(snowy.rows.length).toBeGreaterThan(plain.rows.length);
    expect(snowy.date.text).not.toBe(plain.date.text);
    expect(snowy.width).toBe(plain.width);
    expect(snowy.font).toBeLessThanOrEqual(plain.font);
    for (const hours of [3, 6]) {
      await moveTo(day10 + hours * HOUR_MS);
      const moved = await sideBarLayout(tooltip);
      expectFittedSideBar(moved);
      expect(moved.font).toBe(snowy.font);
      expect(moved.width).toBe(plain.width);
    }

    // Back without snow: the font does not grow again, the width stays.
    await touch(page, x(day6), y);
    await expect(tooltip.getByTestId("snowfall-row")).toHaveCount(0);
    const back = await sideBarLayout(tooltip);
    expectFittedSideBar(back);
    expect(back.font).toBe(snowy.font);
    expect(back.width).toBe(plain.width);

    // On a lower screen the rows with snow no longer fit the height: the font gets smaller once and not larger again,
    // the width stays.
    await turn(page, LOW_LANDSCAPE);
    const low = await chartPlaces(big);
    await touch(page, low.x(day6), low.y);
    await expect(tooltip.getByTestId("snowfall-row")).toHaveCount(0);
    const lowPlain = await sideBarLayout(tooltip);
    expectFittedSideBar(lowPlain);
    await touch(page, low.x(day10), low.y);
    await expect(tooltip.getByTestId("snowfall-row")).toBeVisible();
    const lowSnowy = await sideBarLayout(tooltip);
    expectFittedSideBar(lowSnowy);
    expect(lowSnowy.font).toBeLessThan(lowPlain.font);
    expect(lowSnowy.width).toBe(lowPlain.width);
    await touch(page, low.x(day6), low.y);
    await expect(tooltip.getByTestId("snowfall-row")).toHaveCount(0);
    const lowBack = await sideBarLayout(tooltip);
    expectFittedSideBar(lowBack);
    expect(lowBack.font).toBe(lowSnowy.font);
    expect(lowBack.width).toBe(lowPlain.width);
  });

  test("a model name too long for one line gives way to its short name; date, model and run take a line each (REQ-588)", async ({
    page,
  }) => {
    const now = Date.UTC(2026, 9, 30, 11);
    await page.clock.setFixedTime(now);
    await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
    await forecastWithSnowFrom(page, now, now + 8 * DAY_MS);
    // At the Ortler the chain starts with "ItaliaMeteo ARPAE ICON-2i" and ends with "ECMWF IFS HRES 9km".
    await page.route("**/config.json", async (route) => {
      const response = await route.fetch();
      const config = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...config, startLocation: ORTLER } });
    });
    // Every model names its newest run, which reaches far enough: the bar shows it below the model name.
    await page.route("https://api.open-meteo.com/data/**", (route) => fakeMeta(route, now));
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    await turn(page, LANDSCAPE);
    const dialog = page.getByRole("dialog", { name: "Meteogramm (Vollbild)" });
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const tooltip = dialog.getByTestId("meteogram-tooltip");
    const { x, y } = await chartPlaces(big);

    // The full name of the first model needs more than the line: its short name from the model catalogue stands there.
    await touch(page, x(now + 6 * HOUR_MS), y);
    await expect(tooltip).toBeVisible();
    const early = await sideBarLayout(tooltip);
    expectFittedSideBar(early);
    expect(await fitsTheLine(tooltip, "ItaliaMeteo ARPAE ICON-2i")).toBe(false);
    expect(early.model.text).toBe("ICON-2I");
    expect(early.run?.text).toMatch(/^Run \d\d\.\d\d\. \d\d:\d\d \+ \d+h$/);

    // The last model: its full name when it fits the line, else its short one; the width stays.
    await touch(page, x(now + 6 * DAY_MS), y);
    await expect(tooltip).not.toContainText("ICON-2I");
    const late = await sideBarLayout(tooltip);
    expectFittedSideBar(late);
    const full = "ECMWF IFS HRES 9km";
    expect(late.model.text).toBe((await fitsTheLine(tooltip, full)) ? full : "IFS HRES");
    expect(late.width).toBe(early.width);
  });

  test("with a notch its inset comes on top of the side bar's quarter of the screen (REQ-584)", async ({ page }) => {
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { left: 47, right: 47 } });
    await turn(page, LANDSCAPE);
    const dialog = fullscreen(page);
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const bigBox = (await big.boundingBox())!;
    const tooltip = dialog.getByTestId("meteogram-tooltip");
    const bar = () =>
      tooltip.evaluate((el: HTMLElement) => {
        const style = getComputedStyle(el);
        const { width } = el.getBoundingClientRect();
        return {
          width,
          // Without the inset at the notch's side.
          inner:
            el.dataset.side === "left" ? width - parseFloat(style.paddingLeft) : width - parseFloat(style.paddingRight),
          outer: el.dataset.side === "left" ? parseFloat(style.paddingLeft) : parseFloat(style.paddingRight),
        };
      });
    await touch(page, bigBox.x + (bigBox.width * 3) / 4, bigBox.y + bigBox.height / 3);
    await expect(tooltip).toHaveAttribute("data-side", "left");
    const left = await bar();
    expect(left.outer).toBe(47);
    expect(left.width).toBeLessThanOrEqual(LANDSCAPE.width / 4 + 47 + 0.5);
    expect(left.width).toBeGreaterThan(LANDSCAPE.width / 4);
    // At the other side the same.
    await touch(page, bigBox.x + bigBox.width / 4, bigBox.y + bigBox.height / 3);
    await expect(tooltip).toHaveAttribute("data-side", "right");
    const right = await bar();
    expect(right.outer).toBe(47);
    expect(right.width).toBe(left.width);
    expect(right.inner).toBe(left.inner);
    await cdp.detach();
  });

  test("the chart reaches the camera on its side and the screen's edge on the other, also turned; the row below keeps clear of both edges (REQ-606, REQ-624)", async ({
    page,
  }) => {
    // The screen's angle as the test sets it (`__angle`; undefined: the browser tells none), in `screen.orientation`
    // and the older `window.orientation` (−90 for 270°), with a `change` per turn.
    await page.addInitScript(() => {
      const state = window as unknown as { __angle?: number };
      state.__angle = 90;
      Object.defineProperty(ScreenOrientation.prototype, "angle", {
        configurable: true,
        get: () => state.__angle,
      });
      Object.defineProperty(window, "orientation", {
        configurable: true,
        get: () => {
          const angle = state.__angle;
          return angle === undefined ? undefined : angle > 180 ? angle - 360 : angle;
        },
      });
    });
    const setAngle = (angle: number | undefined) =>
      page.evaluate((next) => {
        (window as unknown as { __angle?: number }).__angle = next ?? undefined;
        screen.orientation.dispatchEvent(new Event("change"));
      }, angle ?? null);
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    // iOS reports the camera's inset on both sides.
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { left: 47, right: 47 } });
    await turn(page, LANDSCAPE);
    const dialog = fullscreen(page);
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const edges = async () => {
      const box = (await big.boundingBox())!;
      return { left: Math.round(box.x), right: Math.round(LANDSCAPE.width - box.x - box.width) };
    };
    // The row below the chart: from the screen's left edge to the place's text, from the data source's text to the
    // right edge (REQ-624). The screen's rounded corners would cut text closer to the edge.
    const row = dialog.getByTestId("meteogram-footer-row");
    const rowText = async () => {
      const place = (await row.getByTestId("meteogram-footer-location").boundingBox())!;
      const source = (await row.locator(".meteogram-attribution-link").boundingBox())!;
      return { left: Math.round(place.x), right: Math.round(LANDSCAPE.width - source.x - source.width) };
    };

    // Turned to the left (90°): the camera at the left, the chart from it to the right edge of the screen.
    await expect(dialog).toHaveClass(/meteogram-fullscreen--camera-left/);
    await expect.poll(edges).toEqual({ left: 47, right: 0 });
    await expect(row).toBeVisible();
    await expect.poll(rowText).toEqual({ left: 47, right: 47 });
    await page.screenshot({ path: test.info().outputPath("camera-left.png") });

    // Turned to the right (270°): the other way round.
    await setAngle(270);
    await expect(dialog).toHaveClass(/meteogram-fullscreen--camera-right/);
    await expect.poll(edges).toEqual({ left: 0, right: 47 });
    await expect.poll(rowText).toEqual({ left: 47, right: 47 });
    await page.screenshot({ path: test.info().outputPath("camera-right.png") });

    // Without an angle: clear of both sides as before.
    await setAngle(undefined);
    await expect(dialog).not.toHaveClass(/meteogram-fullscreen--camera/);
    await expect.poll(edges).toEqual({ left: 47, right: 47 });
    await expect.poll(rowText).toEqual({ left: 47, right: 47 });

    // Back in portrait the view is closed and the page's chart as before.
    await setAngle(0);
    await turn(page, PORTRAIT);
    await expect(fullscreen(page)).toHaveCount(0);
    await expect(embedded(page)).toBeVisible();
    await cdp.detach();
  });

  test("two fingers zoom the time axis only; spreading zooms in, pinching back zooms out (REQ-563)", async ({
    page,
  }) => {
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    await turn(page, LANDSCAPE);
    const big = fullscreen(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const span = async () => {
      const [start, end] = await Promise.all([
        big.getAttribute("data-visible-start-time"),
        big.getAttribute("data-visible-end-time"),
      ]);
      return Date.parse(end!) - Date.parse(start!);
    };
    const before = await span();
    const box = (await big.boundingBox())!;
    const height = box.height;
    const y = Math.round(box.y + box.height / 2);
    const mid = box.x + box.width / 2;
    const cdp = await page.context().newCDPSession(page);
    const pinch = async (from: number, to: number) => {
      const points = (d: number) => [
        { x: Math.round(mid - d), y, id: 1 },
        { x: Math.round(mid + d), y, id: 2 },
      ];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
      for (let step = 1; step <= 8; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: points(from + ((to - from) * step) / 8),
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    // Spreading the fingers to twice their distance halves the time span.
    await pinch(80, 160);
    await expect.poll(span).toBeLessThan(before * 0.6);
    expect(await span()).toBeGreaterThan(before * 0.4);
    // The height stays, the page is not zoomed.
    expect(Math.abs((await big.boundingBox())!.height - height)).toBeLessThan(1);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    // Pinching back zooms out again, no further than the view opened with.
    await pinch(160, 20);
    await expect.poll(span).toBe(before);
    await cdp.detach();
  });

  test("a small phone in landscape shows the whole chart without scroll bars", async ({ page }) => {
    // With the model chains shown, so the page in portrait scrolls (the chart takes the height left, REQ-608).
    await page.addInitScript(() => {
      window.localStorage.setItem("graupel.showWeatherChain", "true");
      window.localStorage.setItem("graupel.showCloudChain", "true");
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(APP);
    await expect(embedded(page)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 200));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await turn(page, { width: 568, height: 320 });
    await expect(fullscreen(page)).toBeVisible();
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    await expectNoScrollbars(page);
    // Turned back, the page scrolls again and is where it was.
    await turn(page, { width: 320, height: 568 });
    await expect(fullscreen(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});
