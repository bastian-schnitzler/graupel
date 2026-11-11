// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Model chains (REQ-435) in a real browser with mocked network: hidden by default without a card (REQ-471), shown
 * from the settings as two cards of their own between the place and the meteogram (REQ-482), no edit mode on the
 * website (REQ-480), boundaries moved with mouse, finger and keys that the meteogram follows and a newly loaded
 * place resets (REQ-481), at once and without a new download (REQ-497), already while the boundary is dragged and
 * also after the hour turned (REQ-504), a double-click or double-tap that puts one boundary back (REQ-498), each card
 * switched on its own (REQ-503), the cloud chain's boundaries in the meteogram only while it is dragged (REQ-523), and
 * the block switched off by the configuration. On a phone each grip stands in the middle of the line between two
 * cards, and a card without data says "0 h" (REQ-609). Dragging one boundary leaves every other where it is, while it
 * is dragged and afterwards, in both chains, on the phone and the desktop (REQ-610). On the desktop the keys move the
 * boundary under the mouse without a click, unless the place search has the focus (REQ-657).
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://geocoding-api.open-meteo.com/**", (route) =>
    route.fulfill({
      json: {
        results: [{ name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, elevation: 574, country: "Austria" }],
      },
    }),
  );
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) => route.fulfill({ json: { elevation: [574] } }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Starts the page with the model chain shown (the stored choice of an earlier visit). */
async function showChain(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  });
}

const block = (page: Page) => page.locator('[data-region="model-chain"]');
const weather = (page: Page) => block(page).getByRole("group", { name: "Weather chain" });
const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
/** Name of ICON-CH2 in the catalogue, as the meteogram headers carry it. */
const CH2 = "MeteoSwiss ICON CH2";

/** Start of each model's header in the meteogram (x of its first segment), by model name. */
async function headerStarts(page: Page): Promise<Record<string, number>> {
  return meteogram(page)
    .locator('[data-testid="model-label-segment"]')
    .evaluateAll((nodes) => {
      const starts: Record<string, number> = {};
      for (const node of nodes) {
        const model = node.getAttribute("data-model") ?? "";
        const x = Number(node.getAttribute("data-start-x"));
        if (!(model in starts) || x < starts[model]!) starts[model] = x;
      }
      return starts;
    });
}

/** The value of a boundary slider. */
async function value(slider: Locator): Promise<number> {
  return Number(await slider.getAttribute("aria-valuenow"));
}

/** Picks Innsbruck in the place search. */
async function pickInnsbruck(page: Page) {
  const input = page.getByRole("combobox", { name: "Search for a place" });
  await input.fill("Inns");
  await page.locator('[data-region="location"]').getByRole("option", { name: /Innsbruck/ }).click();
}

