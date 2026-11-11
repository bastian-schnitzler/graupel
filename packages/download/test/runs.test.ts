// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Run segments, probing of newer runs and ensemble runs. Run segments are loaded by
// default and can be switched off (REQ-414); an outage of the Single Runs API stops the search (REQ-633). No network: Open-Meteo is a fake behind an injected fetch.
import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  MAX_OLDER_RUNS,
  SingleRunsUnavailableError,
  buildRunSegments,
  canonicalTimestamp,
  createClient,
  downloadChain,
  resolveRunSegments,
  runLabel,
  type DownloadChainRequest,
  type ForecastResult,
} from "../src/index";
import { fakeOpenMeteo, hourlyAnswer, json, windowStart, type Call, type FakeApi, type FakeHandlers } from "./fakeOpenMeteo";
import { catalogue, registry, resolverData } from "./modelData";

const NOW = Date.UTC(2026, 9, 6, 12, 20);
const NOW_HOUR = Date.UTC(2026, 9, 6, 12);
const LOCATION = { name: "Test", latitude: 47, longitude: 11 };
const RUN_END_CHAIN = [
  { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 10 },
  { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 20 },
];
const seconds = (ms: number) => Math.floor(ms / 1000);
const at = (hours: number) => canonicalTimestamp(NOW_HOUR + hours * HOUR_MS);

function client(api: FakeApi) {
  return createClient({ fetch: api.fetch, retryBackoffMs: 0, cache: null });
}

function download(api: FakeApi, request: Partial<DownloadChainRequest> = {}): Promise<ForecastResult> {
  return downloadChain(
    client(api),
    {
      location: LOCATION,
      now: NOW,
      timezone: "UTC",
      cloudChain: [],
      chain: RUN_END_CHAIN,
      quantities: ["temperature"],
      ...request,
    },
    { catalogue, registry },
  );
}

/** Every model delivers its whole window (GapClient without gaps). */
const fullForecast: FakeHandlers["forecast"] = (call) => {
  const { start, count } = windowStart(call, NOW_HOUR);
  return hourlyAnswer(call.hourly, start, count, (_v, i) => i);
};

/** A Single Runs answer: `hours` samples of 1.0 from the run's start. */
function singleRunAnswer(call: Call, hours = Number(call.params.forecast_hours)) {
  const start = Date.parse(`${call.params.run}:00Z`);
  return hourlyAnswer(["temperature_2m"], start, hours, () => 1);
}

