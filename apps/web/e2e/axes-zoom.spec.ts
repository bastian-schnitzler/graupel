// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Axes when zoomed (REQ-656, from the library: REQ-655) in a real browser, on the desktop and on a phone. With the
 * option „Adjust axes when zooming“ on (the default), a meteogram that shows only part of the forecast takes the
 * precipitation and wind axes from the values in that part: a calm day chosen in the day slider, or zoomed into with
 * two fingers in the phone's full-screen view, gets smaller axes than the stormy forecast as a whole. With the option
 * off the axes of the whole forecast stay. The chart on the page, the full-screen view and the copied picture show the
 * same axes. While two fingers move the chart the axes stay as they were when the fingers came down; they adapt once
 * the fingers lift (DEC-061).
 *
 * The fake forecast is stormy (wind 40 km/h, gusts 70 km/h, 8 mm every third hour: axes to 10 mm and 75 km/h) before
 * today, in the first four hours of today (UTC, the fake's time zone) and from 02:00 of the day after tomorrow on; calm
 * in between (wind 5 km/h, gusts 12 km/h, 0.4 mm every sixth hour: axes to 2 mm and 15 km/h), so tomorrow is calm with
 * an hour to spare at both ends. The picture is checked in
 * the SVG the export rasterises (recorded from `XMLSerializer`).
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const COPY = "Copy the meteogram as a picture";
const OPTION = "Adjust axes when zooming";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Tops of the two axes (value and unit, a two-line label joined by a space). */
interface Axes {
  precip: string | null;
  wind: string | null;
}

/** Axes over the whole forecast, the storm included. */
const STORMY: Axes = { precip: "10 mm", wind: "75 km/h" };
/** Axes of the calm part. */
const CALM: Axes = { precip: "2 mm", wind: "15 km/h" };

/** Reads the axis tops from a chart's root element (page, full-screen view or a picture's SVG document). */
function readAxes(root: ParentNode): { precip: string | null; wind: string | null } {
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

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Registered after the shared fake, so it answers first. Each answer starts `past_hours` before the current hour.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const past = Number(new URL(route.request().url()).searchParams.get("past_hours") ?? 0);
    const nowHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const today = Math.floor(nowHour / DAY_MS) * DAY_MS;
    const calm = (index: number) => {
      const time = nowHour + (index - past) * HOUR_MS;
      return time >= today + 4 * HOUR_MS && time < today + 2 * DAY_MS + 2 * HOUR_MS;
    };
    const wind = (index: number) => (calm(index) ? 5 : 40);
    const gusts = (index: number) => (calm(index) ? 12 : 70);
    const precipitation = (index: number) =>
      calm(index) ? (index % 6 === 0 ? 0.4 : 0) : index % 3 === 0 ? 8 : 0;
    return fakeForecast(route, {
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
  // The SVG of every exported picture, reduced to its axes.
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
const cards = (page: Page) => page.getByTestId("day-card");
/** The chart on the page. */
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  // Yesterday, today and the days after.
  await expect(cards(page).nth(1)).toHaveAttribute("aria-current", "date");
}

/**
 * Selects one day in the day slider: a click (or tap) on its card, where the slider's marker lies over the cards and
 * selects the day under the pointer.
 */
async function selectDay(page: Page, index: number, tap = false) {
  const box = (await cards(page).nth(index).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  if (tap) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(cards(page).nth(index)).toHaveAttribute("aria-pressed", "true");
}

/** Visible time span of a chart (ms). */
async function visibleSpan(svg: Locator) {
  const [start, end] = await Promise.all([
    svg.getAttribute("data-visible-start-time"),
    svg.getAttribute("data-visible-end-time"),
  ]);
  return Date.parse(end!) - Date.parse(start!);
}

/** What the chart inside `scope` shows of the axes. */
const shown = (scope: Locator): Promise<Axes> => scope.evaluate(readAxes);

/** The option in the open settings popup. */
const option = (settings: Locator) => settings.getByRole("radiogroup", { name: OPTION });

/** The option stored in the browser; `null`: no choice (on). */
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("graupel.scaleToVisibleRange"));

/** Pictures exported so far. */
const pictures = (page: Page) => page.evaluate(() => (window as unknown as { __pictures: Axes[] }).__pictures);

/** Clicks or taps the copy button in `scope` and returns the axes of the picture, once the page says it copied it. */
async function copyPicture(page: Page, scope: Locator, tap = false): Promise<Axes> {
  const button = scope.getByRole("button", { name: COPY });
  const status = scope.getByTestId("meteogram-image-feedback");
  await expect(status).toHaveText("");
  const before = (await pictures(page)).length;
  if (tap) await button.tap();
  else await button.click();
  // Drawing the picture takes a while on a loaded machine.
  await expect(status).toHaveText("Meteogram copied", { timeout: 15_000 });
  const exported = await pictures(page);
  expect(exported).toHaveLength(before + 1);
  return exported[before]!;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: "en-GB" });
  ownDevice();

  async function openSettings(page: Page) {
    await page.locator('[data-region="header"]').getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    // The option is in the tab Meteogram (REQ-686).
    await settings.getByRole("tab", { name: "Meteogram" }).click();
    return settings;
  }

  test("a calm day in the day slider gets smaller axes on the page, full screen and in the picture; Off keeps the whole forecast's", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);
    const card = page.getByTestId("meteogram-card");
    // All days: the storm sets the axes.
    expect(await shown(embedded(page))).toEqual(STORMY);

    // The option, On without a choice, in the meteogram section below the legend with its hint (REQ-686).
    let settings = await openSettings(page);
    const group = option(settings);
    await expect(group.locator("label")).toHaveText(["On", "Off"]);
    await expect(group.getByRole("radio", { name: "On" })).toBeChecked();
    await expect(group).toHaveAccessibleDescription(
      "Applies to precipitation and wind: their axes follow the values in the period shown.",
    );
    const legend = (await settings.getByRole("checkbox", { name: "Show the legend" }).boundingBox())!;
    const dewPoint = (await settings.getByRole("radiogroup", { name: "Dew point" }).boundingBox())!;
    const box = (await group.boundingBox())!;
    expect(box.y).toBeGreaterThan(legend.y + legend.height);
    expect(box.y + box.height).toBeLessThan(dewPoint.y);
    await settings.getByRole("button", { name: "Close" }).click();

    // Tomorrow, a calm day: smaller axes, the same in the picture and in the full-screen view and its picture.
    await selectDay(page, 2);
    await expect.poll(() => shown(embedded(page))).toEqual(CALM);
    expect(await copyPicture(page, card)).toEqual(CALM);
    await card.getByRole("button", { name: "Show the meteogram full screen" }).click();
    let view = fullscreen(page);
    await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    expect(await shown(view.getByTestId("meteogram-fullscreen"))).toEqual(CALM);
    expect(await copyPicture(page, view)).toEqual(CALM);
    await view.getByRole("button", { name: "Close" }).click();
    await expect(fullscreen(page)).toHaveCount(0);

    // Off, stored: the axes of the whole forecast for the same day, everywhere.
    settings = await openSettings(page);
    await option(settings).getByRole("radio", { name: "Off" }).check();
    await expect.poll(() => stored(page)).toBe("false");
    await settings.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => shown(embedded(page))).toEqual(STORMY);
    expect(await copyPicture(page, card)).toEqual(STORMY);
    await card.getByRole("button", { name: "Show the meteogram full screen" }).click();
    view = fullscreen(page);
    await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    expect(await shown(view.getByTestId("meteogram-fullscreen"))).toEqual(STORMY);
    expect(await copyPicture(page, view)).toEqual(STORMY);
    await view.getByRole("button", { name: "Close" }).click();

    // Kept after a reload.
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await selectDay(page, 2);
    await expect.poll(() => visibleSpan(chart(page))).toBe(DAY_MS);
    expect(await shown(embedded(page))).toEqual(STORMY);
    await expect(option(await openSettings(page)).getByRole("radio", { name: "Off" })).toBeChecked();

    // On again: nothing stored, the calm day's axes.
    await option(page.getByRole("dialog", { name: "Settings" })).getByRole("radio", { name: "On" }).check();
    await expect.poll(() => stored(page)).toBeNull();
    await expect.poll(() => shown(embedded(page))).toEqual(CALM);
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

  /** Two fingers on the full-screen chart, in its middle; `moves` puts them at new places, `lift` ends the touch. */
  async function fingers(page: Page) {
    const big = fullscreen(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const box = (await big.boundingBox())!;
    const y = Math.round(box.y + box.height / 2);
    const mid = box.x + box.width / 2;
    const cdp = await page.context().newCDPSession(page);
    /** Fingers `distance` apart around the middle, both moved right by `shift`. */
    const points = (distance: number, shift: number) => [
      { x: Math.round(mid - distance / 2 + shift), y, id: 1 },
      { x: Math.round(mid + distance / 2 + shift), y, id: 2 },
    ];
    let at = { distance: 0, shift: 0 };
    return {
      async down(distance: number) {
        at = { distance, shift: 0 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(distance, 0) });
      },
      async move(distance: number, shift: number) {
        const from = at;
        for (let step = 1; step <= 8; step++) {
          const part = step / 8;
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: points(
              from.distance + (distance - from.distance) * part,
              from.shift + (shift - from.shift) * part,
            ),
          });
        }
        at = { distance, shift };
      },
      async lift() {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      },
      detach: () => cdp.detach(),
    };
  }

  /** Visible time span of the full-screen chart (ms). */
  const span = (page: Page) =>
    visibleSpan(fullscreen(page).locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]'));

  test("one calm day in the slider and two fingers zoomed into the calm hours give the same smaller axes", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);
    expect(await shown(embedded(page))).toEqual(STORMY);

    // Tomorrow in the day slider: the calm day's axes on the page, in the picture and in the full-screen view.
    await selectDay(page, 2, true);
    await expect.poll(() => shown(embedded(page))).toEqual(CALM);
    expect(await copyPicture(page, page.getByRole("contentinfo"), true)).toEqual(CALM);
    await turn(page, LANDSCAPE);
    const big = fullscreen(page).getByTestId("meteogram-fullscreen");
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    expect(await shown(big)).toEqual(CALM);
    await turn(page, PORTRAIT);
    await expect(fullscreen(page)).toHaveCount(0);

    // Today: its first hours are stormy.
    await selectDay(page, 1, true);
    await expect.poll(() => shown(embedded(page))).toEqual(STORMY);
    await turn(page, LANDSCAPE);
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    expect(await shown(big)).toEqual(STORMY);
    const whole = await span(page);

    // Spreading two fingers in the middle of the day zooms into its calm hours (06:00 to 18:00): while the fingers
    // move, the axes stay; once they lift, they are those of the calm day in the slider.
    const touch = await fingers(page);
    await touch.down(100);
    await touch.move(200, 0);
    await expect.poll(() => span(page)).toBeLessThan(whole * 0.6);
    expect(await shown(big)).toEqual(STORMY);
    await touch.lift();
    await expect.poll(() => shown(big)).toEqual(CALM);
    expect(await span(page)).toBeGreaterThan(whole * 0.4);
    await touch.detach();
  });

  test("while two fingers move the zoomed chart the axes stay; they adapt when the fingers lift (DEC-061)", async ({
    page,
  }) => {
    await open(page);
    await selectDay(page, 1, true);
    await expect.poll(() => shown(embedded(page))).toEqual(STORMY);
    await turn(page, LANDSCAPE);
    const big = fullscreen(page).getByTestId("meteogram-fullscreen");
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    const whole = await span(page);
    const touch = await fingers(page);
    // Zoomed into the calm hours.
    await touch.down(100);
    await touch.move(200, 0);
    await touch.lift();
    await expect.poll(() => shown(big)).toEqual(CALM);
    const zoomed = await span(page);
    expect(zoomed).toBeLessThan(whole * 0.6);

    // Both fingers move right: the chart moves to the stormy morning, the axes stay those of the calm hours.
    await touch.down(200);
    await touch.move(200, 350);
    const start = await fullscreen(page)
      .locator('svg[data-render-mode="fullscreen"]')
      .getAttribute("data-visible-start-time");
    expect(Date.parse(start!) % DAY_MS).toBeLessThan(4 * HOUR_MS);
    expect(Math.abs((await span(page)) - zoomed)).toBeLessThan(60_000);
    expect(await shown(big)).toEqual(CALM);
    // Lifted: the axes of the stormy hours now shown.
    await touch.lift();
    await expect.poll(() => shown(big)).toEqual(STORMY);
    await touch.detach();
  });

  test("with the option off the axes of the whole forecast stay, also when zoomed", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("graupel.scaleToVisibleRange", "false"));
    await open(page);
    // Tomorrow, calm, in the day slider: the axes of the whole forecast, on the page and in the full-screen view.
    await selectDay(page, 2, true);
    await expect.poll(() => visibleSpan(chart(page))).toBe(DAY_MS);
    expect(await shown(embedded(page))).toEqual(STORMY);
    await turn(page, LANDSCAPE);
    const big = fullscreen(page).getByTestId("meteogram-fullscreen");
    await expect(fullscreen(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    expect(await shown(big)).toEqual(STORMY);
    // Zoomed further with two fingers: still those axes.
    const whole = await span(page);
    const touch = await fingers(page);
    await touch.down(100);
    await touch.move(200, 0);
    await touch.lift();
    await expect.poll(() => span(page)).toBeLessThan(whole * 0.6);
    expect(await shown(big)).toEqual(STORMY);
    await touch.detach();
  });
});
