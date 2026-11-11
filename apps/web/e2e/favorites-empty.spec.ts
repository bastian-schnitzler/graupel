// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * First visit (REQ-708): on every domain the favourites menu is empty, the start place of the domain included; a place
 * marked with the star is listed and stays after a reload.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";

const APP = "http://localhost:4175/";

const DOMAINS = [
  { tld: "at", start: "Großglockner" },
  { tld: "ch", start: "Matterhorn" },
  { tld: "fr", start: "Mont Blanc" },
  { tld: "it", start: "Ortler" },
  { tld: "eu", start: "Brussels" },
];

test.describe("favourites on a first visit (REQ-708)", () => {
  test.use({ locale: "en-GB", storedFavorites: false });

  for (const { tld, start } of DOMAINS) {
    test(`graupel.${tld} starts at ${start} without favourites`, async ({ page }) => {
      const config = readFileSync(new URL(`../domains/${tld}/config.json`, import.meta.url), "utf8");
      await page.route("**/config.json", (route) => route.fulfill({ contentType: "application/json", body: config }));
      await page.goto(APP);
      const location = page.locator('[data-region="location"]');
      await expect(location.getByRole("combobox").first()).toHaveValue(start);

      // The start place is no favourite, and the menu says how to mark one.
      const star = location.getByRole("button", { name: `Add ${start} to favourites` });
      await expect(star).toHaveAttribute("aria-pressed", "false");
      const arrow = location.getByRole("button", { name: "Show favourites" });
      await arrow.click();
      const menu = location.getByRole("menu", { name: "Favourites" });
      await expect(menu.getByRole("menuitem")).toHaveText(["No favourites yet. Mark a place with the star."]);
      await arrow.click();

      // Marked, it is listed, also after a reload.
      await star.click();
      await expect(location.getByRole("button", { name: `Remove ${start} from favourites` })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await page.reload();
      await location.getByRole("button", { name: "Show favourites" }).click();
      await expect(location.getByRole("menu", { name: "Favourites" }).getByRole("menuitem")).toHaveText([start]);
    });
  }
});
