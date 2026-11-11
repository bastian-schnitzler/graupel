// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's top and menu (REQ-573, REQ-575, REQ-580, REQ-582), in the iPhone's size with touch: at the top only the
 * place row, without the header bar above it, the line with elevation and coordinates below it and the card around it.
 * The menu button stands at the end of the row, after the favourites; its menu opens below it with language,
 * installation, settings, info, imprint and privacy, and opening and closing it leaves the page where it is (REQ-574).
 * The footer keeps only the picture buttons. In the browser the place row starts at the page's top edge, the installed
 * app and the desktop keep the page's top margin (REQ-586). Below the day slider's row of grips the meteogram's first
 * row follows with no more room than there is between the place row and the slider (REQ-607), and with as much: 10 px
 * above and below the slider, with or without the model headers (REQ-615).
 */
import { expect, test, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "en-GB" });
ownDevice();

async function open(page: Page) {
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
}

const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
const region = (page: Page) => page.locator('[data-region="location"]');
const menuButton = (page: Page) => region(page).getByRole("button", { name: "Menu" });
const panel = (page: Page) => page.getByTestId("phone-menu-panel");

test("at the top only the place row, without a card, as wide as the day slider (REQ-573, REQ-580)", async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-region="header"]')).toHaveCount(0);
  await expect(page.getByTestId("location-elevation")).toHaveCount(0);
  await expect(page.getByTestId("location-coordinates")).toHaveCount(0);
  // The place and its elevation still stand between the day slider's grips (REQ-562).
  await expect(page.getByTestId("day-slider-caption")).toContainText(" m");
  const top = page.locator(".app__top");
  const look = await top.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
  });
  expect(look).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px", shadow: "none" });
  // The row has the day slider's width: no padding of a card around it.
  const bar = await box(page.locator(".location__bar"));
  const slider = await box(page.locator('[data-region="day-slider"]'));
  expect(Math.abs(bar.x - slider.x)).toBeLessThan(1);
  expect(Math.abs(bar.x + bar.width - (slider.x + slider.width))).toBeLessThan(1);
});

/** The page's top margin, the place row's top edge and its gap to the day slider, at the top of the page. */
async function pageTop(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const margin = await page.locator(".app__inner").evaluate((element) => getComputedStyle(element).paddingTop);
  const bar = await box(page.locator(".location__bar"));
  const slider = await box(page.locator('[data-region="day-slider"]'));
  return { margin, row: bar.y, gap: slider.y - (bar.y + bar.height) };
}

/** Room between the place row and the day slider on a phone, as below the slider's grips (REQ-615). */
const SLIDER_GAP = 10;

test("in the browser the place row starts at the page's top edge, 10 px above the day slider (REQ-586, REQ-615)", async ({
  page,
}) => {
  await open(page);
  const { margin, row, gap } = await pageTop(page);
  expect(margin).toBe("0px");
  expect(row).toBeGreaterThanOrEqual(0);
  expect(row).toBeLessThanOrEqual(1);
  expect(Math.abs(gap - SLIDER_GAP)).toBeLessThan(0.5);
});

// The installed app has no address bar above the page, which starts below the status bar: the margin stays. Android
// and desktops report the display mode, iOS a home-screen app through navigator.standalone.
for (const [name, installed] of [
  [
    "display mode standalone",
    () => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
          : original(query);
    },
  ],
  [
    "iOS home screen",
    () => Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true }),
  ],
] as const) {
  test(`the installed app (${name}) keeps the page's top margin above the place row (REQ-586, REQ-615)`, async ({
    page,
  }) => {
    await page.addInitScript(installed);
    await open(page);
    const { margin, row, gap } = await pageTop(page);
    expect(margin).toBe("12px");
    expect(Math.abs(row - 12)).toBeLessThan(0.5);
    expect(Math.abs(gap - SLIDER_GAP)).toBeLessThan(0.5);
  });
}

/**
 * Room between the place row and the day slider's strip, and between the slider's row of grips (with place and
 * elevation, REQ-562) and the top edge of the meteogram's first row: its first model header, or without model headers
 * its day row (REQ-615). Also where the slider ends and the chart's drawing starts. With the legend card between them
 * (REQ-639), the room from the grips to the card and from the card to the first row.
 */
