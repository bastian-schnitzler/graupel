// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Phone in portrait (REQ-608, DEC-053): the meteogram takes the height the rest of the page leaves on the screen, so
 * the page does not scroll vertically and the footer stays on screen, in the browser and in the installed app. Only its
 * areas get lower: its width (4.5 days on the screen's width), text and symbols stay. Below 40 % of the screen's height
 * the chart keeps 40 % and the page scrolls; on a tall screen it is no higher than before. The height does not depend
 * on the days chosen in the slider (REQ-585); its scale does not depend on how many days are loaded (REQ-741). Room
 * below the footer for Safari's bottom bar stays only in Safari on the iPhone (REQ-611) and only where the page
 * scrolls: where it fits, the bar stays shown and covers nothing, so the footer stands right on it and the chart gets
 * that room (REQ-612, REQ-614). The desktop is unchanged.
 */
import type { Browser } from "@playwright/test";
import { expect, IPHONE_SAFARI, test, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast, mockOpenMeteo } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time of the portrait tests: Tuesday, 3 November 2026, 12:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 12);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** As the installed app: `(display-mode: standalone)` matches (as in install.spec.ts). */
async function asInstalledApp(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({
            ...original(query),
            media: query,
            matches: true,
            addEventListener() {},
            removeEventListener() {},
          } as MediaQueryList)
        : original(query);
  });
}

/**
 * The page's and the screen's height, the chart's size, its scale (CSS px per viewBox unit), the size of its day labels
 * on screen and the bottom of the footer (with its room below) in the page.
 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-region="meteogram"] svg.meteogram-svg-integrated')!;
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const label = svg.querySelector<SVGTextElement>("text.day-label-text[font-size]")!;
    const footer = document.querySelector('[data-region="footer"]')!.getBoundingClientRect();
    return {
      scrollHeight: document.documentElement.scrollHeight,
      screen: document.documentElement.clientHeight,
      chartWidth: box.width,
      chartHeight: box.height,
      viewBoxHeight: svg.viewBox.baseVal.height,
      scale,
      fontPx: Number(label.getAttribute("font-size")) * scale,
      footerBottom: footer.bottom + window.scrollY,
    };
  });

type Measure = Awaited<ReturnType<typeof measure>>;

/** Starts the page with both model chains shown (the stored choice of an earlier visit, as in model-chain.spec.ts). */
async function showChains(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  });
}

/** Opens the page at `height` px and waits until the chart has taken its height (the page's height stays). */
async function openAt(page: Page, height: number): Promise<Measure> {
  await page.setViewportSize({ width: 390, height });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  return settled(page);
}

/** Measures once the page's height has not changed for a few frames. */
async function settled(page: Page): Promise<Measure> {
  let last = -1;
  await expect
    .poll(async () => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const now = (await measure(page)).chartHeight;
      const steady = Math.abs(now - last) < 0.5;
      last = now;
      return steady;
    })
    .toBe(true);
  return measure(page);
}

