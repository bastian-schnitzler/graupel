// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Help" beside the other info entries (REQ-849, REQ-853): in the desktop's footer it stands between "Info" and the
 * imprint, in the phone's menu after "Info"; a click or tap opens the info popup at its Help tab. A tablet has the
 * phone's design (REQ-728): its footer has no links (REQ-582); where its header buttons do not fit, the phone's menu
 * takes Help at the same place (REQ-731). In English and German.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Thursday, 12 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 12, 9);

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

/** Names of the entries and of the popup in each language. */
const LANGUAGES = {
  en: { entries: ["Info", "Help", "Legal notice", "Privacy"], help: "Help", popup: "Information", menu: "Menu" },
  de: { entries: ["Info", "Hilfe", "Impressum", "Datenschutz"], help: "Hilfe", popup: "Information", menu: "Menü" },
} as const;

async function open(page: Page, language: keyof typeof LANGUAGES) {
  if (language !== "en") await page.addInitScript((value) => localStorage.setItem("graupel.language", value), language);
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

const footerLinks = (page: Page) => page.locator('footer[data-region="footer"]').getByRole("navigation").getByRole("button");
const panel = (page: Page) => page.getByTestId("phone-menu-panel");

/** The popup is open at its Help tab, which shows the help. */
async function expectHelpTab(page: Page, language: keyof typeof LANGUAGES) {
  const names = LANGUAGES[language];
  const dialog = page.getByRole("dialog", { name: names.popup });
  await expect(dialog.getByRole("tab", { selected: true })).toHaveText(names.help);
  await expect(dialog.getByRole("tabpanel", { name: names.help })).toBeVisible();
  await expect(dialog.locator('[data-help-section="meteogram"]')).toBeVisible();
}

/** Opens the phone's menu and checks its last entries: Info, Help, imprint, privacy (REQ-853); returns Help. */
async function menuHelp(page: Page, language: keyof typeof LANGUAGES): Promise<Locator> {
  const names = LANGUAGES[language];
  await page.locator('[data-region="location"]').getByRole("button", { name: names.menu }).click();
  await expect(panel(page)).toBeVisible();
  const buttons = panel(page).getByRole("button");
  const texts = await buttons.allTextContents();
  expect(texts.slice(-4)).toEqual(names.entries);
  return buttons.nth(texts.length - 3);
}

for (const language of ["en", "de"] as const) {
  test(`Info › Help › imprint › privacy, Help opens the Help tab, ${language} (REQ-849, REQ-853)`, async ({
    page,
    deviceClass,
  }) => {
    await open(page, language);
    const names = LANGUAGES[language];
    if (deviceClass === "desktop") {
      // REQ-849: in the footer, between Info and the imprint.
      await expect(footerLinks(page)).toHaveText([...names.entries]);
      await expect(page.getByTestId("phone-menu")).toHaveCount(0);
      await footerLinks(page).nth(1).click();
      await expectHelpTab(page, language);
    } else if (deviceClass === "phone") {
      // REQ-853: the phone's footer has no links (REQ-582); in the menu Help follows Info.
      await expect(footerLinks(page)).toHaveCount(0);
      const help = await menuHelp(page, language);
      await help.tap();
      await expect(panel(page)).toBeHidden();
      await expectHelpTab(page, language);
    } else {
      // A tablet has the phone's design (REQ-728): no links in the footer (REQ-582). The iPad's header buttons fit
      // beside the place row (REQ-731), so it has no menu either; the narrow tablet below has one.
      await expect(footerLinks(page)).toHaveCount(0);
      await expect(page.locator('[data-region="header"]')).toBeVisible();
      await expect(page.getByTestId("phone-menu")).toHaveCount(0);
    }
  });
}

test.describe("narrow tablet with the phone's menu", () => {
  /** A tablet whose short side just makes it one (DEC-090), too narrow upright for the desktop's header row (REQ-731). */
  test.use({ viewport: { width: 600, height: 960 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ownDevice();

  test("the menu has Help after Info, a tap opens the Help tab (REQ-853, REQ-731)", async ({ page }) => {
    await open(page, "en");
    await expect(footerLinks(page)).toHaveCount(0);
    const help = await menuHelp(page, "en");
    await help.tap();
    await expect(panel(page)).toBeHidden();
    await expectHelpTab(page, "en");
  });
});