async function sliderGaps(page: Page, headers: boolean) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const bar = await box(page.locator(".location__bar"));
  const slider = await box(page.locator('[data-region="day-slider"]'));
  const grips = await page.locator(".day-slider__handle, [data-testid='day-slider-caption']").evaluateAll((elements) =>
    Math.max(...elements.map((element) => element.getBoundingClientRect().bottom)),
  );
  const chart = page.locator('[data-region="meteogram"]');
  const first = await box(chart.getByTestId(headers ? "model-header-shape" : "day-label-cell").first());
  const svg = await box(chart.locator("svg.meteogram-svg-integrated"));
  const legend = page.getByTestId("meteogram-legend");
  const card = (await legend.count()) > 0 ? await box(legend) : null;
  return {
    above: slider.y - (bar.y + bar.height),
    below: first.y - grips,
    grips,
    chart: svg.y,
    legend: card ? { above: card.y - grips, below: first.y - (card.y + card.height) } : null,
  };
}

for (const [name, installed] of [
  ["in the browser", () => undefined],
  [
    "in the installed app",
    () => Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true }),
  ],
] as const) {
  for (const headers of [true, false]) {
    test(`${name} the meteogram's first row follows the slider's grips as closely as the slider the place row, ${
      headers ? "with" : "without"
    } model headers (REQ-607, REQ-615)`, async ({ page }) => {
      await page.addInitScript(installed);
      // The model headers as switched in the settings (REQ-472).
      if (!headers) await page.addInitScript(() => localStorage.setItem("graupel.modelHeaders", "false"));
      await open(page);
      const shapes = page.locator('[data-region="meteogram"] [data-testid="model-header-shape"]');
      if (headers) await expect(shapes.first()).toBeVisible();
      else await expect(shapes).toHaveCount(0);
      // With the legend card (REQ-639): it follows the grips, and the first row follows it, as closely as the slider
      // follows the place row.
      await expect(page.getByTestId("meteogram-legend")).toBeVisible();
      const withLegend = await sliderGaps(page, headers);
      expect(withLegend.legend).not.toBeNull();
      expect(Math.abs(withLegend.legend!.above - withLegend.above)).toBeLessThan(1);
      expect(Math.abs(withLegend.legend!.below - withLegend.above)).toBeLessThan(1);
      // Without it, the first row follows the grips.
      await page.getByRole("button", { name: "Close the legend" }).tap();
      await expect(page.getByTestId("meteogram-legend")).toHaveCount(0);
      const { above, below, grips, chart } = await sliderGaps(page, headers);
      expect(Math.abs(above - SLIDER_GAP)).toBeLessThan(0.5);
      // As much room below as above (under 1 px apart), so not more below than above (REQ-607).
      expect(Math.abs(below - above)).toBeLessThan(1);
      // Everything of the slider stays above the chart and what it draws.
      const region = await box(page.locator('[data-region="meteogram"]'));
      const caption = await box(page.getByTestId("day-slider-caption"));
      expect(caption.y + caption.height).toBeLessThanOrEqual(region.y + 0.5);
      expect(grips).toBeLessThanOrEqual(chart + 0.5);
    });
  }
}

test("the menu button stands after the favourites, at the end of the place row (REQ-580)", async ({ page }) => {
  await open(page);
  const menu = await box(menuButton(page));
  const favourites = await box(region(page).locator(".location__favorites"));
  const bar = await box(page.locator(".location__bar"));
  expect(menu.x).toBeGreaterThanOrEqual(favourites.x + favourites.width);
  expect(Math.abs(menu.x + menu.width - (bar.x + bar.width))).toBeLessThan(1);
  // One row.
  expect(Math.abs(menu.y + menu.height / 2 - (favourites.y + favourites.height / 2))).toBeLessThan(2);
  // The footer has no menu and no links any more (REQ-582), only copy and save.
  const footer = page.locator('footer[data-region="footer"]');
  await expect(footer.getByRole("button")).toHaveCount(2);
  await expect(footer.getByTestId("meteogram-copy")).toBeVisible();
  await expect(footer.getByTestId("meteogram-save")).toBeVisible();
});

