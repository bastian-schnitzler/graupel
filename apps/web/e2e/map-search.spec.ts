// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Place search in the full-screen map (REQ-641): on the desktop the search field of the place row with GPS and X sits
 * top left in the map, the favourites beside it; zoom stays top right, Cancel and OK bottom right. A hit or a favourite
 * moves the map and its marker there and OK takes it; the current position is taken at once and closes the map. On a
 * phone the map has no search field. For OpenTopoMap (Leaflet) and Maptoolkit (MapLibre); without network the tiles are
 * a transparent pixel and the Maptoolkit style is refused, as in map-picker.spec.ts.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const DESKTOP = { width: 1280, height: 800 };
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const INNSBRUCK = "47.2627° N · 11.3945° E";

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const results = name.startsWith("Inns")
      ? [{ name: "Innsbruck", latitude: 47.2627, longitude: 11.3945, elevation: 574, admin1: "Tyrol", country: "Austria" }]
      : [];
    return route.fulfill({ json: { results } });
  });
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function useProvider(page: Page, provider: "opentopomap" | "maptoolkit") {
  await page.addInitScript((value) => localStorage.setItem("graupel.map", value), provider);
}

async function openMap(page: Page, provider: "opentopomap" | "maptoolkit") {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toBeVisible();
  // Wait until the library has set up the map (Leaflet: panes; MapLibre: the canvas).
  await expect(
    dialog.locator(`[data-map="${provider}"]`).locator(provider === "opentopomap" ? ".leaflet-map-pane" : "canvas"),
  ).toHaveCount(1);
  return dialog;
}

/** Centre of the place marker on the screen: Leaflet's circle, MapLibre's pin with its tip on the place. */
async function markerPoint(dialog: Locator, provider: "opentopomap" | "maptoolkit") {
  const marker = dialog.locator(provider === "opentopomap" ? "path.leaflet-interactive" : ".maplibregl-marker");
  const box = (await marker.boundingBox())!;
  return provider === "opentopomap"
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : { x: box.x + box.width / 2, y: box.y + box.height };
}

function coordinates(page: Page) {
  return page.locator('[data-region="location"] > .location__facts').getByTestId("location-coordinates");
}

for (const provider of ["opentopomap", "maptoolkit"] as const) {
  test(`${provider}: search field, GPS, X and favourites top left on the desktop`, async ({ page }) => {
    await useProvider(page, provider);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const dialog = await openMap(page, provider);

    const field = dialog.getByRole("combobox", { name: "Search for a place" });
    await expect(field).toHaveValue("Mont Blanc");
    const gps = dialog.getByRole("button", { name: "Current location" });
    const clear = dialog.getByRole("button", { name: "Clear search" });
    const star = dialog.getByRole("button", { name: "Remove Mont Blanc from favourites" });
    const arrow = dialog.getByRole("button", { name: "Show favourites" });
    const fieldBox = (await dialog.locator(".location__field").boundingBox())!;
    const gpsBox = (await gps.boundingBox())!;
    const clearBox = (await clear.boundingBox())!;
    const starBox = (await star.boundingBox())!;
    const arrowBox = (await arrow.boundingBox())!;
    // Top left, as in the mockup; GPS inside the field on the left, X on the right.
    expect(fieldBox.x).toBeLessThan(20);
    expect(fieldBox.y).toBeLessThan(20);
    expect(fieldBox.width).toBeGreaterThan(300);
    expect(gpsBox.x).toBeLessThan(fieldBox.x + 10);
    expect(clearBox.x + clearBox.width).toBeGreaterThan(fieldBox.x + fieldBox.width - 10);
    // The favourites to the right of the field, on the same line.
    expect(starBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width);
    expect(arrowBox.x).toBeGreaterThan(starBox.x);
    expect(Math.abs(starBox.y + starBox.height / 2 - (fieldBox.y + fieldBox.height / 2))).toBeLessThan(3);
    // Zoom stays top right, clear of the search, Cancel and OK bottom right.
    const zoom = (await dialog
      .locator(provider === "opentopomap" ? ".leaflet-control-zoom" : ".maplibregl-ctrl-zoom-in")
      .boundingBox())!;
    expect(zoom.y).toBeLessThan(20);
    expect(arrowBox.x + arrowBox.width).toBeLessThan(zoom.x);
    const ok = (await dialog.getByRole("button", { name: "OK" }).boundingBox())!;
    expect(DESKTOP.width - (ok.x + ok.width)).toBeLessThan(20);
    expect(DESKTOP.height - (ok.y + ok.height)).toBeLessThan(60);
    await page.screenshot({ path: test.info().outputPath(`map-search-${provider}.png`) });
  });

  test(`${provider}: a hit moves the map and its marker there, OK takes it`, async ({ page }) => {
    await useProvider(page, provider);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const dialog = await openMap(page, provider);
    const map = dialog.locator(`[data-map="${provider}"]`);
    const ok = dialog.getByRole("button", { name: "OK" });
    // Away from the centre first: the search brings the marker back to the middle of the map.
    await map.click({ position: { x: 300, y: 600 } });
    await expect(ok).toBeEnabled();
    await expect.poll(async () => (await markerPoint(dialog, provider)).x).toBeLessThan(320);

    const field = dialog.getByRole("combobox", { name: "Search for a place" });
    await field.fill("Inns");
    const option = dialog.getByRole("option", { name: /Innsbruck/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(field).toHaveValue("Innsbruck");
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => {
        const point = await markerPoint(dialog, provider);
        return Math.round(Math.hypot(point.x - DESKTOP.width / 2, point.y - DESKTOP.height / 2));
      })
      // MapLibre's pin ends a few pixels below its tip (its shadow); the click before was some 400 px away.
      .toBeLessThan(12);
    // The place row keeps the old place until OK.
    await expect(coordinates(page)).not.toHaveText(INNSBRUCK);
    await ok.click();
    await expect(dialog).toHaveCount(0);
    await expect(coordinates(page)).toHaveText(INNSBRUCK);
    await expect(page.locator('[data-region="location"]').getByRole("combobox")).toHaveValue("Innsbruck");
  });

  test(`${provider}: a favourite moves the map there, OK takes it`, async ({ page }) => {
    await useProvider(page, provider);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const dialog = await openMap(page, provider);
    await dialog.getByRole("button", { name: "Show favourites" }).click();
    await dialog.getByRole("menuitem", { name: "Matterhorn" }).click();
    await expect(dialog.getByRole("combobox")).toHaveValue("Matterhorn");
    await expect(dialog.getByRole("button", { name: "Remove Matterhorn from favourites" })).toBeVisible();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-region="location"]').getByRole("combobox")).toHaveValue("Matterhorn");
  });
}

