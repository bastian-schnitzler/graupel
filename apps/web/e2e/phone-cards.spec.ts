// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Phones without cards (REQ-528, REQ-529): at phone width the weather and cloud chain, the day slider and the meteogram
 * stand on the page without a card and without the side labels "Weather", "Clouds" and "Horizon"; the slider shows
 * neither the selected period in words nor "All", and a double tap on a day still selects all days. The top area
 * (header and place) stays a card. At desktop width everything is as before.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  });
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

/** The card look of an element: background, frame and shadow. */
const look = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      shadow: style.boxShadow,
    };
  });

/** The containers that are cards on wide screens: both chains, the day slider and the meteogram. */
const sections = (page: Page) => [
  page.getByTestId("model-chain-card"),
  page.getByTestId("cloud-model-chain-card"),
  page.locator('section[data-region="day-slider"]'),
  page.getByTestId("meteogram-card"),
];

const labels = (page: Page) => [
  page.getByTestId("border-label"),
  page.getByTestId("cloud-border-label"),
  page.getByTestId("day-slider-label"),
];

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("cloud-model-chain-card")).toBeVisible();
}

test("phone (375 px): no cards around chains, slider and meteogram, no side labels, no period and no All", async ({
  page,
}) => {
  await open(page, 375);
  for (const section of sections(page)) {
    await expect(section).toBeVisible();
    expect(await look(section)).toEqual({ background: TRANSPARENT, border: "0px", shadow: "none" });
  }
  // The meteogram's card padding is gone as well: the chart starts at the page gutter like the chains.
  const meteogram = (await page.getByTestId("meteogram-card").boundingBox())!;
  const chain = (await page.getByTestId("model-chain-card").boundingBox())!;
  // The meteogram reaches over the page's side margins to the screen's edges (REQ-547).
  expect(Math.abs(meteogram.x)).toBeLessThan(1);
  expect(Math.abs(meteogram.x + meteogram.width - 375)).toBeLessThan(1);
  expect(chain.x).toBeGreaterThan(8);
  expect(await page.getByTestId("meteogram-card").evaluate((e) => getComputedStyle(e).paddingLeft)).toBe("0px");

  for (const label of labels(page)) await expect(label).toBeHidden();
  // The first model card starts at the chain's left edge, where the label was.
  const firstModel = (await page.getByTestId("model-chain-card").locator(".model-card").first().boundingBox())!;
  expect(Math.abs(firstModel.x - chain.x)).toBeLessThan(1);

  // The top area stays one card.
  const top = await look(page.locator(".app__top"));
  expect(top.border).toBe("1px");
  expect(top.background).not.toBe(TRANSPARENT);

  // Day slider: neither the period in words nor "All"; the strip is the first row.
  await expect(page.getByTestId("day-slider-whole")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All" })).toHaveCount(0);
  await expect(page.getByTestId("day-slider-period")).toHaveCount(0);
  const slider = (await page.locator('section[data-region="day-slider"]').boundingBox())!;
  const firstDay = (await page.getByTestId("day-card").first().boundingBox())!;
  expect(firstDay.y - slider.y).toBeLessThan(1);

  // Nothing sticks out of the page.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test.describe("phone touch (375 px)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("without All a double tap on a day still selects all days", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    const marker = page.getByTestId("day-slider-marker");
    const tap = async (index: number) => {
      const box = (await cards.nth(index).boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };

    await tap(3);
    await expect(marker).toHaveAttribute("data-start", "3");
    await expect(marker).toHaveAttribute("data-end", "3");
    await page.waitForTimeout(600);
    await tap(2);
    await tap(2);
    await expect(marker).toHaveAttribute("data-start", "0");
    await expect(marker).toHaveAttribute("data-end", String(count - 1));
  });
});

test("desktop (1280 px): chains, slider and meteogram stay cards with labels and All", async ({ page }) => {
  await open(page, 1280);
  for (const section of sections(page)) {
    const { background, border, shadow } = await look(section);
    expect(border).toBe("1px");
    expect(background).not.toBe(TRANSPARENT);
    expect(shadow).not.toBe("none");
  }
  await expect(page.getByTestId("border-label")).toHaveText("Weather");
  await expect(page.getByTestId("cloud-border-label")).toHaveText("Clouds");
  await expect(page.getByTestId("day-slider-label")).toHaveText("Horizon");
  for (const label of labels(page)) await expect(label).toBeVisible();
  // No "All" on the desktop either (REQ-640): a double click selects the whole period.
  await expect(page.getByRole("button", { name: "All" })).toHaveCount(0);
});

// Screenshots for a look by eye, only when asked for (SHOTS_DIR).
const shots = process.env.SHOTS_DIR;
for (const scheme of ["light", "dark"] as const) {
  for (const width of [375, 1280]) {
    test(`screenshot ${width} px ${scheme}`, async ({ page }) => {
      test.skip(!shots, "SHOTS_DIR not set");
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, width);
      await page.screenshot({ path: `${shots}/${width}-${scheme}.png`, fullPage: true });
    });
  }
}
