// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The copied or saved picture of the meteogram (REQ-714): above and below it has a band in its background colour, in
 * the light and the dark colour mode, so the model headers and the footer row do not stand at its edge. It has the
 * model headers exactly when the chart on screen shows them: the own choice in the settings, else `modelHeaders` of
 * config.json; `imageModelHeaders` has no effect for now (REQ-539, DEC-094). The clipboard is the real one
 * (permissions granted); the saved file is a download (a browser without the "Save as" dialog). The PNGs are decoded
 * in the page and read row by row.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
/** Band above and below in pixels of the PNG: 12 CSS px at the picture's scale of 2 (device pixel ratio 1). */
const BAND = 24;
const COPY = "Copy the meteogram as a picture";
const SAVE = "Save the picture to the photos";

test.use({ timezoneId: "UTC", viewport: { width: 1280, height: 900 } });
ownDevice();

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  // Every SVG the page serialises: the last one is the chart of the picture.
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
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const card = (page: Page) => page.getByTestId("meteogram-card");
const chart = (page: Page) => card(page).locator("svg.meteogram-svg-integrated");

/** Number of model header labels in the chart of the last picture. */
const pictureModelHeaders = (page: Page) =>
  page.evaluate(() => {
    const markup = (window as unknown as { __exportSvgs: string[] }).__exportSvgs.at(-1) ?? "";
    return markup.split('data-testid="model-header-label"').length - 1;
  });

/**
 * Opens the page with `config` as config.json; `choice` is an own choice of the model headers in the settings
 * (REQ-472). `screen`: whether the chart on screen shows model headers.
 */
async function open(
  page: Page,
  config: { modelHeaders: boolean; imageModelHeaders?: boolean },
  { choice, screen = choice ?? config.modelHeaders }: { choice?: boolean; screen?: boolean } = {},
) {
  await page.route("**/config.json", (route) => route.fulfill({ json: config }));
  if (choice !== undefined) {
    await page.addInitScript((value) => window.localStorage.setItem("graupel.modelHeaders", value), String(choice));
  }
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  // The number of model headers depends on the chain; only whether the screen shows any matters here.
  await expect
    .poll(async () => (await chart(page).locator('[data-testid="model-header-label"]').count()) > 0)
    .toBe(screen);
}

/** Size of a PNG, its band colour and the first and last row that are not all in that colour. */
interface Rows {
  width: number;
  height: number;
  band: [number, number, number];
  firstContent: number;
  lastContent: number;
}

/**
 * Decodes the PNG (base64, or null: the one on the clipboard) in the page and reads its rows; `background` is the
 * colour of the chart's nearest painted ancestor, which the picture takes.
 */
function readRows(page: Page, base64: string | null) {
  return page.evaluate(async (data) => {
    let blob: Blob;
    if (data === null) {
      const items = await navigator.clipboard.read();
      const item = items.find((entry) => entry.types.includes("image/png"))!;
      blob = await item.getType("image/png");
    } else {
      blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const band = [pixels[0]!, pixels[1]!, pixels[2]!] as [number, number, number];
    const plain = (y: number) => {
      for (let x = 0; x < bitmap.width; x++) {
        const i = (y * bitmap.width + x) * 4;
        if (pixels[i] !== band[0] || pixels[i + 1] !== band[1] || pixels[i + 2] !== band[2]) return false;
      }
      return true;
    };
    let firstContent = 0;
    while (firstContent < bitmap.height && plain(firstContent)) firstContent++;
    let lastContent = bitmap.height - 1;
    while (lastContent >= 0 && plain(lastContent)) lastContent--;
    let node: Element | null = document.querySelector('[data-testid="meteogram-card"] svg.meteogram-svg-integrated');
    let background = "";
    for (; node && !background; node = node.parentElement) {
      const colour = getComputedStyle(node).backgroundColor;
      if (colour && colour !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(colour)) background = colour;
    }
    return { width: bitmap.width, height: bitmap.height, band, firstContent, lastContent, background };
  }, base64);
}

/** The band stands above and below the picture in the background colour of the chart. */
function expectBand(rows: Rows & { background: string }, scheme: "light" | "dark") {
  expect(`rgb(${rows.band.join(", ")})`).toBe(rows.background);
  const brightness = (rows.band[0] + rows.band[1] + rows.band[2]) / 3;
  if (scheme === "light") expect(brightness).toBeGreaterThan(200);
  else expect(brightness).toBeLessThan(60);
  // Nothing but background in the band above and below; the chart starts right below the band.
  expect(rows.firstContent).toBeGreaterThanOrEqual(BAND);
  expect(rows.firstContent).toBeLessThan(BAND + 8);
  expect(rows.lastContent).toBeLessThanOrEqual(rows.height - 1 - BAND);
  expect(rows.width).toBeGreaterThan(2000);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`picture with model headers and band, ${scheme} (REQ-714)`, () => {
    test.use({ colorScheme: scheme });

    test("copying gives a PNG with the model headers the screen shows, without imageModelHeaders, and a band above and below", async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
      await open(page, { modelHeaders: true, imageModelHeaders: false });
      await card(page).getByRole("button", { name: COPY }).click();
      await expect(card(page).getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
      expect(await pictureModelHeaders(page)).toBeGreaterThan(0);
      expectBand(await readRows(page, null), scheme);
      // The chart on screen keeps showing its model headers.
      await expect(chart(page).locator('[data-testid="model-header-label"]').first()).toBeAttached();
    });

    test("saving gives a PNG file with the model headers and a band above and below", async ({ page }) => {
      await page.addInitScript(() => {
        Reflect.deleteProperty(window, "showSaveFilePicker");
      });
      await open(page, { modelHeaders: true });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        card(page).getByRole("button", { name: SAVE }).click(),
      ]);
      await expect(card(page).getByRole("status").filter({ hasText: "Picture saved" })).toBeVisible();
      expect(await pictureModelHeaders(page)).toBeGreaterThan(0);
      const bytes = await readFile(await download.path());
      expectBand(await readRows(page, bytes.toString("base64")), scheme);
    });
  });
}

test("without model headers on screen the picture has none, also with imageModelHeaders, and the band (REQ-539, REQ-714, DEC-094)", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  await open(page, { modelHeaders: false, imageModelHeaders: true });
  await card(page).getByRole("button", { name: COPY }).click();
  await expect(card(page).getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
  expect(await pictureModelHeaders(page)).toBe(0);
  const rows = await readRows(page, null);
  expect(`rgb(${rows.band.join(", ")})`).toBe(rows.background);
  expect(rows.firstContent).toBeGreaterThanOrEqual(BAND);
  expect(rows.lastContent).toBeLessThanOrEqual(rows.height - 1 - BAND);
  // The chart on screen keeps showing no model headers.
  await expect(chart(page).locator('[data-testid="model-header-label"]')).toHaveCount(0);
});

for (const choice of [true, false]) {
  test(`the picture follows the own choice of the model headers (${choice ? "on" : "off"}) over modelHeaders of config.json (REQ-472, REQ-539, DEC-094)`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await open(page, { modelHeaders: !choice, imageModelHeaders: !choice }, { choice });
    await card(page).getByRole("button", { name: COPY }).click();
    await expect(card(page).getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
    expect((await pictureModelHeaders(page)) > 0).toBe(choice);
  });
}