test("hidden by default; shown as two cards between place and meteogram, without an edit mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  // Switched off: no card at all, not even an empty frame (REQ-471).
  await expect(meteogram(page)).toBeVisible();
  await expect(block(page)).toHaveCount(0);

  // The settings only show or hide the chains (REQ-480).
  await page.locator('[data-region="header"]').getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  // In the tab Models (REQ-686).
  await dialog.getByRole("tab", { name: "Models" }).click();
  const section = dialog.getByRole("group", { name: "Model chain" });
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Edit model chain" })).toHaveCount(0);
  await expect(section).toContainText("Drag the boundaries between the models");
  await section.getByRole("checkbox", { name: "Show the weather chain" }).check();
  await section.getByRole("checkbox", { name: "Show the cloud chain" }).check();
  await page.keyboard.press("Escape");

  // Two cards of their own: weather above clouds, between the place and the meteogram, as wide as the other cards.
  await expect(weather(page).getByTestId("model-card-meteofrance_arome_france_hd")).toContainText("AROME HD");
  await expect(weather(page).getByTestId("model-range-meteofrance_arome_france_hd")).toHaveAttribute("data-span", "delivered");
  const cards = block(page).locator(".model-chain-row");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute("aria-label", "Weather chain");
  await expect(cards.nth(1)).toHaveAttribute("aria-label", "Cloud chain");
  const top = (await page.locator(".app__top").boundingBox())!;
  const weatherBox = (await cards.nth(0).boundingBox())!;
  const cloudBox = (await cards.nth(1).boundingBox())!;
  const meteogramBox = (await page.getByTestId("meteogram-card").boundingBox())!;
  expect(weatherBox.y).toBeGreaterThan(top.y + top.height);
  expect(cloudBox.y).toBeGreaterThan(weatherBox.y + weatherBox.height);
  expect(meteogramBox.y).toBeGreaterThan(cloudBox.y + cloudBox.height);
  for (const card of [weatherBox, cloudBox]) {
    expect(Math.abs(card.x - meteogramBox.x)).toBeLessThan(1);
    expect(Math.abs(card.width - meteogramBox.width)).toBeLessThan(1);
    expect(Math.abs(card.width - top.width)).toBeLessThan(1);
  }

  // Nothing of the old card: no heading, region text, hint, Hide, collapse or edit buttons; only the info buttons.
  await expect(block(page).getByRole("heading")).toHaveCount(0);
  await expect(block(page)).not.toContainText("Automatic");
  await expect(block(page)).not.toContainText("hours from now");
  const buttons = await block(page).getByRole("button").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons.filter((name) => !name?.startsWith("Details for "))).toEqual([]);
  await expect(block(page).getByRole("slider")).not.toHaveCount(0);

  // The choice is kept for the next visit.
  await page.reload();
  await expect(weather(page)).toBeVisible();
});

test("dragging a boundary moves the hours of the models; the meteogram follows; a new place resets", async ({
  page,
  openMeteo,
}) => {
  await showChain(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  const range = weather(page).getByTestId("model-range-meteofrance_arome_france_hd");
  await expect(range).toHaveAttribute("data-span", "delivered");
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  const start = await value(boundary);
  expect(start).toBeGreaterThan(24);
  await expect(range).toHaveText(`0–${start} h`);
  await expect.poll(async () => (await headerStarts(page))[CH2] ?? null).not.toBeNull();
  const before = (await headerStarts(page))[CH2]!;
  /** Top of the chart on the page (a message above it would push it down). */
  const chartTop = async () => (await page.getByTestId("meteogram-scroll").boundingBox())!.y;
  const top = await chartTop();

  // Drag to the left with the mouse: the cards follow at once, the meteogram too (REQ-504, see below).
  const requests = openMeteo.length;
  const box = (await boundary.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 5 });
  const dragged = await value(boundary);
  expect(dragged).toBeLessThan(start);
  await expect(range).toHaveText(`0–${dragged} h`);
  await page.mouse.up();
  await expect(boundary).toBeFocused();
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect(range).toHaveText(`0–${dragged} h`);
  // ICON-CH2 takes over earlier: its header in the meteogram starts further left, rebuilt from the answers the page
  // already has, without a new request and without moving the chart (REQ-497).
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(before);
  expect(openMeteo.slice(requests)).toEqual([]);
  expect(await chartTop()).toBe(top);
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);

  // The keys move it too: by 12 hours with Shift, handed on when the key is let go.
  const beforeKeys = (await headerStarts(page))[CH2]!;
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(boundary).toHaveAttribute("aria-valuenow", String(dragged - 12));
  await expect(range).toHaveText(`0–${dragged - 12} h`);
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(beforeKeys);
  expect(openMeteo.slice(requests)).toEqual([]);
  expect(await chartTop()).toBe(top);

  // Loading the place again starts from the automatic chain.
  await pickInnsbruck(page);
  await expect(weather(page).getByTestId("model-card-geosphere_claef_austria")).toContainText("C-LAEF");
  const innsbruck = weather(page).getByRole("slider").first();
  await expect(weather(page).getByTestId("model-range-geosphere_claef_austria")).toHaveAttribute(
    "data-span",
    "delivered",
  );
  const auto = await value(innsbruck);
  await innsbruck.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(innsbruck).toHaveAttribute("aria-valuenow", String(auto - 12));
  await expect(weather(page).getByTestId("model-range-geosphere_claef_austria")).toHaveAttribute(
    "data-span",
    "delivered",
  );
  await pickInnsbruck(page);
  await expect(innsbruck).toHaveAttribute("aria-valuenow", String(auto));
  await expect(weather(page).getByTestId("model-range-geosphere_claef_austria")).toHaveText(`0–${auto} h`);
});