describe("run segments (test_forecast_archive_and_handover.py)", () => {
  it("splits mixed runs into segments: the newest run ends after 5 h, the older delivers the rest", async () => {
    const newestInit = NOW_HOUR - 2 * HOUR_MS;
    const olderInit = newestInit - 6 * HOUR_MS;
    const api = fakeOpenMeteo({
      forecast: fullForecast,
      meta: {
        ecmwf_ifs: {
          last_run_initialisation_time: seconds(newestInit),
          data_end_time: seconds(NOW_HOUR + 5 * HOUR_MS),
          update_interval_seconds: 21600,
        },
      },
      singleRun: (call) => singleRunAnswer(call),
    });
    const result = await download(api, { chain: [{ name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 20 }] });

    const info = result.availability["ECMWF IFS"]!;
    const boundary = at(5);
    expect(info.run_segments).toEqual([
      { run_init_time: canonicalTimestamp(newestInit), valid_from: null, valid_until: boundary, run_length_hours: 6 },
      // The fake run covers the requested hours through hour 20 + 8.
      { run_init_time: canonicalTimestamp(olderInit), valid_from: boundary, valid_until: null, run_length_hours: 28 },
    ]);
    expect(info.data_end_run_init_time).toBe(canonicalTimestamp(olderInit));
    expect(api.ofKind("single_run").map((c) => c.params.run)).toEqual([runLabel(olderInit)]);
    expect(result.runSegments["ECMWF IFS"]).toEqual(info.run_segments);
    expect(result.chain[0]?.runSegments).toEqual(info.run_segments);
  });

  it("loads no run segments when switched off (REQ-414)", async () => {
    const api = fakeOpenMeteo({
      forecast: fullForecast,
      meta: {
        ecmwf_ifs: {
          last_run_initialisation_time: seconds(NOW_HOUR - 2 * HOUR_MS),
          data_end_time: seconds(NOW_HOUR + 5 * HOUR_MS),
          update_interval_seconds: 21600,
        },
      },
      singleRun: (call) => singleRunAnswer(call),
    });
    const result = await download(api, {
      chain: [{ name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 20 }],
      runSegments: false,
    });
    expect(api.ofKind("single_run")).toEqual([]);
    expect(result.runSegments).toEqual({});
    expect(result.availability["ECMWF IFS"]?.run_segments).toBeUndefined();
    expect(result.availability["ECMWF IFS"]?.last_run_init_time).toBe(at(-2));
  });

  /** `meta.json` names a run 5 h ago that may not explain the served data (every 3 h, 121 samples per run). */
  function laggingMetadata(published: number[], metaRunHours: number) {
    const metaInit = NOW_HOUR - 5 * HOUR_MS;
    const runs = new Set(published);
    const api = fakeOpenMeteo({
      forecast: fullForecast,
      meta: {
        dwd_icon_eu: {
          last_run_initialisation_time: seconds(metaInit),
          last_run_availability_time: seconds(metaInit),
          data_end_time: seconds(metaInit + metaRunHours * HOUR_MS),
          update_interval_seconds: 10800,
        },
      },
      singleRun: (call) =>
        runs.has(Date.parse(`${call.params.run}:00Z`))
          ? singleRunAnswer(call, 121)
          : json({ error: true, reason: "Run not available" }, 400),
    });
    return { api, metaInit };
  }

  it("needs no extra run requests when the metadata explains the data", async () => {
    const { api, metaInit } = laggingMetadata([], 31);
    const result = await download(api);
    expect(api.ofKind("single_run")).toEqual([]);
    expect(result.availability["ICON-EU"]?.last_run_init_time).toBe(canonicalTimestamp(metaInit));
    expect(result.availability["ICON-EU"]?.run_segments).toEqual([
      { run_init_time: canonicalTimestamp(metaInit), valid_from: null, valid_until: null, run_length_hours: 30 },
    ]);
  });

  it("probes a newer run when the metadata cannot explain the data", async () => {
    const newer = NOW_HOUR - 2 * HOUR_MS;
    // The metadata run ends after 3 h, no older run covers the rest, yet data is served.
    const { api } = laggingMetadata([newer], 3);
    const icon = (await download(api)).availability["ICON-EU"]!;
    expect(icon.last_run_init_time).toBe(canonicalTimestamp(newer));
    // Availability of a run the metadata does not list is unknown.
    expect(icon.last_run_availability_time).toBeNull();
    // The newer 120 h run covers the whole series: one segment.
    expect(icon.run_segments?.map((s) => s.run_init_time)).toEqual([canonicalTimestamp(newer)]);
    expect(icon.run_segments?.[0]?.run_length_hours).toBe(120);
    // Probing forward stops before the next init time, which is in the future.
    const runs = api.ofKind("single_run").map((c) => c.params.run);
    expect(runs.at(-1)).toBe(runLabel(newer));
    expect(runs.filter((r) => r === runLabel(newer))).toHaveLength(1);
  });

  it("keeps the metadata run when no newer run is published", async () => {
    const { api, metaInit } = laggingMetadata([], 3);
    const result = await download(api);
    expect(result.availability["ICON-EU"]).toMatchObject({
      last_run_init_time: canonicalTimestamp(metaInit),
      last_run_availability_time: canonicalTimestamp(metaInit),
    });
    expect(result.warnings.some((w) => w.startsWith("Failed to fetch run "))).toBe(true);
  });

  it("stops the backward search at a run of the longest length", async () => {
    const metaInit = NOW_HOUR - 5 * HOUR_MS;
    const older = metaInit - 3 * HOUR_MS;
    // Every older run would be published with ICON-EU's longest length.
    const { api } = laggingMetadata(
      Array.from({ length: 8 }, (_, k) => metaInit - 3 * (k + 1) * HOUR_MS),
      3,
    );
    const [segments, coveredEnd] = await buildRunSegments(
      client(api),
      { modelId: "icon_eu", location: LOCATION, catalogue },
      { init: null, available: null, initEpoch: seconds(metaInit), dataEndEpoch: seconds(metaInit + 3 * HOUR_MS), intervalSeconds: 10800 },
      NOW_HOUR + 300 * HOUR_MS,
    );
    // The first older run is 120 h long: no earlier run can reach further.
    expect(api.ofKind("single_run").map((c) => c.params.run)).toEqual([runLabel(older)]);
    expect(segments.map((s) => s.run_init_time)).toEqual([canonicalTimestamp(metaInit), canonicalTimestamp(older)]);
    expect(coveredEnd).toBe(older + 121 * HOUR_MS);
  });
});

