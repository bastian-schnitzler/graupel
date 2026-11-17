// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-809: the tab Design of the settings offers, on the website only, to hide the install button. Yes hides the
 * button in the header bar (desktop, tablet) and the entry "Install app" in the phone's menu, No shows them again; the
 * choice stays after reloading. The installed app has no such button and no such section.
 *
 * The browser is made one without an install prompt (like Safari and Firefox), so the button stands there without a
 * synthetic `beforeinstallprompt`. The installed app is emulated by a matchMedia stand-in (as install.spec.ts).
 */
import { expect, test, type Locator, type Page, onlyIn } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const SECTION = "Hide the “Install” button";

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Like Safari and Firefox, which do not know beforeinstallprompt: the install button opens the instructions. */
async function withoutInstallPrompt(page: Page) {
  await page.addInitScript(() => {
    delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
    delete (Window.prototype as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
  });
}

/** The installed app: its display mode matches (Playwright cannot set it). */
async function installed(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
        : original(query);
  });
}

async function load(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

/** Opens the settings from the header bar or the phone's menu; the tab Design is selected. */
async function openSettings(page: Page): Promise<Locator> {
  await (await headerControl(page, "button", "Settings")).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");
  return dialog;
}

/** Chooses Yes or No in the section and closes the settings. */
async function choose(page: Page, answer: "Yes" | "No") {
  const dialog = await openSettings(page);
  const group = dialog.getByRole("tabpanel").getByRole("radiogroup", { name: SECTION });
  await group.getByRole("radio", { name: answer }).check();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** The section's choice as the settings show it. */
async function shownChoice(page: Page) {
  const dialog = await openSettings(page);
  const group = dialog.getByRole("tabpanel").getByRole("radiogroup", { name: SECTION });
  const yes = await group.getByRole("radio", { name: "Yes" }).isChecked();
  const no = await group.getByRole("radio", { name: "No" }).isChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return yes && !no ? "Yes" : no && !yes ? "No" : "both or none";
}

const header = (page: Page) => page.locator('[data-region="header"]');
const downloadButton = (page: Page) => header(page).getByRole("button", { name: "Download" });

test("the section is the last of the tab Design, after colour mode and map, with No chosen (REQ-809)", async ({ page }) => {
  await withoutInstallPrompt(page);
  await load(page);
  const dialog = await openSettings(page);
  const panel = dialog.getByRole("tabpanel");
  await expect(panel.getByRole("heading")).toHaveText(["Colour mode", "Map", SECTION]);
  const group = panel.getByRole("radiogroup", { name: SECTION });
  await expect(group.getByRole("radio")).toHaveCount(2);
  await expect(group.locator("label")).toHaveText(["Yes", "No"]);
  await expect(group.getByRole("radio", { name: "No" })).toBeChecked();
  // Inside the popup, without sideways scrolling.
  const popup = (await dialog.boundingBox())!;
  const box = (await group.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(popup.x + popup.width + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe("header bar", () => {
  onlyIn(["desktop", "tablet"], "the header bar's install button; the phone's menu is tested below");

  test("Yes hides the install button, No shows it again; the choice stays after reloading (REQ-809)", async ({ page }) => {
    await withoutInstallPrompt(page);
    await load(page);
    await expect(downloadButton(page)).toBeVisible();
    const info = header(page).getByRole("button", { name: "Info" });
    const before = (await info.boundingBox())!;
    const download = (await downloadButton(page).boundingBox())!;

    await choose(page, "Yes");
    await expect(downloadButton(page)).toHaveCount(0);
    // No gap is left: info is the bar's last button, in the same row; where the bar is right-aligned it moves into the
    // download button's place.
    await expect(header(page).getByRole("button").last()).toHaveAccessibleName("Info");
    const after = (await info.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(after.height).toBeCloseTo(before.height, 0);
    expect([before.x, download.x + download.width - after.width].some((x) => Math.abs(after.x - x) < 1)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("graupel.hideInstallButton"))).toBe("true");

    await page.reload();
    await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
    await expect(info).toBeVisible();
    await expect(downloadButton(page)).toHaveCount(0);
    expect(await shownChoice(page)).toBe("Yes");

    await choose(page, "No");
    await expect(downloadButton(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("graupel.hideInstallButton"))).toBeNull();
    await page.reload();
    await expect(downloadButton(page)).toBeVisible();
    expect(await shownChoice(page)).toBe("No");
  });
});

test.describe("phone's menu", () => {
  onlyIn("phone", "the phone has no header bar; its menu holds the entry Install app");

  const panel = (page: Page) => page.getByTestId("phone-menu-panel");
  const menuButton = (page: Page) => page.locator('[data-region="location"]').getByRole("button", { name: "Menu" });
  /** The menu's entries, opened and closed again. */
  async function entries(page: Page) {
    await menuButton(page).click();
    await expect(panel(page)).toBeVisible();
    const names = await panel(page).getByRole("button").allTextContents();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    return names;
  }

  test("Yes removes “Install app” from the menu, No brings it back; the choice stays after reloading (REQ-809)", async ({
    page,
  }) => {
    await withoutInstallPrompt(page);
    await load(page);
    expect(await entries(page)).toContain("Install app");

    await choose(page, "Yes");
    expect(await entries(page)).toEqual(["Settings", "Info", "Help", "Legal notice", "Privacy"]);
    await page.reload();
    await expect(menuButton(page)).toBeVisible();
    expect(await entries(page)).not.toContain("Install app");
    expect(await shownChoice(page)).toBe("Yes");

    await choose(page, "No");
    expect(await entries(page)).toEqual(["Install app", "Settings", "Info", "Help", "Legal notice", "Privacy"]);
    await page.reload();
    await expect(menuButton(page)).toBeVisible();
    expect(await entries(page)).toContain("Install app");
  });
});

test("installed app (standalone): the tab Design has no such section (REQ-809)", async ({ page }) => {
  await installed(page);
  await withoutInstallPrompt(page);
  await load(page);
  const dialog = await openSettings(page);
  const panel = dialog.getByRole("tabpanel");
  await expect(panel.getByRole("heading")).toHaveText(["Colour mode", "Map"]);
  await expect(dialog.getByRole("radiogroup", { name: SECTION })).toHaveCount(0);
  await expect(dialog.getByText(SECTION)).toHaveCount(0);
});