// REQ-673: below the search field the elevation of the marked place; REQ-732: never its coordinates, also not for a
// named place.
for (const provider of ["opentopomap", "maptoolkit"] as const) {
  test(`${provider}: elevation below the search field, no coordinates`, async ({ page }) => {
    await useProvider(page, provider);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const dialog = await openMap(page, provider);
    const field = dialog.getByRole("combobox", { name: "Search for a place" });
    const facts = dialog.locator(".map-dialog__tools .location__facts");
    const elevation = facts.getByTestId("location-elevation");
    const mapCoordinates = facts.getByTestId("location-coordinates");

    // The place the map opened with: its elevation, no coordinates although the field shows its name (REQ-732).
    await expect(field).toHaveValue("Mont Blanc");
    await expect(elevation).toHaveText("4,806 m");
    await expect(mapCoordinates).toHaveCount(0);
    await expect(facts.locator("dt")).toHaveText(["Elevation"]);
    // Below the field, starting where it starts, clear of the zoom on the right.
    const fieldBox = (await dialog.locator(".location__field").boundingBox())!;
    const factsBox = (await facts.boundingBox())!;
    expect(factsBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    expect(factsBox.y - (fieldBox.y + fieldBox.height)).toBeLessThan(16);
    expect(Math.abs(factsBox.x - fieldBox.x)).toBeLessThan(1);
    expect(factsBox.width).toBeLessThan(DESKTOP.width / 2);

    // A hit: its own elevation, again without coordinates.
    await field.fill("Inns");
    await dialog.getByRole("option", { name: /Innsbruck/ }).click();
    await expect(field).toHaveValue("Innsbruck");
    await expect(elevation).toHaveText("574 m");
    await expect(mapCoordinates).toHaveCount(0);

    // A point clicked on the map: the elevation from the elevation API, the line below has only the elevation.
    await dialog.locator(`[data-map="${provider}"]`).click({ position: { x: 300, y: 600 } });
    await expect(field).toHaveValue(/^\d+\.\d{4}° [NS] · \d+\.\d{4}° [EW]$/);
    await expect(elevation).toHaveText("1,234 m");
    await expect(mapCoordinates).toHaveCount(0);
    await expect(facts.locator("dt")).toHaveText(["Elevation"]);
    await page.screenshot({ path: test.info().outputPath(`map-elevation-${provider}.png`) });

    // OK: the place row the same way.
    const point = await field.inputValue();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.locator('[data-region="location"]');
    await expect(row.getByRole("combobox")).toHaveValue(point);
    await expect(row.getByTestId("location-elevation")).toHaveText("1,234 m");
    await expect(coordinates(page)).toHaveCount(0);
  });
}

test("the elevation below the search field in the map speaks the page language (REQ-673, REQ-732)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  await page.getByRole("button", { name: "Karte", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Karte" });
  const facts = dialog.locator(".map-dialog__tools .location__facts");
  await expect(facts.locator("dt")).toHaveText(["Höhe"]);
  await expect(facts.getByTestId("location-elevation")).toHaveText("4.806 m");
  await expect(facts.getByTestId("location-coordinates")).toHaveCount(0);
});