// REQ-768: Open-Meteo ends HRRR on 2026-11-30; RRFS (84 h every 6 h) leads the chains of the USA.
describe("RRFS in the USA (REQ-768)", () => {
  const CHICAGO = { name: "Chicago", latitude: 41.878, longitude: -87.63 };
  /** The newest RRFS run (06 UTC) is still being written and ends after 5 h; the 00 UTC run delivers the rest. */
  const newestInit = NOW_HOUR - 6 * HOUR_MS;
  const olderInit = newestInit - 6 * HOUR_MS;
  const rrfsApi = () =>
    fakeOpenMeteo({
      forecast: fullForecast,
      meta: {
        ncep_rrfs_conus: {
          last_run_initialisation_time: seconds(newestInit),
          last_run_availability_time: seconds(newestInit + 3 * HOUR_MS),
          data_end_time: seconds(NOW_HOUR + 5 * HOUR_MS),
          update_interval_seconds: 21600,
          temporal_resolution_seconds: 3600,
        },
      },
      // Every published run covers the 85 hours 0-84 h.
      singleRun: (call) =>
        call.model === "ncep_rrfs_conus" && Date.parse(`${call.params.run}:00Z`) <= newestInit
          ? singleRunAnswer(call, 85)
          : json({ error: true, reason: "Run not available" }, 400),
    });

  it("resolves Chicago's chain to RRFS and downloads it with its run segments", async () => {
    const api = rrfsApi();
    const result = await downloadChain(
      client(api),
      { location: CHICAGO, now: NOW, timezone: "UTC", cloudChain: [], auto: true, quantities: ["temperature"] },
      { registry, ...resolverData },
    );
    expect(result.autoChain?.main_model_chain.map((m) => m.id)).toEqual([
      "ncep_rrfs_conus",
      "ncep_nbm_conus",
      "ecmwf_ifs",
    ]);
    expect(api.ofKind("forecast").map((c) => c.model)).toContain("ncep_rrfs_conus");
    expect(api.ofKind("forecast").map((c) => c.model)).not.toContain("ncep_hrrr_conus");
    // The chain starts with RRFS (84 h) under its short name, and the chart is complete.
    expect(result.chain[0]).toMatchObject({ id: "ncep_rrfs_conus", shortName: "RRFS", sliceEndHours: 84 });
    expect(result.combined.every((p) => p.value !== null)).toBe(true);
    expect(result.combined.find((p) => p.timestamp === at(83))?.model).toBe("NCEP RRFS Conus");
    expect(result.combined.find((p) => p.timestamp === at(84))?.model).toBe(result.chain[1]?.model);

    // Run lookup: the newest run ends after 5 h, the Single Runs API serves the 00 UTC run for the rest. That run
    // ends before the fetched horizon, so the next run (12 UTC) is probed once; it is not published yet.
    const rrfs = result.availability["NCEP RRFS Conus"]!;
    expect(api.ofKind("meta").map((c) => c.model)).toContain("ncep_rrfs_conus");
    expect(api.ofKind("single_run").filter((c) => c.model === "ncep_rrfs_conus").map((c) => c.params.run)).toEqual([
      runLabel(olderInit),
      runLabel(newestInit + 6 * HOUR_MS),
    ]);
    expect(rrfs.last_run_init_time).toBe(canonicalTimestamp(newestInit));
    // The 06 UTC run has samples through 16 UTC (10 h); the 00 UTC run hands over to NBM after its 84 h.
    expect(rrfs.run_segments).toEqual([
      { run_init_time: canonicalTimestamp(newestInit), valid_from: null, valid_until: at(5), run_length_hours: 10 },
      { run_init_time: canonicalTimestamp(olderInit), valid_from: at(5), valid_until: at(73), run_length_hours: 84 },
    ]);
    expect(result.chain[0]?.runSegments).toEqual(rrfs.run_segments);
  });

  it("finds the run of RRFS directly with resolveRunSegments", async () => {
    const api = rrfsApi();
    const segments = await resolveRunSegments(
      client(api),
      { modelId: "ncep_rrfs_conus", location: CHICAGO, catalogue },
      {
        init: null,
        available: null,
        initEpoch: seconds(newestInit),
        dataEndEpoch: seconds(NOW_HOUR + 5 * HOUR_MS),
        intervalSeconds: 21600,
      },
      NOW_HOUR + 84 * HOUR_MS,
      NOW,
    );
    expect(segments.map((s) => s.run_init_time)).toEqual([
      canonicalTimestamp(newestInit),
      canonicalTimestamp(olderInit),
    ]);
    expect(api.ofKind("single_run").every((c) => c.model === "ncep_rrfs_conus")).toBe(true);
  });
});

