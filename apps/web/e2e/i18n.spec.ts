// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Language of the page in a real browser: browser language, stored choice, English otherwise. */
import { expect, test } from "./fixtures.ts";

const APP = "http://localhost:4175/";

test.describe("browser language German", () => {
  test.use({ locale: "de-AT" });

  test("shows German texts", async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByRole("region", { name: "Ort", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });

  test("a stored choice wins over the browser language", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("graupel.language", "fr"));
    await page.goto(APP);
    await expect(page.getByRole("region", { name: "Lieu", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });
});

test.describe("unsupported browser language", () => {
  test.use({ locale: "pl-PL" });

  test("falls back to English", async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByRole("region", { name: "Location", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
