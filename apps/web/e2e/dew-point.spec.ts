// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Dew point and spread in the meteogram (REQ-593) in a real browser, on the desktop and on a phone: the option Auto,
 * On or Off in the settings (section Meteogram), Off by default (REQ-621), kept after a reload; the chart on the page,
 * the full-screen view and the copied picture follow it. The dew point is fetched with every forecast, whatever the
 * option. Auto shows line and spread over the whole chart, without gaps, as soon as its condition holds at any hour of
 * the days shown and a temperature there reaches 5 °C, else not at all (REQ-605, REQ-620, REQ-621).
 *
 * The fake forecast of these tests has its own dew point: 1 K below the temperature for six hours of yesterday (the
 * hours 5 to 10 of each answer, which starts two to three hours before yesterday 00:00) and 10 K below at every other
 * hour, always below 15 °C; the temperature reaches 10 °C. With yesterday shown Auto equals On; without it Auto shows
 * nothing. A cold variant lowers the temperature below 5 °C at every hour, with the dew point 1 K below it throughout.
 * The other tests keep the shared fake, whose dew point equals the temperature. The picture is checked twice: the SVG
 * the export rasterises (recorded from `XMLSerializer`) and the green of the dew point line in the PNG on the
 * clipboard.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const HOUR_MS = 3_600_000;
const COPY = "Copy the meteogram as a picture";

/** Temperature of the fake forecast at an hour of an answer (openMeteo.ts). */
const temperature = (index: number) => Math.round((4 + 6 * Math.sin(index / 5)) * 10) / 10;
/** Dew point of these tests: 1 K below the temperature at the hours 5 to 10 of an answer (yesterday), else 10 K. */
const dewPoint = (index: number) => Math.round((temperature(index) - (index >= 5 && index <= 10 ? 1 : 10)) * 10) / 10;
/** Temperature of the cold variant: 6 K lower, from −8 to 4 °C, below 5 °C at every hour (REQ-620). */
const coldTemperature = (index: number) => Math.round((temperature(index) - 6) * 10) / 10;
/** Dew point of the cold variant: 1 K below its temperature at every hour, so the spread is small everywhere. */
const coldDewPoint = (index: number) => Math.round((coldTemperature(index) - 1) * 10) / 10;

/** What a chart (or a picture's SVG) shows of the dew point: its line pieces, its spread fills, the hours covered. */
interface Shown {
  lines: number;
  fills: number;
  hours: number;
}

let errors: string[] = [];
let forecastRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  forecastRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Registered after the shared fake, so it answers first.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    forecastRequests.push(route.request().url());
    return fakeForecast(route, { values: { dew_point_2m: dewPoint } });
  });
  // The SVG of every exported picture, reduced to what it shows of the dew point.
  await page.addInitScript(() => {
    const pictures: { lines: number; fills: number }[] = [];
    Object.assign(window, { __pictures: pictures });
    const serialize = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (this: XMLSerializer, node: Node) {
      const markup = serialize.call(this, node);
      if (markup.startsWith("<svg")) {
        pictures.push({
          lines: markup.split('data-testid="dew-point-path"').length - 1,
          fills: markup.split('data-testid="dew-point-spread"').length - 1,
        });
      }
      return markup;
    };
  });
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

/** What the chart inside `scope` shows of the dew point. */
function shown(scope: Locator): Promise<Shown> {
  return scope.evaluate((root, hour) => {
    const lines = [...root.querySelectorAll('[data-testid="dew-point-path"]')];
    const span = (line: Element) =>
      Date.parse(line.getAttribute("data-end") ?? "") - Date.parse(line.getAttribute("data-start") ?? "");
    return {
      lines: lines.length,
      fills: root.querySelectorAll('[data-testid="dew-point-spread"]').length,
      hours: lines.reduce((sum, line) => sum + span(line), 0) / hour,
    };
  }, HOUR_MS);
}

/**
 * Expects the dew point line over the whole chart: its stretches end where the next begins, the first starts at the
 * beginning of the days shown at the latest and the last ends with the data.
 */
