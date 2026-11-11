// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Privacy policy in the info popup at phone and desktop width (REQ-432). */
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";
import { chooseLanguage, headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";

test.use({ locale: "en-GB" });

for (const width of [375, 1280]) {
  test(`${width}px: info popup shows the privacy policy`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);

    await (await headerControl(page, "button", "Info")).click();
    const dialog = page.getByRole("dialog", { name: "Information" });
    await dialog.getByRole("tab", { name: "Privacy policy" }).click();
    const panel = dialog.getByRole("tabpanel", { name: "Privacy policy" });
    // REQ-484: the tab names the full policy, the panel repeats no heading of it.
    await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(panel.getByRole("heading", { level: 4 })).toHaveText([
      "Controller",
      "Hosting on GitHub Pages",
      "Weather data from Open-Meteo",
      "Map",
      "Location and IP address",
      "Storage in your browser",
      "Your rights",
    ]);
    // REQ-493: the map section names both providers, whichever is chosen.
    const mapSection = panel.locator('[data-section="map"]');
    await expect(mapSection.locator("[data-provider]")).toHaveCount(2);
    await expect(mapSection.locator('[data-provider="opentopomap"]')).toBeVisible();
    await expect(mapSection.locator('[data-provider="maptoolkit"]')).toContainText("Toursprung GmbH");
    await expect(mapSection).toContainText("depends on your choice in the settings");
    const maptoolkitLink = mapSection.getByRole("link", { name: "Maptoolkit privacy policy" });
    await expect(maptoolkitLink).toHaveAttribute("href", "https://www.maptoolkit.org/privacy");
    // REQ-494: the coordinates also fetch the map section.
    await expect(panel.locator('[data-section="location"]')).toContainText(
      "to load the matching map section from the map provider (OpenTopoMap or Maptoolkit)",
    );
    // The default config.json names the hoster instead of an operator and has no Swiss section.
    await expect(panel.getByTestId("privacy-hoster")).toContainText("88 Colin P. Kelly Jr. Street");

    // The last section can be scrolled into view and nothing overflows sideways.
    const last = panel.getByRole("heading", { name: "Your rights" });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);

    // Switching the language translates the policy.
    await page.keyboard.press("Escape");
    await chooseLanguage(page, "de", "Language");
    await (await headerControl(page, "button", "Info")).click();
    const panelDe = page.getByRole("dialog").getByRole("tabpanel", { name: "Datenschutzerklärung" });
    await expect(panelDe.getByRole("heading", { level: 4 }).first()).toHaveText("Verantwortlicher");
    await expect(panelDe.getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(panelDe.locator('[data-section="map"]')).toContainText("Ihrer Wahl in den Einstellungen");
    await expect(panelDe.locator('[data-provider="maptoolkit"]')).toContainText("Mariahilfer Straße 93/20, 1060 Wien");
    expect(errors).toEqual([]);
  });
}

const NAME = "Bastian Schnitzler";
const EMAIL = "baschni@gmx.de";
const MAIL = `Email: ${EMAIL}`;
const DOMAINS = [
  { tld: "eu", swiss: false, controller: [NAME, "Cornelius-Fredericks-Straße 56a", "13351 Berlin", MAIL] },
  { tld: "at", swiss: false, controller: [NAME, "Berlin", MAIL] },
  { tld: "ch", swiss: true, controller: [NAME, MAIL] },
  { tld: "it", swiss: false, controller: [NAME, MAIL] },
  // DEC-028/DEC-032: the imprint of .fr stays anonymous, the privacy policy names the controller with name and email.
  { tld: "fr", swiss: false, controller: [NAME, MAIL] },
];

for (const { tld, swiss, controller } of DOMAINS) {
  test(`graupel.${tld}: controller and Swiss section in the privacy policy`, async ({ page }) => {
    const config = readFileSync(new URL(`../domains/${tld}/config.json`, import.meta.url), "utf8");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/config.json", (route) => route.fulfill({ contentType: "application/json", body: config }));
    await page.goto(APP);

    await (await headerControl(page, "button", "Info")).click();
    const dialog = page.getByRole("dialog", { name: "Information" });
    await dialog.getByRole("tab", { name: "Privacy policy" }).click();
    const panel = dialog.getByRole("tabpanel");
    await expect(panel.getByTestId("privacy-controller").locator("span")).toHaveText(controller);
    const email = panel.getByTestId("privacy-controller").getByRole("link", { name: EMAIL });
    await expect(email).toHaveAttribute("href", `mailto:${EMAIL}`);
    await expect(panel.getByTestId("privacy-hoster")).toHaveCount(0);
    // REQ-710: the domains are served by ALL-INKL.
    await expect(panel.getByRole("heading", { level: 4 }).nth(1)).toHaveText("Hosting at ALL-INKL");
    await expect(panel.locator('[data-section="hosting"]')).not.toContainText("GitHub");
    await expect(panel.getByRole("heading", { name: "Note for Switzerland" })).toHaveCount(swiss ? 1 : 0);
    if (swiss) await expect(panel.locator('[data-section="switzerland"]')).toContainText("FDPIC");
    expect(errors).toEqual([]);
  });
}
