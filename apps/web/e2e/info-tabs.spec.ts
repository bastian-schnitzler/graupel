// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tabs of the info popup in one row (REQ-780), in every language and with the imprint label of every domain (e.g.
 * “Mentions légales” on graupel.fr): where they do not fit, spacing and font get smaller down to a lower bound, then
 * the bar scrolls sideways and the selected tab is scrolled into view. Never a visible scrollbar (REQ-518).
 */
import { readFileSync, readdirSync } from "node:fs";
import { expect, test, ownDevice, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { Finger } from "./touch.ts";

const APP = "http://localhost:4175/";
const LANGUAGES = ["de", "en", "fr", "it", "nl", "da", "cs", "sl"] as const;
type Language = (typeof LANGUAGES)[number];

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
const MESSAGES = Object.fromEntries(LANGUAGES.map((language) => [language, json(`../src/i18n/${language}.json`)])) as Record<
  Language,
  Record<string, string>
>;
/** Every domain's configuration and its fixed imprint label, if any. */
const DOMAINS = readdirSync(new URL("../domains/", import.meta.url)).map((tld) => {
  const config = readFileSync(new URL(`../domains/${tld}/config.json`, import.meta.url), "utf8");
  const parsed = JSON.parse(config) as { legal?: { imprint?: { label?: string } } };
  return { tld, config, label: parsed.legal?.imprint?.label };
});

/** Labels of the info tabs in `language` on a domain with the imprint label `imprint` (Help since REQ-819). */
function tabLabels(language: Language, imprint: string | undefined) {
  const t = MESSAGES[language];
  return [t["info.tab.about"]!, t["info.tab.help"]!, imprint ?? t["info.tab.imprint"]!, t["privacy.title"]!];
}

test.use({ locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Opens the info popup on the domain `config` in `language`; returns its tab bar. */
async function openInfo(page: Page, config: string, language: Language): Promise<Locator> {
  await page.unroute("**/config.json");
  await page.route("**/config.json", (route) => route.fulfill({ contentType: "application/json", body: config }));
  await page.addInitScript((value) => localStorage.setItem("graupel.language", value), language);
  await page.goto(APP);
  await (await headerControl(page, "button", MESSAGES[language]["header.info"]!)).click();
  const dialog = page.getByRole("dialog", { name: MESSAGES[language]["info.title"]! });
  await expect(dialog).toBeVisible();
  return dialog.getByRole("tablist");
}

/** Geometry of the tab bar `bar`: its tabs' boxes, overflow and scrollbars. */
function measure(bar: Locator) {
  return bar.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    const barBox = element.getBoundingClientRect();
    const tabs = [...element.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => {
      const box = tab.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(tab).lineHeight);
      const padding = parseFloat(getComputedStyle(tab).paddingTop) + parseFloat(getComputedStyle(tab).paddingBottom);
      return { top: box.top, left: box.left, right: box.right, height: box.height, lineHeight, padding };
    });
    return {
      tabs,
      left: barBox.left,
      right: barBox.right,
      fit: Number(element.dataset.fit ?? 0),
      fontSize: parseFloat(getComputedStyle(element.querySelector('[role="tab"]')!).fontSize),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      // A visible scrollbar takes room from the box: offset size minus borders differs from the client size (REQ-518).
      scrollbarX: element.offsetHeight - element.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
      scrollbarY: element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/** All tabs in one row: the same top edge, each label on a single line; no scrollbar, nothing below the bar. */
async function expectOneRow(bar: Locator, what: string) {
  const box = await measure(bar);
  const tops = box.tabs.map((tab) => Math.round(tab.top));
  expect(new Set(tops).size, `${what}: tops ${tops.join(", ")}`).toBe(1);
  for (const tab of box.tabs) expect(tab.height - tab.padding, what).toBeLessThan(1.5 * tab.lineHeight);
  expect(box.scrollHeight, what).toBeLessThanOrEqual(box.clientHeight);
  expect(box.scrollbarX, what).toBe(0);
  expect(box.scrollbarY, what).toBe(0);
  expect(box.pageOverflow, what).toBeLessThanOrEqual(0);
  // The lower bound of the font: 13 px.
  expect(box.fontSize, what).toBeGreaterThanOrEqual(13);
  return box;
}

/** The last tab, chosen with End, is scrolled into the bar, and the first again with Home. */
async function expectEndsReachable(page: Page, bar: Locator, what: string) {
  const tabs = bar.getByRole("tab");
  await tabs.first().click();
  await page.keyboard.press("End");
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  let box = await measure(bar);
  expect(box.tabs.at(-1)!.right, what).toBeLessThanOrEqual(box.right + 0.5);
  expect(box.tabs.at(-1)!.left, what).toBeGreaterThanOrEqual(box.left - 0.5);
  await page.keyboard.press("Home");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  box = await measure(bar);
  expect(box.tabs[0]!.left, what).toBeGreaterThanOrEqual(box.left - 0.5);
}

// REQ-780: in every device class, every language and with every domain's imprint label, the tabs stay in one row.
for (const { tld, config, label } of DOMAINS) {
  test(`info tabs in one row on graupel.${tld} in every language (REQ-780)`, async ({ page }) => {
    test.setTimeout(90_000);
    for (const language of LANGUAGES) {
      const what = `graupel.${tld}, ${language}`;
      const bar = await openInfo(page, config, language);
      await expect(bar.getByRole("tab")).toHaveText(tabLabels(language, label));
      await expectOneRow(bar, what);
      await expectEndsReachable(page, bar, what);
      await expectOneRow(bar, what);
    }
  });
}

test.describe("phone 390 px, graupel.fr in German", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  ownDevice();

  // REQ-780: the case of the report: “Info” (“Über” before REQ-814), “Mentions légales”, “Datenschutzerklärung” fit
  // in one row with tighter spacing, also beside the X in the heading row (REQ-814). With “Hilfe” as fourth tab
  // (REQ-819) they still stand in one row; the bar scrolls only at the lower bound and keeps the selected tab in view.
  test("the four tabs stay in one row with tighter spacing (REQ-780, REQ-819)", async ({ page }) => {
    const fr = DOMAINS.find((domain) => domain.tld === "fr")!;
    const bar = await openInfo(page, fr.config, "de");
    await expect(bar.getByRole("tab")).toHaveText(["Info", "Hilfe", "Mentions légales", "Datenschutzerklärung"]);
    await bar.getByRole("tab", { name: "Datenschutzerklärung" }).tap();
    const box = await expectOneRow(bar, "390 px");
    expect(box.fit).toBeGreaterThan(0);
    if (box.scrollWidth > box.clientWidth) expect(box.fit).toBe(5);
    expect(box.tabs.at(-1)!.right).toBeLessThanOrEqual(box.right + 0.5);
    await expect(page.getByRole("dialog")).toHaveScreenshot("info-tabs-phone-390-fr-de.png");
  });
});

test.describe("phone 320 px", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  ownDevice();

  // REQ-780: one row in every language and with every imprint label, scrolling where even the lower bound is too wide.
  test("info tabs in one row in every language and on every domain (REQ-780)", async ({ page }) => {
    test.setTimeout(240_000);
    for (const { tld, config, label } of DOMAINS) {
      for (const language of LANGUAGES) {
        const what = `320 px, graupel.${tld}, ${language}`;
        const bar = await openInfo(page, config, language);
        await expect(bar.getByRole("tab")).toHaveText(tabLabels(language, label));
        const box = await expectOneRow(bar, what);
        // Scrolling only at the lower bound of spacing and font.
        if (box.scrollWidth > box.clientWidth) expect(box.fit, what).toBe(5);
        await expectEndsReachable(page, bar, what);
      }
    }
  });

  // REQ-780: where even the lower bound does not fit, the bar can be swiped, and choosing the last tab scrolls it in.
  test("the tab bar can be swiped; choosing the last tab scrolls it into view (REQ-780)", async ({ page }) => {
    const bar = await openInfo(page, DOMAINS.find((domain) => domain.tld === "fr")!.config, "cs");
    let box = await expectOneRow(bar, "320 px, cs");
    expect(box.fit).toBe(5);
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
    expect(await bar.evaluate((element) => element.scrollLeft)).toBe(0);

    // Swiped to the left with a finger, the bar shows its end.
    const area = (await bar.boundingBox())!;
    const finger = await Finger.down(page, area.x + area.width - 20, area.y + area.height / 2);
    await finger.move(-(area.width - 60), 0);
    await finger.up();
    await expect.poll(() => bar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    // Swiped back.
    const back = await Finger.down(page, area.x + 20, area.y + area.height / 2);
    await back.move(area.width - 60, 0);
    await back.up();
    await expect.poll(() => bar.evaluate((element) => element.scrollLeft)).toBe(0);

    // Tapped where it peeks out, the tab at the bar's right edge is selected and scrolled fully into the bar.
    box = await measure(bar);
    expect(box.tabs.at(-1)!.right).toBeGreaterThan(box.right);
    const peeking = box.tabs.findIndex((tab) => tab.left < box.right - 6 && tab.right > box.right);
    expect(peeking).toBeGreaterThan(0);
    const tab = bar.getByRole("tab").nth(peeking);
    await page.touchscreen.tap(area.x + area.width - 6, area.y + area.height / 2);
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => {
        const now = await measure(bar);
        return now.tabs[peeking]!.right <= now.right + 0.5 && now.tabs[peeking]!.left >= now.left - 0.5;
      })
      .toBe(true);
    // The last tab, chosen with End, is scrolled in too.
    await page.keyboard.press("End");
    const last = bar.getByRole("tab").last();
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => {
        const now = await measure(bar);
        return now.tabs.at(-1)!.right <= now.right + 0.5 && now.tabs.at(-1)!.left >= now.left - 0.5;
      })
      .toBe(true);
    await expect(page.getByRole("dialog").getByRole("tabpanel", { name: MESSAGES.cs["privacy.title"]! })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveScreenshot("info-tabs-phone-320-cs-privacy.png");
  });
});