async function expectWholeChart(page: Page, chart: Shown) {
  const { start, end, gaps } = await embedded(page).evaluate((root) => {
    const svg = root.querySelector("svg.meteogram-svg-integrated")!;
    const pieces = [...root.querySelectorAll('[data-testid="dew-point-path"]')]
      .map((line) => [Date.parse(line.getAttribute("data-start")!), Date.parse(line.getAttribute("data-end")!)])
      .sort((a, b) => a[0]! - b[0]!);
    return {
      start: [Date.parse(svg.getAttribute("data-visible-start-time")!), pieces[0]![0]!],
      end: [Date.parse(svg.getAttribute("data-visible-end-time")!), pieces.at(-1)![1]!],
      gaps: pieces.slice(1).map((piece, i) => piece[0]! - pieces[i]![1]!),
    };
  });
  expect(chart.lines).toBeGreaterThan(0);
  // The data begin before the days shown: the line begins at their start at the latest, and it reaches the last hour
  // of data, which is the end of the days shown less one hour.
  expect(start[1]! - start[0]!).toBeLessThanOrEqual(0);
  expect(end[0]! - end[1]!).toBeLessThanOrEqual(HOUR_MS);
  // No gap of more than an hour between its stretches (one per model).
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(HOUR_MS);
}

/** Every forecast request for the weather (with the temperature) asks for the dew point as well. */
function expectDewPointFetched() {
  const weather = forecastRequests
    .map((url) => new URL(url).searchParams.get("hourly")?.split(",") ?? [])
    .filter((hourly) => hourly.includes("temperature_2m"));
  expect(weather.length).toBeGreaterThan(0);
  for (const hourly of weather) expect(hourly).toContain("dew_point_2m");
}

/** The dew point option in the open settings popup. */
const option = (settings: Locator) => settings.getByRole("radiogroup", { name: "Dew point" });

/** Expects the option and the hint in the meteogram section of the settings popup, `checked` chosen. */
async function expectOption(settings: Locator, checked: "Auto" | "On" | "Off") {
  const group = settings.locator('[data-settings="meteogram"]').getByRole("radiogroup", { name: "Dew point" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.locator("label")).toHaveText(["Auto", "On", "Off"]);
  await expect(group.getByRole("radio", { name: checked })).toBeChecked();
  await expect(group).toHaveAccessibleDescription(
    "Auto shows the dew point and the spread across the whole chart as soon as the air is nearly saturated " +
      "(spread up to 5\u00a0K) or muggy (dew point from 15\u00a0°C) at any time in the period shown and the " +
      "temperature (2\u00a0m) reaches 5\u00a0°C at least once in it, otherwise not at all. The dew point is always " +
      "loaded.",
  );
}

/** The dew point option stored in the browser; `null`: no choice. */
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("graupel.dewPoint"));

/** Pictures exported so far. */
const pictures = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pictures: { lines: number; fills: number }[] }).__pictures);

/** Pixels in the green of the dew point line (#059669 in the light theme) in the PNG on the clipboard; null without. */
function clipboardGreen(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes("image/png"));
    if (!item) return null;
    const bitmap = await createImageBitmap(await item.getType("image/png"));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let count = 0;
    // Far more green than red and more than blue: no other line or area of the chart has such a colour.
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 1]! > data[i]! + 60 && data[i + 1]! > data[i + 2]! + 25) count += 1;
    }
    return count;
  });
}

/**
 * Taps or clicks the copy button in `scope` (the card, the full-screen view or the phone's footer row) and returns what
 * the picture shows of the dew point: from the SVG the export rasterised, and the pixels in the dew point's green in
 * the PNG on the clipboard, read once the page says it copied it (a read while the write runs would cancel it).
 */
async function copyPicture(page: Page, scope: Locator, tap = false) {
  const button = scope.getByRole("button", { name: COPY });
  const status = scope.getByTestId("meteogram-image-feedback");
  // The message of a copy before is gone.
  await expect(status).toHaveText("");
  const before = (await pictures(page)).length;
  await page.evaluate(() => navigator.clipboard.writeText(""));
  if (tap) await button.tap();
  else await button.click();
  // Drawing the picture takes a while on a loaded machine.
  await expect(status).toHaveText("Meteogram copied", { timeout: 15_000 });
  const exported = await pictures(page);
  expect(exported).toHaveLength(before + 1);
  const pixels = await clipboardGreen(page);
  expect(pixels).not.toBeNull();
  return { ...exported[before]!, pixels: pixels! };
}

