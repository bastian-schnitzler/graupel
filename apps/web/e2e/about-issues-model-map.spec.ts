// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The About tab of the info popup on the phone, the tablet and the desktop: below the source link the note that
 * problems, bugs and feature requests can be reported via GitHub Issues (REQ-855), and after the weather data the entry
 * "Model map" with the link to the Model Domain Viewer and how the model chains are chosen (REQ-856), which replaces the
 * link below the introduction (REQ-821). Both notes are small like the text below the weather data, both links open in
 * a new tab; the pages behind them are answered by a stand-in, nothing leaves the browser.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const ISSUES_URL = "https://github.com/bastian-schnitzler/graupel/issues";
const DOMAIN_VIEWER_URL = "https://bastian-schnitzler.github.io/graupel/";
const DOMAIN_VIEWER_LINK = "bastian-schnitzler.github.io/graupel";
/** Fixed time: Tuesday, 17 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 17, 9);

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  // Stand-ins for the issues and the domain viewer, opened in a new tab of the same context.
  for (const url of [`${ISSUES_URL}**`, `${DOMAIN_VIEWER_URL}**`]) {
    await page.context().route(url, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stand-in</title>" }),
    );
  }
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const TEXTS = {
  de: {
    info: "Info",
    name: "Information",
    tab: "Info",
    source: "Quellcode",
    data: "Wetterdaten",
    modelMap: "Modellkarte",
    issues: "Probleme, Bugs und Feature Requests können über GitHub Issues gemeldet werden.",
    note:
      "Die bestmöglichen Modellketten werden in Abhängigkeit vom Ort und den unter Open-Meteo verfügbaren Modellen " +
      "ausgewählt und können über die Modellkarte visualisiert werden.",
    oldLink: "Gebiete der Wettermodelle auf der Karte ansehen",
  },
  en: {
    info: "Info",
    name: "Information",
    tab: "About",
    source: "Source code",
    data: "Weather data",
    modelMap: "Model map",
    issues: "Problems, bugs and feature requests can be reported via GitHub Issues.",
    note:
      "The best possible model chains are chosen depending on the place and the models available from Open-Meteo, " +
      "and can be visualised on the model map.",
    oldLink: "View the areas of the weather models on a map",
  },
} as const;

async function openInfo(page: Page, language: keyof typeof TEXTS) {
  await page.addInitScript((value) => localStorage.setItem("graupel.language", value), language);
  await page.goto(APP);
  await (await headerControl(page, "button", TEXTS[language].info)).click();
  const dialog = page.getByRole("dialog", { name: TEXTS[language].name });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: TEXTS[language].tab })).toHaveAttribute("aria-selected", "true");
  return dialog;
}

/** Address, new tab and noopener of a link, then a click that opens `url` in a new tab and leaves the page as it was. */
async function opensInNewTab(page: Page, link: Locator, url: string) {
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(url);
  await popup.close();
  expect(page.url()).toBe(APP);
}

/**
 * Look of the small text `note` against the text below the weather data and the link `above` it: same size, colour and
 * display, smaller than the link, below it; nothing scrolls sideways.
 */
async function look(note: Locator, above: Locator) {
  const aboveBox = await above.boundingBox();
  return note.evaluate((element: HTMLElement, aboveBottom) => {
    const style = (target: Element) => {
      const { display, fontSize, color } = getComputedStyle(target);
      return { display, fontSize, color };
    };
    const dialog = element.closest<HTMLElement>("dialog")!;
    const body = element.closest<HTMLElement>(".dialog__body")!;
    const box = element.getBoundingClientRect();
    const dialogBox = dialog.getBoundingClientRect();
    return {
      note: style(element),
      data: style(dialog.querySelector('[data-testid="about-data-license"]')!),
      linkSize: getComputedStyle(element.parentElement!.querySelector("a")!).fontSize,
      below: box.top >= aboveBottom - 1,
      inside: box.left >= dialogBox.left && box.right <= dialogBox.right,
      bodyScroll: body.scrollWidth - body.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, aboveBox!.y + aboveBox!.height);
}

for (const language of ["de", "en"] as const) {
  const text = TEXTS[language];

  test(`the note on GitHub Issues stands small below the source link and opens the issues in a new tab (${language}, REQ-855)`, async ({
    page,
  }) => {
    const dialog = await openInfo(page, language);
    const source = dialog.getByTestId("about-source");
    await expect(dialog.locator(".about__facts > dt").nth(1)).toHaveText(text.source);
    const repository = source.getByRole("link", { name: "github.com/bastian-schnitzler/graupel" });
    const note = source.getByTestId("about-issues");
    await expect(note).toHaveText(text.issues);
    await note.scrollIntoViewIfNeeded();
    const m = await look(note, repository);
    expect(m.note).toEqual(m.data);
    expect(m.note.display).toBe("block");
    expect(parseFloat(m.note.fontSize)).toBeLessThan(parseFloat(m.linkSize));
    expect(m.below).toBe(true);
    expect(m.inside).toBe(true);
    expect(m.bodyScroll).toBeLessThanOrEqual(0);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    await opensInNewTab(page, note.getByRole("link", { name: "GitHub Issues" }), ISSUES_URL);
    await expect(dialog).toBeVisible();
  });

  test(`the entry ${text.modelMap} follows the weather data and opens the domain viewer in a new tab (${language}, REQ-856)`, async ({
    page,
  }) => {
    const dialog = await openInfo(page, language);
    // The link below the introduction is gone (before: REQ-821).
    await expect(dialog.getByRole("link", { name: text.oldLink })).toHaveCount(0);
    await expect(dialog.locator(".about__description + *")).toHaveClass("about__facts");
    const terms = dialog.locator(".about__facts > dt");
    await expect(terms.nth(-2)).toHaveText(text.data);
    await expect(terms.last()).toHaveText(text.modelMap);
    const entry = dialog.locator(".about__facts > dd").last();
    await expect(entry).toHaveAttribute("data-testid", "about-model-map");
    const link = entry.getByRole("link", { name: DOMAIN_VIEWER_LINK });
    await expect(entry.getByRole("link")).toHaveCount(1);
    const note = entry.getByTestId("about-model-map-note");
    await expect(note).toHaveText(text.note);
    await note.scrollIntoViewIfNeeded();
    const m = await look(note, link);
    expect(m.note).toEqual(m.data);
    expect(m.note.display).toBe("block");
    expect(parseFloat(m.note.fontSize)).toBeLessThan(parseFloat(m.linkSize));
    expect(m.below).toBe(true);
    expect(m.inside).toBe(true);
    expect(m.bodyScroll).toBeLessThanOrEqual(0);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    // Below the weather data.
    const data = await dialog.getByTestId("about-data").boundingBox();
    const linkBox = await link.boundingBox();
    expect(linkBox!.y).toBeGreaterThanOrEqual(data!.y + data!.height - 1);
    await opensInNewTab(page, link, DOMAIN_VIEWER_URL);
    await expect(dialog).toBeVisible();
  });
}
