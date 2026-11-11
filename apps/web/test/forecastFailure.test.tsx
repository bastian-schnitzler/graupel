// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The error card of a failed forecast names the reason (REQ-632): the mapping of Open-Meteo's answers to a reason, the
 * most frequent of mixed reasons, and the card with the reason in its second line and the retry button in place.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AllModelsFailedError, ApiError, OutOfDomainError } from "@graupel/download";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type Language } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  FORECAST_FAILURES,
  FORECAST_FAILURE_DETAIL,
  ForecastProvider,
  LocationProvider,
  forecastFailure,
  modelFailure,
  type ForecastFailure,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast?models=icon_d2";
const DAILY = "Daily API request limit exceeded. Please try again tomorrow.";
const CONCURRENT = "Too many concurrent requests";

const answer = (status: number | null, reason?: string) =>
  new ApiError(`Open-Meteo API Error: ${reason ?? status}`, { status, reason: reason ?? null, url: FORECAST_URL });
const daily = () => answer(429, DAILY);
const concurrent = () => answer(429, CONCURRENT);
const overloaded = () => answer(503, "The service is overloaded");
const network = () => answer(null);
const allFailed = (...errors: unknown[]) =>
  new AllModelsFailedError(Object.fromEntries(errors.map((error, index) => [`model ${index + 1}`, error])));

describe("reason of one model's error (REQ-632)", () => {
  it("reads Open-Meteo's 429 reasons case-insensitively by a part of their text", () => {
    expect(modelFailure(daily())).toBe("dailyLimit");
    expect(modelFailure(answer(429, "DAILY api REQUEST limit exceeded"))).toBe("dailyLimit");
    expect(modelFailure(concurrent())).toBe("concurrent");
    expect(modelFailure(answer(429, "too many CONCURRENT requests, please slow down"))).toBe("concurrent");
  });

  it("takes any other 429 for a general error", () => {
    expect(modelFailure(answer(429))).toBe("general");
    expect(modelFailure(answer(429, "Hourly API request limit exceeded. Please try again in the next hour."))).toBe(
      "general",
    );
    expect(modelFailure(answer(429, "Monthly API request limit exceeded."))).toBe("general");
  });

  it("takes every 5xx for an overloaded or disrupted service", () => {
    for (const status of [500, 502, 503, 504, 599]) expect(modelFailure(answer(status))).toBe("unavailable");
    expect(modelFailure(overloaded())).toBe("unavailable");
  });

  it("takes a missing answer (network error, CORS, timeout) for no connection", () => {
    expect(modelFailure(network())).toBe("offline");
    expect(
      modelFailure(
        new ApiError("Open-Meteo request timed out after 60000 ms", {
          status: null,
          url: FORECAST_URL,
          cause: new DOMException("Open-Meteo request timed out", "TimeoutError"),
        }),
      ),
    ).toBe("offline");
  });

  it("takes everything else for a general error", () => {
    expect(modelFailure(answer(400, "Cannot initialize WeatherVariable from invalid String value foo"))).toBe(
      "general",
    );
    const outside = new OutOfDomainError("outside", { status: 400, reason: "No data is available", url: FORECAST_URL });
    expect(modelFailure(outside)).toBe("general");
    expect(modelFailure(answer(404))).toBe("general");
    expect(modelFailure(new Error("harmonize failed"))).toBe("general");
    expect(modelFailure(new TypeError("Failed to fetch"))).toBe("general");
    expect(modelFailure("text")).toBe("general");
    expect(modelFailure(undefined)).toBe("general");
  });
});

describe("reason of a failed forecast (REQ-632)", () => {
  it("names the reason all models share", () => {
    expect(forecastFailure(allFailed(daily(), daily()))).toBe("dailyLimit");
    expect(forecastFailure(allFailed(concurrent()))).toBe("concurrent");
    expect(forecastFailure(allFailed(overloaded(), answer(502), answer(500)))).toBe("unavailable");
    expect(forecastFailure(allFailed(network(), network()))).toBe("offline");
    expect(forecastFailure(allFailed(new Error("broken")))).toBe("general");
  });

  it("takes the most frequent of mixed reasons", () => {
    expect(forecastFailure(allFailed(network(), daily(), network()))).toBe("offline");
    expect(forecastFailure(allFailed(daily(), overloaded(), overloaded()))).toBe("unavailable");
    expect(forecastFailure(allFailed(concurrent(), concurrent(), daily()))).toBe("concurrent");
    // The general reason counts like the others.
    expect(forecastFailure(allFailed(new Error("a"), new Error("b"), daily()))).toBe("general");
    expect(forecastFailure(allFailed(new Error("a"), daily(), daily()))).toBe("dailyLimit");
  });

  it("decides a tie by the order of FORECAST_FAILURES: Open-Meteo's answers first, the general reason last", () => {
    expect(FORECAST_FAILURES).toEqual(["dailyLimit", "concurrent", "unavailable", "offline", "general"]);
    expect(forecastFailure(allFailed(concurrent(), daily()))).toBe("dailyLimit");
    expect(forecastFailure(allFailed(network(), overloaded()))).toBe("unavailable");
    expect(forecastFailure(allFailed(overloaded(), concurrent()))).toBe("concurrent");
    expect(forecastFailure(allFailed(new Error("a"), network()))).toBe("offline");
    expect(forecastFailure(allFailed(network(), network(), daily(), daily(), new Error("a")))).toBe("dailyLimit");
  });

  it("reads an error that is not an AllModelsFailedError as the only one", () => {
    expect(forecastFailure(daily())).toBe("dailyLimit");
    expect(forecastFailure(network())).toBe("offline");
    expect(forecastFailure(new Error("model data"))).toBe("general");
    expect(forecastFailure(undefined)).toBe("general");
    expect(forecastFailure(allFailed())).toBe("general");
  });
});