test.describe("desktop: the keys move the boundary under the mouse, without a click (REQ-657)", () => {
  /** Fixed time: Tuesday, 3 November 2026, 10:00 UTC (the day of the report). */
  const FIXED_NOW = Date.UTC(2026, 10, 3, 10);
  test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });
  ownDevice();

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
    await showChain(page);
    await page.goto(APP);
    await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
    await expect(weather(page).getByTestId("model-range-meteofrance_arome_france_hd")).toHaveAttribute(
      "data-span",
      "delivered",
    );
    await expect.poll(async () => (await headerStarts(page))[CH2] ?? null).not.toBeNull();
  });

  test("ArrowLeft moves it by an hour, Shift+ArrowLeft by 12; the meteogram follows; only that boundary", async ({
    page,
  }) => {
    const requests = openMeteoRequests(page);
    const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
    const range = weather(page).getByTestId("model-range-meteofrance_arome_france_hd");
    const cloud = block(page).getByRole("group", { name: "Cloud chain" }).getByRole("slider").first();
    const cloudStart = await value(cloud);
    const start = await value(boundary);
    expect(start).toBeGreaterThan(24);
    const before = (await headerStarts(page))[CH2]!;

    // Only over it, as the tooltip shows: no click, no focus.
    await boundary.hover();
    await expect(boundary).not.toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(boundary).toHaveAttribute("aria-valuenow", String(start - 1));
    await expect(range).toHaveText(`0–${start - 1} h`);
    await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(before);
    const oneHour = (await headerStarts(page))[CH2]!;
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(boundary).toHaveAttribute("aria-valuenow", String(start - 13));
    await expect(range).toHaveText(`0–${start - 13} h`);
    await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(oneHour);
    await expect(boundary).not.toBeFocused();
    // The page did not scroll with the keys, the cloud chain stayed, nothing was loaded.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await value(cloud)).toBe(cloudStart);
    expect(requests).toEqual([]);
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);

    // Over the cloud chain's boundary the keys move that one, the weather chain stays.
    await cloud.hover();
    await page.keyboard.press("ArrowLeft");
    await expect(cloud).toHaveAttribute("aria-valuenow", String(cloudStart - 1));
    expect(await value(boundary)).toBe(start - 13);

    // Away from the boundaries the keys move none.
    await page.mouse.move(5, 5);
    await page.keyboard.press("ArrowLeft");
    expect(await value(boundary)).toBe(start - 13);
    expect(await value(cloud)).toBe(cloudStart - 1);
    await page.screenshot({ path: test.info().outputPath("keys-under-mouse.png") });
  });

  test("with the focus in the place search the arrow keys stay there", async ({ page }) => {
    const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
    const start = await value(boundary);
    const search = page.getByRole("combobox", { name: "Search for a place" });
    await search.click();
    await search.fill("Innsbruck");
    await boundary.hover();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(search).toBeFocused();
    // The caret moved in the field (the last word selected by Shift), the boundary not.
    expect(await search.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([7, 8]);
    expect(await value(boundary)).toBe(start);
  });
});

/** Every request of the page to Open-Meteo (forecast, meta.json, Single Runs), as URLs. */
function openMeteoRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (/open-meteo\.com/.test(new URL(request.url()).hostname)) seen.push(request.url());
  });
  return seen;
}

