// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Dew point, dew point spread and relative humidity in the meteogram's popup (REQ-671, the meteogram's REQ-676): with
 * the dew point and the relative humidity "On" in the settings the popup on the desktop and the side bar of the
 * full-screen view on a phone show both and the spread (temperature minus dew point) in the temperature group after
 * "Feels like", in the page's language, the side bar with short labels (REQ-557) that keep every row on one line
 * (REQ-588); without them none of these rows.
 *
 * The fake forecast of these tests has its own dew point, 1 to 3.1 K below the temperature, and its own relative
 * humidity, so every row has a value of its own, and wind values rounded to tenths as Open-Meteo sends them.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Friday, 30 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 30, 11);
const PORTRAIT = { width: 375, height: 812 };
const LANDSCAPE = { width: 844, height: 390 };
/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
const LANGUAGES = ["de", "en", "fr", "it", "nl", "cs", "da", "sl"] as const;

/** Temperature of the fake forecast at an hour of an answer (openMeteo.ts). */
const temperature = (index: number) => Math.round((4 + 6 * Math.sin(index / 5)) * 10) / 10;
/** Dew point of these tests: 1 to 3.1 K below the temperature. */
const dewPoint = (index: number) => Math.round((temperature(index) - 1 - (index % 4) * 0.7) * 10) / 10;
/** Relative humidity of these tests, 60 to 94 %. */
const humidity = (index: number) => 60 + (index % 35);
/** Wind and gusts rounded as Open-Meteo sends them (the fake's own are not), so the labels set the side bar's width. */
const wind = (index: number) => Math.round((15 + 8 * Math.sin(index / 5)) * 10) / 10;
const gusts = (index: number) => Math.round((30 + 10 * Math.sin(index / 5)) * 10) / 10;

/** The rows' labels in the popup (desktop) and the side bar (phone): temperature, dew point, spread, humidity. */
const LABELS = {
  de: {
    popup: ["Temperatur:", "Gefühlt:", "Taupunkt:", "Taupunktdifferenz:", "Relative Luftfeuchte:"],
    side: ["Temperatur:", "Gefühlt:", "Taupunkt:", "Spread:", "Rel. Feuchte:"],
  },
  en: {
    popup: ["Temperature:", "Feels like:", "Dew point:", "Dew point spread:", "Relative humidity:"],
    side: ["Temperature:", "Feels like:", "Dew point:", "Spread:", "Rel. humidity:"],
  },
} as const;

const SETTINGS = {
  de: {
    settings: "Einstellungen",
    meteogram: "Meteogramm",
    dewPoint: "Taupunkt",
    humidity: "Relative Luftfeuchte",
    on: "An",
    off: "Aus",
  },
  en: {
    settings: "Settings",
    meteogram: "Meteogram",
    dewPoint: "Dew point",
    humidity: "Relative humidity",
    on: "On",
    off: "Off",
  },
} as const;

const ROWS = ["tooltip-row-dew_point", "tooltip-row-dew_point_spread", "tooltip-row-relative_humidity"];

