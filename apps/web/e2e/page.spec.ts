// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The whole page in a real browser with a fake network (REQ-426): pick a place, the meteogram appears for it, the
 * footer opens the info popup at its tabs, language and colour mode switch; at phone and desktop width.
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const LIGHT_BG = "rgb(244, 246, 248)";
const DARK_BG = "rgb(17, 22, 28)";

test.use({ locale: "en-GB", colorScheme: "light" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://geocoding-api.open-meteo.com/**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    const results = name.startsWith("Inns")
      ? [{ name: "Innsbruck", latitude: 47.26266, longitude: 11.39454, elevation: 574, admin1: "Tyrol", country: "Austria" }]
      : [];
    return route.fulfill({ json: { results } });
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const pageBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

for (const { name, width, height } of [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  test(`${name} width: place, meteogram, footer, language and colour mode`, async ({ page, openMeteo }) => {
    await page.setViewportSize({ width, height });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();

    // Pick a place: the meteogram is loaded for it.
    const location = page.locator('[data-region="location"]');
    const input = location.getByRole("combobox", { name: "Search for a place" });
    await input.fill("Inns");
    await location.getByRole("option", { name: /Innsbruck/ }).click();
    await expect(input).toHaveValue("Innsbruck");
    await expect
      .poll(() => openMeteo.some((url) => new URL(url).searchParams.get("latitude")?.startsWith("47.26")))
      .toBe(true);
    // Elevation of Innsbruck in the chart (Mont Blanc: 4806 m).
    await expect(chart(page)).toContainText("574 m");
    await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
    // Readable on phones too: the chart keeps its width and scrolls inside its region.
    const chartBox = await chart(page).boundingBox();
    expect(chartBox!.width).toBeGreaterThanOrEqual(Math.min(640, width - 80));
    // Three areas since the convection area was dropped (REQ-447).
    expect(chartBox!.height).toBeGreaterThanOrEqual(250);
    await expectNoHorizontalScroll(page);

    // Footer: each link opens the info popup at its tab.
    const footer = page.getByRole("navigation", { name: "Information" });
    for (const [link, tab] of [
      ["Info", "About"],
      ["Legal notice", "Legal notice"],
      ["Privacy", "Privacy policy"],
    ] as const) {
      await footer.getByRole("button", { name: link, exact: true }).click();
      const popup = page.getByRole("dialog", { name: "Information" });
      await expect(popup.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    }

    // Language: the whole page switches, the footer too.
    await page.getByRole("combobox", { name: "Language" }).selectOption("de");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const footerDe = page.getByRole("navigation", { name: "Informationen" });
    await expect(footerDe.getByRole("button")).toHaveText(["Info", "Impressum", "Datenschutz"]);
    await expect(location.getByRole("combobox", { name: "Ort suchen" })).toHaveValue("Innsbruck");

    // Colour mode: system (light) by default, then dark, kept after a reload, back to the system.
    expect(await theme(page)).toBeNull();
    expect(await pageBackground(page)).toBe(LIGHT_BG);
    const lightChart = await chart(page).innerHTML();
    await page.getByRole("button", { name: "Einstellungen" }).click();
    const settings = page.getByRole("dialog", { name: "Einstellungen" });
    const modes = settings.getByRole("radiogroup", { name: "Farbmodus" });
    await expect(modes.getByRole("radio", { name: "System" })).toBeChecked();
    await modes.getByRole("radio", { name: "Dunkel" }).check();
    await expect.poll(() => theme(page)).toBe("dark");
    await expect.poll(() => pageBackground(page)).toBe(DARK_BG);
    await expect.poll(() => chart(page).innerHTML()).not.toBe(lightChart);
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(chart(page)).toBeVisible();
    expect(await theme(page)).toBe("dark");
    expect(await pageBackground(page)).toBe(DARK_BG);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");

    await page.getByRole("button", { name: "Einstellungen" }).click();
    await page.getByRole("radio", { name: "Hell" }).check();
    await expect.poll(() => theme(page)).toBe("light");
    // System follows the browser preference, also when it changes.
    await page.getByRole("radio", { name: "System" }).check();
    await expect.poll(() => theme(page)).toBeNull();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => pageBackground(page)).toBe(DARK_BG);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => pageBackground(page)).toBe(LIGHT_BG);
    expect(await page.evaluate(() => localStorage.getItem("graupel.colorMode"))).toBeNull();
    await page.keyboard.press("Escape");
    await expectNoHorizontalScroll(page);
  });
}