/** Presses the mouse on the middle of a boundary. */
async function grab(page: Page, boundary: Locator) {
  const box = (await boundary.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  return at;
}

test("while a boundary is dragged the meteogram follows at every step, without a request (REQ-504)", async ({
  page,
}) => {
  const requests = openMeteoRequests(page);
  await showChain(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  const range = weather(page).getByTestId("model-range-meteofrance_arome_france_hd");
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect.poll(async () => (await headerStarts(page))[CH2] ?? null).not.toBeNull();
  const before = (await headerStarts(page))[CH2]!;
  const loaded = requests.length;
  expect(loaded).toBeGreaterThan(0);
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  const start = await value(boundary);
  const chart = meteogram(page).locator(".meteogram__chart");
  // The chart is updated in place, not built anew (no flicker).
  await chart.evaluate((node) => node.setAttribute("data-e2e-mark", "kept"));

  // The mouse stays pressed: ICON-CH2's header already starts further left.
  const at = await grab(page, boundary);
  await page.mouse.move(at.x - 40, at.y, { steps: 4 });
  const first = await value(boundary);
  expect(first).toBeLessThan(start);
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(before);
  const step = (await headerStarts(page))[CH2]!;
  // Further, still pressed: it follows again.
  await page.mouse.move(at.x - 80, at.y, { steps: 4 });
  expect(await value(boundary)).toBeLessThan(first);
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(step);
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  // The poll above ends at the first step further left; the last steps of the move may still be drawing. Wait until
  // the header stays put, so the release is compared with the end of the drag.
  let dragged = Number.NaN;
  await expect
    .poll(async () => {
      const previous = dragged;
      dragged = (await headerStarts(page))[CH2]!;
      return dragged === previous;
    })
    .toBe(true);

  await page.mouse.up();
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect(range).toHaveText(`0–${await value(boundary)} h`);
  expect((await headerStarts(page))[CH2]).toBe(dragged);
  await expect(chart).toHaveAttribute("data-e2e-mark", "kept");
  expect(requests.slice(loaded)).toEqual([]);
});

test("the cloud chain's boundaries show in the meteogram only while one of them is dragged (REQ-523)", async ({
  page,
}) => {
  await showChain(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  const cloudLines = meteogram(page).locator('[data-testid="cloud-model-boundary-line"]');
  // The weather chain's boundaries follow the model headers, as thin solid lines.
  const weatherLine = meteogram(page).locator('[data-testid="model-boundary-line"]').first();
  await expect(weatherLine).toBeAttached();
  await expect(weatherLine).toHaveAttribute("stroke-width", "1");
  await expect(weatherLine).not.toHaveAttribute("stroke-dasharray", /./);
  await expect(cloudLines).toHaveCount(0);

  const boundary = block(page).getByRole("group", { name: "Cloud chain" }).getByRole("slider").first();
  const at = await grab(page, boundary);
  await page.mouse.move(at.x - 40, at.y, { steps: 4 });
  await expect.poll(() => cloudLines.count()).toBeGreaterThan(0);
  await expect(cloudLines.first()).not.toHaveAttribute("stroke-dasharray", /./);

  await page.mouse.up();
  await expect(cloudLines).toHaveCount(0);
});

test("after the hour turned a moved boundary loads nothing: the place keeps its time and its data (REQ-504)", async ({
  page,
}) => {
  const requests = openMeteoRequests(page);
  const loadedAt = Date.now();
  await page.clock.setFixedTime(loadedAt);
  await showChain(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  await expect(weather(page).getByTestId("model-range-meteofrance_arome_france_hd")).toHaveAttribute(
    "data-span",
    "delivered",
  );
  await expect.poll(async () => (await headerStarts(page))[CH2] ?? null).not.toBeNull();
  const before = (await headerStarts(page))[CH2]!;
  const loaded = requests.length;

  // Two hours and a half later (the data would have expired after 15 minutes before).
  await page.clock.setFixedTime(loadedAt + 2.5 * 3_600_000);
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  const at = await grab(page, boundary);
  await page.mouse.move(at.x - 60, at.y, { steps: 5 });
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(before);
  await page.mouse.up();
  const dragged = (await headerStarts(page))[CH2]!;
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(dragged);
  const cloud = block(page).getByRole("group", { name: "Cloud chain" }).getByRole("slider").first();
  if ((await cloud.count()) > 0) {
    await cloud.focus();
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  expect(requests.slice(loaded)).toEqual([]);
});

test("a double-click puts a moved boundary back; the other moved one stays; the meteogram follows (REQ-498)", async ({
  page,
  openMeteo,
}) => {
  await showChain(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  const range = weather(page).getByTestId("model-range-meteofrance_arome_france_hd");
  await expect(range).toHaveAttribute("data-span", "delivered");
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  await expect(boundary).toHaveAttribute("title", /Double-click/);
  const sliders = weather(page).getByRole("slider");
  expect(await sliders.count()).toBeGreaterThan(1);
  const other = sliders.last();
  const start = await value(boundary);
  const otherStart = await value(other);
  await expect.poll(async () => (await headerStarts(page))[CH2] ?? null).not.toBeNull();
  const before = (await headerStarts(page))[CH2]!;

  // Move both boundaries to the left with the keys.
  await other.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(other).toHaveAttribute("aria-valuenow", String(otherStart - 12));
  await boundary.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(boundary).toHaveAttribute("aria-valuenow", String(start - 12));
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBeLessThan(before);

  // The double-click puts only this boundary back; the meteogram follows at once, from the answers the page already
  // has (REQ-497).
  const requests = openMeteo.length;
  await boundary.dblclick();
  await expect(boundary).toHaveAttribute("aria-valuenow", String(start));
  await expect(range).toHaveText(`0–${start} h`);
  await expect(other).toHaveAttribute("aria-valuenow", String(otherStart - 12));
  await expect.poll(async () => (await headerStarts(page))[CH2]).toBe(before);
  expect(openMeteo.slice(requests)).toEqual([]);
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect(range).toHaveText(`0–${start} h`);

  // The other one back too.
  await other.dblclick();
  await expect(other).toHaveAttribute("aria-valuenow", String(otherStart));
  await expect(boundary).toHaveAttribute("aria-valuenow", String(start));
});

test("on a phone a double-tap puts a moved boundary back (REQ-498)", async ({ page }) => {
  await showChain(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(APP);
  const range = weather(page).getByTestId("model-range-meteofrance_arome_france_hd");
  await expect(range).toHaveAttribute("data-span", "delivered");
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  const start = await value(boundary);
  await boundary.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(boundary).toHaveAttribute("aria-valuenow", String(start - 12));
  await expect(range).toHaveAttribute("data-span", "delivered");

  // Two taps of a finger (pointer events) in a row.
  await boundary.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = (await boundary.boundingBox())!;
  const touch = {
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    bubbles: true,
  };
  await boundary.evaluate((node, init) => {
    for (let i = 0; i < 2; i++) {
      node.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
      node.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    }
  }, touch);
  await expect(boundary).toHaveAttribute("aria-valuenow", String(start));
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect(range).toHaveText(`0–${start} h`);
});

// REQ-497: a load that takes a while shows "Updating forecast…" over the chart, which keeps its place.
test("a slow reload shows the update message over the meteogram without moving it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  const scroll = page.getByTestId("meteogram-scroll");
  const top = (await scroll.boundingBox())!.y;

  // Innsbruck's forecast answers only after a second.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    await held;
    await route.fallback();
  });
  await pickInnsbruck(page);
  const message = page.getByTestId("forecast-loading");
  await expect(message).toHaveText("Updating forecast…");
  expect((await scroll.boundingBox())!.y).toBe(top);
  const box = (await message.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(top - 1);
  release();
  await expect(message).toHaveCount(0);
  expect((await scroll.boundingBox())!.y).toBe(top);
});

test("on a phone the cards fit and a finger drags a boundary", async ({ page }) => {
  await showChain(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(APP);
  const range = weather(page).getByTestId("model-range-meteofrance_arome_france_hd");
  await expect(range).toHaveAttribute("data-span", "delivered");
  const cards = block(page).locator(".model-chain-row");
  await expect(cards).toHaveCount(2);
  // The cards take the content's width, the meteogram beside the page's side margins too (REQ-547).
  const meteogramBox = (await page.getByTestId("meteogram-card").boundingBox())!;
  const gutter = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".app__inner")!).paddingLeft));
  for (const index of [0, 1]) {
    const b = (await cards.nth(index).boundingBox())!;
    expect(Math.abs(b.width + 2 * gutter - meteogramBox.width)).toBeLessThan(1);
  }
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  // A touch drag (pointer events of a finger) to the right.
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  const start = await value(boundary);
  await boundary.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = (await boundary.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const touch = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientY: y, bubbles: true };
  await boundary.dispatchEvent("pointerdown", { ...touch, clientX: x });
  await boundary.dispatchEvent("pointermove", { ...touch, clientX: x - 20 });
  await boundary.dispatchEvent("pointermove", { ...touch, clientX: x - 40 });
  const moved = await value(boundary);
  expect(moved).toBeLessThan(start);
  await boundary.dispatchEvent("pointerup", { ...touch, clientX: x - 40, buttons: 0 });
  await expect(range).toHaveAttribute("data-span", "delivered");
  await expect(range).toHaveText(`0–${moved} h`);
});

test("German texts and the block switched off by the configuration", async ({ page }) => {
  await showChain(page);
  await page.route("**/config.json", (route) => route.fulfill({ json: { defaultLanguage: "de", modelChain: false } }));
  await page.goto(APP);
  await expect(meteogram(page)).toBeVisible();
  await expect(block(page)).toHaveCount(0);

  await page.unroute("**/config.json");
  await page.route("**/config.json", (route) => route.fulfill({ json: { languages: ["de"], defaultLanguage: "de" } }));
  await page.reload();
  await expect(block(page).getByRole("group", { name: "Wetterkette" })).toBeVisible();
  await expect(block(page).getByRole("group", { name: "Wolkenkette" })).toBeVisible();
  await expect(
    block(page).getByRole("slider", { name: "Grenze zwischen AROME HD und ICON-CH2" }),
  ).toHaveAttribute("aria-valuetext", /^AROME HD bis \d+ h, dann ICON-CH2$/);
});

// REQ-503: one switch per card; a hidden card changes nothing of what is loaded.
for (const shown of ["weather", "cloud"] as const) {
  test(`only the ${shown} chain switched on shows only its card`, async ({ page, openMeteo }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(APP);
    await expect(meteogram(page)).toBeVisible();
    await page.locator('[data-region="header"]').getByRole("button", { name: "Settings" }).click();
    await page.getByRole("dialog").getByRole("tab", { name: "Models" }).click();
    const section = page.getByRole("dialog").getByRole("group", { name: "Model chain" });
    const weatherBox = section.getByRole("checkbox", { name: "Show the weather chain" });
    const cloudBox = section.getByRole("checkbox", { name: "Show the cloud chain" });
    await expect(weatherBox).not.toBeChecked();
    await expect(cloudBox).not.toBeChecked();
    await (shown === "weather" ? weatherBox : cloudBox).check();
    await expect(weatherBox).toBeChecked({ checked: shown === "weather" });
    await expect(cloudBox).toBeChecked({ checked: shown === "cloud" });
    await page.keyboard.press("Escape");

    const cards = block(page).locator(".model-chain-row");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("aria-label", shown === "weather" ? "Weather chain" : "Cloud chain");
    // The one card sits between the place and the meteogram, as wide as the other cards.
    const top = (await page.locator(".app__top").boundingBox())!;
    const card = (await cards.first().boundingBox())!;
    const meteogramBox = (await page.getByTestId("meteogram-card").boundingBox())!;
    expect(card.y).toBeGreaterThan(top.y + top.height);
    expect(meteogramBox.y).toBeGreaterThan(card.y + card.height);
    expect(Math.abs(card.width - meteogramBox.width)).toBeLessThan(1);
    // Display only: the cloud chain is still requested for the meteogram's cloud area.
    expect(openMeteo.some((url) => /cloud_cover_\d+hPa/.test(decodeURIComponent(url)))).toBe(true);

    // Kept for the next visit.
    await page.reload();
    await expect(block(page).locator(".model-chain-row")).toHaveCount(1);
    await expect(block(page).locator(".model-chain-row").first()).toHaveAttribute(
      "aria-label",
      shown === "weather" ? "Weather chain" : "Cloud chain",
    );
  });
}

// REQ-463: the info popover of a model card closes on a click outside it and on Escape.
test("the info popover closes on a click outside and on Escape", async ({ page }) => {
  await showChain(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  const card = weather(page).getByTestId("model-card-meteofrance_arome_france_hd");
  const info = card.getByRole("button", { name: /^Details for / });
  const popover = page.getByTestId("model-info-popover");

  await info.click();
  await expect(popover).toBeVisible();
  // A click inside keeps it open, a click outside (here on the page heading area) closes it.
  await popover.click();
  await expect(popover).toBeVisible();
  await meteogram(page).click({ position: { x: 5, y: 5 } });
  await expect(popover).toHaveCount(0);
  await expect(info).toHaveAttribute("aria-expanded", "false");

  await info.click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(info).toBeFocused();
});

test.describe("phone with a finger (REQ-609)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  ownDevice();

  /** For each boundary of both chains: the middle of its grip and the middle of the thin line left of it (x). */
  const grips = (page: Page) =>
    block(page)
      .getByRole("slider")
      .evaluateAll((handles) =>
        handles.map((handle) => {
          const box = handle.getBoundingClientRect();
          const grip = getComputedStyle(handle, "::after");
          const card = handle.parentElement!.querySelector(".model-card")!;
          const line = card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).borderRightWidth) / 2;
          return {
            name: handle.getAttribute("aria-label"),
            grip: box.left + parseFloat(grip.left) + parseFloat(grip.width) / 2,
            line,
          };
        }),
      );

  test("each grip stands in the middle of the line between two cards, also while it is dragged", async ({ page }) => {
    await showChain(page);
    await page.goto(APP);
    await expect(weather(page).getByTestId("model-range-meteofrance_arome_france_hd")).toHaveAttribute(
      "data-span",
      "delivered",
    );
    const before = await grips(page);
    // Both chains, two boundaries each.
    expect(before.length).toBeGreaterThanOrEqual(4);
    for (const { name, grip, line } of before) expect(Math.abs(grip - line), name ?? "").toBeLessThanOrEqual(0.5);

    // Dragged to the left and still held: the grip moves with the line.
    const boundary = weather(page).getByRole("slider").first();
    const start = await value(boundary);
    const at = await grab(page, boundary);
    await page.mouse.move(at.x - 40, at.y, { steps: 4 });
    await expect(boundary).toHaveClass(/active-resizing/);
    expect(await value(boundary)).toBeLessThan(start);
    const dragged = (await grips(page))[0]!;
    expect(Math.abs(dragged.grip - dragged.line)).toBeLessThanOrEqual(0.5);
    expect(dragged.line).toBeLessThan(before[0]!.line - 10);
    await page.mouse.up();
    const after = (await grips(page))[0]!;
    expect(Math.abs(after.grip - after.line)).toBeLessThanOrEqual(0.5);
    await page.screenshot({ path: test.info().outputPath("grips.png") });
  });
});