test("the menu opens below its button and moves nothing; its entries in order (REQ-574, REQ-580, REQ-582)", async ({
  page,
}) => {
  await open(page);
  // Scrolled down, as far as the button stays whole on the screen: a tap on a button partly above the screen would
  // scroll it into view first.
  const top = await menuButton(page).evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), Math.floor(top));
  const scrolled = await page.evaluate(() => window.scrollY);
  await expect(panel(page)).toBeHidden();

  await menuButton(page).tap();
  await expect(panel(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  const panelBox = await box(panel(page));
  const buttonBox = await box(menuButton(page));
  // Below the button, at its right edge, within the screen.
  expect(panelBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
  expect(Math.abs(panelBox.x + panelBox.width - (buttonBox.x + buttonBox.width))).toBeLessThan(1);
  expect(panelBox.x).toBeGreaterThanOrEqual(0);
  await expect(panel(page).getByRole("combobox", { name: "Language" })).toBeVisible();
  // Chromium offers the installation once it fires its install prompt (REQ-425); then it stands below the language,
  // highlighted (REQ-582).
  await expect(panel(page).getByRole("button")).toHaveText(["Settings", "Info", "Legal notice", "Privacy"]);
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    window.dispatchEvent(event);
  });
  await expect(panel(page).getByRole("button")).toHaveText(["Install app", "Settings", "Info", "Legal notice", "Privacy"]);
  const install = panel(page).getByRole("button", { name: "Install app" });
  const background = await install.evaluate((element) => getComputedStyle(element).backgroundColor);
  const accent = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--color-accent)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  expect(background).toBe(accent);
  // A divider between the settings and the info.
  const divider = await box(panel(page).getByRole("separator"));
  const settings = await box(panel(page).getByRole("button", { name: "Settings" }));
  const info = await box(panel(page).getByRole("button", { name: "Info" }));
  expect(divider.y).toBeGreaterThanOrEqual(settings.y + settings.height);
  expect(divider.y + divider.height).toBeLessThanOrEqual(info.y);

  // A tap beside it (on the day slider's caption) closes it, and the page stays where it was.
  const caption = await box(page.getByTestId("day-slider-caption"));
  await page.touchscreen.tap(caption.x + 4, caption.y + caption.height / 2);
  await expect(panel(page)).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

  // A second tap on the button closes it as well.
  await menuButton(page).tap();
  await expect(panel(page)).toBeVisible();
  await menuButton(page).tap();
  await expect(panel(page)).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test("the menu opens the settings and the info at its tabs, and switches the language (REQ-575, REQ-582)", async ({
  page,
}) => {
  await open(page);
  await menuButton(page).tap();
  await panel(page).getByRole("button", { name: "Settings" }).tap();
  await expect(panel(page)).toBeHidden();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).tap();
  await expect(settings).toBeHidden();

  for (const [entry, tab] of [
    ["Info", "About"],
    ["Legal notice", "Legal notice"],
    ["Privacy", "Privacy policy"],
  ] as const) {
    await menuButton(page).tap();
    await panel(page).getByRole("button", { name: entry, exact: true }).tap();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByRole("dialog").getByRole("tab", { selected: true })).toHaveText(tab);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  await menuButton(page).tap();
  await panel(page).getByRole("combobox", { name: "Language" }).selectOption("de");
  await expect(panel(page)).toBeHidden();
  await region(page).getByRole("button", { name: "Menü" }).tap();
  await expect(panel(page).getByRole("button", { name: "Impressum" })).toBeVisible();
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  ownDevice();

  test("keeps the header bar, the card, elevation and coordinates and the footer links, and has no menu", async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator('[data-region="header"]').getByRole("combobox", { name: "Language" })).toBeVisible();
    await expect(page.getByTestId("location-elevation")).toBeVisible();
    await expect(page.getByTestId("location-coordinates")).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
    const border = await page.locator(".app__top").evaluate((element) => getComputedStyle(element).borderTopWidth);
    expect(border).toBe("1px");
    await expect(page.locator("footer").getByRole("navigation").getByRole("button")).toHaveText([
      "Info",
      "Legal notice",
      "Privacy",
    ]);
  });

  test("keeps the page's top margin above the card (REQ-586 is for the phone in the browser)", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.locator(".app__inner").evaluate((element) => getComputedStyle(element).paddingTop)).toBe("16px");
    expect(Math.abs((await box(page.locator(".app__top"))).y - 16)).toBeLessThan(0.5);
  });

  test("keeps the page's gaps around the day slider and the chart's top edge (REQ-615 is for the phone)", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const top = await box(page.locator(".app__top"));
    const slider = await box(page.locator('[data-region="day-slider"]'));
    const card = await box(page.getByTestId("meteogram-card"));
    expect(Math.abs(slider.y - (top.y + top.height) - 16)).toBeLessThan(0.5);
    // The legend's card stands between them where the margin has no room for it beside the chart (REQ-670), with the
    // same gaps as the other cards.
    const legend = await box(page.getByTestId("meteogram-legend"));
    expect(Math.abs(legend.y - (slider.y + slider.height) - 12)).toBeLessThan(0.5);
    expect(Math.abs(card.y - (legend.y + legend.height) - 12)).toBeLessThan(0.5);
    // The chart starts at its region's top edge, with the room above its model headers.
    const region = await box(page.locator('[data-region="meteogram"]'));
    const chart = await box(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated'));
    expect(Math.abs(chart.y - region.y)).toBeLessThan(0.5);
  });
});