test.use({ timezoneId: "UTC", locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    fakeForecast(route, {
      now: FIXED_NOW,
      values: {
        dew_point_2m: dewPoint,
        relative_humidity_2m: humidity,
        wind_speed_10m: wind,
        wind_gusts_10m: gusts,
      },
    }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Opens the page in `language`, with the dew point and the relative humidity stored as given (none: no choice). */
async function open(page: Page, language: string, stored?: { dewPoint: string; relativeHumidity: string }) {
  await page.goto(APP);
  await page.evaluate(
    ({ language, stored }) => {
      localStorage.setItem("graupel.language", language);
      localStorage.removeItem("graupel.dewPoint");
      localStorage.removeItem("graupel.relativeHumidity");
      if (stored) {
        localStorage.setItem("graupel.dewPoint", stored.dewPoint);
        localStorage.setItem("graupel.relativeHumidity", stored.relativeHumidity);
      }
    },
    { language, stored },
  );
  await page.reload();
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

/** Label, value and test id of every row of a popup or side bar. */
const rows = (tooltip: Locator) =>
  tooltip.locator(".tooltip-row").evaluateAll((elements) =>
    elements.map((row) => ({
      id: row.getAttribute("data-testid"),
      label: row.querySelector(".label")?.textContent ?? "",
      value: row.querySelector(".val")?.textContent ?? "",
    })),
  );

/** The number of a value such as "4.2 °C", "−1,3 °C" or "73 %". */
const number = (value: string) =>
  Number(
    value
      .replace("−", "-")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );

/**
 * Expects the rows of dew point, spread and relative humidity after temperature and "Feels like", with `labels`; the
 * spread is the temperature minus the dew point, the humidity a whole number in per cent.
 */
async function expectHumidRows(tooltip: Locator, labels: readonly string[]) {
  for (const id of ROWS) await expect(tooltip.getByTestId(id)).toBeVisible();
  const shown = await rows(tooltip);
  expect(shown.slice(0, 5).map(({ label }) => label)).toEqual(labels);
  expect(shown.slice(2, 5).map(({ id }) => id)).toEqual(ROWS);
  const [temp, , dew, spread, humid] = shown.map(({ value }) => value);
  expect(temp).toMatch(/°C$/u);
  expect(dew).toMatch(/°C$/u);
  expect(spread).toMatch(/°C$/u);
  expect(humid).toMatch(/^\d+ %$/u);
  expect(number(spread!)).toBeCloseTo(number(temp!) - number(dew!), 5);
  expect(number(spread!)).toBeGreaterThanOrEqual(1);
  expect(number(humid!)).toBeGreaterThanOrEqual(60);
  expect(number(humid!)).toBeLessThanOrEqual(94);
}

async function expectNoHumidRows(tooltip: Locator) {
  await expect(tooltip.locator(".tooltip-row").first()).toBeVisible();
  for (const id of ROWS) await expect(tooltip.getByTestId(id)).toHaveCount(0);
}

test.describe("desktop popup", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

  /** Moves the mouse over the chart, a little elsewhere each time, so the popup shows the options in force. */
  async function hover(page: Page, step = 0) {
    const box = (await chart(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 3 + step * 7, box.y + box.height / 4);
    const tooltip = page.getByTestId("meteogram-tooltip");
    await expect(tooltip).toBeVisible();
    return tooltip;
  }

  for (const language of ["de", "en"] as const) {
    test(`${language}: On in the settings shows dew point, spread and humidity, Off none of them (REQ-671)`, async ({
      page,
    }) => {
      const texts = SETTINGS[language];
      await open(page, language);
      // Off by default: none of the rows.
      await expectNoHumidRows(await hover(page));

      const openSettings = async () => {
        await page.locator('[data-region="header"]').getByRole("button", { name: texts.settings }).click();
        const settings = page.getByRole("dialog", { name: texts.settings });
        await expect(settings).toBeVisible();
        // The options are in the tab Meteogram (REQ-686).
        await settings.getByRole("tab", { name: texts.meteogram }).click();
        return settings;
      };
      const choose = async (option: string, choice: string) => {
        const settings = await openSettings();
        await settings.getByRole("radiogroup", { name: option }).getByRole("radio", { name: choice }).check();
        await page.keyboard.press("Escape");
        await expect(settings).toBeHidden();
      };

      // Both On: the three rows in the temperature group.
      await choose(texts.dewPoint, texts.on);
      await choose(texts.humidity, texts.on);
      await expectHumidRows(await hover(page, 1), LABELS[language].popup);

      // The dew point alone: its row and the spread, no humidity.
      await choose(texts.humidity, texts.off);
      let tooltip = await hover(page, 2);
      await expect(tooltip.getByTestId("tooltip-row-dew_point")).toBeVisible();
      await expect(tooltip.getByTestId("tooltip-row-dew_point_spread")).toBeVisible();
      await expect(tooltip.getByTestId("tooltip-row-relative_humidity")).toHaveCount(0);

      // The humidity alone: its row, no dew point, no spread.
      await choose(texts.dewPoint, texts.off);
      await choose(texts.humidity, texts.on);
      tooltip = await hover(page, 3);
      await expect(tooltip.getByTestId("tooltip-row-relative_humidity")).toBeVisible();
      await expect(tooltip.getByTestId("tooltip-row-dew_point")).toHaveCount(0);
      await expect(tooltip.getByTestId("tooltip-row-dew_point_spread")).toHaveCount(0);

      // Both Off again: none of the rows.
      await choose(texts.humidity, texts.off);
      await expectNoHumidRows(await hover(page, 4));
    });
  }

  test("every language: the three rows have its own labels, each on one line with its value (REQ-671)", async ({
    page,
  }) => {
    const english = new Set(["Dew Point:", "Dew Point Spread:", "Rel. Humidity:"]);
    for (const language of LANGUAGES) {
      await open(page, language, { dewPoint: "on", relativeHumidity: "on" });
      const tooltip = await hover(page);
      for (const id of ROWS) await expect(tooltip.getByTestId(id), language).toBeVisible();
      const shown = (await rows(tooltip)).filter(({ id }) => ROWS.includes(id ?? ""));
      for (const { label } of shown) expect(english.has(label), `${language} ${label}`).toBe(false);
      const lines = await tooltip.evaluate((el) =>
        [...el.querySelectorAll('[data-testid^="tooltip-row-"]')].flatMap((row) =>
          [row.querySelector(".label")!, row.querySelector(".val")!].map((part) => {
            const range = document.createRange();
            range.selectNodeContents(part);
            return new Set(
              [...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)),
            ).size;
          }),
        ),
      );
      for (const count of lines) expect(count, language).toBe(1);
    }
  });
});

/** Turns the phone and waits until the page has seen it (meteogram-fullscreen.spec.ts). */
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

/**
 * Whether the side bar fits (REQ-584, REQ-588): every row's label and value on one line side by side, all text inside
 * the padding, the bar at most a quarter of the screen wide.
 */
const sideBarFit = (tooltip: Locator) =>
  tooltip.evaluate((el: HTMLElement) => {
    const lines = (part: Element | null) => {
      if (!part) return 0;
      const range = document.createRange();
      range.selectNodeContents(part);
      return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)))
        .size;
    };
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const content = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const inner = {
      right: box.left + el.clientLeft + el.clientWidth - parseFloat(style.paddingRight),
      bottom: box.top + el.clientTop + el.clientHeight - parseFloat(style.paddingBottom),
    };
    return {
      width: box.width,
      overRight: Math.max(...content.map((part) => part.right)) - inner.right,
      overBottom: Math.max(...content.map((part) => part.bottom)) - inner.bottom,
      wrapped: [...el.querySelectorAll(".tooltip-row")]
        .filter((row) => {
          const label = row.querySelector(".label")!.getBoundingClientRect();
          const value = row.querySelector(".val")!.getBoundingClientRect();
          return (
            Math.max(lines(row.querySelector(".label")), lines(row.querySelector(".val"))) > 1 ||
            value.left <= label.right ||
            value.top >= label.bottom
          );
        })
        .map((row) => row.textContent),
    };
  });