for (const [device, use, empty] of [
  ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "0 h"],
  ["desktop", { viewport: { width: 1280, height: 900 } }, "No data"],
] as const) {
  test.describe(device, () => {
    test.use(use);
    ownDevice();

    test(`a card without data says "${empty}", its title the planned slice (REQ-609)`, async ({ page }) => {
      await showChain(page);
      // ICON-CH2 answers without a single hour.
      await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
        new URL(route.request().url()).searchParams.get("models")?.includes("icon_ch2")
          ? fakeForecast(route, { cutHours: 100_000 })
          : route.fallback(),
      );
      await page.goto(APP);
      const card = weather(page).locator('[data-testid^="model-card-"][data-testid*="icon_ch2"]');
      const range = card.locator(".model-card__range");
      await expect(range).toHaveAttribute("data-span", "none");
      await expect(range).toHaveText(empty);
      await expect(card).toHaveAttribute("title", /: no data \(planned \d+–\d+ h\)$/);
    });
  });
}

/** Moves a boundary to the left with the keys: `twelves` steps of 12 h, then `ones` of 1 h, each one handed on. */
async function press(slider: Locator, twelves: number, ones: number) {
  for (let i = 0; i < twelves; i++) await slider.press("Shift+ArrowLeft");
  for (let i = 0; i < ones; i++) await slider.press("ArrowLeft");
}

