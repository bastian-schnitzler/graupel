// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Runs in the info popover of a model (REQ-687) on the desktop and on a phone, from a card of the weather chain and
 * from the info button in the meteogram's model header: below the title the properties, grid spacing and "Max (from
 * now)" (hours left from now / catalogue horizon), without time step, catalogue horizon and probability end; below
 * them the main run and the ensemble run, each listed separately; below them the explanation of the horizon.
 *
 * The fake Open-Meteo names in every model's `meta.json` a run 7 hours old (06:00 UTC) that ends 48 hours after its
 * start, so 41 hours are left from now; every ensemble's `meta.json` names a run from 00:00 UTC, available at 05:00,
 * that ends 36 hours after its start. The forecast data of every model ends with its run, 41 hours from now. The Single
 * Runs API has no older run, so every series is one run.
 */
import { readFileSync } from "node:fs";
import type { Route } from "@playwright/test";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const HOUR_MS = 3_600_000;
/** Fixed time: Tuesday, 3 November 2026, 13:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 3, 13);
const MAIN_RUN_MS = Date.UTC(2026, 10, 3, 6);
const MAIN_RUN_HOURS = 48;
const LEFT_HOURS = 41;
const ENSEMBLE_RUN_MS = Date.UTC(2026, 10, 3, 0);
const ENSEMBLE_HOURS = 36;

interface CatalogueEntry {
  id: string;
  name: string;
  max_forecast_hours: number;
  ensemble_meta_path?: string | null;
}

const CATALOGUE = (
  JSON.parse(readFileSync(new URL("../../../model-data/model_catalogue.json", import.meta.url), "utf8")) as {
    models: CatalogueEntry[];
  }
).models;
const byId = (id: string) => CATALOGUE.find((model) => model.id === id)!;
const byName = (name: string) => CATALOGUE.find((model) => model.name === name)!;

test.use({ timezoneId: "UTC", locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  // Each model's data ends where its run ends: 41 hours from now.
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    const ahead = Number(new URL(route.request().url()).searchParams.get("forecast_hours") ?? 0);
    return fakeForecast(route, { now: FIXED_NOW, cutHours: Math.max(0, ahead - LEFT_HOURS) });
  });
  await page.route("https://api.open-meteo.com/data/**", fakeMeta);
  await page.route("https://single-runs-api.open-meteo.com/**", (route) =>
    route.fulfill({ json: { timezone: "GMT", hourly: { time: [] } } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

function fakeMeta(route: Route) {
  const ensemble = /_ensemble|_eps/.test(route.request().url());
  const run = ensemble ? ENSEMBLE_RUN_MS : MAIN_RUN_MS;
  return route.fulfill({
    json: {
      last_run_initialisation_time: run / 1000,
      last_run_availability_time: run / 1000 + (ensemble ? 5 : 3) * 3600,
      data_end_time: (run + (ensemble ? ENSEMBLE_HOURS : MAIN_RUN_HOURS) * HOUR_MS) / 1000,
      update_interval_seconds: 6 * 3600,
      temporal_resolution_seconds: 3600,
    },
  });
}

/** Date and time as the popover writes them (en-GB, the device's time zone, here UTC like the fake forecast, REQ-733). */
const time = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(ms);

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
const weatherChain = (page: Page) =>
  page.locator('[data-region="model-chain"]').getByRole("group", { name: "Weather chain" });
const popover = (page: Page) => page.getByTestId("model-info-popover");

async function open(page: Page, chain: boolean) {
  if (chain) await page.addInitScript(() => window.localStorage.setItem("graupel.showWeatherChain", "true"));
  await page.goto(APP);
  await expect(meteogram(page).locator("svg.meteogram-svg-integrated")).toBeVisible();
}

