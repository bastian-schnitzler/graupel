// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Imprint of each domain in the info popup at phone and desktop width (REQ-430, DEC-023). */
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";
import { chooseLanguage, headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";
const NAME = "Bastian Schnitzler";
const EMAIL = "baschni@gmx.de";

const DOMAINS = [
  {
    tld: "eu",
    label: "Legal notice",
    sections: ["Operator"],
    operator: [NAME, "Cornelius-Fredericks-Straße 56a", "13351 Berlin", `Email: ${EMAIL}`],
  },
  {
    tld: "at",
    label: "Impressum",
    sections: ["Operator"],
    operator: [NAME, "Place of residence: Berlin", `Email: ${EMAIL}`],
  },
  { tld: "ch", label: "Legal notice", sections: ["Operator"], operator: [NAME, `Email: ${EMAIL}`] },
  { tld: "it", label: "Note legali", sections: ["Operator"], operator: [NAME, `Email: ${EMAIL}`] },
  {
    tld: "fr",
    label: "Mentions légales",
    sections: ["Operator", "Hosting provider"],
    operator: null,
    hoster: [
      "ALL-INKL.COM – Neue Medien Münnich",
      "Hauptstraße 68",
      "02742 Friedersdorf",
      "Allemagne",
      "Phone: +49 35872 353-10",
    ],
  },
];

// English browser language on every domain, so the translated parts are comparable.
test.use({ locale: "en-GB" });

for (const width of [375, 1280]) {
  for (const { tld, label, sections, operator, hoster } of DOMAINS) {
    test(`${width}px: graupel.${tld} shows its imprint`, async ({ page }) => {
      const config = readFileSync(new URL(`../domains/${tld}/config.json`, import.meta.url), "utf8");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/config.json", (route) => route.fulfill({ contentType: "application/json", body: config }));
      await page.setViewportSize({ width, height: 800 });
      await page.goto(APP);

      await (await headerControl(page, "button", "Info")).click();
      const dialog = page.getByRole("dialog", { name: "Information" });
      await dialog.getByRole("tab", { name: label }).click();
      const panel = dialog.getByRole("tabpanel");
      // REQ-484: no heading repeats the tab label; the tab names the panel.
      await expect(panel.getByRole("heading", { level: 3 })).toHaveCount(0);
      await expect(dialog.getByRole("tabpanel", { name: label })).toBeVisible();
      await expect(panel.getByRole("heading", { level: 4 })).toHaveText(sections);

      const operatorLines = panel.getByTestId("imprint-operator").locator("span");
      if (operator) {
        await expect(operatorLines).toHaveText(operator);
        // DEC-032: the contact email is a mailto link.
        await expect(panel.getByRole("link", { name: EMAIL })).toHaveAttribute("href", `mailto:${EMAIL}`);
      } else {
        await expect(panel.getByTestId("imprint-operator")).toHaveCount(0);
        await expect(panel).not.toContainText(NAME);
      }
      if (hoster) {
        await expect(panel.getByTestId("imprint-hoster").locator(":scope > span")).toHaveText(hoster);
        await expect(panel.getByRole("link", { name: "+49 35872 353-10" })).toHaveAttribute("href", "tel:+493587235310");
      } else {
        await expect(panel.getByTestId("imprint-hoster")).toHaveCount(0);
      }

      // Nothing overflows sideways, the popup fits the viewport.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
      const panelOverflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(panelOverflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("the imprint follows the language, a fixed label stays", async ({ page }) => {
  const config = readFileSync(new URL("../domains/fr/config.json", import.meta.url), "utf8");
  await page.route("**/config.json", (route) => route.fulfill({ contentType: "application/json", body: config }));
  await page.goto(APP);
  await chooseLanguage(page, "fr", "Language");
  await (await headerControl(page, "button", "Infos")).click();
  const panel = page.getByRole("dialog").getByRole("tabpanel", { name: "Mentions légales" });
  await page.getByRole("dialog").getByRole("tab", { name: "Mentions légales" }).click();
  await expect(panel.getByRole("heading", { level: 4 })).toHaveText(["Éditeur", "Hébergeur"]);
  await expect(panel.getByTestId("imprint-hoster")).toContainText("Tél. : +49 35872 353-10");
});
