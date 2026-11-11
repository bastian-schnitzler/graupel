// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Info popover of a model (REQ-687) on the desktop and on a phone, from a card of the weather chain and from the info
 * button in the meteogram's model header (REQ-643): on top "model (publisher, coverage)" as the model catalogue has
 * them; the model's name opens the model's documentation (`documentation_url`), the publisher its homepage
 * (`provider_url`), each in a new tab with `rel="noopener noreferrer"`.
 */
import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 3 November 2026, 13:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 13);

interface CatalogueEntry {
  id: string;
  name: string;
  provider?: string | null;
  region?: string | null;
  documentation_url?: string | null;
  provider_url?: string | null;
}

const CATALOGUE = (
  JSON.parse(readFileSync(new URL("../../../model-data/model_catalogue.json", import.meta.url), "utf8")) as {
    models: CatalogueEntry[];
  }
).models;
const byId = (id: string) => CATALOGUE.find((model) => model.id === id)!;
const byName = (name: string) => CATALOGUE.find((model) => model.name === name)!;

/** The popover's title as the catalogue entry gives it: "model (publisher, coverage)". */
const expectedTitle = (model: CatalogueEntry) => {
  const inBrackets = [model.provider, model.region].filter(Boolean).join(", ");
  return inBrackets ? `${model.name} (${inBrackets})` : model.name;
};

test.use({ timezoneId: "UTC", locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(async ({ page, context }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await stubLinkTargets(context);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The pages behind the links stay in the browser: each answers with a short page of its own. */
async function stubLinkTargets(context: BrowserContext) {
  const targets = new Set(
    CATALOGUE.flatMap((model) => [model.documentation_url, model.provider_url]).filter((url): url is string => !!url),
  );
  await context.route(
    (url) => targets.has(url.href) || targets.has(url.href.replace(/\/$/, "")),
    (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Linked page</title>" }),
  );
}

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
const weatherChain = (page: Page) =>
  page.locator('[data-region="model-chain"]').getByRole("group", { name: "Weather chain" });
const popover = (page: Page) => page.getByTestId("model-info-popover");

/** Starts the page; `chain`: with the weather chain card shown (the stored choice of an earlier visit). */
async function open(page: Page, chain: boolean) {
  if (chain) await page.addInitScript(() => window.localStorage.setItem("graupel.showWeatherChain", "true"));
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
}

/** Checks the open popover's title and its two links against the catalogue entry. */
async function expectTitle(page: Page, model: CatalogueEntry) {
  const title = popover(page).getByTestId("model-info-title");
  await expect(title).toHaveText(expectedTitle(model));
  const links = title.getByRole("link");
  const expected = [
    [model.name, model.documentation_url],
    [model.provider, model.provider_url],
  ].filter((pair): pair is [string, string] => !!pair[0] && !!pair[1]);
  await expect(links).toHaveCount(expected.length);
  for (const [index, [text, href]] of expected.entries()) {
    const link = links.nth(index);
    await expect(link).toHaveText(text);
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
}

/** Presses `link` and checks that it opens `href` in a new tab while the page stays where it is. */
async function expectOpensInNewTab(page: Page, link: Locator, href: string, tap: boolean) {
  const [tab] = await Promise.all([page.waitForEvent("popup"), tap ? link.tap() : link.click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe(new URL(href).href);
  // No way back to the page from the new tab.
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  expect(page.url()).toBe(APP);
  await tab.close();
}

for (const phone of [false, true]) {
  test.describe(phone ? "phone" : "desktop", () => {
    test.use(
      phone
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 900 } },
    );
    ownDevice();
    const press = (locator: Locator) => (phone ? locator.tap() : locator.click());

    test("chain card: model (publisher, coverage) with links to the documentation and the homepage", async ({
      page,
    }, testInfo) => {
      await open(page, true);
      const cards = weatherChain(page).locator('[data-testid^="model-card-"]');
      await expect(cards.first()).toBeVisible();
      const ids = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")!.replace("model-card-", "")),
      );
      expect(ids.length).toBeGreaterThan(1);
      // Every model of the chain, as the catalogue has it.
      for (const id of ids) {
        const model = byId(id);
        await press(weatherChain(page).getByTestId(`model-card-${id}`).getByRole("button", { name: /^Details for / }));
        await expect(popover(page)).toBeVisible();
        await expectTitle(page, model);
        await page.keyboard.press("Escape");
        await expect(popover(page)).toHaveCount(0);
      }

      // The first model: its name opens the documentation, its publisher the homepage, each in a new tab.
      const model = byId(ids[0]!);
      expect(model.documentation_url).toMatch(/^https:\/\//);
      expect(model.provider_url).toMatch(/^https:\/\//);
      const info = weatherChain(page).getByTestId(`model-card-${model.id}`).getByRole("button", { name: /^Details for / });
      await press(info);
      const title = popover(page).getByTestId("model-info-title");
      await page.screenshot({
        path: testInfo.outputPath(`model-info-chain-${phone ? "phone" : "desktop"}.png`),
        clip: await popoverClip(page),
      });
      await expectOpensInNewTab(page, title.getByRole("link", { name: model.name }), model.documentation_url!, phone);
      await expect(popover(page)).toBeVisible();
      await expectOpensInNewTab(page, title.getByRole("link", { name: model.provider! }), model.provider_url!, phone);
    });

    test("meteogram header: the same title and links in the popover of the info button", async ({
      page,
    }, testInfo) => {
      await open(page, false);
      const buttons = meteogram(page).getByTestId("model-header-info-button");
      await expect(buttons.first()).toBeVisible();
      const item = meteogram(page).locator(".model-header-info__item").first();
      const model = byName((await item.getAttribute("data-model"))!);
      await press(buttons.first());
      await expect(popover(page)).toBeVisible();
      await expectTitle(page, model);
      await page.screenshot({
        path: testInfo.outputPath(`model-info-header-${phone ? "phone" : "desktop"}.png`),
        clip: await popoverClip(page),
      });
      // A press on the link opens the documentation, not the full-screen meteogram.
      const title = popover(page).getByTestId("model-info-title");
      await expectOpensInNewTab(page, title.getByRole("link", { name: model.name }), model.documentation_url!, phone);
      await expect(page.getByRole("dialog", { name: "Meteogram (full screen)" })).toHaveCount(0);
    });
  });
}

/** The popover with some room around it, for the pictures. */
async function popoverClip(page: Page) {
  const box = (await popover(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  const x = Math.max(0, box.x - 16);
  const y = Math.max(0, box.y - 48);
  return {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + 32),
    height: Math.min(viewport.height - y, box.height + 64),
  };
}
