// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tab bar of the settings popup (REQ-686) in a real browser, on the desktop and on a phone: the tabs Design, Start,
 * Models and Meteogram switch with the mouse and the keyboard, each setting is reachable in its tab and takes effect,
 * all tabs fit on a phone (the bar scrolls sideways where they do not), and the tab Archive appears only in the
 * installed app: the days the history keeps (a shorter choice deletes older fetches) and, on a phone only, the switch
 * of the history slider. The installed app is emulated by a matchMedia stand-in (as in history.spec.ts).
 */
import { expect, test, type Locator, type Page, ownDevice, onlyIn } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC; an earlier fetch a week before. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
const WEEK_BEFORE = FIXED_NOW - 7 * 24 * 3_600_000;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
/** Name of the phone's menu button and of the settings in each language. */
const NAMES: Readonly<Record<string, { menu: string; settings: string }>> = {
  en: { menu: "Menu", settings: "Settings" },
  de: { menu: "Menü", settings: "Einstellungen" },
  fr: { menu: "Menu", settings: "Paramètres" },
  it: { menu: "Menu", settings: "Impostazioni" },
  sl: { menu: "Meni", settings: "Nastavitve" },
  cs: { menu: "Nabídka", settings: "Nastavení" },
  nl: { menu: "Menu", settings: "Instellingen" },
  da: { menu: "Menu", settings: "Indstillinger" },
};

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];
/** The time the fake Open-Meteo answers from: the page's clock. */
let now = FIXED_NOW;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  now = FIXED_NOW;
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [200] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

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

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function load(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

/** Opens the settings popup from the header (desktop) or the phone's menu. */
async function openSettings(page: Page, language = "en") {
  const { menu: menuName, settings: name } = NAMES[language]!;
  const menu = page.locator('[data-region="location"]').getByRole("button", { name: menuName, exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByTestId("phone-menu-panel").getByRole("button", { name }).click();
  } else {
    await page.locator('[data-region="header"]').getByRole("button", { name }).click();
  }
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

const tabList = (dialog: Locator) => dialog.getByRole("tablist");
const tab = (dialog: Locator, name: string) => tabList(dialog).getByRole("tab", { name, exact: true });
const panel = (dialog: Locator) => dialog.getByRole("tabpanel");

async function expectSelected(dialog: Locator, name: string) {
  await expect(tab(dialog, name)).toHaveAttribute("aria-selected", "true");
  await expect(panel(dialog)).toHaveCount(1);
  await expect(panel(dialog)).toHaveAttribute("aria-labelledby", (await tab(dialog, name).getAttribute("id"))!);
}

/** Each setting in its tab, switched with the mouse, and its effect on the page. */
async function everySettingTakesEffect(page: Page, dialog: Locator) {
  // Design: colour mode and map.
  await tab(dialog, "Design").click();
  await expectSelected(dialog, "Design");
  await panel(dialog).getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await panel(dialog).getByRole("radio", { name: "Light" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await panel(dialog).getByRole("radio", { name: "Maptoolkit" }).check();
  expect(await page.evaluate(() => localStorage.getItem("graupel.map"))).toBe("maptoolkit");

  // Start: start place, day slider and the days shown.
  await tab(dialog, "Start").click();
  await expectSelected(dialog, "Start");
  await panel(dialog).getByRole("combobox", { name: "Start place" }).selectOption({ label: "Current position (GPS)" });
  expect(await page.evaluate(() => localStorage.getItem("graupel.startLocation"))).toBe("gps");
  const slider = page.locator('[data-region="day-slider"]');
  await expect(slider).toBeAttached();
  await panel(dialog).getByRole("checkbox", { name: "Show the day slider" }).uncheck();
  await expect(slider).toHaveCount(0);
  const days = panel(dialog).getByRole("combobox", { name: "Days shown" });
  await expect(days).toBeEnabled();
  await days.selectOption("2");
  await expect
    .poll(async () => Date.parse((await chart(page).getAttribute("data-visible-end-time"))!))
    .toBe(Date.UTC(2026, 9, 30));

  // Models: weather and cloud chain, model headers.
  await tab(dialog, "Models").click();
  await expectSelected(dialog, "Models");
  await panel(dialog).getByRole("checkbox", { name: "Show the weather chain" }).check();
  await expect(page.locator(".model-chain-row")).toHaveCount(1);
  await panel(dialog).getByRole("checkbox", { name: "Show the cloud chain" }).check();
  await expect(page.locator(".model-chain-row")).toHaveCount(2);
  const headers = page.locator('[data-region="meteogram"] [data-testid="model-header-shape"]');
  await expect(headers.first()).toBeAttached();
  await panel(dialog).getByRole("checkbox", { name: "Show model headers" }).uncheck();
  await expect(headers).toHaveCount(0);

  // Meteogram: legend, axes when zoomed, dew point, relative humidity.
  await tab(dialog, "Meteogram").click();
  await expectSelected(dialog, "Meteogram");
  await panel(dialog).getByRole("checkbox", { name: "Show the legend" }).uncheck();
  expect(await page.evaluate(() => localStorage.getItem("graupel.legend"))).toBe("false");
  await expect(page.getByTestId("meteogram-legend")).toHaveCount(0);
  await panel(dialog).getByRole("radiogroup", { name: "Adjust axes when zooming" }).getByRole("radio", { name: "Off" }).check();
  expect(await page.evaluate(() => localStorage.getItem("graupel.scaleToVisibleRange"))).toBe("false");
  const dewPoint = page.locator('[data-region="meteogram"] [data-testid="dew-point-path"]');
  await expect(dewPoint).toHaveCount(0);
  await panel(dialog).getByRole("radiogroup", { name: "Dew point" }).getByRole("radio", { name: "On" }).check();
  await expect(dewPoint.first()).toBeAttached();
  await panel(dialog).getByRole("radiogroup", { name: "Relative humidity" }).getByRole("radio", { name: "On" }).check();
  expect(await page.evaluate(() => localStorage.getItem("graupel.relativeHumidity"))).toBe("on");
  await expect(page.locator('[data-region="meteogram"] [data-testid="relative-humidity-path"]').first()).toBeAttached();
}

/** The keyboard moves between the tabs: arrow keys (wrapping), Home and End; Tab moves on into the panel. */
async function keyboardSwitchesTabs(page: Page, dialog: Locator, tabs: readonly string[]) {
  await tab(dialog, tabs[0]!).click();
  await expect(tab(dialog, tabs[0]!)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tab(dialog, tabs[1]!)).toBeFocused();
  await expectSelected(dialog, tabs[1]!);
  await page.keyboard.press("End");
  await expect(tab(dialog, tabs.at(-1)!)).toBeFocused();
  await expectSelected(dialog, tabs.at(-1)!);
  await page.keyboard.press("ArrowRight");
  await expect(tab(dialog, tabs[0]!)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(dialog, tabs.at(-1)!)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab(dialog, tabs[0]!)).toBeFocused();
  await expectSelected(dialog, tabs[0]!);
  // Tab leaves the tab bar into the panel: the colour mode's checked option.
  await page.keyboard.press("Tab");
  await expect(panel(dialog).getByRole("radio", { name: "System" })).toBeFocused();
  // Shift+Tab comes back to the selected tab, not to the others.
  await page.keyboard.press("Shift+Tab");
  await expect(tab(dialog, tabs[0]!)).toBeFocused();
}

/** The tab bar lies within the popup, below its heading row, and the page does not scroll sideways. */
async function expectBarInPopup(page: Page, dialog: Locator) {
  const bar = (await tabList(dialog).boundingBox())!;
  const box = (await dialog.boundingBox())!;
  const heading = (await dialog.getByRole("heading", { name: "Settings", level: 2 }).boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(box.x - 0.5);
  expect(bar.x + bar.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  expect(bar.y).toBeGreaterThan(heading.y + heading.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // No scrollbar takes room below the tabs.
  expect(await tabList(dialog).evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight)).toBeLessThanOrEqual(1);
}

test.describe("desktop", () => {
  onlyIn("desktop", "the desktop's settings popup; touch devices show more options, blocks phone");
  test("tabs switch with the mouse and the keyboard; every setting takes effect; no tab Archive", async ({ page }) => {
    await load(page);
    const dialog = await openSettings(page);
    await expect(tabList(dialog).getByRole("tab")).toHaveText(["Design", "Start", "Models", "Meteogram"]);
    await expectSelected(dialog, "Design");
    await expectBarInPopup(page, dialog);
    // All tabs in one row, without scrolling.
    expect(await tabList(dialog).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // The popup keeps its height when the tab changes.
    const height = (await dialog.boundingBox())!.height;
    await keyboardSwitchesTabs(page, dialog, ["Design", "Start", "Models", "Meteogram"]);
    await everySettingTakesEffect(page, dialog);
    expect((await dialog.boundingBox())!.height).toBe(height);
    // The tab bar stays in place while the panel scrolls.
    const barTop = (await tabList(dialog).boundingBox())!.y;
    await dialog.locator(".dialog__body").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect((await tabList(dialog).boundingBox())!.y).toBe(barTop);
    // Kept for the next visit, and the popup opens again at the tab shown last.
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(page.locator('[data-region="day-slider"]')).toHaveCount(0);
    const again = await openSettings(page);
    await expectSelected(again, "Design");
    await tab(again, "Meteogram").click();
    await page.keyboard.press("Escape");
    await expectSelected(await openSettings(page), "Meteogram");
  });

  test("the installed app adds the tab Archive: days to keep, a shorter choice deletes older fetches", async ({ page }) => {
    await installed(page);
    // A fetch a week before, then the current one: the history button appears.
    now = WEEK_BEFORE;
    await page.clock.setFixedTime(WEEK_BEFORE);
    await load(page);
    await expect(page.getByTestId("day-card").first()).toBeVisible();
    now = FIXED_NOW;
    await page.clock.setFixedTime(FIXED_NOW);
    await page.reload();
    await expect(chart(page)).toBeVisible();
    const historyButton = page.getByTestId("history-button");
    await expect(historyButton).toBeVisible();

    const dialog = await openSettings(page);
    await expect(tabList(dialog).getByRole("tab")).toHaveText(["Design", "Start", "Models", "Meteogram", "Archive"]);
    await keyboardSwitchesTabs(page, dialog, ["Design", "Start", "Models", "Meteogram", "Archive"]);
    await tab(dialog, "Archive").click();
    await expectSelected(dialog, "Archive");
    const keep = panel(dialog).getByRole("combobox", { name: "Days to keep" });
    await expect(keep).toHaveValue("unlimited");
    await expect(keep.locator("option")).toHaveText(["Unlimited", "365 days", "90 days", "14 days", "5 days"]);
    // Not on the desktop: the history slider.
    await expect(panel(dialog).getByRole("checkbox")).toHaveCount(0);
    // 14 days keep the fetch of a week before; 5 days delete it, so the history has nothing to offer.
    await keep.selectOption("14");
    expect(await page.evaluate(() => localStorage.getItem("graupel.archiveDays"))).toBe("14");
    await page.waitForTimeout(300);
    await expect(historyButton).toBeVisible();
    await keep.selectOption("5");
    expect(await page.evaluate(() => localStorage.getItem("graupel.archiveDays"))).toBe("5");
    await expect(historyButton).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(chart(page)).toBeVisible();
    const again = await openSettings(page);
    await tab(again, "Archive").click();
    await expect(panel(again).getByRole("combobox", { name: "Days to keep" })).toHaveValue("5");
  });

  test("reference image of the popup (tab Design)", async ({ page }) => {
    await load(page);
    const dialog = await openSettings(page);
    await expect(dialog).toHaveScreenshot("settings-desktop-design.png");
  });
});

test.describe("phone", () => {
  test.use(PHONE);
  ownDevice();

  test("all tabs fit or scroll into view; tabs switch by touch and keyboard; every setting takes effect", async ({ page }) => {
    await load(page);
    const dialog = await openSettings(page);
    await expect(tabList(dialog).getByRole("tab")).toHaveText(["Design", "Start", "Models", "Meteogram"]);
    await expectBarInPopup(page, dialog);
    // Each tab can be reached: tapped, it lies inside the bar.
    for (const name of ["Meteogram", "Design", "Models", "Start"]) {
      await tab(dialog, name).tap();
      await expectSelected(dialog, name);
      const bar = (await tabList(dialog).boundingBox())!;
      const button = (await tab(dialog, name).boundingBox())!;
      expect(button.x).toBeGreaterThanOrEqual(bar.x - 0.5);
      expect(button.x + button.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
    }
    await keyboardSwitchesTabs(page, dialog, ["Design", "Start", "Models", "Meteogram"]);
    await everySettingTakesEffect(page, dialog);
  });

  test("the tab bar fits or scrolls in every language", async ({ page }) => {
    await load(page);
    for (const language of Object.keys(NAMES)) {
      await page.evaluate((value) => localStorage.setItem("graupel.language", value), language);
      await page.reload();
      await expect(chart(page)).toBeVisible();
      const dialog = await openSettings(page, language);
      await expect(tabList(dialog).getByRole("tab")).toHaveCount(4);
      const tabs = tabList(dialog).getByRole("tab");
      // The last tab, chosen with End, is scrolled into the bar.
      await tabs.first().focus();
      await page.keyboard.press("End");
      const bar = (await tabList(dialog).boundingBox())!;
      const last = (await tabs.last().boundingBox())!;
      expect(last.x + last.width, language).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
      await page.keyboard.press("Home");
      const first = (await tabs.first().boundingBox())!;
      expect(first.x, language).toBeGreaterThanOrEqual(bar.x - 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), language).toBe(true);
      await page.keyboard.press("Escape");
    }
  });

  test("the installed app adds the tab Archive with the history slider switch", async ({ page }) => {
    await installed(page);
    await load(page);
    const dialog = await openSettings(page);
    await expect(tabList(dialog).getByRole("tab")).toHaveText(["Design", "Start", "Models", "Meteogram", "Archive"]);
    await tab(dialog, "Archive").tap();
    await expectSelected(dialog, "Archive");
    // Scrolled into the bar where it would not fit.
    const bar = (await tabList(dialog).boundingBox())!;
    const archive = (await tab(dialog, "Archive").boundingBox())!;
    expect(archive.x + archive.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
    await panel(dialog).getByRole("combobox", { name: "Days to keep" }).selectOption("90");
    expect(await page.evaluate(() => localStorage.getItem("graupel.archiveDays"))).toBe("90");
    const slider = panel(dialog).getByRole("checkbox", { name: "Show the history slider" });
    await expect(slider).not.toBeChecked();
    await expect(panel(dialog).getByText("Shows the days with kept fetches in a bar like the day slider.")).toBeVisible();
    await expect(dialog).toHaveScreenshot("settings-phone-archive.png");
    await slider.check();
    expect(await page.evaluate(() => localStorage.getItem("graupel.historySlider"))).toBe("true");
    await slider.uncheck();
    expect(await page.evaluate(() => localStorage.getItem("graupel.historySlider"))).toBeNull();
  });

  test("reference image of the popup (tab Design)", async ({ page }) => {
    await load(page);
    const dialog = await openSettings(page);
    await expect(dialog).toHaveScreenshot("settings-phone-design.png");
  });
});