describe("texts of the reasons (REQ-632)", () => {
  const named = FORECAST_FAILURES.filter((failure) => failure !== "general");

  it("gives every named reason a second line and the general one none", () => {
    expect(FORECAST_FAILURE_DETAIL.general).toBeNull();
    for (const failure of named) expect(FORECAST_FAILURE_DETAIL[failure]).toBe(`forecast.reason.${failure}`);
  });

  it.each(LANGUAGES)("has its own text for every reason in %s", (language) => {
    const texts = named.map((failure) => MESSAGES[language][FORECAST_FAILURE_DETAIL[failure]!]);
    for (const text of texts) expect(text?.trim()).toBeTruthy();
    expect(new Set(texts).size).toBe(named.length);
    if (language !== "en") {
      for (const failure of named) {
        const key = FORECAST_FAILURE_DETAIL[failure]!;
        expect(MESSAGES[language][key], `${language}: ${key}`).not.toBe(MESSAGES.en[key]);
      }
    }
  });
});

function renderPanel(loader: ForecastLoader, language: Language = "en") {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={[language]} fallbackLanguage={language} browserLanguages={[]}>
        <NoticesProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <MeteogramPanel />
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const cardText = () => screen.getByTestId("error-card").querySelector(".error-card__text")?.textContent;
const cardDetail = () => screen.queryByTestId("error-card-detail")?.textContent ?? null;

describe("error card of a failed forecast (REQ-632)", () => {
  const cases: readonly [ForecastFailure, () => unknown, string][] = [
    [
      "dailyLimit",
      () => allFailed(daily(), daily()),
      "Open-Meteo's daily request limit has been reached. It works again tomorrow, or right away from another network.",
    ],
    [
      "concurrent",
      () => allFailed(concurrent(), daily(), concurrent()),
      "Open-Meteo is receiving too many concurrent requests. Please try again in a moment.",
    ],
    ["unavailable", () => allFailed(overloaded()), "Open-Meteo is overloaded or disrupted. Please try again later."],
    [
      "offline",
      () => allFailed(network(), network()),
      "No connection to Open-Meteo, or the request was blocked. Check your connection.",
    ],
  ];

  it.each(cases)("names the reason %s under the message", async (_, error, detail) => {
    renderPanel(vi.fn<ForecastLoader>(async () => Promise.reject(error())));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(cardText()).toBe("The forecast could not be loaded.");
    expect(cardDetail()).toBe(detail);
    expect(within(screen.getByTestId("forecast-error")).getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the message alone for a general error", async () => {
    renderPanel(vi.fn<ForecastLoader>(async () => Promise.reject(allFailed(new Error("broken"), answer(400)))));
    expect((await screen.findByRole("alert")).textContent).toBe("The forecast could not be loaded.");
    expect(cardDetail()).toBeNull();
  });

  it("names the reason in the active language", async () => {
    renderPanel(vi.fn<ForecastLoader>(async () => Promise.reject(allFailed(daily()))), "de");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(cardText()).toBe("Die Vorhersage konnte nicht geladen werden.");
    expect(cardDetail()).toBe(translate("de", "forecast.reason.dailyLimit"));
    expect(cardDetail()).toBe(
      "Das Tageslimit für Anfragen an Open-Meteo ist erreicht. Morgen geht es wieder, aus einem anderen Netz schon jetzt.",
    );
  });

  it("follows the reason of the next try and clears the card once the forecast loads", async () => {
    const outcomes: unknown[] = [allFailed(daily()), allFailed(overloaded(), overloaded())];
    const loader = vi.fn<ForecastLoader>(async () => {
      const next = outcomes.shift();
      if (next) throw next;
      return forecastFixture();
    });
    renderPanel(loader);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(cardDetail()).toBe(translate("en", "forecast.reason.dailyLimit"));

    const retry = () =>
      fireEvent.click(within(screen.getByTestId("forecast-error")).getByRole("button", { name: "Try again" }));
    await act(async () => retry());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(cardDetail()).toBe(translate("en", "forecast.reason.unavailable"));
    expect(screen.getAllByTestId("error-card")).toHaveLength(1);

    await act(async () => retry());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("forecast-error")).toBeNull();
    expect(loader).toHaveBeenCalledTimes(3);
    expect(loader.mock.calls[2]![0].refresh).toBe(true);
  });
});