describe("outage of the Single Runs API (REQ-633)", () => {
  const newestInit = NOW_HOUR - 2 * HOUR_MS;
  /** Both models' newest run ends after 5 h: each needs a backward search through older runs. */
  const shortRuns = {
    last_run_initialisation_time: seconds(newestInit),
    last_run_availability_time: seconds(NOW_HOUR - HOUR_MS),
    data_end_time: seconds(NOW_HOUR + 5 * HOUR_MS),
    update_interval_seconds: 21600,
  };
  const META = { dwd_icon_eu: shortRuns, ecmwf_ifs: shortRuns };
  const overloaded = () => json({ error: true, reason: "The service is overloaded" }, 503);
  const outageWarnings = (result: ForecastResult) => result.warnings.filter((w) => w.includes("Single Runs API unavailable"));

  function downloadWith(api: FakeApi, clientOptions: Parameters<typeof createClient>[0]): Promise<ForecastResult> {
    return downloadChain(
      createClient({ fetch: api.fetch, retryBackoffMs: 0, cache: null, ...clientOptions }),
      { location: LOCATION, now: NOW, timezone: "UTC", cloudChain: [], chain: RUN_END_CHAIN, quantities: ["temperature"] },
      { catalogue, registry },
    );
  }

  /** The result must look like one with `runSegments: false` (REQ-414). */
  async function expectAsWithoutRunSegments(result: ForecastResult) {
    const off = await download(fakeOpenMeteo({ forecast: fullForecast, meta: META }), { runSegments: false });
    expect(result.runSegments).toEqual({});
    expect(result.availability).toEqual(off.availability);
    expect(result.chain).toEqual(off.chain);
    expect(result.combined).toEqual(off.combined);
    for (const entry of Object.values(result.availability)) {
      expect(entry.run_segments).toBeUndefined();
      expect(entry.data_end_run_init_time).toBeUndefined();
      expect(entry.last_run_init_time).toBe(canonicalTimestamp(newestInit));
    }
  }

  it("stops the run search at the first 503: no retries, no further requests, one warning", async () => {
    const api = fakeOpenMeteo({ forecast: fullForecast, meta: META, singleRun: overloaded });
    const result = await download(api);

    // Both searches were in flight together: one request each, none repeated, no older run after it.
    const runs = api.ofKind("single_run");
    expect(runs.map((c) => c.model).sort()).toEqual(["ecmwf_ifs", "icon_eu"]);
    expect(runs.map((c) => c.params.run)).toEqual([runLabel(newestInit - 6 * HOUR_MS), runLabel(newestInit - 6 * HOUR_MS)]);
    expect(outageWarnings(result)).toHaveLength(1);
    expect(outageWarnings(result)[0]).toContain("The service is overloaded");
    expect(outageWarnings(result)[0]).toContain("'ICON-EU', 'ECMWF IFS'");
    expect(result.warnings.some((w) => w.startsWith("Failed to fetch run "))).toBe(false);
    await expectAsWithoutRunSegments(result);
  });

  it("does not start a queued search after the outage", async () => {
    const api = fakeOpenMeteo({ forecast: fullForecast, meta: META, singleRun: overloaded });
    const result = await downloadWith(api, { concurrency: 1 });
    expect(api.ofKind("single_run")).toHaveLength(1);
    expect(outageWarnings(result)).toHaveLength(1);
    await expectAsWithoutRunSegments(result);
  });

  it("returns without waiting for a Single Runs request still in flight", async () => {
    let hanging = 0;
    const api = fakeOpenMeteo({
      forecast: fullForecast,
      meta: META,
      singleRun: (call) => {
        if (call.model !== "icon_eu") return overloaded();
        hanging += 1;
        return new Promise(() => {}); // Never answers; only the abort ends it.
      },
    });
    const result = await download(api);
    expect(hanging).toBe(1);
    expect(api.ofKind("single_run")).toHaveLength(2);
    expect(outageWarnings(result)).toHaveLength(1);
    await expectAsWithoutRunSegments(result);
  });

  it("treats a network error like a 503", async () => {
    const api = fakeOpenMeteo({ forecast: fullForecast, meta: META, singleRun: () => new TypeError("fetch failed") });
    const result = await download(api);
    expect(api.ofKind("single_run")).toHaveLength(2);
    expect(outageWarnings(result)).toHaveLength(1);
    expect(outageWarnings(result)[0]).toContain("Open-Meteo request failed");
    await expectAsWithoutRunSegments(result);
  });

  it("treats a timeout like a 503", async () => {
    const api = fakeOpenMeteo({ forecast: fullForecast, meta: META, singleRun: () => new Promise(() => {}) });
    const result = await downloadWith(api, { timeoutMs: 50 });
    expect(api.ofKind("single_run")).toHaveLength(2);
    expect(outageWarnings(result)).toHaveLength(1);
    expect(outageWarnings(result)[0]).toContain("timed out after 50 ms");
    await expectAsWithoutRunSegments(result);
  });

  it("keeps the run segments known before the outage", async () => {
    // ICON-EU's metadata explains its data: its single segment needs no Single Runs request.
    const api = fakeOpenMeteo({
      forecast: fullForecast,
      meta: { ...META, dwd_icon_eu: { ...shortRuns, data_end_time: seconds(NOW_HOUR + 120 * HOUR_MS) } },
      singleRun: overloaded,
    });
    const result = await download(api);
    expect(api.ofKind("single_run").map((c) => c.model)).toEqual(["ecmwf_ifs"]);
    expect(result.runSegments["ICON-EU"]?.map((s) => s.run_init_time)).toEqual([canonicalTimestamp(newestInit)]);
    expect(result.availability["ICON-EU"]?.run_segments).toEqual(result.runSegments["ICON-EU"]);
    expect(result.runSegments["ECMWF IFS"]).toBeUndefined();
    expect(result.availability["ECMWF IFS"]?.run_segments).toBeUndefined();
    expect(outageWarnings(result)).toHaveLength(1);
    expect(outageWarnings(result)[0]).toContain("'ECMWF IFS'");
    expect(outageWarnings(result)[0]).not.toContain("'ICON-EU'");
  });

  it("leaves the metadata run in place when the API fails after a newer run was probed", async () => {
    const metaInit = NOW_HOUR - 5 * HOUR_MS;
    const newer = NOW_HOUR - 2 * HOUR_MS;
    const info = {
      init: canonicalTimestamp(metaInit),
      available: canonicalTimestamp(metaInit),
      initEpoch: seconds(metaInit),
      dataEndEpoch: seconds(metaInit + 3 * HOUR_MS),
      intervalSeconds: 10800,
    };
    const before = { ...info };
    let newerAnswered = false;
    const api = fakeOpenMeteo({
      singleRun: (call) => {
        const run = Date.parse(`${call.params.run}:00Z`);
        if (run === newer && !newerAnswered) {
          newerAnswered = true;
          return singleRunAnswer(call, 121);
        }
        if (run > newer) return json({ error: true, reason: "Run not available" }, 400);
        // Older runs: first the search behind the metadata run (missing), then behind the probed run (outage).
        return newerAnswered ? overloaded() : json({ error: true, reason: "Run not available" }, 400);
      },
    });
    const error = await resolveRunSegments(
      client(api),
      { modelId: "icon_eu", location: LOCATION, catalogue },
      info,
      NOW_HOUR + 300 * HOUR_MS,
      NOW,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SingleRunsUnavailableError);
    expect((error as SingleRunsUnavailableError).status).toBe(503);
    expect(info).toEqual(before);
  });

  it("keeps the current behaviour for a missing run (404, empty answer)", async () => {
    for (const missing of [
      () => json({ error: true, reason: "Not Found" }, 404),
      (call: Call) => singleRunAnswer(call, 0),
    ]) {
      const api = fakeOpenMeteo({ forecast: fullForecast, meta: META, singleRun: missing });
      const result = await download(api);
      // Every older run is asked once, without retries, and no outage is reported.
      const runs = api.ofKind("single_run");
      expect(runs.filter((c) => c.model === "icon_eu").map((c) => c.params.run)).toEqual(
        Array.from({ length: MAX_OLDER_RUNS }, (_, k) => runLabel(newestInit - 6 * (k + 1) * HOUR_MS)),
      );
      expect(runs).toHaveLength(2 * MAX_OLDER_RUNS);
      expect(outageWarnings(result)).toEqual([]);
      for (const name of ["ICON-EU", "ECMWF IFS"]) {
        expect(result.availability[name]?.run_segments).toEqual([
          { run_init_time: canonicalTimestamp(newestInit), valid_from: null, valid_until: at(5), run_length_hours: 6 },
        ]);
      }
    }
  });
});

