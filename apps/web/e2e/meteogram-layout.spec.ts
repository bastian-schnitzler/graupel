// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Meteogram without convection (REQ-447): CAPE, CIN and LPI are no longer part of the quantity registry, so the page
 * neither asks Open-Meteo for them nor draws the convection area.
 */
import { expect, test } from "./fixtures.ts";

const APP = "http://localhost:4175/";

test("the meteogram has no convection area and no CAPE, CIN or LPI is requested", async ({ page, openMeteo }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  const chart = page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
  await expect(chart).toBeVisible();

  const areas = chart.locator("[data-area-id]");
  await expect(areas).toHaveCount(3);
  expect(await areas.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-area-id")))).toEqual([
    "temp",
    "precip",
    "wind",
  ]);
  await expect(chart.locator('[data-testid="cape-bar"], [data-testid="cin-bar"], [data-testid="lpi-path"]')).toHaveCount(
    0,
  );

  expect(openMeteo.length).toBeGreaterThan(0);
  for (const url of openMeteo) {
    const hourly = (new URL(url).searchParams.get("hourly") ?? "").split(",");
    for (const name of ["cape", "convective_inhibition", "lightning_potential"]) expect(hourly).not.toContain(name);
  }
});
