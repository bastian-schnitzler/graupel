// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Smoke test of the built viewer (`pnpm --filter @graupel/domain-viewer start`) without network: every request to
 * another host is answered here (a blank base-map style) or aborted, the service worker is blocked so that it cannot
 * bypass the routes.
 */
import { expect, test, type Page } from "@playwright/test";

const VIEWER = "http://localhost:4174/";
const STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ccc" } }] };

test.use({ serviceWorkers: "block" });

/** The Leaflet map the page exposes as window.domainMap (only what the tests call). */
interface DomainMap {
  latLngToContainerPoint(latlng: [number, number]): { x: number; y: number };
  setView(center: [number, number], zoom: number, options: { animate: boolean }): void;
}

let errors: string[] = [];
let external: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => {
      const url = route.request().url();
      external.push(url);
      if (url === "https://tiles.openfreemap.org/styles/liberty") return route.fulfill({ json: STYLE });
      return route.abort();
    },
  );
  await page.goto(VIEWER);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
});

test.afterEach(() => {
  expect(errors).toEqual([]);
  expect(external.filter((url) => !url.startsWith("https://tiles.openfreemap.org/"))).toEqual([]);
});

/** Moves the mouse to a lon/lat on the map. */
async function hover(page: Page, lon: number, lat: number) {
  const point = await page.evaluate(([lng, lt]) => {
    const p = (window as unknown as { domainMap: DomainMap }).domainMap.latLngToContainerPoint([lt, lng]);
    return { x: p.x, y: p.y };
  }, [lon, lat] as const);
  const box = (await page.getByTestId("map").boundingBox())!;
  await page.mouse.move(box.x + point.x, box.y + point.y);
}

async function zoomTo(page: Page, lon: number, lat: number, zoom: number) {
  await page.evaluate(
    ([lng, lt, z]) =>
      (window as unknown as { domainMap: DomainMap }).domainMap.setView([lt, lng], z, { animate: false }),
    [lon, lat, zoom] as const,
  );
}

test("lists all models by group and draws the regional domains", async ({ page }) => {
  const rows = page.locator("#list .model");
  await expect(rows).toHaveCount(47);
  // Global models are listed (without checkbox), regional ones with a checkbox.
  await expect(page.locator("#list .model:not(:has(input))")).toHaveCount(22);
  await expect(page.locator('#list .model[data-model="ecmwf_ifs"]')).toContainText("IFS");
  const headings = page.locator("#list h2.group label");
  await expect(headings).toHaveText(["Europe", "North America", "Asia", "Intercontinental", "Global"]);
  // Europe, North America and Asia are shown at start; drawn as SVG paths without NaN.
  const paths = page.locator(".leaflet-overlay-pane path");
  expect(await paths.count()).toBeGreaterThan(0);
  const ds = await paths.evaluateAll((els) => els.map((el) => el.getAttribute("d") ?? ""));
  expect(ds.filter((d) => d === "" || d.includes("NaN"))).toEqual([]);
});

test("shows every regional polygon including RDPS over the pole", async ({ page }) => {
  const paths = page.locator(".leaflet-overlay-pane path");
  const before = await paths.count();
  // RDPS is the one Intercontinental model, hidden at start.
  const rdps = page.locator('#list .model[data-model="cmc_gem_rdps"]');
  await expect(rdps).toHaveClass(/off/);
  await page.locator("#list h2.group", { hasText: "Intercontinental" }).locator("input").check();
  await expect(rdps).not.toHaveClass(/off/);
  await expect.poll(() => paths.count()).toBeGreaterThan(before);
  // All 25 regional models are on now: every checkbox ticked.
  const boxes = page.locator("#list .model input");
  await expect(boxes).toHaveCount(25);
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  // Greenland lies in the RDPS domain (the wedge at 43.5° to 48.6° W included).
  await zoomTo(page, -46, 70, 3);
  await hover(page, -46, 70);
  const tooltip = page.locator(".leaflet-tooltip.domains");
  await expect(tooltip).toContainText("GEM Regional");
  // Over the Alps: ICON-D2 among others, plus the global models.
  await zoomTo(page, 10.985, 47.421, 5);
  await hover(page, 10.985, 47.421);
  await expect(tooltip).toContainText("ICON-D2");
  await expect(tooltip).toContainText("+ 22 global models");
});

