// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Shared smoke scenario for Node and jsdom: auto chain at the Zugspitze, run segments on, default cache.
import { expect } from "vitest";
import { HOUR_MS, createClient, downloadChain } from "../src/index";
import { fakeOpenMeteo, hourlyAnswer, windowStart } from "./fakeOpenMeteo";
import { registry, resolverData } from "./modelData";

export async function runSmoke(): Promise<void> {
  const nowHour = Date.UTC(2026, 9, 26, 9);
  const api = fakeOpenMeteo({
    forecast: (call) => {
      const { start, count } = windowStart(call, nowHour);
      return hourlyAnswer(call.hourly, start, count, (_v, i) => i % 7);
    },
    cloud: (call) => {
      const { start, count } = windowStart(call, nowHour);
      return hourlyAnswer(call.hourly, start, count, (v) => (v.startsWith("cloud") ? 60 : 2000));
    },
    sun: { daily: { time: ["2026-10-26"], sunrise: ["2026-10-26T06:10"], sunset: ["2026-10-26T15:55"] } },
    meta: {
      dwd_icon_d2: {
        last_run_initialisation_time: (nowHour - 3 * HOUR_MS) / 1000,
        data_end_time: (nowHour + 45 * HOUR_MS) / 1000,
        update_interval_seconds: 10800,
      },
    },
  });
  const client = createClient({ fetch: api.fetch, retryBackoffMs: 0 });
  const request = {
    location: { name: "Zugspitze", latitude: 47.421, longitude: 10.985 },
    auto: true,
    now: nowHour + 15 * 60_000,
    timezone: "Europe/Berlin",
  };
  const result = await downloadChain(client, request, { registry, ...resolverData });
  expect(result.autoChain?.region_id).toBe("northern_alps");
  expect(result.chain.map((m) => m.id)).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs"]);
  expect(result.combined.length).toBeGreaterThan(0);
  expect(result.cloud?.profiles.length).toBeGreaterThan(0);
  expect(result.sunPhases).toHaveLength(1);
  expect(result.runSegments["ICON-D2"]?.[0]?.run_init_time).toBe("2026-10-26T06:00:00Z");
  expect(JSON.parse(JSON.stringify(result.combined[0]))).toEqual(result.combined[0]);
  // Second call within the hour: from the default in-memory cache.
  const calls = api.calls.length;
  expect(await downloadChain(client, request, { registry, ...resolverData })).toBe(result);
  expect(api.calls).toHaveLength(calls);
}
