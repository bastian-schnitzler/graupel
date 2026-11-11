// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Relative humidity in the meteogram (REQ-650) in a real browser, on the desktop and on a phone: the option On or Off
 * in the settings (section Meteogram, directly below the dew point), Off by default, kept after a reload. With it on,
 * the chart shows the humidity as a line in the temperature area with its own axis right of the plot, "100 %" at the
 * top and "0 %" at the bottom; the chart on the page, the full-screen view and the copied picture follow the option.
 * The relative humidity is fetched with every forecast, also with the option off.
 *
 * The fake forecast of these tests has its own relative humidity, between 40 and 90 %. The picture is checked in the
 * SVG the export rasterises (recorded from `XMLSerializer`); that a PNG reached the clipboard is checked as well.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const COPY = "Copy the meteogram as a picture";

/** Relative humidity of these tests (%) at an hour of an answer. */
const humidity = (index: number) => Math.round(65 + 25 * Math.sin(index / 7));

/** What a chart (or a picture's SVG) shows of the relative humidity. */
interface Shown {
  /** Line pieces. */
  lines: number;
  /** Labels "100 %" and "0 %" in the temperature area. */
  max: number;
  min: number;
}

const HIDDEN: Shown = { lines: 0, max: 0, min: 0 };

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
    return fakeForecast(route, { values: { relative_humidity_2m: humidity } });
  });
  // The SVG of every exported picture, reduced to what it shows of the relative humidity.
  await page.addInitScript(() => {
    const pictures: { lines: number; max: number; min: number }[] = [];
    Object.assign(window, { __pictures: pictures });
    const serialize = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function (this: XMLSerializer, node: Node) {
      const markup = serialize.call(this, node);
      if (markup.startsWith("<svg")) {
        const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
        const texts = [...doc.querySelectorAll('[data-area-id="temp"] text:not([data-halo])')].map((text) =>
          (text.textContent ?? "").replace(/\s/g, ""),
        );
        pictures.push({
          lines: doc.querySelectorAll('[data-testid="relative-humidity-path"]').length,
          max: texts.filter((text) => text === "100%").length,
          min: texts.filter((text) => text === "0%").length,
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

/** What the chart inside `scope` shows of the relative humidity. */
function shown(scope: Locator): Promise<Shown> {
  return scope.evaluate((root) => {
    const texts = [...root.querySelectorAll('[data-area-id="temp"] text:not([data-halo])')].map((text) =>
      (text.textContent ?? "").replace(/\s/g, ""),
    );
    return {
      lines: root.querySelectorAll('[data-testid="relative-humidity-path"]').length,
      max: texts.filter((text) => text === "100%").length,
      min: texts.filter((text) => text === "0%").length,
    };
  });
}

/**
 * Expects the humidity's axis at the right of the temperature area of the chart inside `scope`: "100 %" at its top
 * and "0 %" below it, in the right quarter of the chart, the line between their heights. `beside`: the labels stand
 * right of the plot, beyond where the line ends (on a phone they stand over the plot's right edge, REQ-547).
 */
async function expectRightAxis(scope: Locator, beside = true) {
  const place = await scope.evaluate((root) => {
    const svg = root.querySelector("svg")!.getBoundingClientRect();
    const area = root.querySelector('[data-area-id="temp"]')!;
    const find = (wanted: string) =>
      [...area.querySelectorAll("text")].find((text) => (text.textContent ?? "").replace(/\s/g, "") === wanted)!;
    const box = (element: Element) => element.getBoundingClientRect();
    const lines = [...area.querySelectorAll('[data-testid="relative-humidity-path"]')].map(box);
    return {
      quarter: svg.left + svg.width * 0.75,
      max: box(find("100%")),
      min: box(find("0%")),
      lineRight: Math.max(...lines.map((line) => line.right)),
      lineTop: Math.min(...lines.map((line) => line.top)),
      lineBottom: Math.max(...lines.map((line) => line.bottom)),
    };
  });
  expect(place.max.left).toBeGreaterThan(place.quarter);
  expect(place.min.left).toBeGreaterThan(place.quarter);
  if (beside) {
    expect(place.max.left).toBeGreaterThanOrEqual(place.lineRight - 1);
    expect(place.min.left).toBeGreaterThanOrEqual(place.lineRight - 1);
  }
  expect(place.max.bottom).toBeLessThan(place.min.top);
  // The line (40 to 90 %) runs between the two labels' heights.
  expect(place.lineTop).toBeGreaterThan(place.max.top);
  expect(place.lineBottom).toBeLessThan(place.min.bottom);
}

/** Every forecast request for the weather (with the temperature) asks for the relative humidity as well. */
function expectHumidityFetched() {
  const weather = forecastRequests
    .map((url) => new URL(url).searchParams.get("hourly")?.split(",") ?? [])
    .filter((hourly) => hourly.includes("temperature_2m"));
  expect(weather.length).toBeGreaterThan(0);
  for (const hourly of weather) expect(hourly).toContain("relative_humidity_2m");
}

/** The relative humidity option in the open settings popup. */
const option = (settings: Locator) => settings.getByRole("radiogroup", { name: "Relative humidity" });

/** Expects the option in the meteogram section of the settings popup, directly below the dew point, `checked` chosen. */
async function expectOption(settings: Locator, checked: "On" | "Off") {
  const section = settings.locator('[data-settings="meteogram"]');
  const group = section.getByRole("radiogroup", { name: "Relative humidity" });
  await expect(group.getByRole("radio")).toHaveCount(2);
  await expect(group.locator("label")).toHaveText(["On", "Off"]);
  await expect(group.getByRole("radio", { name: checked })).toBeChecked();
  // Below the dew point's hint, the next field of the section.
  const dewPoint = section.getByRole("radiogroup", { name: "Dew point" });
  const hintId = await dewPoint.getAttribute("aria-describedby");
  const next = await group.evaluate(
    (element, id) => element.closest(".settings__field") === document.getElementById(id!)?.nextElementSibling,
    hintId,
  );
  expect(next).toBe(true);
  const [dew, humid] = [(await dewPoint.boundingBox())!, (await group.boundingBox())!];
  expect(humid.y).toBeGreaterThan(dew.y + dew.height);
}

/** The relative humidity option stored in the browser; `null`: no choice. */
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("graupel.relativeHumidity"));

/** Pictures exported so far. */
const pictures = (page: Page) => page.evaluate(() => (window as unknown as { __pictures: Shown[] }).__pictures);

/** Whether a PNG is on the clipboard. */
const clipboardHasPng = (page: Page) =>
  page.evaluate(async () => (await navigator.clipboard.read()).some((item) => item.types.includes("image/png")));

/**
 * Taps or clicks the copy button in `scope` (the card, the full-screen view or the phone's footer row) and returns what
 * the picture shows of the relative humidity, from the SVG the export rasterised, once the page says it copied it.
 */
async function copyPicture(page: Page, scope: Locator, tap = false): Promise<Shown> {
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
  expect(await clipboardHasPng(page)).toBe(true);
  return exported[before]!;
}

/** Expects a chart or picture with the line and the labels "100 %" and "0 %" (`shows`) or without any of them. */
function expectShown(chart: Shown, shows: boolean) {
  if (shows) {
    expect(chart.lines).toBeGreaterThanOrEqual(1);
    expect({ max: chart.max, min: chart.min }).toEqual({ max: 1, min: 1 });
  } else expect(chart).toEqual(HIDDEN);
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

  test("Off by default, On in the settings shows line and axis; kept after a reload", async ({ page }) => {
    await open(page);
    // Fetched with the option off.
    expectHumidityFetched();
    expect(await shown(embedded(page))).toEqual(HIDDEN);

    const settings = await openSettings(page);
    await expectOption(settings, "Off");
    expect(await stored(page)).toBeNull();

    // On, stored: the line and "100 %" and "0 %" right of the temperature area.
    await option(settings).getByRole("radio", { name: "On" }).check();
    await expect.poll(() => stored(page)).toBe("on");
    await expect(embedded(page).getByTestId("relative-humidity-path").first()).toBeVisible();
    expectShown(await shown(embedded(page)), true);
    await expectRightAxis(embedded(page));

    // Off: neither, nothing stored.
    await option(settings).getByRole("radio", { name: "Off" }).check();
    await expect(embedded(page).getByTestId("relative-humidity-path")).toHaveCount(0);
    expect(await shown(embedded(page))).toEqual(HIDDEN);
    expect(await stored(page)).toBeNull();

    // On again, kept after a reload; the humidity is still fetched.
    await option(settings).getByRole("radio", { name: "On" }).check();
    await expect.poll(() => stored(page)).toBe("on");
    forecastRequests = [];
    await page.reload();
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    expectHumidityFetched();
    await expect(embedded(page).getByTestId("relative-humidity-path").first()).toBeVisible();
    expectShown(await shown(embedded(page)), true);
    await expectOption(await openSettings(page), "On");
  });

  test("the full-screen view and the copied picture follow the option", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page);
    const card = page.getByTestId("meteogram-card");

    for (const mode of ["Off", "On", "Off"] as const) {
      const settings = await openSettings(page);
      await option(settings).getByRole("radio", { name: mode }).check();
      await settings.getByRole("button", { name: "Close" }).click();
      if (mode === "On") await expect(embedded(page).getByTestId("relative-humidity-path").first()).toBeVisible();
      else await expect(embedded(page).getByTestId("relative-humidity-path")).toHaveCount(0);
      const chart = await shown(embedded(page));
      expectShown(chart, mode === "On");

      // The picture of the card.
      expectShown(await copyPicture(page, card), mode === "On");

      // The full-screen view and its picture.
      await card.getByRole("button", { name: "Show the meteogram full screen" }).click();
      const view = fullscreen(page);
      await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
      const big = view.getByTestId("meteogram-fullscreen");
      expect(await shown(big)).toEqual(chart);
      if (mode === "On") await expectRightAxis(big);
      expectShown(await copyPicture(page, view), mode === "On");
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
    expectHumidityFetched();
    expect(await shown(embedded(page))).toEqual(HIDDEN);
    const footer = page.getByRole("contentinfo");

    let settings = await openSettings(page);
    await expectOption(settings, "Off");
    // The option fits the phone's screen.
    const box = (await option(settings).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PORTRAIT.width);

    for (const mode of ["On", "Off"] as const) {
      settings = page.getByRole("dialog", { name: "Settings" });
      if (!(await settings.isVisible())) settings = await openSettings(page);
      await option(settings).getByRole("radio", { name: mode }).tap();
      await expect(option(settings).getByRole("radio", { name: mode })).toBeChecked();
      await settings.getByRole("button", { name: "Close" }).tap();
      await expect(settings).toHaveCount(0);

      if (mode === "On") await expect(embedded(page).getByTestId("relative-humidity-path").first()).toBeAttached();
      const chart = await shown(embedded(page));
      expectShown(chart, mode === "On");

      // The picture from the footer row.
      expectShown(await copyPicture(page, footer, true), mode === "On");

      // Turned to landscape, the full-screen view.
      await turn(page, LANDSCAPE);
      const view = fullscreen(page);
      await expect(view.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
      const big = view.getByTestId("meteogram-fullscreen");
      expectShown(await shown(big), mode === "On");
      if (mode === "On") await expectRightAxis(big, false);
      await turn(page, PORTRAIT);
      await expect(fullscreen(page)).toHaveCount(0);
    }
  });
});
