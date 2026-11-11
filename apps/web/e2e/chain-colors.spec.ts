// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colours of the model chains (REQ-443, REQ-456) in a real browser: the weather chain in shades of blue, the cloud
 * chain in shades of slate, and each meteogram model header in the shade of its model's weather-chain card, in light
 * and dark mode.
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  // The model chain is hidden by default (REQ-445); these tests look at its cards.
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

interface Card {
  model: string;
  color: string;
}

async function cards(page: Page, prefix: string): Promise<Card[]> {
  const block = page.locator('[data-region="model-chain"]');
  return block.locator(`[data-testid^="${prefix}model-card-"]`).evaluateAll((nodes) =>
    nodes.map((node) => ({
      model: node.getAttribute("data-model") ?? "",
      color: node.getAttribute("data-chain-color") ?? "",
    })),
  );
}

/** Header fill per model of the meteogram, in drawing order (one entry per model). */
async function headers(page: Page): Promise<Card[]> {
  const segments = page.locator('[data-region="meteogram"] [data-testid="model-label-segment"]');
  const all = await segments.evaluateAll((nodes) =>
    nodes.map((node) => ({
      model: node.getAttribute("data-model") ?? "",
      color: node.querySelector('[data-testid="model-header-shape"]')?.getAttribute("fill") ?? "",
    })),
  );
  return all.filter((header, index) => index === 0 || all[index - 1]!.model !== header.model);
}

/** The REQ-456 colours of a chain of `count` models over the page's card colour (white, dark `#1a2129`). */
function expected(count: number, base: string, dark: boolean): string[] {
  const shares = [0.72, 0.46, 0.24];
  const background = dark ? "#1a2129" : "#ffffff";
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Array.from({ length: count }, (_, index) => {
    const t = count > 1 ? index / (count - 1) : 0;
    const share =
      t <= 0.5
        ? shares[0]! + (shares[1]! - shares[0]!) * t * 2
        : shares[1]! + (shares[2]! - shares[1]!) * (t - 0.5) * 2;
    const opacity = dark ? 0.25 + 0.75 * share : share;
    const bottom = channels(background);
    return `#${channels(base)
      .map((value, i) =>
        Math.floor(value * opacity + bottom[i]! * (1 - opacity) + 0.5)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  });
}

async function checkColors(page: Page, dark: boolean) {
  // Polls throughout: after a change of the colour mode the cards re-render and their background is still in its
  // transition for a moment, and the meteogram redraws its headers.
  const colors = async (prefix: string) => (await cards(page, prefix)).map((card) => card.color);
  await expect.poll(async () => (await colors("")).length).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await colors("cloud-")).length).toBeGreaterThanOrEqual(1);
  const count = (await colors("")).length;
  const cloudCount = (await colors("cloud-")).length;
  await expect.poll(() => colors("")).toEqual(expected(count, "#1f6fd1", dark));
  await expect.poll(() => colors("cloud-")).toEqual(expected(cloudCount, "#556579", dark));
  const weather = await cards(page, "");
  const cloud = await cards(page, "cloud-");
  expect(new Set(weather.map((card) => card.color)).size).toBe(weather.length);

  // The shades are mixed over the real card colour of the mode (reached once the background transition has ended).
  const card = page.locator('[data-region="model-chain"] [data-testid^="model-card-"]').first();
  await expect
    .poll(() => card.evaluate((node) => getComputedStyle(node).backgroundColor))
    .toBe(dark ? "rgb(26, 33, 41)" : "rgb(255, 255, 255)");

  // Every meteogram header has the colour of its model's card in the weather chain.
  const byModel = new Map(weather.map((entry) => [entry.model, entry.color]));
  await expect.poll(async () => (await headers(page)).length).toBeGreaterThanOrEqual(2);
  await expect
    .poll(async () => (await headers(page)).filter((header) => header.color !== byModel.get(header.model)))
    .toEqual([]);
  return { weather, cloud };
}

test("chain cards and meteogram headers share the colours, in light and dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(APP);
  await expect(page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeVisible();
  await expect(page.locator('[data-region="model-chain"]').getByRole("group", { name: "Weather chain" })).toBeVisible();
  const light = await checkColors(page, false);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await cards(page, ""))[0]?.color).not.toBe(light.weather[0]!.color);
  const dark = await checkColors(page, true);
  expect(dark.cloud[0]!.color).not.toBe(light.cloud[0]!.color);
});