/** Expects a picture with the dew point line and spread (`shows`) or without. */
function expectPicture(picture: { lines: number; fills: number; pixels: number }, shows: boolean) {
  expect({ lines: picture.lines > 0, fills: picture.fills > 0 }).toEqual({ lines: shows, fills: shows });
  if (shows) expect(picture.pixels).toBeGreaterThan(500);
  else expect(picture.pixels).toBeLessThan(50);
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

  test("Off by default, Auto and On in the settings; the chart follows, Auto stays after a reload (REQ-621)", async ({
    page,
  }) => {
    await open(page);
    expectDewPointFetched();
    // Off without a choice: no line, no spread.
    await expect(embedded(page).getByTestId("dew-point-path")).toHaveCount(0);
    await expect(embedded(page).getByTestId("dew-point-spread")).toHaveCount(0);

    const settings = await openSettings(page);
    await expectOption(settings, "Off");
    expect(await stored(page)).toBeNull();

    // Auto, stored: the spread is small for six hours of yesterday and the temperature reaches 10 °C, so line and
    // spread cover all days, as with On.
    await option(settings).getByRole("radio", { name: "Auto" }).check();
    await expect.poll(() => stored(page)).toBe("auto");
    await expect(embedded(page).getByTestId("dew-point-path").first()).toBeVisible();
    const auto = await shown(embedded(page));
    expect(auto.lines).toBeGreaterThanOrEqual(1);
    expect(auto.fills).toBe(auto.lines);
    expect(auto.hours).toBeGreaterThan(5 * 24);
    await expectWholeChart(page, auto);

    // On: everywhere, the same as Auto here.
    await option(settings).getByRole("radio", { name: "On" }).check();
    await expect.poll(() => stored(page)).toBe("on");
    await expect.poll(() => shown(embedded(page))).toEqual(auto);

    // Off: nowhere, nothing stored.
    await option(settings).getByRole("radio", { name: "Off" }).check();
    await expect(embedded(page).getByTestId("dew-point-path")).toHaveCount(0);
    await expect(embedded(page).getByTestId("dew-point-spread")).toHaveCount(0);
    expect(await stored(page)).toBeNull();

    // Auto again, stored again.
    await option(settings).getByRole("radio", { name: "Auto" }).check();
    await expect.poll(() => shown(embedded(page))).toEqual(auto);
    expect(await stored(page)).toBe("auto");

    // Kept after a reload; the dew point is still fetched.
    forecastRequests = [];
    await page.reload();
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    expectDewPointFetched();
    await expect.poll(() => shown(embedded(page))).toEqual(auto);
    await expectOption(await openSettings(page), "Auto");
  });

  test("Auto shows nothing while every temperature stays below 5 °C, with warmer days all (REQ-621)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    // The cold variant until `cold` is cleared; registered after the fake of these tests, so it answers first.
    let cold = true;
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
      cold
        ? fakeForecast(route, { values: { temperature_2m: coldTemperature, dew_point_2m: coldDewPoint } })
        : route.fallback(),
    );
    await open(page);
    const settings = await openSettings(page);
    // On: the dew point is there, over all days.
    await option(settings).getByRole("radio", { name: "On" }).check();
    await expect(embedded(page).getByTestId("dew-point-path").first()).toBeAttached();
    const on = await shown(embedded(page));
    expect(on.fills).toBe(on.lines);
    expect(on.hours).toBeGreaterThan(5 * 24);

    // Auto: the spread is 1 K at every hour, but no temperature reaches 5 °C, so nothing.
    await option(settings).getByRole("radio", { name: "Auto" }).check();
    await expect(embedded(page).getByTestId("dew-point-path")).toHaveCount(0);
    await expect(embedded(page).getByTestId("dew-point-spread")).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();
    const card = page.getByTestId("meteogram-card");
    // Nor in the picture or the full-screen view.
    expectPicture(await copyPicture(page, card), false);
    await card.getByRole("button", { name: "Show the meteogram full screen" }).click();
    const view = fullscreen(page);
    await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    expect(await shown(view.getByTestId("meteogram-fullscreen"))).toEqual({ lines: 0, fills: 0, hours: 0 });
    await view.getByRole("button", { name: "Close" }).click();
    await expect(fullscreen(page)).toHaveCount(0);

    // Warmer days (up to 10 °C) with Auto still chosen: the whole chart.
    cold = false;
    await page.reload();
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    await expect(embedded(page).getByTestId("dew-point-path").first()).toBeVisible();
    const warm = await shown(embedded(page));
    expect(warm.fills).toBe(warm.lines);
    await expectWholeChart(page, warm);
    expect(await stored(page)).toBe("auto");
  });

  test("Auto shows nothing once the days shown leave out the hours of a small spread, On still all (REQ-605)", async ({
    page,
  }) => {
    // Auto chosen before.
    await page.addInitScript(() => localStorage.setItem("graupel.dewPoint", "auto"));
    await open(page);
    const all = await shown(embedded(page));
    expect(all.hours).toBeGreaterThan(5 * 24);
    // Nothing focused: the key after 0 removes yesterday from the days shown (REQ-533).
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("Minus");
    await expect(page.getByTestId("day-slider-marker")).toHaveAttribute("data-start", "1");
    await expect(embedded(page).getByTestId("dew-point-path")).toHaveCount(0);
    await expect(embedded(page).getByTestId("dew-point-spread")).toHaveCount(0);

    // On: still the line, over the days shown.
    const settings = await openSettings(page);
    await option(settings).getByRole("radio", { name: "On" }).check();
    await expect(embedded(page).getByTestId("dew-point-path").first()).toBeAttached();
    const on = await shown(embedded(page));
    expect(on.fills).toBe(on.lines);
    await expectWholeChart(page, on);

    // Auto again: nothing; with yesterday back, all days as at the start.
    await option(settings).getByRole("radio", { name: "Auto" }).check();
    await expect(embedded(page).getByTestId("dew-point-path")).toHaveCount(0);
    await settings.getByRole("button", { name: "Close" }).click();
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("Minus");
    await expect(page.getByTestId("day-slider-marker")).toHaveAttribute("data-start", "0");
    await expect.poll(() => shown(embedded(page))).toEqual(all);
  });

  test("the full-screen view and the copied picture follow the option", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);
    const card = page.getByTestId("meteogram-card");

    for (const mode of ["On", "Off", "Auto"] as const) {
      const settings = await openSettings(page);
      await option(settings).getByRole("radio", { name: mode }).check();
      await settings.getByRole("button", { name: "Close" }).click();
      const chart = await shown(embedded(page));
      if (mode === "Off") expect(chart).toEqual({ lines: 0, fills: 0, hours: 0 });
      else expect(chart.lines).toBeGreaterThanOrEqual(1);

      // The picture of the card.
      expectPicture(await copyPicture(page, card), mode !== "Off");

      // The full-screen view and its picture.
      await card.getByRole("button", { name: "Show the meteogram full screen" }).click();
      const view = fullscreen(page);
      await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
      const big = await shown(view.getByTestId("meteogram-fullscreen"));
      expect(big.lines).toBe(chart.lines);
      expect(big.fills).toBe(chart.fills);
      expect(big.hours).toBeCloseTo(chart.hours, 3);
      expectPicture(await copyPicture(page, view), mode !== "Off");
      await view.getByRole("button", { name: "Close" }).click();
      await expect(fullscreen(page)).toHaveCount(0);
    }
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

  async function openSettings(page: Page) {
    await page.locator('[data-region="location"]').getByRole("button", { name: "Menu" }).tap();
    await page.getByTestId("phone-menu-panel").getByRole("button", { name: "Settings" }).tap();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    // The option is in the tab Meteogram (REQ-686).
    await settings.getByRole("tab", { name: "Meteogram" }).tap();
    return settings;
  }

  test("the option in the settings from the menu; chart, full-screen view and picture follow it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);
    expectDewPointFetched();
    // Off without a choice (REQ-621).
    await expect(embedded(page).getByTestId("dew-point-path")).toHaveCount(0);
    await expect(embedded(page).getByTestId("dew-point-spread")).toHaveCount(0);
    const footer = page.getByRole("contentinfo");

    let settings = await openSettings(page);
    await expectOption(settings, "Off");
    // The option fits the phone's screen.
    const box = (await option(settings).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PORTRAIT.width);

    let auto: Shown | null = null;
    for (const mode of ["Auto", "On", "Off"] as const) {
      settings = page.getByRole("dialog", { name: "Settings" });
      if (!(await settings.isVisible())) settings = await openSettings(page);
      await option(settings).getByRole("radio", { name: mode }).tap();
      await expect(option(settings).getByRole("radio", { name: mode })).toBeChecked();
      await settings.getByRole("button", { name: "Close" }).tap();
      await expect(settings).toHaveCount(0);

      if (mode !== "Off") await expect(embedded(page).getByTestId("dew-point-path").first()).toBeAttached();
      const chart = await shown(embedded(page));
      // Auto and On alike over the whole chart: the spread is small for six hours of yesterday.
      if (mode === "Off") expect(chart).toEqual({ lines: 0, fills: 0, hours: 0 });
      else if (auto) expect(chart).toEqual(auto);
      else {
        auto = chart;
        expect(auto.lines).toBeGreaterThanOrEqual(1);
        expect(auto.fills).toBe(auto.lines);
        expect(auto.hours).toBeGreaterThan(5 * 24);
        await expectWholeChart(page, auto);
      }

      // The picture from the footer row.
      expectPicture(await copyPicture(page, footer, true), mode !== "Off");

      // Turned to landscape, the full-screen view.
      await turn(page, LANDSCAPE);
      const view = fullscreen(page);
      await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
      const big = await shown(view.getByTestId("meteogram-fullscreen"));
      expect(big.lines).toBe(chart.lines);
      expect(big.fills).toBe(chart.fills);
      expect(big.hours).toBeCloseTo(chart.hours, 3);
      await turn(page, PORTRAIT);
      await expect(fullscreen(page)).toHaveCount(0);
    }
  });
});
