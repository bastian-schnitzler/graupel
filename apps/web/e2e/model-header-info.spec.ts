// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Info button in the meteogram's model header (REQ-643): while the weather chain is hidden, each model header has a
 * small info button right of the model's name that opens the same info popover as the chain card's; a model split
 * into runs has it only in its widest part, and where it does not fit beside the name there is none. On the desktop
 * and on a phone, in the card and on the whole screen; it follows the day selection and sideways scrolling. With the
 * weather chain shown there are no buttons in the meteogram, and the copied picture has none.
 *
 * The fake Open-Meteo names a run 6 hours old that ends 24 hours ahead in every model's `meta.json`; the Single Runs
 * API answers the older run with data, so every model reaching further is split into runs (as model-header-runs).
 */
import type { Route } from "@playwright/test";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const HOUR_MS = 3_600_000;
/** Fixed time: Tuesday, 3 November 2026, 13:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 13);
const NEWEST_RUN_MS = Math.floor((FIXED_NOW - 6 * HOUR_MS) / (6 * HOUR_MS)) * 6 * HOUR_MS;

test.use({ timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/data/**", fakeMeta);
  await page.route("https://single-runs-api.open-meteo.com/**", fakeSingleRun);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

function fakeMeta(route: Route) {
  if (route.request().url().includes("ensemble")) return route.fulfill({ json: {} });
  return route.fulfill({
    json: {
      last_run_initialisation_time: NEWEST_RUN_MS / 1000,
      last_run_availability_time: NEWEST_RUN_MS / 1000 + 3 * 3600,
      data_end_time: (Math.floor(FIXED_NOW / HOUR_MS) * HOUR_MS + 24 * HOUR_MS) / 1000,
      update_interval_seconds: 6 * 3600,
      temporal_resolution_seconds: 3600,
    },
  });
}

/** A run older than the newest covers everything it is asked for; newer runs have no data yet. */
function fakeSingleRun(route: Route) {
  const params = new URL(route.request().url()).searchParams;
  const run = Date.parse(`${params.get("run")}Z`);
  const hours = run < NEWEST_RUN_MS ? Number(params.get("forecast_hours") ?? 0) : 0;
  const time = Array.from({ length: hours }, (_, i) => new Date(run + i * HOUR_MS).toISOString().slice(0, 16));
  return route.fulfill({ json: { timezone: "GMT", hourly: { time, temperature_2m: time.map(() => 5) } } });
}

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const infoButtons = (scope: Locator) => scope.getByTestId("model-header-info-button");

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface HeaderInfo {
  segments: { model: string; width: number; shape: Rect; label: Rect }[];
  buttons: { model: string; rect: Rect }[];
}

/** The model headers of the chart in `scope` and the info buttons over it, measured on the page. */
function headerInfo(scope: Locator): Promise<HeaderInfo> {
  return scope.evaluate((root) => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    return {
      segments: [...root.querySelectorAll('[data-testid="model-label-segment"]')].map((group) => ({
        model: group.getAttribute("data-model") ?? "",
        width: Number(group.getAttribute("data-end-x")) - Number(group.getAttribute("data-start-x")),
        shape: rect(group.querySelector('[data-testid="model-header-shape"]')!),
        label: rect(group.querySelector('[data-testid="model-header-label"]')!),
      })),
      buttons: [...root.querySelectorAll(".model-header-info__item")].map((item) => ({
        model: item.getAttribute("data-model") ?? "",
        rect: rect(item.querySelector("button")!),
      })),
    };
  });
}

/**
 * Checks one button per model at most, each in the model's widest part, right of its name and inside its header; and
 * a button for every model whose widest part has room for one. Returns the models that have a button.
 */
async function expectButtonsInWidestParts(scope: Locator, minModels = 2): Promise<string[]> {
  // The buttons follow the chart in the next frame.
  await scope.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { segments, buttons } = await headerInfo(scope);
  const models = [...new Set(segments.map((segment) => segment.model))];
  expect(models.length).toBeGreaterThanOrEqual(minModels);
  expect(new Set(buttons.map((button) => button.model)).size).toBe(buttons.length);
  for (const model of models) {
    const parts = segments.filter((segment) => segment.model === model);
    const widest = parts.reduce((best, part) => (part.width > best.width ? part : best));
    const button = buttons.find((item) => item.model === model);
    const room = widest.shape.right - widest.label.right;
    if (!button) {
      // None only where it does not fit beside the name.
      expect(room, model).toBeLessThan(30);
      continue;
    }
    const { rect } = button;
    expect(rect.left, model).toBeGreaterThanOrEqual(widest.label.right);
    expect(rect.right, model).toBeLessThanOrEqual(widest.shape.right + 0.5);
    expect(rect.top, model).toBeGreaterThanOrEqual(widest.shape.top - 0.5);
    expect(rect.bottom, model).toBeLessThanOrEqual(widest.shape.bottom + 0.5);
    // Close to the name, as in the mockup.
    expect(rect.left - widest.label.right, model).toBeLessThan(8);
  }
  expect(buttons.length).toBeGreaterThan(0);
  return buttons.map((button) => button.model);
}

/** Starts the page; `chain`: with the weather chain card shown (the stored choice of an earlier visit). */
async function open(page: Page, chain = false) {
  if (chain) await page.addInitScript(() => window.localStorage.setItem("graupel.showWeatherChain", "true"));
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  // Wait until the split runs are drawn.
  await expect
    .poll(async () => {
      const { segments } = await headerInfo(meteogram(page));
      return segments.length > new Set(segments.map((segment) => segment.model)).size;
    })
    .toBe(true);
}