/** Checks the open popover of `model`: order of its parts, the properties, the runs and the explanation. */
async function expectRuns(page: Page, model: CatalogueEntry) {
  const box = popover(page);
  await expect(box).toBeVisible();
  const parts = box.locator(
    '[data-testid="model-info-title"], [data-testid="model-info-specs"], [data-testid="model-info-main-runs"], ' +
      '[data-testid="model-info-ensemble-runs"], [data-testid="model-info-explanation"]',
  );
  const ensemble = !!model.ensemble_meta_path;
  const expectedParts = [
    "model-info-title",
    "model-info-specs",
    "model-info-main-runs",
    ...(ensemble ? ["model-info-ensemble-runs"] : []),
    "model-info-explanation",
  ];
  await expect.poll(() => parts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")))).toEqual(
    expectedParts,
  );

  // Grid spacing stays; one line Max (from now) instead of time step, catalogue horizon and probability end.
  const catalogue = model.max_forecast_hours;
  const left = Math.min(LEFT_HOURS, catalogue);
  const specs = box.getByTestId("model-info-specs");
  await expect(specs.locator("dt")).toHaveText(["Grid spacing", "Max (from now)"]);
  await expect(specs.locator("dd").last()).toHaveText(`${left} h / ${catalogue} h`);
  await expect(box).not.toContainText(/Time step|Catalogue horizon:|Probability until|Forecast length/);

  // The main run and the ensemble run, each listed separately.
  const main = box.getByTestId("model-info-main-runs");
  await expect(main.locator(".model-info__runs-title")).toHaveText("Main run");
  await expect(main.locator(".model-info__run").first()).toContainText(new RegExp(`^${time(MAIN_RUN_MS)} · .*until `));
  if (ensemble) {
    const runs = box.getByTestId("model-info-ensemble-runs");
    await expect(runs.locator(".model-info__runs-title")).toHaveText(`Ensemble run (${model.ensemble_meta_path})`);
    await expect(runs.locator(".model-info__run").first()).toHaveText(
      `${time(ENSEMBLE_RUN_MS)} · available ${time(ENSEMBLE_RUN_MS + 5 * HOUR_MS)}, until ` +
        time(ENSEMBLE_RUN_MS + ENSEMBLE_HOURS * HOUR_MS),
    );
  }

  // The explanation below refers to the line Max (from now).
  const explanation = box.getByTestId("model-info-explanation").locator("p");
  await expect(explanation.first()).toHaveText(
    `Max (from now) ${left} h / ${catalogue} h: the model’s longest run is ${catalogue} h long (catalogue horizon); ` +
      `from the current hour on, the data reaches ${left} h.`,
  );
  if (left < catalogue) {
    await expect(explanation.nth(1)).toContainText(`7 h before the current hour (${time(FIXED_NOW)})`);
    await expect(explanation.nth(1)).toContainText(`only ${left} h are left from now`);
  }

  // Inside the window.
  const rect = (await box.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
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
    const name = phone ? "phone" : "desktop";

    test("chain card: properties, main run, ensemble run and explanation", async ({ page }, testInfo) => {
      await open(page, true);
      const cards = weatherChain(page).locator('[data-testid^="model-card-"]');
      await expect(cards.first()).toBeVisible();
      const ids = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")!.replace("model-card-", "")),
      );
      // At least one model of the chain with an ensemble.
      expect(ids.some((id) => !!byId(id).ensemble_meta_path)).toBe(true);
      for (const id of ids) {
        const info = weatherChain(page).getByTestId(`model-card-${id}`).getByRole("button", { name: /^Details for / });
        await press(info);
        await expectRuns(page, byId(id));
        if (byId(id).ensemble_meta_path) {
          await page.screenshot({ path: testInfo.outputPath(`model-info-runs-chain-${name}.png`) });
        }
        await page.keyboard.press("Escape");
        await expect(popover(page)).toHaveCount(0);
      }
    });

    test("meteogram header: the same parts in the popover of the info button", async ({ page }, testInfo) => {
      await open(page, false);
      const items = meteogram(page).locator(".model-header-info__item");
      await expect(items.first()).toBeVisible();
      const models = await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-model")!));
      const withEnsemble = models.find((model) => !!byName(model).ensemble_meta_path) ?? models[0]!;
      const item = meteogram(page).locator(`.model-header-info__item[data-model="${withEnsemble}"]`);
      await press(item.getByTestId("model-header-info-button"));
      await expectRuns(page, byName(withEnsemble));
      await page.screenshot({ path: testInfo.outputPath(`model-info-runs-header-${name}.png`) });
    });
  });
}

/**
 * REQ-733: the runs stand in the device's time zone, not in the place's (the fake forecast's, UTC); when the device's
 * zone cannot be determined, in that of the domain's default place (here the default configuration: Mont Blanc,
 * Europe/Paris).
 */
test.describe("time zone of the runs (REQ-733)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  /** Date and time as the popover writes them in `timeZone`. */
  const zoned = (ms: number, timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(ms);

  async function expectRunsIn(page: Page, timeZone: string) {
    await open(page, true);
    const cards = weatherChain(page).locator('[data-testid^="model-card-"]');
    await expect(cards.first()).toBeVisible();
    const ids = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")!.replace("model-card-", "")),
    );
    const withEnsemble = ids.find((id) => !!byId(id).ensemble_meta_path)!;
    expect(withEnsemble).toBeTruthy();
    await weatherChain(page)
      .getByTestId(`model-card-${withEnsemble}`)
      .getByRole("button", { name: /^Details for / })
      .click();
    const box = popover(page);
    await expect(box.getByTestId("model-info-main-runs").locator(".model-info__run").first()).toContainText(
      new RegExp(`^${zoned(MAIN_RUN_MS, timeZone)} · .*until ${zoned(MAIN_RUN_MS + MAIN_RUN_HOURS * HOUR_MS, timeZone)}`),
    );
    await expect(box.getByTestId("model-info-ensemble-runs").locator(".model-info__run").first()).toHaveText(
      `${zoned(ENSEMBLE_RUN_MS, timeZone)} · available ${zoned(ENSEMBLE_RUN_MS + 5 * HOUR_MS, timeZone)}, until ` +
        zoned(ENSEMBLE_RUN_MS + ENSEMBLE_HOURS * HOUR_MS, timeZone),
    );
  }

  test.describe("device in New York", () => {
    test.use({ timezoneId: "America/New_York" });

    test("shows the runs in the device's time zone", async ({ page }) => {
      // 06:00 UTC is 01:00 in New York.
      expect(zoned(MAIN_RUN_MS, "America/New_York")).toBe("03/11, 01:00");
      await expectRunsIn(page, "America/New_York");
    });
  });

  test("without a determinable device zone in that of the domain's default place", async ({ page }) => {
    // The device reports no time zone. Each formatter is wrapped: the fixed clock's formatters carry their own
    // `resolvedOptions`, so patching the prototype would not reach them.
    await page.addInitScript(() => {
      const Base = Intl.DateTimeFormat;
      const Patched = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
        const format = new Base(...args);
        const resolved = format.resolvedOptions.bind(format);
        format.resolvedOptions = () => ({ ...resolved(), timeZone: undefined as unknown as string });
        return format;
      } as unknown as typeof Intl.DateTimeFormat;
      Object.assign(Patched, { prototype: Base.prototype, supportedLocalesOf: Base.supportedLocalesOf.bind(Base) });
      Intl.DateTimeFormat = Patched;
    });
    expect(zoned(MAIN_RUN_MS, "Europe/Paris")).toBe("03/11, 07:00");
    await expectRunsIn(page, "Europe/Paris");
  });
});
