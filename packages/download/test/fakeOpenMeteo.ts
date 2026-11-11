// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// A fake Open-Meteo behind an injected fetch, standing in for the mocked clients of the pytest suite. No network.
import { DEFAULT_FORECAST_URL, DEFAULT_META_URL, DEFAULT_SINGLE_RUNS_URL, HOUR_MS, type FetchLike } from "../src/index";

export type CallKind = "forecast" | "cloud" | "sun" | "meta" | "single_run";

export interface Call {
  kind: CallKind;
  url: string;
  params: Record<string, string>;
  /** Open-Meteo model of forecast and Single Runs requests, data path of `meta.json`. */
  model: string;
  hourly: string[];
}

/** What a handler answers: a JSON body, a Response, or an Error (network failure). */
export type Reply = unknown;
export type Handler = (call: Call) => Reply | Promise<Reply>;

export interface FakeApi {
  fetch: FetchLike;
  calls: Call[];
  ofKind(kind: CallKind): Call[];
}

/** `YYYY-MM-DDTHH:MM` like Open-Meteo with `timezone=GMT`. */
export function gmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Hourly answer with `count` samples from `start`; `value(variable, index, timeMs)` gives each value. */
export function hourlyAnswer(
  variables: readonly string[],
  start: number,
  count: number,
  value: (variable: string, index: number, timeMs: number) => number | null,
  units: Record<string, string> = {},
): Record<string, unknown> {
  const times = Array.from({ length: Math.max(0, count) }, (_, i) => start + i * HOUR_MS);
  const hourly: Record<string, unknown> = { time: times.map(gmt) };
  for (const variable of variables) hourly[variable] = times.map((t, i) => value(variable, i, t));
  const hourlyUnits: Record<string, string> = {};
  for (const variable of variables) hourlyUnits[variable] = units[variable] ?? defaultUnit(variable);
  return { timezone: "GMT", hourly, hourly_units: hourlyUnits };
}

function defaultUnit(variable: string): string {
  if (variable.includes("temp") || variable.includes("dew_point")) return "°C";
  if (variable.includes("wind") && !variable.includes("direction")) return "km/h";
  if (variable.includes("direction")) return "°";
  if (variable === "precipitation") return "mm";
  if (variable === "snowfall") return "cm";
  if (variable === "snow_depth") return "m";
  if (variable === "weather_code") return "wmo code";
  return "%";
}

/** Like Open-Meteo: samples from `nowHour - past_hours` for `past_hours + forecast_hours` hours. */
export function windowStart(call: Call, nowHour: number): { start: number; count: number } {
  const past = Number(call.params.past_hours ?? 0);
  const forecast = Number(call.params.forecast_hours ?? 24);
  return { start: nowHour - past * HOUR_MS, count: past + forecast };
}

export interface FakeHandlers {
  forecast?: Handler;
  cloud?: Handler;
  sun?: Reply | Handler;
  /** `meta.json` documents by data path; unknown paths answer 404. */
  meta?: Record<string, unknown> | Handler;
  singleRun?: Handler;
}

const emptySun = { timezone: "GMT", daily: { time: [], sunrise: [], sunset: [] } };

export function fakeOpenMeteo(handlers: FakeHandlers = {}): FakeApi {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    // Like the real fetch: an abort rejects a pending request with the signal's reason.
    const signal = init?.signal;
    const answer = respond(input);
    if (!signal) return answer;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      answer.then(resolve, reject);
    });
  };
  const respond = async (input: string): Promise<Response> => {
    const url = new URL(input);
    const params = Object.fromEntries(url.searchParams.entries());
    const hourly = params.hourly ? params.hourly.split(",") : [];
    let kind: CallKind;
    let model = params.models ?? "";
    if (input.startsWith(DEFAULT_META_URL)) {
      kind = "meta";
      model = url.pathname.replace(/^\/data\//, "").replace(/\/static\/meta\.json$/, "");
    } else if (input.startsWith(DEFAULT_SINGLE_RUNS_URL)) {
      kind = "single_run";
    } else if (input.startsWith(DEFAULT_FORECAST_URL)) {
      kind = params.daily ? "sun" : hourly.some((v) => v.endsWith("hPa")) ? "cloud" : "forecast";
    } else {
      throw new Error(`unexpected URL ${input}`);
    }
    const call: Call = { kind, url: input, params, model, hourly };
    calls.push(call);

    let reply: Reply;
    if (kind === "meta") {
      const meta = handlers.meta;
      reply = typeof meta === "function" ? await meta(call) : meta?.[model];
      if (reply === undefined) reply = json({ error: true, reason: "Not Found" }, 404);
    } else if (kind === "single_run") {
      reply = handlers.singleRun
        ? await handlers.singleRun(call)
        : json({ error: true, reason: "Run not available" }, 400);
    } else if (kind === "sun") {
      const sun = handlers.sun;
      reply = typeof sun === "function" ? await (sun as Handler)(call) : (sun ?? emptySun);
    } else if (kind === "cloud") {
      reply = handlers.cloud ? await handlers.cloud(call) : json({ error: true, reason: "No cloud handler" }, 400);
    } else {
      reply = handlers.forecast ? await handlers.forecast(call) : json({ error: true, reason: "No handler" }, 400);
    }
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    if (typeof reply === "string") return new Response(reply, { status: 200 });
    return json(reply);
  };
  return { fetch, calls, ofKind: (kind) => calls.filter((c) => c.kind === kind) };
}
