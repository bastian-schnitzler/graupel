// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Why the forecast did not load (REQ-632). When every model of the chain failed, `downloadChain` throws an
 * `AllModelsFailedError` with the error of each model; the reason is read from Open-Meteo's answers to them: its daily
 * limit (429 "Daily API request limit exceeded"), too many concurrent requests (429 "Too many concurrent requests"),
 * an overloaded or disrupted service (5xx), no answer at all (network error, timeout, or a request the browser blocked,
 * e.g. CORS), else a general error. With mixed reasons the most frequent one counts.
 */
import { AllModelsFailedError, ApiError } from "@graupel/download";
import type { MessageKey } from "../i18n/index.ts";

/**
 * The reasons. Equally frequent reasons go to the one first in this list: an answer of Open-Meteo says more than a
 * missing one, and every named reason more than the general one. The daily limit leads, since trying again does not
 * help before the next day, while too many concurrent requests pass in a moment.
 */
export const FORECAST_FAILURES = ["dailyLimit", "concurrent", "unavailable", "offline", "general"] as const;

export type ForecastFailure = (typeof FORECAST_FAILURES)[number];

/** Second line of the card under "The forecast could not be loaded."; the general case has none. */
export const FORECAST_FAILURE_DETAIL: Readonly<Record<ForecastFailure, MessageKey | null>> = {
  dailyLimit: "forecast.reason.dailyLimit",
  concurrent: "forecast.reason.concurrent",
  unavailable: "forecast.reason.unavailable",
  offline: "forecast.reason.offline",
  general: null,
};

/**
 * Reason of one model's error. Open-Meteo's `reason` is matched case-insensitively by a part of its text; any other
 * 429 (e.g. an hourly or monthly limit) is a general error.
 */
export function modelFailure(error: unknown): ForecastFailure {
  if (!(error instanceof ApiError)) return "general";
  const reason = (error.reason ?? "").toLowerCase();
  if (reason.includes("daily api request limit")) return "dailyLimit";
  if (reason.includes("concurrent")) return "concurrent";
  if (error.status === null) return "offline";
  if (error.status >= 500 && error.status <= 599) return "unavailable";
  return "general";
}

/** Reason of a failed forecast: the most frequent of the models of an `AllModelsFailedError`, else the error's own. */
export function forecastFailure(error: unknown): ForecastFailure {
  const errors = error instanceof AllModelsFailedError ? Object.values(error.errors) : [error];
  const counts = new Map<ForecastFailure, number>();
  for (const each of errors) {
    const failure = modelFailure(each);
    counts.set(failure, (counts.get(failure) ?? 0) + 1);
  }
  let best: ForecastFailure = "general";
  let most = 0;
  // Strictly more wins, so a tie keeps the reason earlier in FORECAST_FAILURES.
  for (const failure of FORECAST_FAILURES) {
    const count = counts.get(failure) ?? 0;
    if (count > most) {
      best = failure;
      most = count;
    }
  }
  return best;
}