describe("ensemble runs (test_forecast_archive_and_handover.py)", () => {
  it("reports the end of the probability and the ensemble run behind it", async () => {
    const ensembleInit = NOW_HOUR - 10 * HOUR_MS;
    const ensembleMeta = {
      last_run_initialisation_time: seconds(ensembleInit),
      last_run_availability_time: seconds(NOW_HOUR),
      data_end_time: seconds(NOW_HOUR + 6 * HOUR_MS),
      update_interval_seconds: 21600,
    };
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        // The ensemble lags: the probability ends at +6 h.
        return hourlyAnswer(call.hourly, start, count, (v, i, t) =>
          v === "precipitation_probability" && t >= NOW_HOUR + 6 * HOUR_MS ? null : i,
        );
      },
      meta: (call) => (/(eps|ensemble)/.test(call.model) ? ensembleMeta : undefined),
    });
    const result = await download(api, { quantities: ["temperature", "precipitation_probability"] });

    const icon = result.availability["ICON-EU"]!;
    expect(icon.probability_valid_until).toBe(at(6));
    expect(icon.available_hours).toBeNull(); // temperature still reaches +10 h
    expect(icon.ensemble).toEqual({
      model_id: "dwd_icon_eu_eps_native",
      run_init_time: canonicalTimestamp(ensembleInit),
      run_availability_time: at(0),
      data_end_time: at(6),
      update_interval_hours: 6,
    });
    expect(result.availability["ECMWF IFS"]?.ensemble?.model_id).toBe("ecmwf_ifs025_ensemble");
    // One metadata request per ensemble.
    const ensembleCalls = api.ofKind("meta").filter((c) => /(eps|ensemble)/.test(c.model));
    expect(ensembleCalls.map((c) => c.model).sort()).toEqual(["dwd_icon_eu_eps_native", "ecmwf_ifs025_ensemble"]);
  });

  it("leaves the ensemble out when its metadata fails", async () => {
    const api = fakeOpenMeteo({
      forecast: fullForecast,
      meta: (call) => (call.model.includes("eps") ? json({ error: true, reason: "broken" }, 400) : undefined),
    });
    const result = await download(api);
    expect(result.availability["ICON-EU"]?.ensemble).toBeUndefined();
    expect(result.warnings.some((w) => w.startsWith("Failed to fetch ensemble metadata for 'icon_eu'"))).toBe(true);
  });
});
