// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Head of the info popup without the title “Information” (REQ-814): only the tabs and the X, in one row, on the phone,
 * the tablet and the desktop. The tabs stand where the title stood, the X stays at the right; nothing overflows the row
 * and the tabs fit without scrolling in German and English. The dialog keeps “Information” as its accessible name, and
 * in German the first tab is called “Info”. The new introduction of the first tab (REQ-812) is in the reference image.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Thursday, 12 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 12, 9);

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const TEXTS = {
  de: { info: "Info", name: "Information", tabs: ["Info", "Hilfe", "Impressum", "Datenschutzerklärung"] },
  en: { info: "Info", name: "Information", tabs: ["About", "Help", "Legal notice", "Privacy policy"] },
} as const;

/** Opens the info popup in `language`; returns the dialog. */
async function openInfo(page: Page, language: keyof typeof TEXTS): Promise<Locator> {
  await page.addInitScript((value) => localStorage.setItem("graupel.language", value), language);
  await page.goto(APP);
  await (await headerControl(page, "button", TEXTS[language].info)).click();
  const dialog = page.getByRole("dialog", { name: TEXTS[language].name });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Boxes of the heading row, its tabs and its X. */
function measureHead(dialog: Locator) {
  return dialog.evaluate((element: HTMLElement) => {
    const head = element.querySelector<HTMLElement>(".dialog__header")!;
    const bar = head.querySelector<HTMLElement>('[role="tablist"]')!;
    const close = head.querySelector<HTMLElement>(".dialog__close")!;
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
    };
    return {
      head: box(head),
      dialog: box(element),
      bar: box(bar),
      close: box(close),
      tabs: [...bar.querySelectorAll('[role="tab"]')].map(box),
      headText: head.textContent,
      headScroll: head.scrollWidth - head.clientWidth,
      barScroll: bar.scrollWidth - bar.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headings: element.querySelectorAll("h1, h2").length,
      ariaLabel: element.getAttribute("aria-label"),
      labelledBy: element.getAttribute("aria-labelledby"),
    };
  });
}

for (const language of ["de", "en"] as const) {
  // REQ-814: in every device class the head shows only the tabs and the X in one row, without overflow.
  test(`the head of the info popup shows only the tabs and the X in one row (${language}, REQ-814)`, async ({ page }) => {
    const dialog = await openInfo(page, language);
    const texts = TEXTS[language];
    await expect(dialog.getByRole("tab")).toHaveText([...texts.tabs]);
    await expect(dialog.getByRole("tab", { selected: true })).toHaveText(texts.tabs[0]);
    await expect(dialog.getByRole("heading", { name: texts.name })).toHaveCount(0);

    const m = await measureHead(dialog);
    // No title: the row holds the tabs' labels only, and the name is the dialog's aria-label.
    expect(m.headText).toBe(texts.tabs.join(""));
    expect(m.headings).toBe(0);
    expect(m.ariaLabel).toBe(texts.name);
    expect(m.labelledBy).toBeNull();
    // Tabs and X in one row: the tabs side by side on one line, the X right of them and at the dialog's right edge.
    expect(new Set(m.tabs.map((tab) => Math.round(tab.top))).size).toBe(1);
    for (const tab of m.tabs) expect(tab.height).toBeLessThan(m.close.height * 1.5);
    expect(m.tabs[0]!.left - m.dialog.left).toBeLessThan(12);
    expect(m.bar.right).toBeLessThanOrEqual(m.close.left + 0.5);
    expect(m.dialog.right - m.close.right).toBeLessThan(16);
    // Both inside the heading row, the X centred in its height.
    for (const part of [m.bar, m.close]) {
      expect(part.top).toBeGreaterThanOrEqual(m.head.top - 0.5);
      expect(part.bottom).toBeLessThanOrEqual(m.head.bottom + 0.5);
    }
    expect(Math.abs((m.close.top + m.close.bottom) / 2 - (m.head.top + m.head.bottom) / 2)).toBeLessThan(2);
    // As compact as a title row was: at most 4 rem.
    expect(m.head.height).toBeLessThanOrEqual(64);
    // Nothing overflows: neither the row nor the tab bar (the tabs fit without scrolling), nor the page.
    expect(m.headScroll).toBeLessThanOrEqual(0);
    expect(m.barScroll).toBeLessThanOrEqual(0);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
  });
}

// REQ-814, REQ-812: reference image of the info popup per device class, in German: tabs and X in the head, the new
// introduction in the first tab. The version (with the build's commit) is masked.
test("reference image of the info popup in German (REQ-814, REQ-812)", async ({ page }, testInfo) => {
  const dialog = await openInfo(page, "de");
  await expect(dialog.getByRole("img", { name: "Graupel-Logo" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Graupel-Logo" })).toHaveJSProperty("complete", true);
  await expect(dialog).toHaveScreenshot(`info-dialog-${testInfo.project.name}.png`, {
    mask: [dialog.getByTestId("about-version")],
  });
});