/** Opens the info popover (on a phone the dialog) of `button` and checks it names the model; Escape closes it again. */
async function expectPopover(page: Page, button: Locator, tap = false) {
  const name = (await button.getAttribute("aria-label"))!.replace(/^Details for /, "");
  if (tap) await button.tap();
  else await button.click();
  const popover = page.getByTestId("model-info-popover");
  await expect(popover).toHaveCount(1);
  await expect(popover).toBeVisible();
  // The title atop the popover, or in the heading row of the phone's dialog (REQ-719).
  await expect(popover.getByTestId("model-info-title").locator("strong")).toHaveText(name);
  // With the forecast loaded: hours left from now / catalogue horizon (REQ-687).
  await expect(popover).toContainText("Max (from now)");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // The popover stands inside the window.
  const box = (await popover.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("chain hidden: one info button per model in its widest part, opening the model's popover", async ({
    page,
  }, testInfo) => {
    await open(page);
    const models = await expectButtonsInWidestParts(meteogram(page));
    expect(models.length).toBeGreaterThan(1);
    // Same popover as on a chain card.
    await expectPopover(page, infoButtons(meteogram(page)).first());
    // A click on the button neither opens the full-screen view nor leaves anything open.
    await infoButtons(meteogram(page)).first().dblclick();
    await expect(fullscreen(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await meteogram(page).screenshot({ path: testInfo.outputPath("model-header-info-desktop.png") });

    // It follows the day selection: 2 shows yesterday, today and tomorrow (REQ-533).
    const chart = meteogram(page).locator("svg.meteogram-svg-integrated");
    const before = await chart.getAttribute("data-visible-end-time");
    await page.keyboard.press("Digit2");
    await expect.poll(() => chart.getAttribute("data-visible-end-time")).not.toBe(before);
    await expectButtonsInWidestParts(meteogram(page), 1);
    await meteogram(page).screenshot({ path: testInfo.outputPath("model-header-info-desktop-day.png") });
  });

  test("on the whole screen as well", async ({ page }, testInfo) => {
    await open(page);
    await page.getByRole("button", { name: "Show the meteogram full screen" }).click();
    const dialog = fullscreen(page);
    await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    await expectButtonsInWidestParts(dialog);
    const button = infoButtons(dialog).last();
    await button.click();
    await expect(page.getByTestId("model-info-popover")).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath("model-header-info-fullscreen.png") });
    // Escape closes the popover first, the view stays open; a second Escape closes the view.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("model-info-popover")).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(button).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(fullscreen(page)).toHaveCount(0);
  });

  test("chain shown: no info buttons in the meteogram", async ({ page }) => {
    await open(page, true);
    await expect(page.locator('[data-region="model-chain"]').getByRole("button", { name: /^Details for / }).first())
      .toBeVisible();
    await expect(meteogram(page).getByTestId("model-header-info")).toHaveCount(0);
    await expect(page.getByTestId("model-header-info-button")).toHaveCount(0);
  });

  test("the copied picture has no info buttons", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    // The picture has the model headers because the chart on screen shows them (modelHeaders, REQ-539, DEC-094).
    await page.route("**/config.json", (route) => route.fulfill({ json: { modelHeaders: true } }));
    await page.addInitScript(() => {
      const serialize = XMLSerializer.prototype.serializeToString;
      const captured: string[] = [];
      Object.assign(window, { __exportSvgs: captured });
      XMLSerializer.prototype.serializeToString = function (node: Node) {
        const markup = serialize.call(this, node);
        if (markup.startsWith("<svg")) captured.push(markup);
        return markup;
      };
    });
    await open(page);
    await expect(infoButtons(meteogram(page)).first()).toBeVisible();
    await page.getByRole("button", { name: "Copy the meteogram as a picture" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
    const markup = await page.evaluate(
      () => (window as unknown as { __exportSvgs: string[] }).__exportSvgs.at(-1) ?? "",
    );
    // The picture has the model headers, but not the buttons.
    expect(markup).toContain('data-testid="model-header-label"');
    expect(markup).not.toContain("model-header-info");
    expect(markup).not.toContain("Details for");
    // The buttons on the page stay.
    await expect(infoButtons(meteogram(page)).first()).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("chain hidden: info buttons in the widest parts, following the sideways scrolling", async ({
    page,
  }, testInfo) => {
    await open(page);
    await expectButtonsInWidestParts(meteogram(page));
    await expectPopover(page, infoButtons(meteogram(page)).first(), true);
    await meteogram(page).screenshot({ path: testInfo.outputPath("model-header-info-phone.png") });

    // Scrolled sideways, each button stays beside its name.
    const scroll = page.getByTestId("meteogram-scroll");
    await scroll.evaluate((element) => {
      element.scrollLeft = 300;
    });
    await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expectButtonsInWidestParts(meteogram(page));
  });

  test("chain shown: no info buttons in the meteogram", async ({ page }) => {
    await open(page, true);
    await expect(page.getByTestId("model-header-info-button")).toHaveCount(0);
  });

  test("on the whole screen in landscape as well", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 844, height: 390 });
    const dialog = fullscreen(page);
    await expect(dialog.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
    await expectButtonsInWidestParts(dialog);
    await expectPopover(page, infoButtons(dialog).first(), true);
  });
});