for (const [device, use] of [
  ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ["desktop", { viewport: { width: 1280, height: 900 } }],
] as const) {
  test.describe(`${device}: dragging the rear boundary (REQ-610)`, () => {
    test.use(use);
    ownDevice();

    for (const chain of ["Weather chain", "Cloud chain"]) {
      test(`${chain}: the front boundary stays on its pixel, while dragged and after`, async ({ page }) => {
        await showChain(page);
        await page.goto(APP);
        await expect(weather(page).getByTestId("model-range-meteofrance_arome_france_hd")).toHaveAttribute(
          "data-span",
          "delivered",
        );
        const sliders = block(page).getByRole("group", { name: chain }).getByRole("slider");
        await expect(sliders).toHaveCount(2);
        const front = sliders.first();
        const rear = sliders.last();
        await rear.evaluate((node) => node.scrollIntoView({ block: "center" }));
        // As in the picture at REQ-610: the front model up to 12 h, the middle one up to 27 h, below the hours the
        // front model could cover (51 h). There the front card's width depended on the rear boundary.
        await expect(front).toHaveAttribute("aria-valuenow", "51");
        await expect(rear).toHaveAttribute("aria-valuenow", "120");
        await press(front, 3, 3);
        await expect(front).toHaveAttribute("aria-valuenow", "12");
        await press(rear, 7, 9);
        await expect(rear).toHaveAttribute("aria-valuenow", "27");
        /** Left edge of the front boundary's handle and of the rear one, in px. */
        const place = async () => ({ front: (await front.boundingBox())!.x, rear: (await rear.boundingBox())!.x });
        const before = await place();

        for (const dx of [30, -30]) {
          const start = await value(rear);
          const startPlace = await place();
          const at = await grab(page, rear);
          await page.mouse.move(at.x + dx / 2, at.y, { steps: 2 });
          await page.mouse.move(at.x + dx, at.y, { steps: 2 });
          await expect(rear).toHaveClass(/active-resizing/);
          // Still held: the rear boundary moved, the front one not by a pixel.
          const moved = await value(rear);
          expect(moved === start, `${dx} px moves the rear boundary`).toBe(false);
          const held = await place();
          expect(Math.abs(held.rear - startPlace.rear)).toBeGreaterThan(3);
          expect(held.front).toBeCloseTo(before.front, 1);
          await page.mouse.up();
          await expect(rear).not.toHaveClass(/active-resizing/);
          // Released and handed on: the same.
          await expect.poll(() => value(rear)).toBe(moved);
          expect((await place()).front).toBeCloseTo(before.front, 1);
          expect((await place()).rear).toBeCloseTo(held.rear, 1);
        }
        await page.screenshot({ path: test.info().outputPath(`rear-boundary-${device}.png`) });
      });
    }
  });
}
