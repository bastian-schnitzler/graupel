// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Background behind the page and in the status bar (REQ-750): pulling the page down on the iPad showed blue above it
 * and in the status bar. html and body (so also the overscroll area), the meta theme-color the browser and the
 * installed app colour their bars with, and the manifest's theme_color and background_color have the page's
 * background colour, light and dark; the theme-color follows the colour mode chosen in the settings. In every device
 * class.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";
/** Page background (`--color-bg`, PAGE_BACKGROUND in src/state/colorMode.ts) per colour scheme. */
const BACKGROUND = { light: "#f4f6f8", dark: "#11161c" } as const;

test.use({ locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** "#rrggbb" as the browser writes a computed colour. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/**
 * Colours the page shows behind itself and in the bars: html and body background, `--color-bg`, the theme-color the
 * browser applies (the tag whose media matches) and the iOS status bar style.
 */
const colours = (page: Page) =>
  page.evaluate(() => {
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const applied = metas.filter((meta) => !meta.media || window.matchMedia(meta.media).matches);
    return {
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      token: getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
      themeColor: applied.map((meta) => meta.content),
      statusBar: document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
    };
  });

/** The page's colours are those of `scheme`'s background. */
async function expectBackground(page: Page, scheme: "light" | "dark") {
  await expect.poll(async () => (await colours(page)).themeColor).toEqual([BACKGROUND[scheme]]);
  expect(await colours(page)).toEqual({
    html: rgb(BACKGROUND[scheme]),
    body: rgb(BACKGROUND[scheme]),
    token: BACKGROUND[scheme],
    themeColor: [BACKGROUND[scheme]],
    // "default": the installed app's status bar takes the theme-color, the page starts below it.
    statusBar: "default",
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme}: html, body, theme-color and manifest have the page's background colour (REQ-750)`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(APP);
    await expect(page.locator('[data-region="meteogram"]')).toBeVisible();
    await expectBackground(page, scheme);

    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await page.request.get(new URL(href ?? "", APP).href)).json();
    // The manifest has one pair of colours for light and one for its dark colour scheme.
    const colors = scheme === "light" ? manifest : manifest.user_preferences.color_scheme.dark;
    expect({ theme: colors.theme_color, background: colors.background_color }).toEqual({
      theme: BACKGROUND[scheme],
      background: BACKGROUND[scheme],
    });
  });
}

test("the theme-color follows the colour mode chosen against the system's (REQ-750)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  // A dark mode stored by an earlier visit applies from the start.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) localStorage.setItem("graupel.colorMode", "dark");
    sessionStorage.setItem("seeded", "1");
  });
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectBackground(page, "dark");

  // Light against a dark system, then back to the system.
  await page.emulateMedia({ colorScheme: "dark" });
  await (await headerControl(page, "button", "Settings")).click();
  const modes = page.getByRole("dialog", { name: "Settings" }).getByRole("radiogroup", { name: "Colour mode" });
  await modes.getByRole("radio", { name: "Light" }).check();
  await expectBackground(page, "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectBackground(page, "light");

  await (await headerControl(page, "button", "Settings")).click();
  await page.getByRole("radio", { name: "System" }).check();
  await expectBackground(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectBackground(page, "light");
});