// REQ-732: the elevation card in the map has room for four digits and "m", so that it keeps its width from 0 m up to
// 8,848 m and without an elevation ("n/a").
for (const language of ["en", "de"] as const) {
  test(`the elevation card in the map keeps its width whatever the elevation (${language})`, async ({ page }) => {
    const elevations: Record<string, number | null> = { Null: 0, Gipfel: 4800, Everest: 8848, Ohne: null };
    await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
      const name = new URL(route.request().url()).searchParams.get("name") ?? "";
      const results = Object.entries(elevations)
        .filter(([key]) => name.startsWith(key))
        .map(([key, elevation]) => ({ name: key, latitude: 46, longitude: 11, ...(elevation === null ? {} : { elevation }) }));
      return route.fulfill({ json: { results } });
    });
    await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
      route.fulfill({ json: { elevation: [null] } }),
    );
    await page.addInitScript((value) => localStorage.setItem("graupel.language", value), language);
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    await page.getByRole("button", { name: language === "de" ? "Karte" : "Map", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const field = dialog.getByRole("combobox");
    const facts = dialog.locator(".map-dialog__tools .location__facts");
    const elevation = facts.getByTestId("location-elevation");

    const widths: Record<string, number> = {};
    const expected: Record<string, string> = {
      Null: "0 m",
      Gipfel: language === "de" ? "4.800 m" : "4,800 m",
      Everest: language === "de" ? "8.848 m" : "8,848 m",
      Ohne: "n/a",
    };
    for (const name of Object.keys(elevations)) {
      await field.fill(name);
      await dialog.getByRole("option", { name: new RegExp(name) }).click();
      await expect(field).toHaveValue(name);
      await expect(elevation).toHaveText(expected[name]!);
      await expect(facts.getByTestId("location-coordinates")).toHaveCount(0);
      widths[name] = (await facts.boundingBox())!.width;
      if (name === "Ohne") await page.screenshot({ path: test.info().outputPath(`map-elevation-na-${language}.png`) });
    }
    expect(widths.Gipfel).toBeCloseTo(widths.Null!, 1);
    expect(widths.Everest).toBeCloseTo(widths.Null!, 1);
    expect(widths.Ohne).toBeCloseTo(widths.Null!, 1);
  });
}

test.describe("current position", () => {
  test.use({ geolocation: { latitude: 47.267891, longitude: 11.392345 }, permissions: ["geolocation"] });

  test("GPS in the map takes the position at once and closes the map", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(APP);
    const dialog = await openMap(page, "opentopomap");
    await dialog.getByRole("button", { name: "Current location" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-region="location"]').getByRole("combobox")).toHaveValue("My location");
    await expect(coordinates(page)).toHaveText("47.2679° N · 11.3923° E");
  });
});

test("Escape in the search closes the suggestions, then the map", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(APP);
  const dialog = await openMap(page, "opentopomap");
  const field = dialog.getByRole("combobox");
  await field.fill("Inns");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await field.press("Escape");
  await expect(dialog.getByRole("option")).toBeHidden();
  await expect(dialog).toBeVisible();
  await field.press("Escape");
  await expect(field).toHaveValue("Mont Blanc");
  await expect(dialog).toBeVisible();
  await field.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  for (const provider of ["opentopomap", "maptoolkit"] as const) {
    test(`${provider}: no search field in the map`, async ({ page }) => {
      await useProvider(page, provider);
      await page.goto(APP);
      const dialog = await openMap(page, provider);
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Show favourites" })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Current location" })).toHaveCount(0);

      // Held in landscape neither.
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
    });
  }
});