test("Chains tab lists all zones and names the region under the cursor", async ({ page }) => {
  await page.getByRole("tab", { name: "Chains" }).click();
  await expect(page.locator("#tab-chains")).toBeVisible();
  await expect(page.locator("#zone-list .model")).toHaveCount(38);
  await expect(page.locator("#zone-list h2.group label")).toHaveText([
    "Europe",
    "North America",
    "Asia",
    "Intercontinental",
    "Global",
  ]);
  const paths = page.locator(".leaflet-overlay-pane path");
  expect(await paths.count()).toBeGreaterThan(0);
  // The tooltip names the chain also where zones are hidden; hiding them keeps the redraws in software rendering short.
  for (const group of ["Europe", "North America", "Asia"])
    await page.locator("#zone-list h2.group", { hasText: group }).locator("input").uncheck();
  await expect(paths).toHaveCount(0);
  const tooltip = page.locator(".leaflet-tooltip.domains");
  await zoomTo(page, 10.985, 47.421, 7);
  await hover(page, 10.985, 47.421); // Zugspitze
  await expect(tooltip).toContainText("Region here: Northern Alps");
  await expect(tooltip).toContainText("Main: ICON-D2");
  await zoomTo(page, 2.352, 48.857, 7);
  await hover(page, 2.352, 48.857); // Paris
  await expect(tooltip).toContainText("Region here: France");
  await expect(tooltip).toContainText("(hidden on the map)");
  // Clicking a zone shows it again and zooms to it. Europe is folded while none of its zones is shown in the view.
  await page.locator("#zone-list").getByRole("button", { name: "Expand Europe" }).click();
  const row = page.locator('#zone-list .model[data-zone="icon_d2.icon_eu.ecmwf_ifs~icon_d2.icon_eu.ecmwf_ifs025"]');
  await row.click();
  await expect(row).toHaveClass(/active/);
  await expect(row.locator("input")).toBeChecked();
  await expect.poll(() => paths.count()).toBeGreaterThan(0);
});

test("shows the attribution and links the license files", async ({ page, request }) => {
  const attribution = page.locator("#attribution");
  await expect(attribution).toBeVisible();
  const link = (name: string) => attribution.getByRole("link", { name });
  await expect(link("OpenFreeMap")).toHaveAttribute("href", "https://openfreemap.org/");
  await expect(attribution).toContainText("© OpenStreetMap contributors");
  await expect(link("OpenStreetMap contributors")).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect(attribution).toContainText("derived from Open-Meteo.com data (CC BY 4.0)");
  await expect(link("Natural Earth")).toBeVisible();
  await expect(attribution).toContainText("© 2026 Bastian Schnitzler. Code: GPL-3.0-or-later");
  // Every license link resolves on the built site.
  const hrefs = await attribution
    .locator("a:not([href^='http'])")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs).toEqual(
    expect.arrayContaining([
      "LICENSE",
      "LICENSES/CC-BY-4.0.txt",
      "LICENSES/MPL-2.0.txt",
      "data/LICENSE",
      "THIRD_PARTY_LICENSES.md",
    ]),
  );
  for (const href of hrefs) expect((await request.get(new URL(href, VIEWER).href)).status(), href).toBe(200);
  expect(await (await request.get(`${VIEWER}LICENSE`)).text()).toContain("GNU GENERAL PUBLIC LICENSE");
  expect(await (await request.get(`${VIEWER}THIRD_PARTY_LICENSES.md`)).text()).toContain("### maplibre-gl 4.7.1");
});