test.describe("phone side bar", () => {
  test.use({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  ownDevice();

  /** Opens the full-screen view by turning the phone and touches the chart; returns the side bar. */
  async function sideBar(page: Page) {
    await turn(page, LANDSCAPE);
    const dialog = page.locator('[data-testid="meteogram-fullscreen"]');
    const big = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    await expect(big).toBeVisible();
    const box = (await big.boundingBox())!;
    await touch(page, box.x + box.width / 4, box.y + box.height / 3);
    const tooltip = dialog.getByTestId("meteogram-tooltip");
    await expect(tooltip).toBeVisible();
    return tooltip;
  }

  for (const language of ["de", "en"] as const) {
    test(`${language}: with dew point and humidity On the side bar shows both and the spread, short (REQ-671, REQ-557)`, async ({
      page,
    }) => {
      await open(page, language, { dewPoint: "on", relativeHumidity: "on" });
      const tooltip = await sideBar(page);
      await expectHumidRows(tooltip, LABELS[language].side);
      const fit = await sideBarFit(tooltip);
      expect(fit.wrapped).toEqual([]);
      expect(fit.overRight).toBeLessThanOrEqual(0.5);
      expect(fit.overBottom).toBeLessThanOrEqual(0.5);
      expect(fit.width).toBeLessThanOrEqual(LANDSCAPE.width / 4 + 0.5);
    });

    test(`${language}: without them the side bar has none of these rows (REQ-671)`, async ({ page }) => {
      await open(page, language);
      await expectNoHumidRows(await sideBar(page));
    });
  }

  test("every language: the side bar with the three rows does not overflow (REQ-671, REQ-584, REQ-588)", async ({
    page,
  }) => {
    for (const language of LANGUAGES) {
      await page.setViewportSize(PORTRAIT);
      await open(page, language, { dewPoint: "on", relativeHumidity: "on" });
      const tooltip = await sideBar(page);
      for (const id of ROWS) await expect(tooltip.getByTestId(id), language).toBeVisible();
      const fit = await sideBarFit(tooltip);
      expect(fit.wrapped, language).toEqual([]);
      expect(fit.overRight, language).toBeLessThanOrEqual(0.5);
      expect(fit.overBottom, language).toBeLessThanOrEqual(0.5);
      expect(fit.width, language).toBeLessThanOrEqual(LANDSCAPE.width / 4 + 0.5);
    }
  });
});
