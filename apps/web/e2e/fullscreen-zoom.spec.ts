// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Zoom in the meteogram's full-screen view on the desktop (REQ-636): the mouse wheel zooms the
 * time axis in and out at the mouse pointer (the time under it stays under it), the zoom keys + and - as well, and 0
 * goes back. It zooms out no further than the range the view opened with (the day slider's). The chart in the card
 * does not zoom. The precipitation and wind axes adapt after every step (REQ-656, DEC-061), and the info buttons in the
 * model headers follow the zoom (REQ-643).
 *
 * The fake forecast is calm (wind 5 km/h, gusts 12 km/h, 0.4 mm every sixth hour: axes to 2 mm and 15 km/h) until
 * 02:00 of the day after tomorrow and stormy from then on (wind 40 km/h, gusts 70 km/h, 8 mm every third hour: axes to
 * 10 mm and 75 km/h).
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Fixed time: Tuesday, 3 November 2026, 13:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 13);
/** Start of the storm: 02:00 of the day after tomorrow. */
const STORM = Date.UTC(2026, 10, 5, 2);

/** Tops of the two axes. */
interface Axes {
  precip: string | null;
  wind: string | null;
}
const STORMY: Axes = { precip: "10 mm", wind: "75 km/h" };
const CALM: Axes = { precip: "2 mm", wind: "15 km/h" };

test.use({ viewport: { width: 1280, height: 900 }, locale: "en-GB", timezoneId: "UTC" });
ownDevice();

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const past = Number(new URL(route.request().url()).searchParams.get("past_hours") ?? 0);
    const nowHour = Math.floor(FIXED_NOW / HOUR_MS) * HOUR_MS;
    const stormy = (index: number) => nowHour + (index - past) * HOUR_MS >= STORM;
    const wind = (index: number) => (stormy(index) ? 40 : 5);
    const gusts = (index: number) => (stormy(index) ? 70 : 12);
    const precipitation = (index: number) =>
      stormy(index) ? (index % 3 === 0 ? 8 : 0) : index % 6 === 0 ? 0.4 : 0;
    return fakeForecast(route, {
      now: FIXED_NOW,
      values: {
        wind_speed: wind,
        wind_speed_10m: wind,
        wind_gusts: gusts,
        wind_gusts_10m: gusts,
        precipitation,
        rain: precipitation,
      },
    });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const card = (page: Page) => page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const big = (page: Page) => dialog(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');

/** Visible range of a chart. */
async function range(svg: Locator) {
  const [start, end] = await Promise.all([
    svg.getAttribute("data-visible-start-time"),
    svg.getAttribute("data-visible-end-time"),
  ]);
  return { start: Date.parse(start!), end: Date.parse(end!) };
}

/** Left and right edge of a chart's plot on the page. */
const plotEdges = (chart: Locator) =>
  chart.evaluate((svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const clip = svg.querySelector<SVGRectElement>(".panel-temperature clipPath rect")!;
    const x = Number(clip.getAttribute("x"));
    const width = Number(clip.getAttribute("width"));
    return { left: box.left + x * scale, right: box.left + (x + width) * scale };
  });

/** The time at the page's `x` on a chart's axis. */
async function timeAt(chart: Locator, x: number) {
  const [{ start, end }, plot] = await Promise.all([range(chart), plotEdges(chart)]);
  return start + ((x - plot.left) / (plot.right - plot.left)) * (end - start);
}

/** Reads the axis tops from a chart's root element (as in axes-zoom.spec.ts). */
function readAxes(root: ParentNode): Axes {
  const text = (element: Element) => {
    const spans = [...element.querySelectorAll("tspan")];
    const lines = spans.length > 0 ? spans.map((span) => span.textContent ?? "") : [element.textContent ?? ""];
    return lines.map((line) => line.trim()).join(" ");
  };
  const top = (area: string, unit: string) => {
    const values = [...root.querySelectorAll(`[data-area-id="${area}"] text`)]
      .filter((element) => element.getAttribute("data-testid") !== "axis-mid")
      .map(text)
      .filter((label) => label.endsWith(` ${unit}`))
      .map((label) => Number(label.slice(0, -unit.length - 1)));
    return values.length > 0 ? `${Math.max(...values)} ${unit}` : null;
  };
  return { precip: top("precip", "mm"), wind: top("wind", "km/h") };
}

const axes = (page: Page): Promise<Axes> => dialog(page).getByTestId("meteogram-fullscreen").evaluate(readAxes);

async function open(page: Page) {
  await page.goto(APP);
  await expect(card(page)).toBeVisible();
}

async function openFullscreen(page: Page) {
  await page.getByRole("button", { name: "Show the meteogram full screen" }).click();
  await expect(big(page)).toBeVisible();
}

/** One step of the mouse wheel at the pointer: up zooms in. */
async function wheel(page: Page, direction: "in" | "out") {
  const before = await big(page).getAttribute("data-visible-end-time");
  const start = await big(page).getAttribute("data-visible-start-time");
  await page.mouse.wheel(0, direction === "in" ? -100 : 100);
  // Drawn at once; at the limit nothing changes.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return (
    before !== (await big(page).getAttribute("data-visible-end-time")) ||
    start !== (await big(page).getAttribute("data-visible-start-time"))
  );
}

