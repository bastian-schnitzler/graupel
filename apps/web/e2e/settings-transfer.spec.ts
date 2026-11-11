// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Export and import of settings and favourites in a real browser (REQ-429): the exported file restores the
 * language and the favourites; an invalid file is refused with a message and changes nothing.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./fixtures.ts";
import { chooseLanguage, headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";

test.use({ locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const favoriteNames = (page: Page) => page.locator(".location__favorites li");
const stored = (page: Page) =>
  page.evaluate(() => ({
    language: localStorage.getItem("graupel.language"),
    favorites: localStorage.getItem("graupel.favorites"),
  }));

test("exported settings and favourites are restored by an import", async ({ page }) => {
  await page.goto(APP);
  const location = page.locator('[data-region="location"]');
  await expect(favoriteNames(page)).toHaveText(["Großglockner", "Matterhorn", "Mont Blanc", "Gran Paradiso", "Ortler"]);
  // Own favourites: drop Mont Blanc (the start place), then choose German.
  await location.getByRole("button", { name: "Remove Mont Blanc from favourites" }).click();
  await expect(favoriteNames(page)).toHaveCount(4);
  // The language is chosen in the header (REQ-468); export and import are icon buttons in the title row (REQ-469).
  await chooseLanguage(page, "de", "Language");
  await (await headerControl(page, "button", "Einstellungen")).click();
  const popup = page.getByRole("dialog");
  await expect(page.getByRole("dialog", { name: "Einstellungen" })).toBeVisible();
  await expect(popup.getByRole("combobox", { name: "Sprache" })).toHaveCount(0);
  await popup.getByRole("radio", { name: "Maptoolkit" }).check();

  const downloadPromise = page.waitForEvent("download");
  await popup.getByRole("button", { name: "Einstellungen exportieren" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^graupel-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const exported = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  expect(exported).toMatchObject({
    format: "graupel-settings",
    version: 1,
    settings: { language: "de", map: "maptoolkit" },
    favorites: [{ name: "Großglockner" }, { name: "Matterhorn" }, { name: "Gran Paradiso" }, { name: "Ortler" }],
  });

  // Change all three, then import the file.
  await popup.getByRole("radio", { name: "OpenTopoMap" }).check();
  await popup.getByRole("button", { name: "Schließen" }).click();
  await chooseLanguage(page, "en", "Sprache");
  await location.getByRole("button", { name: "Add Mont Blanc to favourites" }).click();
  await expect(favoriteNames(page)).toHaveCount(5);

  await (await headerControl(page, "button", "Settings")).click();
  await expect(popup.getByRole("radio", { name: "OpenTopoMap" })).toBeChecked();
  await popup.getByTestId("settings-import-file").setInputFiles(path);
  await expect(popup.getByRole("status")).toHaveText("Einstellungen und Favoriten wurden importiert.");
  await expect(page.getByRole("dialog", { name: "Einstellungen" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(popup.getByRole("radio", { name: "Maptoolkit" })).toBeChecked();
  await expect(favoriteNames(page)).toHaveText(["Großglockner", "Matterhorn", "Gran Paradiso", "Ortler"]);

  // The import survives a reload.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(favoriteNames(page)).toHaveText(["Großglockner", "Matterhorn", "Gran Paradiso", "Ortler"]);
});

test("an invalid file is refused with a message and changes nothing", async ({ page }) => {
  await page.goto(APP);
  await chooseLanguage(page, "fr", "Language");
  await (await headerControl(page, "button", "Paramètres")).click();
  const popup = page.getByRole("dialog");
  const before = await stored(page);

  await popup.getByTestId("settings-import-file").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ favorites: [{ name: "Nowhere" }] })),
  });
  await expect(popup.getByRole("alert")).toHaveText(
    "Ce fichier n'est pas un fichier de paramètres Graupel. Rien n'a été modifié.",
  );
  await popup.getByTestId("settings-import-file").setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "graupel-settings", version: 99, settings: { language: "de" } })),
  });
  await expect(popup.getByRole("alert")).toHaveText(
    "Ce fichier provient d'une version plus récente de Graupel et ne peut pas être lu. Rien n'a été modifié.",
  );
  await expect(popup.getByRole("status")).toHaveText("");
  expect(await stored(page)).toEqual(before);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(favoriteNames(page)).toHaveCount(5);
});
