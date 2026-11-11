// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * RRFS in place of HRRR (REQ-768): Open-Meteo ends HRRR on 2026-11-30, so the chains of the USA start with RRFS, its
 * successor. A place in the USA (Chicago, the start place of config.json) shows "RRFS" in the meteogram's model header,
 * never HRRR, and the chart is complete.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 11 November 2026, 18:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 11, 18);
const CHICAGO = { name: "Chicago", lat: 41.878, lon: -87.63, elevation: 181 };

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
  await page.route("**/config.json", (route) => route.fulfill({ json: { startLocation: CHICAGO } }));
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const model = new URL(route.request().url()).searchParams.get("models");
    if (model) models.push(model);
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** The chart's header segments: start and end in chart units and the name shown. */
function segments(page: Page) {
  return chart(page).evaluate((root) =>
    [...root.querySelectorAll('[data-testid="model-label-segment"]')].map((group) => ({
      start: Number(group.getAttribute("data-start-x")),
      end: Number(group.getAttribute("data-end-x")),
      label: group.querySelector('[data-testid="model-header-label"]')?.textContent ?? "",
    })),
  );
}

test("a place in the USA shows RRFS in the model header, the chart is complete (REQ-768)", async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('[data-region="location"]').getByRole("combobox")).toHaveValue("Chicago");
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  await expect.poll(async () => (await segments(page))[0]?.label).toBe("RRFS");

  const header = await segments(page);
  expect(header.map((segment) => segment.label).join(" ")).not.toContain("HRRR");
  expect(models).toContain("ncep_rrfs_conus");
  expect(models).not.toContain("ncep_hrrr_conus");

  // The chart is complete: the headers follow each other without a gap, and the temperature curve is one line.
  expect(header.length).toBeGreaterThan(1);
  for (let i = 1; i < header.length; i += 1) expect(header[i]!.start).toBeCloseTo(header[i - 1]!.end, 3);
  const line = chart(page).locator('[data-testid="temperature-path"]');
  await expect(line).toHaveCount(1);
  expect(((await line.getAttribute("d")) ?? "").match(/M/g)).toHaveLength(1);
});