test("the wheel zooms the full-screen view at the pointer, in and out no further than it opened; the axes follow each step; the card does not zoom", async ({
  page,
}) => {
  await open(page);
  // The card does not zoom.
  const cardRange = await range(card(page));
  const cardBox = (await card(page).boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.wheel(0, -300);
  expect(await range(card(page))).toEqual(cardRange);

  await openFullscreen(page);
  const opened = await range(big(page));
  expect(opened).toEqual(cardRange);
  expect(await axes(page)).toEqual(STORMY);

  // The pointer over the plot, near its left edge.
  const plot = await plotEdges(big(page));
  const box = (await big(page).boundingBox())!;
  const x = Math.round(plot.left + (plot.right - plot.left) * 0.08);
  await page.mouse.move(x, Math.round(box.y + box.height / 2));
  const anchor = await timeAt(big(page), x);
  const cursor = dialog(page).getByTestId("hover-cursor-line");
  await expect(cursor).toHaveCount(1);
  /** Where the cursor line stands on the page. */
  const cursorX = () =>
    big(page).evaluate((svg: SVGSVGElement) => {
      const line = svg.querySelector('[data-testid="hover-cursor-line"]')!;
      const box = svg.getBoundingClientRect();
      return box.left + Number(line.getAttribute("x1")) * (box.width / svg.viewBox.baseVal.width);
    });
  expect(Math.abs((await cursorX()) - x)).toBeLessThan(1.5);

  // Each step up zooms in at the pointer: the time under it stays there, with the cursor line; the axes adapt.
  let span = opened.end - opened.start;
  for (let step = 0; step < 12; step++) {
    expect(await wheel(page, "in")).toBe(true);
    const now = await range(big(page));
    expect(now.end - now.start).toBeLessThan(span);
    span = now.end - now.start;
    expect(Math.abs((await timeAt(big(page), x)) - anchor)).toBeLessThan(2 * 60_000);
    expect(Math.abs((await cursorX()) - x)).toBeLessThan(1.5);
    // Without the storm in sight (an hour to spare), the calm axes at once.
    if (now.end < STORM - HOUR_MS) expect(await axes(page)).toEqual(CALM);
  }
  expect((await range(big(page))).end).toBeLessThan(STORM - HOUR_MS);
  expect(await axes(page)).toEqual(CALM);
  // The info buttons in the model headers follow (REQ-643).
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectInfoButtonsInHeaders(dialog(page));

  // Down zooms out again at the pointer, as far as the range the view opened with and no further.
  let steps = 0;
  while (await wheel(page, "out")) {
    steps++;
    expect(steps).toBeLessThan(30);
    const now = await range(big(page));
    expect(now.start).toBeGreaterThanOrEqual(opened.start);
    expect(now.end).toBeLessThanOrEqual(opened.end);
  }
  expect(await range(big(page))).toEqual(opened);
  expect(await axes(page)).toEqual(STORMY);
  // The card behind kept its range.
  expect(await range(card(page))).toEqual(cardRange);
});

test("with one day in the slider the view zooms within that day; + and - zoom, 0 goes back", async ({ page }) => {
  await open(page);
  // Tomorrow, by a click on its card in the day slider.
  const tomorrow = page.getByTestId("day-card").nth(2);
  const dayBox = (await tomorrow.boundingBox())!;
  await page.mouse.click(dayBox.x + dayBox.width / 2, dayBox.y + dayBox.height / 2);
  await expect(tomorrow).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => ((await range(card(page))).end - (await range(card(page))).start)).toBe(DAY_MS);

  await openFullscreen(page);
  const opened = await range(big(page));
  expect(opened.end - opened.start).toBe(DAY_MS);
  // At the opening range the wheel does not zoom out.
  const box = (await big(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  expect(await wheel(page, "out")).toBe(false);
  expect(await range(big(page))).toEqual(opened);
  // In, then out as far as it goes: the day again, not more.
  for (let step = 0; step < 3; step++) expect(await wheel(page, "in")).toBe(true);
  expect((await range(big(page))).end - (await range(big(page))).start).toBeLessThan(DAY_MS * 0.6);
  while (await wheel(page, "out"));
  expect(await range(big(page))).toEqual(opened);

  // The zoom keys: + zooms in at the cursor line, - out, 0 back to the day.
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  const zoomed = await range(big(page));
  expect(zoomed.end - zoomed.start).toBeLessThan(DAY_MS * 0.7);
  await page.keyboard.press("-");
  const out = await range(big(page));
  expect(out.end - out.start).toBeGreaterThan(zoomed.end - zoomed.start);
  await page.keyboard.press("0");
  expect(await range(big(page))).toEqual(opened);
  // The day slider behind stays on tomorrow.
  await expect(tomorrow).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  expect(await range(card(page))).toEqual(opened);
});

/** Each info button in the model headers of `scope` stands inside a header of its model. */
async function expectInfoButtonsInHeaders(scope: Locator) {
  const { headers, buttons } = await scope.evaluate((root) => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    return {
      headers: [...root.querySelectorAll('[data-testid="model-label-segment"]')].map((group) => ({
        model: group.getAttribute("data-model") ?? "",
        shape: rect(group.querySelector('[data-testid="model-header-shape"]')!),
      })),
      buttons: [...root.querySelectorAll(".model-header-info__item")].map((item) => ({
        model: item.getAttribute("data-model") ?? "",
        rect: rect(item.querySelector("button")!),
      })),
    };
  });
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    const inside = headers.some(
      ({ model, shape }) =>
        model === button.model &&
        button.rect.left >= shape.left - 0.5 &&
        button.rect.right <= shape.right + 0.5 &&
        button.rect.top >= shape.top - 0.5 &&
        button.rect.bottom <= shape.bottom + 0.5,
    );
    expect(inside, button.model).toBe(true);
  }
}
