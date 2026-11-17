// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renaming a favourite on a phone and a tablet (REQ-862), in every device class: the desktop renames in the menu's row
 * as before (REQ-489), without a popup. A phone and a tablet open a popup "<name> rename?" with a field holding the
 * name so far (focused and selected), OK and Cancel, in the look of the other dialogs (the X without a blue frame,
 * REQ-776). OK changes the name in the menu, Cancel leaves it, an empty name leaves OK disabled.
 */
import { expect, onlyIn, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 17 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 17, 9);

test.use({ locale: "en-GB", timezoneId: "UTC", storedFavorites: false });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  // A preset place and a map point that was renamed earlier.
  await page.addInitScript(() => {
    if (!localStorage.getItem("graupel.favorites")) {
      localStorage.setItem(
        "graupel.favorites",
        JSON.stringify([
          { name: "Sölden", lat: 46.9655, lon: 11.0076 },
          { name: "Alm", lat: 47.1718, lon: 12.6806, mapPoint: true },
        ]),
      );
    }
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const region = (page: Page) => page.locator('[data-region="location"]');
const menu = (page: Page) => page.getByRole("menu", { name: "Favourites" });

async function openPencil(page: Page) {
  await page.goto(APP);
  await region(page).getByRole("button", { name: "Show favourites" }).click();
  await expect(menu(page)).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Rename Alm" }).click();
}

test("the desktop renames in the menu's row, a phone and a tablet in a popup (REQ-862)", async ({
  page,
  deviceClass,
}) => {
  await openPencil(page);
  const popup = page.getByRole("dialog", { name: "Rename Alm?" });
  if (deviceClass === "desktop") {
    await expect(popup).toHaveCount(0);
    const inline = menu(page).getByRole("textbox", { name: "Name of the favourite" });
    await expect(inline).toBeFocused();
    await inline.fill("Hütte");
    await inline.press("Enter");
    await expect(menu(page).getByRole("menuitem", { name: "Hütte", exact: true })).toBeVisible();
    return;
  }

  // Phone and tablet: the popup with the question, the field, OK and Cancel; the menu's row keeps its label.
  await expect(popup).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Rename Alm?" })).toBeVisible();
  await expect(menu(page).getByRole("textbox")).toHaveCount(0);
  const field = popup.getByRole("textbox", { name: "Name of the favourite" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Alm");
  // The name so far is selected: typing replaces it.
  expect(await field.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, 3]);
  const ok = popup.getByRole("button", { name: "OK", exact: true });
  const cancel = popup.getByRole("button", { name: "Cancel", exact: true });
  await expect(ok).toBeVisible();
  await expect(cancel).toBeVisible();
  // The popup fits the screen, its field at least 16 px so Safari does not zoom (REQ-578).
  const box = (await popup.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(await field.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);

  // OK takes the new name: the menu behind shows it.
  await field.fill("Hütte");
  await ok.click();
  await expect(popup).toHaveCount(0);
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Hütte", exact: true })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Alm", exact: true })).toHaveCount(0);

  // Chosen, the place carries it.
  await menu(page).getByRole("menuitem", { name: "Hütte", exact: true }).click();
  await expect(region(page).getByRole("combobox")).toHaveValue("Hütte");
});

test.describe("the popup", () => {
  onlyIn(["phone", "tablet"], "the desktop renames in the menu's row (favorite-rename.spec.ts)");

  test("Cancel, Escape and the X leave the name; an empty name is not taken (REQ-862)", async ({ page }) => {
    await popupCases(page);
  });
});

async function popupCases(page: Page) {
  await openPencil(page);
  const popup = page.getByRole("dialog", { name: "Rename Alm?" });
  const field = popup.getByRole("textbox", { name: "Name of the favourite" });

  // Cancel.
  await field.fill("Hütte");
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(menu(page).getByRole("menuitem", { name: "Alm", exact: true })).toBeVisible();

  // The X, in the look of the other dialogs: no blue frame while it is pressed (REQ-776).
  await menu(page).getByRole("menuitem", { name: "Rename Alm" }).click();
  await field.fill("Hütte");
  const close = popup.getByRole("button", { name: "Close" });
  await close.hover();
  await page.mouse.down();
  expect(await close.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  expect(await close.evaluate((node) => getComputedStyle(node).boxShadow)).toBe("none");
  await page.mouse.up();
  await expect(popup).toHaveCount(0);
  await expect(menu(page).getByRole("menuitem", { name: "Alm", exact: true })).toBeVisible();

  // Escape closes only the popup, the menu stays.
  await menu(page).getByRole("menuitem", { name: "Rename Alm" }).click();
  await field.fill("Hütte");
  await field.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Alm", exact: true })).toBeVisible();

  // An empty name: OK disabled, Enter does nothing.
  await menu(page).getByRole("menuitem", { name: "Rename Alm" }).click();
  await field.fill("   ");
  await expect(popup.getByRole("button", { name: "OK", exact: true })).toBeDisabled();
  await field.press("Enter");
  await expect(popup).toBeVisible();
  // Enter with a name takes it.
  await field.fill("Alpe");
  await field.press("Enter");
  await expect(popup).toHaveCount(0);
  await expect(menu(page).getByRole("menuitem", { name: "Alpe", exact: true })).toBeVisible();

  // After a reload the name is still there.
  await page.reload();
  await region(page).getByRole("button", { name: "Show favourites" }).click();
  await expect(menu(page).getByRole("menuitem", { name: "Alpe", exact: true })).toBeVisible();
}
