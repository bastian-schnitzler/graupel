// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-820: on a phone and a tablet (upright and turned) the info button of the weather chain's models stands in the
 * meteogram's model headers while they are shown, also with the weather chain card shown, whose cards then have none;
 * with the model headers hidden it stands on the chain's cards. On the desktop nothing changes (REQ-643): the cards
 * always have it, the headers only while the weather chain card is hidden. Each button opens the model's details. Runs
 * in all four projects; the phone turned (full-screen view) is in model-header-info.spec.ts.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";

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

const weather = (page: Page) =>
  page.locator('[data-region="model-chain"]').getByRole("group", { name: "Weather chain" });
const cards = (page: Page) => weather(page).locator(".model-card");
const cardInfo = (page: Page) => weather(page).getByRole("button", { name: /^Details for / });
const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
const headerInfo = (page: Page) => meteogram(page).getByTestId("model-header-info-button");

/** Starts the page with the weather chain card shown or hidden and the model headers on or off (stored choices). */
async function open(page: Page, { chain, headers }: { chain: boolean; headers: boolean }) {
  await page.addInitScript(
    ({ chain, headers }) => {
      window.localStorage.setItem("graupel.showWeatherChain", String(chain));
      window.localStorage.setItem("graupel.showCloudChain", "false");
      window.localStorage.setItem("graupel.modelHeaders", String(headers));
    },
    { chain, headers },
  );
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
  if (chain) await expect(cards(page).first()).toBeVisible();
  if (headers) await expect(meteogram(page).getByTestId("model-label-segment").first()).toBeAttached();
  else await expect(meteogram(page).getByTestId("model-label-segment")).toHaveCount(0);
  // The header's buttons follow the chart in the next frame.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Opens the details of `button` (a popover, on a phone or tablet a dialog) and closes them again with Escape. */
async function expectDetails(page: Page, button: Locator) {
  const name = (await button.getAttribute("aria-label"))!.replace(/^Details for /, "");
  await button.click();
  const details = page.getByTestId("model-info-popover");
  await expect(details).toBeVisible();
  await expect(details.getByTestId("model-info-title").locator("strong")).toHaveText(name);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
}

test.describe("info button of the model chain (REQ-820)", () => {
  test("chain shown, model headers shown: on a phone or tablet in the headers only", async ({
    page,
    deviceClass,
  }, testInfo) => {
    await open(page, { chain: true, headers: true });
    if (deviceClass === "desktop") {
      // As before: on every card, none in the headers (REQ-643).
      await expect(cardInfo(page)).toHaveCount(await cards(page).count());
      await expect(headerInfo(page)).toHaveCount(0);
      await expectDetails(page, cardInfo(page).first());
    } else {
      await expect(cardInfo(page)).toHaveCount(0);
      await expect(headerInfo(page).first()).toBeVisible();
      await expectDetails(page, headerInfo(page).first());
    }
    await page.screenshot({ path: testInfo.outputPath(`model-info-place-${testInfo.project.name}-headers.png`) });
  });

  test("chain shown, model headers hidden: on the cards", async ({ page }, testInfo) => {
    await open(page, { chain: true, headers: false });
    // In every class: on every card, nothing over the chart.
    await expect(cardInfo(page)).toHaveCount(await cards(page).count());
    await expect(meteogram(page).getByTestId("model-header-info")).toHaveCount(0);
    await expect(headerInfo(page)).toHaveCount(0);
    await expectDetails(page, cardInfo(page).first());
    await page.screenshot({ path: testInfo.outputPath(`model-info-place-${testInfo.project.name}-no-headers.png`) });
  });

  test("chain hidden, model headers shown: in the headers, as before", async ({ page }) => {
    await open(page, { chain: false, headers: true });
    await expect(weather(page)).toHaveCount(0);
    await expect(headerInfo(page).first()).toBeVisible();
    await expectDetails(page, headerInfo(page).first());
  });

  test("switching the model headers in the settings moves the button at once", async ({ page, deviceClass }) => {
    await open(page, { chain: true, headers: true });
    const handheld = deviceClass !== "desktop";
    const count = await cards(page).count();
    await expect(cardInfo(page)).toHaveCount(handheld ? 0 : count);

    await (await headerControl(page, "button", "Settings")).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Models" }).click();
    const checkbox = dialog.getByRole("checkbox", { name: "Show model headers" });
    await checkbox.uncheck();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Without headers: on every card in every class.
    await expect(cardInfo(page)).toHaveCount(count);
    await expect(headerInfo(page)).toHaveCount(0);

    // Back on: on a phone or tablet in the headers again, off the cards.
    await (await headerControl(page, "button", "Settings")).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Models" }).click();
    await checkbox.check();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(cardInfo(page)).toHaveCount(handheld ? 0 : count);
    if (handheld) await expect(headerInfo(page).first()).toBeVisible();
    else await expect(headerInfo(page)).toHaveCount(0);
  });
});
