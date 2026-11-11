// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A model without current data is replaced (REQ-767): when the first model of the weather chain answers without a
 * value from now on (e.g. GeoSphere's AROME Austria after its end), another fine model with current data takes its
 * slice. The model header shows the replacement as any other model, unchanged, with its plain info button; only the
 * text inside the info popup (on a phone the dialog) says which model delivers no data and what replaced it. The chart
 * stays complete. Austria's chain starts with C-LAEF, AROME Austria's successor.
 *
 * Mont Blanc (the start place) has the chain AROME HD, ICON-CH2, IFS HRES and the cloud chain AROME France, ICON-EU,
 * IFS; the fake Open-Meteo ends AROME HD's data before now, so AROME France (from the cloud chain) replaces it.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 11 November 2026, 12:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 11, 12);

test.use({ timezoneId: "UTC" });

let errors: string[] = [];
let models: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  models = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const model = params.get("models") ?? "";
    if (params.has("hourly") && !params.get("hourly")!.includes("hPa")) models.push(model);
    // AROME HD (and AROME Austria) deliver nothing from now on: the answer ends before the current hour.
    if (model === "meteofrance_arome_france_hd" || model === "geosphere_arome_austria") {
      return fakeForecast(route, { now: FIXED_NOW, cutHours: Number(params.get("forecast_hours") ?? 0) });
    }
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
const chart = (page: Page) => meteogram(page).locator("svg.meteogram-svg-integrated");
const labels = (page: Page) => chart(page).locator('[data-testid="model-header-label"]');

/** The chart's header segments: model, start and end in chart units, and the name shown. */
function segments(page: Page) {
  return chart(page).evaluate((root) =>
    [...root.querySelectorAll('[data-testid="model-label-segment"]')].map((group) => ({
      model: group.getAttribute("data-model") ?? "",
      start: Number(group.getAttribute("data-start-x")),
      end: Number(group.getAttribute("data-end-x")),
      label: group.querySelector('[data-testid="model-header-label"]')?.textContent ?? "",
    })),
  );
}

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  await expect(labels(page).first()).toBeVisible();
}

/** Presses `button` as the device does: a tap on a touch screen, else a click. */
async function press(button: Locator, touch: boolean) {
  if (touch) await button.tap();
  else await button.click();
}

test("the header shows the replacement, only the info popup names the failed model (REQ-767)", async ({
  page,
  hasTouch,
}, testInfo) => {
  await open(page);
  // AROME France was fetched after the chain, with the forecast quantities.
  expect(models).toContain("meteofrance_arome_france");

  // The header: AROME FR in place of AROME HD, no note in it.
  const header = await segments(page);
  expect(header[0]!.label).toBe("AROME FR");
  expect(header.map((segment) => segment.label)).not.toContain("AROME HD");
  const headerText = await chart(page).locator('[data-testid="model-label-segment"]').allTextContents();
  expect(headerText.join(" ")).not.toMatch(/AROME HD|no data|replaced/);

  // The chart is complete: the headers follow each other without a gap over the whole time axis, and the temperature
  // curve is one line.
  for (let i = 1; i < header.length; i += 1) expect(header[i]!.start).toBeCloseTo(header[i - 1]!.end, 3);
  const line = chart(page).locator('[data-testid="temperature-path"]');
  await expect(line).toHaveCount(1);
  expect(((await line.getAttribute("d")) ?? "").match(/M/g)).toHaveLength(1);

  // The info buttons stay as they are: one plain button per model, nothing beside or behind it.
  const layer = meteogram(page).getByTestId("model-header-info");
  await expect(layer.getByTestId("model-header-info-button").first()).toBeVisible();
  expect(await layer.evaluate((element) => element.textContent)).toBe("");
  const items = layer.locator(".model-header-info__item");
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    expect(await items.nth(i).evaluate((element) => element.children.length)).toBe(1);
  }
  const button = layer.locator('[data-model="AROME France"]').getByTestId("model-header-info-button");
  await expect(button).toHaveAttribute("aria-label", "Details for AROME France");
  expect(await button.getAttribute("title")).toBeNull();
  await expect(page.getByText(/delivers no data/)).toHaveCount(0);

  // The note is part of the text in the info popup (on a phone the dialog).
  await press(button, hasTouch);
  const popover = page.getByTestId("model-info-popover");
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId("model-info-replaced")).toHaveText(
    "AROME HD delivers no data at the moment; replaced by AROME FR.",
  );
  await page.screenshot({ path: testInfo.outputPath("model-replacement.png") });
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(page.getByText(/delivers no data/)).toHaveCount(0);
});

test("Austria shows C-LAEF in the header (REQ-767)", async ({ page }) => {
  await open(page);
  const location = page.locator('[data-region="location"]');
  await location.getByRole("button", { name: "Show favourites" }).click();
  await location.getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name: "Großglockner" }).click();
  await expect(location.getByRole("combobox")).toHaveValue("Großglockner");
  await expect.poll(async () => (await segments(page))[0]?.label).toBe("C-LAEF");
  const header = await segments(page);
  expect(header.map((segment) => segment.label)).not.toContain("AROME AT");
  expect(models).toContain("geosphere_claef_austria");
  expect(models).not.toContain("geosphere_arome_austria");
  await expect(page.getByText(/delivers no data/)).toHaveCount(0);
});
