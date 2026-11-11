// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The header's controls in each device class (REQ-745): the desktop's header bar, also on a tablet where its buttons fit
 * (REQ-731, REQ-748), else the phone's menu at the end of the place row (REQ-573). Tests that only use language,
 * settings or info, not the header itself, reach them so in every class.
 */
import { expect, type Locator, type Page } from "./fixtures.ts";

/** The header bar, or the phone's menu button where the page has no header bar. */
async function headerOrMenu(page: Page): Promise<{ header: Locator } | { menu: Locator }> {
  const header = page.locator('[data-region="header"]');
  const menu = page.getByTestId("phone-menu").getByRole("button").first();
  await expect(header.or(menu).first()).toBeVisible();
  return (await header.count()) > 0 ? { header } : { menu };
}

/**
 * The control `role` named `name` of the header bar, or of the phone's menu, opened first (REQ-573). In the header bar
 * the language is a combobox, settings and info are buttons, as in the menu.
 */
export async function headerControl(
  page: Page,
  role: "button" | "combobox",
  name: string | RegExp,
): Promise<Locator> {
  const found = await headerOrMenu(page);
  if ("header" in found) return found.header.getByRole(role, { name });
  await found.menu.click();
  const panel = page.getByTestId("phone-menu-panel");
  await expect(panel).toBeVisible();
  return panel.getByRole(role, { name });
}

/** Chooses the language `value` in the header bar or the phone's menu. */
export async function chooseLanguage(page: Page, value: string, name: string | RegExp = "Language") {
  await (await headerControl(page, "combobox", name)).selectOption(value);
  // The phone's menu stays open after the choice; Escape closes it.
  if (await page.getByTestId("phone-menu-panel").isVisible()) await page.keyboard.press("Escape");
}