// Safari on the iPhone; Chromium's own user agent stands for another browser (Chrome on Android); the installed app.
for (const mode of ["Safari", "another browser", "installed app"] as const) {
  test.describe(`phone portrait, ${mode}`, () => {
    test.use({
      isMobile: true,
      hasTouch: true,
      timezoneId: "UTC",
      locale: "en-GB",
      ...(mode === "another browser" ? {} : { userAgent: IPHONE_SAFARI }),
    });
    ownDevice();

    test.beforeEach(async ({ page }) => {
      if (mode === "installed app") await asInstalledApp(page);
      // A fixed time: the chart's rows depend on the data of the hour (REQ-666).
      await page.clock.setFixedTime(FIXED_NOW);
      await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
    });

    // A screen lower than the iPhone 14 (844 px), where the chart keeps its own height; where the page fits Safari
    // keeps no room below the footer either (REQ-614).
    for (const height of [740]) {
      test(`${height} px: the page fits the screen without scrolling; only the chart's areas get lower`, async ({
        page,
      }) => {
        // On a tall screen the chart has its own height and room is left below the footer.
        const tall = await openAt(page, 1600);
        expect(tall.scrollHeight).toBeLessThanOrEqual(tall.screen);
        expect(tall.footerBottom).toBeLessThan(tall.screen - 50);

        // The page ends with the footer at the screen's bottom edge, nothing to scroll.
        await page.setViewportSize({ width: 390, height });
        const fit = await settled(page);
        expect(fit.scrollHeight).toBeLessThanOrEqual(fit.screen);
        expect(fit.footerBottom).toBeLessThanOrEqual(fit.screen);
        expect(fit.footerBottom).toBeGreaterThan(fit.screen - 2);
        // Not higher (by how much it gets lower does not matter, REQ-666), as wide, the text as large and at least
        // 40 % of the screen.
        expect(fit.chartHeight).toBeLessThanOrEqual(tall.chartHeight);
        expect(fit.chartHeight).toBeGreaterThanOrEqual(0.4 * fit.screen);
        expect(fit.chartWidth).toBeCloseTo(tall.chartWidth, 1);
        expect(fit.scale).toBeCloseTo(tall.scale, 4);
        expect(fit.fontPx).toBeCloseTo(tall.fontPx, 2);
        await page.screenshot({ path: test.info().outputPath(`fit-${mode.replaceAll(" ", "-")}-${height}.png`) });

        // Fewer days chosen: narrower, as high (REQ-585).
        await page.keyboard.press("Digit6");
        await expect.poll(async () => (await measure(page)).chartWidth).toBeLessThan(fit.chartWidth - 10);
        const week = await settled(page);
        expect(Math.abs(week.chartHeight - fit.chartHeight)).toBeLessThanOrEqual(1);
        expect(week.scrollHeight).toBeLessThanOrEqual(week.screen);
      });
    }

    test("with the model chains on a low screen: the chart keeps 40 % of it and the page scrolls", async ({ page }) => {
      await showChains(page);
      const low = await openAt(page, 560);
      await expect(page.locator('[data-region="model-chain"] .model-chain-row')).toHaveCount(2);
      const chains = await settled(page);
      expect(Math.abs(chains.chartHeight - 0.4 * chains.screen)).toBeLessThanOrEqual(1);
      expect(chains.scrollHeight).toBeGreaterThan(chains.screen);
      expect(chains.fontPx).toBeCloseTo(low.fontPx, 2);
      await page.screenshot({ path: test.info().outputPath(`low-${mode.replaceAll(" ", "-")}.png`) });
    });

    // Only one model answered (REQ-741): AROME HD with 49 h back and 51 h ahead, about 4 days; the others fail.
    if (mode !== "another browser") {
      test("only 4 days loaded: at the scale of the full forecast, down to the footer at the bottom", async ({ page }) => {
        const full = await openAt(page, 844);
        await page.unroute("https://api.open-meteo.com/v1/forecast**");
        await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
          const url = new URL(route.request().url());
          return url.searchParams.get("models") === "meteofrance_arome_france_hd" || url.searchParams.has("daily")
            ? fakeForecast(route, { now: FIXED_NOW })
            : route.fulfill({ status: 429, json: { error: true, reason: "Too many concurrent requests" } });
        });
        const short = await openAt(page, 844);
        // It fills the screen's width with its few days, at the scale of the full forecast (CSS px per viewBox unit),
        // and takes the height the page leaves it: at least as high as with the full forecast (the rest of the page is
        // no higher), the footer at the screen's bottom, nothing to scroll.
        expect(short.chartWidth).toBeCloseTo(390, 0);
        expect(short.scale).toBeCloseTo(full.scale, 4);
        expect(short.chartHeight).toBeGreaterThanOrEqual(full.chartHeight - 1);
        expect(short.footerBottom).toBeGreaterThan(short.screen - 2);
        expect(short.scrollHeight).toBeLessThanOrEqual(short.screen);
        await page.screenshot({ path: test.info().outputPath(`short-${mode.replaceAll(" ", "-")}.png`) });
        // The failed models' answers (429) are expected here.
        errors = errors.filter((error) => !/\b429\b|Failed to load resource/.test(error));
      });
    }

    test("no higher than before on a tall screen", async ({ page }) => {
      const tall = await openAt(page, 1600);
      await page.setViewportSize({ width: 390, height: 2000 });
      const taller = await settled(page);
      expect(taller.chartHeight).toBeCloseTo(tall.chartHeight, 1);
    });
  });
}

/**
 * As a Safari whose smallest visible height (`svh`) ends `by` px above the window's height, at the top of a bottom bar
 * floating over the page. Chromium's `svh` is the window's height, so the chart's probe for it is made lower.
 */
async function svhAboveBar(page: Page, by = 100) {
  await page.addInitScript((by) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = `[data-portrait-probe] { height: calc(100vh - ${by}px) !important; }`;
      document.head.append(style);
    });
  }, by);
}

/** The smallest visible height the chart measures, and the bottom of the footer's row without the room below it. */
const bar = (page: Page) =>
  page.evaluate(() => {
    const footer = document.querySelector<HTMLElement>('[data-region="footer"]')!;
    const room = parseFloat(getComputedStyle(footer).paddingBottom) || 0;
    return {
      svh: document.querySelector("[data-portrait-probe]")!.getBoundingClientRect().height,
      room,
      footerRow: footer.getBoundingClientRect().bottom - room + window.scrollY,
    };
  });

