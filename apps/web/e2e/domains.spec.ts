// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The one build with each domain configuration (REQ-422, DEC-019): served as config.json next to the page, it sets
 * the fallback language of the domain without errors.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";

const APP = "http://localhost:4175/";

const DOMAINS = [
  { tld: "at", language: "de", heading: "Ort" },
  { tld: "ch", language: "de", heading: "Ort" },
  { tld: "fr", language: "fr", heading: "Lieu" },
  { tld: "it", language: "it", heading: "Località" },
  { tld: "eu", language: "en", heading: "Location" },
];

test.describe("domain configurations", () => {
  // A browser language no domain offers, so the fallback language of the domain applies.
  test.use({ locale: "pl-PL" });

  for (const { tld, language, heading } of DOMAINS) {
    test(`graupel.${tld} falls back to ${language}`, async ({ page }) => {
      const config = readFileSync(new URL(`../domains/${tld}/config.json`, import.meta.url), "utf8");
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") problems.push(message.text());
      });
      await page.route("**/config.json", (route) =>
        route.fulfill({ contentType: "application/json", body: config }),
      );
      await page.goto(APP);
      await expect(page.getByRole("region", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      for (const region of ["day-slider", "meteogram"]) {
        await expect(page.locator(`[data-region="${region}"]`)).toBeVisible();
      }
      // The model chain is hidden by default and then has no card (REQ-445, REQ-471).
      await expect(page.locator('[data-region="model-chain"]')).toHaveCount(0);
      expect(problems).toEqual([]);
    });
  }
});
