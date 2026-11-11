// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Header bar and popups in a real browser at phone and desktop width (REQ-434). */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

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

for (const width of [375, 1280]) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(APP);
    });

    test("header fits and switches the language", async ({ page }) => {
      const header = page.locator('[data-region="header"]');
      await expect(header.getByRole("combobox", { name: "Language" })).toBeVisible();
      await expect(header.getByRole("button", { name: "Settings" })).toBeVisible();
      await expect(header.getByRole("button", { name: "Info" })).toBeVisible();
      await expect(header.getByRole("button", { name: "Download" })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      // REQ-534: English first, German second.
      await expect(header.getByRole("combobox", { name: "Language" }).locator("option")).toHaveText([
        "English",
        "Deutsch",
        "Français",
        "Italiano",
        "Slovenščina",
        "Čeština",
        "Nederlands",
        "Dansk",
      ]);

      await header.getByRole("combobox", { name: "Language" }).selectOption("de");
      await expect(header.getByRole("button", { name: "Einstellungen" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
    });

    test("settings popup opens and closes with Escape", async ({ page }) => {
      const opener = page.getByRole("button", { name: "Settings" });
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Settings" });
      await expect(dialog).toBeVisible();
      // No language choice in the popup (REQ-468); export and import are icon buttons in the title row (REQ-469).
      await expect(dialog.getByRole("combobox", { name: "Language" })).toHaveCount(0);
      const title = await dialog.getByRole("heading", { name: "Settings" }).boundingBox();
      const exportBox = await dialog.getByRole("button", { name: "Export settings" }).boundingBox();
      const importBox = await dialog.getByRole("button", { name: "Import settings" }).boundingBox();
      const closeBox = await dialog.getByRole("button", { name: "Close" }).boundingBox();
      expect(title && exportBox && importBox && closeBox).toBeTruthy();
      expect(title!.x + title!.width).toBeLessThanOrEqual(exportBox!.x);
      expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(importBox!.x);
      expect(importBox!.x + importBox!.width).toBeLessThanOrEqual(closeBox!.x);
      for (const box of [exportBox!, importBox!]) {
        expect(Math.abs(box.y + box.height / 2 - (closeBox!.y + closeBox!.height / 2))).toBeLessThan(2);
      }
      await expect(dialog.getByRole("button", { name: "Export settings" })).toHaveText("");
      await expectNoHorizontalScroll(page);
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);

      // Tab stays inside the modal dialog.
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    });

    test("info popup: tabs by keyboard, close with Escape", async ({ page }) => {
      const opener = page.getByRole("banner").getByRole("button", { name: "Info" });
      await opener.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Information" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "About" })).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByRole("tab", { name: "About" })).toBeFocused();

      await page.keyboard.press("ArrowRight");
      const imprint = dialog.getByRole("tab", { name: "Legal notice" });
      await expect(imprint).toHaveAttribute("aria-selected", "true");
      await expect(imprint).toBeFocused();
      await expect(dialog.getByRole("tabpanel", { name: "Legal notice" })).toBeVisible();
      await page.keyboard.press("End");
      await expect(dialog.getByRole("tab", { name: "Privacy policy" })).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByRole("tabpanel", { name: "Privacy policy" })).toBeVisible();
      await expectNoHorizontalScroll(page);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    });
  });
}