/** The page in a context of its own: Safari on the iPhone or another browser, 390 px wide and `height` px high. */
async function openIn(
  browser: Browser,
  name: "Safari" | "other",
  height: number,
  { chains = false, svhBelow = 0 }: { chains?: boolean; svhBelow?: number } = {},
) {
  const context = await browser.newContext({
    viewport: { width: 390, height },
    isMobile: true,
    hasTouch: true,
    timezoneId: "UTC",
    locale: "en-GB",
    ...(name === "Safari" ? { userAgent: IPHONE_SAFARI } : {}),
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await mockOpenMeteo(page);
  if (chains) await showChains(page);
  if (svhBelow > 0) await svhAboveBar(page, svhBelow);
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  if (chains) await expect(page.locator('[data-region="model-chain"] .model-chain-row')).toHaveCount(2);
  const measured = await settled(page);
  const padding = await page
    .locator('[data-region="footer"]')
    .evaluate((element) => getComputedStyle(element).paddingBottom);
  return { context, page, measured, ...(await bar(page)), room: padding };
}

test.describe("Safari's room below the footer only where the page scrolls (REQ-611, REQ-614, REQ-617)", () => {
  // Its tests open phones of their own (Safari and another browser) side by side.
  ownDevice();

  test("where the page fits, Safari keeps no room: the footer ends at svh, the chart 10 px higher than elsewhere", async ({
    browser,
  }) => {
    // `svh` as high as the window (Safari's bar ends the window), or 100 px above its bottom (a floating bar); 740 px
    // either way, where the chart gets lower to fit.
    for (const svhBelow of [0, 100]) {
      const safari = await openIn(browser, "Safari", 740 + svhBelow, { svhBelow });
      const other = await openIn(browser, "other", 740 + svhBelow, { svhBelow });
      for (const page of [safari, other]) {
        expect(page.room).toBe("0px");
        expect(page.footerRow).toBeLessThanOrEqual(page.svh);
        expect(page.footerRow).toBeGreaterThan(page.svh - 2);
        expect(page.measured.scrollHeight).toBeLessThanOrEqual(page.measured.screen);
      }
      // Safari's footer row is 10 px lower, its icons at the buttons' lower edge (REQ-617): the chart takes the 10 px.
      expect(Math.abs(safari.measured.chartHeight - other.measured.chartHeight - 10)).toBeLessThanOrEqual(1);
      await safari.page.screenshot({ path: test.info().outputPath(`safari-fits-${svhBelow}.png`) });
      await safari.context.close();
      await other.context.close();
    }
  });

  test("in Safari the copy and save icons stand at the page's end, 10 px closer to the bar; the touch height stays (REQ-617)", async ({
    browser,
  }) => {
    for (const svhBelow of [0, 100]) {
      const safari = await openIn(browser, "Safari", 740 + svhBelow, { svhBelow });
      const other = await openIn(browser, "other", 740 + svhBelow, { svhBelow });
      const buttons = (page: Page) =>
        page.evaluate(() => {
          const copy = document.querySelector<HTMLElement>('footer [data-testid="meteogram-copy"]')!;
          const box = copy.getBoundingClientRect();
          const icon = copy.querySelector("svg")!.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const hit = (y: number) => document.elementFromPoint(x, y)?.closest("button")?.dataset.testid ?? null;
          return {
            iconBottom: icon.bottom + window.scrollY,
            boxTop: box.top,
            boxHeight: box.height,
            above: hit(box.top - 8),
            inside: hit(box.top + 2),
          };
        });
      const inSafari = await buttons(safari.page);
      const elsewhere = await buttons(other.page);
      // Safari: the icon ends at the page's end (svh), the button is 30 px high and takes taps 10 px above it, 40 px in
      // all. Other browsers keep the icon in the middle of their 40 px button, 10 px above the page's end.
      expect(inSafari.iconBottom).toBeLessThanOrEqual(safari.svh);
      expect(inSafari.iconBottom).toBeGreaterThan(safari.svh - 2);
      expect(inSafari.boxHeight).toBeCloseTo(30, 0);
      expect(inSafari.above).toBe("meteogram-copy");
      expect(inSafari.inside).toBe("meteogram-copy");
      expect(elsewhere.boxHeight).toBeCloseTo(40, 0);
      expect(other.svh - elsewhere.iconBottom).toBeGreaterThan(9);
      await safari.context.close();
      await other.context.close();
    }
  });

  test("where the page scrolls (model chains on a low screen) Safari keeps the room, another browser not", async ({
    browser,
  }) => {
    const safari = await openIn(browser, "Safari", 560, { chains: true });
    const other = await openIn(browser, "other", 560, { chains: true });
    expect(safari.room).toBe("80px");
    expect(other.room).toBe("0px");
    for (const page of [safari, other]) {
      expect(page.measured.scrollHeight).toBeGreaterThan(page.measured.screen);
      expect(Math.abs(page.measured.chartHeight - 0.4 * page.measured.screen)).toBeLessThanOrEqual(1);
    }
    await safari.context.close();
    await other.context.close();
  });
});

test("desktop: the chart keeps its height on a low window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const high = await settled(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  const low = await settled(page);
  expect(low.chartHeight).toBeCloseTo(high.chartHeight, 1);
  expect(low.scrollHeight).toBeGreaterThan(low.screen);
});
