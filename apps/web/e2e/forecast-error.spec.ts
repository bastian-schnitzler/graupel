// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The error card of a failed forecast names the reason (REQ-632), derived from Open-Meteo's answers: its daily limit
 * (429), an overloaded service (503) and no answer at all (network error). "Try again" stays and loads the forecast
 * once Open-Meteo answers again.
 */
import type { Route } from "@playwright/test";
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

type Failure = (route: Route) => Promise<void>;

const DAILY_LIMIT: Failure = (route) =>
  route.fulfill({
    status: 429,
    json: { error: true, reason: "Daily API request limit exceeded. Please try again tomorrow." },
  });
const OVERLOADED: Failure = (route) =>
  route.fulfill({ status: 503, json: { error: true, reason: "The service is overloaded" } });
const NO_CONNECTION: Failure = (route) => route.abort();

/** Lets every forecast request fail with `failure` until the returned function is called; then the fake answers. */
async function failForecast(page: Page, failure: Failure): Promise<() => void> {
  let failing = true;
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    failing ? failure(route) : fakeForecast(route),
  );
  return () => {
    failing = false;
  };
}

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

test.describe("in English", () => {
  test.use({ locale: "en-GB" });

  const cases: readonly [string, Failure, string][] = [
    [
      "the daily limit (429)",
      DAILY_LIMIT,
      "Open-Meteo's daily request limit has been reached. It works again tomorrow, or right away from another network.",
    ],
    ["an overloaded service (503)", OVERLOADED, "Open-Meteo is overloaded or disrupted. Please try again later."],
    [
      "no connection (network error)",
      NO_CONNECTION,
      "No connection to Open-Meteo, or the request was blocked. Check your connection.",
    ],
  ];

  for (const [name, failure, reason] of cases) {
    test(`the card names ${name} and "Try again" loads the forecast`, async ({ page }) => {
      const recover = await failForecast(page, failure);
      await page.goto(APP);

      const card = page.getByTestId("error-card");
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("data-notice", "forecast");
      await expect(card.locator(".error-card__text")).toHaveText("The forecast could not be loaded.");
      await expect(card.getByTestId("error-card-detail")).toHaveText(reason);
      await expect(chart(page)).toHaveCount(0);

      recover();
      await page.getByTestId("forecast-error").getByRole("button", { name: "Try again" }).click();
      await expect(chart(page)).toBeVisible();
      await expect(page.getByTestId("error-card")).toHaveCount(0);
      await expect(page.getByTestId("forecast-error")).toHaveCount(0);
    });
  }
});

test.describe("in German", () => {
  test.use({ locale: "de-DE" });

  test("the card names the daily limit in the active language", async ({ page }) => {
    await failForecast(page, DAILY_LIMIT);
    await page.goto(APP);
    const card = page.getByTestId("error-card");
    await expect(card.locator(".error-card__text")).toHaveText("Die Vorhersage konnte nicht geladen werden.");
    await expect(card.getByTestId("error-card-detail")).toHaveText(
      "Das Tageslimit für Anfragen an Open-Meteo ist erreicht. Morgen geht es wieder, aus einem anderen Netz schon jetzt.",
    );
    await expect(page.getByTestId("forecast-error").getByRole("button", { name: "Erneut versuchen" })).toBeVisible();
  });
});
