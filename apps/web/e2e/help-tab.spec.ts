// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Help tab of the info popup (REQ-819) on the phone, the tablet and the desktop: reachable between Info and the imprint,
 * the tab bar still in one row (REQ-780), five sections with drawn pictures that follow the light and dark design, the
 * model chains and the day slider only while the page shows them, the history only in the installed app, and the texts
 * of the device class. Reference images per device class, light and dark.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Thursday, 12 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 12, 9);
const DE = JSON.parse(readFileSync(new URL("../src/i18n/de.json", import.meta.url), "utf8")) as Record<string, string>;

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
  await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Opens the info popup and its Help tab; returns the dialog. */
async function openHelp(page: Page): Promise<Locator> {
  await page.goto(APP);
  await (await headerControl(page, "button", "Info")).click();
  const dialog = page.getByRole("dialog", { name: "Information" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Hilfe" }).click();
  await expect(dialog.getByRole("tab", { name: "Hilfe" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tabpanel", { name: "Hilfe" })).toBeVisible();
  return dialog;
}

const sectionNames = (dialog: Locator) =>
  dialog.locator("[data-help-section]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.helpSection));

/** The tab bar in one row (REQ-780): one top edge, no scrollbar, nothing beyond the page. */
async function expectOneRow(dialog: Locator) {
  const bar = dialog.getByRole("tablist");
  const box = await bar.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    return {
      tops: [...element.querySelectorAll('[role="tab"]')].map((tab) => Math.round(tab.getBoundingClientRect().top)),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollbarX: element.offsetHeight - element.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
      fontSize: parseFloat(getComputedStyle(element.querySelector('[role="tab"]')!).fontSize),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(box.tops).toHaveLength(4);
  expect(new Set(box.tops).size).toBe(1);
  expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
  expect(box.scrollbarX).toBe(0);
  expect(box.fontSize).toBeGreaterThanOrEqual(13);
  expect(box.pageOverflow).toBeLessThanOrEqual(0);
}

/** Fill colours of the pictures' background and highlight, and of the meteogram's temperature curve. */
const pictureColours = (dialog: Locator) =>
  dialog.locator('[data-help-picture="meteogram"]').evaluate((svg) => ({
    screen: getComputedStyle(svg.querySelector(".ip-screen")!).fill,
    badge: getComputedStyle(svg.querySelector(".hp-badge")!).fill,
    temperature: getComputedStyle(svg.querySelector(".hp-temperature")!).stroke,
  }));

/** Shows the model chains (both cards) as an earlier visit chose them. */
const showChains = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem("graupel.showWeatherChain", "true");
    localStorage.setItem("graupel.showCloudChain", "true");
  });

/** Makes the page the installed app (display mode standalone, which Chromium can not emulate). */
const installed = (page: Page) =>
  page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
        : original(query);
  });

// REQ-819, REQ-780: Help is reachable between Info and the imprint; the four tabs stay in one row.
test("the Help tab stands between Info and the imprint, the tabs in one row (REQ-819, REQ-780)", async ({ page }) => {
  const dialog = await openHelp(page);
  await expect(dialog.getByRole("tab")).toHaveText(["Info", "Hilfe", "Impressum", "Datenschutzerklärung"]);
  await expectOneRow(dialog);
  // The default page: no model chain, the day slider shown, the website (no history).
  expect(await sectionNames(dialog)).toEqual(["place", "days", "meteogram", "fullscreen"]);
  const panel = dialog.getByRole("tabpanel", { name: "Hilfe" });
  await expect(panel).not.toContainText(DE["info.help.place.history.button"]!);
  await expect(panel).not.toContainText(DE["info.help.place.history.menu"]!);
  // Every picture is drawn across the panel, at most 28 rem wide, nothing beyond the dialog.
  const panelBox = (await panel.boundingBox())!;
  for (const picture of await panel.locator("svg[data-help-picture]").all()) {
    const box = (await picture.boundingBox())!;
    expect(box.width).toBeGreaterThan(Math.min(240, panelBox.width - 40));
    expect(box.width).toBeLessThanOrEqual(28 * 16 + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
  }
});

// REQ-819: five sections with the model chains shown; the history in the installed app.
test("five sections with the chains shown, the history in the installed app (REQ-819)", async ({ page }) => {
  await showChains(page);
  await installed(page);
  const dialog = await openHelp(page);
  expect(await sectionNames(dialog)).toEqual(["place", "chains", "days", "meteogram", "fullscreen"]);
  await expect(dialog.locator('[data-help-section="chains"] [data-chain]')).toHaveCount(2);
  await expect(dialog.locator('[data-help-section="place"]')).toContainText("ohne zeitliche Begrenzung aufbewahrt");
  await expectOneRow(dialog);
});

// REQ-819: the texts of the device class: full screen by its button or by turning the phone, values by mouse or finger.
test("the texts name the controls of the device class (REQ-819)", async ({ page, deviceClass }) => {
  const dialog = await openHelp(page);
  const days = dialog.locator('[data-help-section="days"]');
  const fullscreen = dialog.locator('[data-help-section="fullscreen"]');
  if (deviceClass === "desktop") {
    await expect(days).toContainText(DE["info.help.days.desktop"]!);
    await expect(fullscreen).toContainText(DE["info.help.fullscreen.desktop"]!);
    await expect(fullscreen).toContainText(DE["info.help.fullscreen.mouse"]!);
  } else {
    await expect(days).toContainText(DE["info.help.days.touch"]!);
    await expect(fullscreen).toContainText(DE["info.help.fullscreen.finger"]!);
    await expect(fullscreen).toContainText(
      DE[deviceClass === "phone" ? "info.help.fullscreen.phone" : "info.help.fullscreen.tablet"]!,
    );
  }
});

/** What REQ-848, REQ-857 and REQ-858 ask of the pictures, as drawn on the page. */
const refinements = (dialog: Locator) =>
  dialog.locator(".help").evaluate((help) => {
    const number = (element: Element, attribute: string) => Number(element.getAttribute(attribute));
    const meteogram = help.querySelector('[data-help-picture="meteogram"]')!;
    const rainDays = new Set([...meteogram.querySelectorAll<SVGElement>(".hp-rain")].map((bar) => bar.dataset.day));
    const place = help.querySelector('[data-help-picture="place"]')!;
    const button = place.querySelector("[data-favourites]")!.getBoundingClientRect();
    const hits = [...place.querySelectorAll("[data-hit]")].map((hit) => ({ tag: hit.tagName, box: hit.getBoundingClientRect() }));
    const fullscreen = help.querySelector('[data-help-picture="fullscreen"]')!;
    const now = [...fullscreen.querySelectorAll(".hp-now")];
    const circle = fullscreen.querySelector("circle[data-hit]")!;
    return {
      days: meteogram.querySelectorAll("rect[data-day].ip-chart").length,
      rainDays: rainDays.size,
      starCircles: hits.filter(
        (hit) =>
          hit.tag === "circle" &&
          hit.box.left >= button.left - 1 &&
          hit.box.right <= button.right + 1 &&
          hit.box.top >= button.top - 1 &&
          hit.box.bottom <= button.bottom + 1,
      ).length,
      buttonRects: hits.filter(
        (hit) =>
          hit.tag === "rect" &&
          hit.box.left <= button.left &&
          hit.box.right >= button.right &&
          hit.box.top <= button.top &&
          hit.box.bottom >= button.bottom &&
          hit.box.width < button.width * 1.3,
      ).length,
      nowLines: now.length,
      cursorLines: fullscreen.querySelectorAll(".hp-cursor").length,
      nowAtCircle: now.length === 1 && number(now[0]!, "x1") === number(circle, "cx"),
      nowStroke: now.length ? getComputedStyle(now[0]!).strokeDasharray : "",
    };
  });

// REQ-848, REQ-857, REQ-858 (DEC-178): a dry day in the meteogram, the whole favourites' button highlighted, the red dashed
// line through the yellow circle in full screen; light and dark.
test("the pictures of the meteogram, the favourites and full screen (REQ-848, REQ-857, REQ-858)", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const dialog = await openHelp(page);
    const found = await refinements(dialog);
    expect(found, colorScheme).toEqual({
      days: 4,
      rainDays: 3,
      starCircles: 0,
      buttonRects: 1,
      nowLines: 1,
      cursorLines: 0,
      nowAtCircle: true,
      nowStroke: "3px, 2px",
    });
  }
});

/** The curves of the meteogram pictures as drawn: per picture the days' vertical swing and the gusts' gap to the wind. */
const curves = (dialog: Locator) =>
  dialog.locator(".help").evaluate((help) =>
    ["meteogram", "fullscreen"].map((name) => {
      const svg = help.querySelector(`[data-help-picture="${name}"]`)!;
      const points = (selector: string) =>
        [...svg.querySelector(selector)!.getAttribute("d")!.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((match) =>
          Number(match[2]),
        );
      const temperature = points(".hp-temperature:not(.hp-temperature--felt)");
      const wind = points(".hp-wind:not(.hp-wind--gust)");
      const gusts = points(".hp-wind--gust");
      const swings = [0, 1, 2, 3].map((day) => {
        const values = temperature.slice(day * 24, day * 24 + 24);
        return Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10;
      });
      const gaps = wind.map((y, hour) => y - gusts[hour]!);
      return {
        name,
        points: temperature.length,
        distinctSwings: new Set(swings).size,
        gustsAbove: gaps.every((gap) => gap > 0),
        unevenGaps: Math.min(...gaps) < 0.25 * Math.max(...gaps),
        cloudHeights: new Set([...svg.querySelectorAll(".hp-cloud")].map((cell) => Number(cell.getAttribute("y")).toFixed(2))).size,
        values: [...svg.querySelectorAll(".hp-value")].map((value) => value.textContent),
      };
    }),
  );

// REQ-864: the meteogram and full screen pictures draw temperature, felt temperature, wind and gusts like a forecast:
// a point per hour, each day its own swing, the gusts unevenly far above the wind; the clouds in at least eight height
// steps; reference images in light.
test("the meteogram pictures' curves look like a forecast (REQ-864)", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  const dialog = await openHelp(page);
  const found = await curves(dialog);
  for (const picture of found) {
    expect(picture.points, picture.name).toBe(97);
    expect(picture.distinctSwings, picture.name).toBe(4);
    expect(picture.gustsAbove, picture.name).toBe(true);
    expect(picture.unevenGaps, picture.name).toBe(true);
    // The clouds in at least eight height steps.
    expect(picture.cloudHeights, picture.name).toBeGreaterThanOrEqual(8);
  }
  // The side bar of full screen: temperature above the felt one, gusts above the wind.
  const values = found[1]!.values.map((value) => Number.parseFloat(value ?? ""));
  expect(values).toHaveLength(6);
  expect(values[1]!).toBeLessThan(values[0]!);
  expect(values[5]!).toBeGreaterThan(values[4]!);
  const meteogram = dialog.locator('[data-help-picture="meteogram"]');
  await meteogram.scrollIntoViewIfNeeded();
  await expect(meteogram).toHaveScreenshot(`help-meteogram-${testInfo.project.name}-light.png`);
  const fullscreen = dialog.locator('[data-help-picture="fullscreen"]');
  await fullscreen.scrollIntoViewIfNeeded();
  await expect(fullscreen).toHaveScreenshot(`help-fullscreen-${testInfo.project.name}-light.png`);
});

// REQ-819: the pictures follow the light and dark design; reference images per device class, light and dark.
test("the pictures in light and dark, reference images (REQ-819)", async ({ page }, testInfo) => {
  await showChains(page);
  await installed(page);
  await page.emulateMedia({ colorScheme: "light" });
  const dialog = await openHelp(page);
  const panel = dialog.getByRole("tabpanel", { name: "Hilfe" });
  const light = await pictureColours(dialog);
  await expect(dialog).toHaveScreenshot(`help-${testInfo.project.name}-light.png`);

  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await pictureColours(dialog);
  expect(dark.screen).not.toBe(light.screen);
  expect(dark.temperature).not.toBe(light.temperature);
  expect(dark.badge).not.toBe(light.badge);
  // The end of the tab: the meteogram and full screen.
  await panel.locator('[data-help-section="fullscreen"]').scrollIntoViewIfNeeded();
  await panel.evaluate((element) => {
    const body = element.closest(".dialog__body")!;
    body.scrollTop = body.scrollHeight;
  });
  await expect(dialog).toHaveScreenshot(`help-${testInfo.project.name}-dark-end.png`);
});
