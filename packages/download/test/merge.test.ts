// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// mergeForecastSegments and the chain helpers.
import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  activeChain,
  capChainToAvailability,
  computeAvailableHours,
  mergeForecastSegments,
  resolveChainModels,
  type DataPoint,
  type WeatherModel,
} from "../src/index";
import { catalogue } from "./modelData";

const point = (model: string, timestamp: string, value: number | null): DataPoint => ({
  timestamp,
  variable: "temperature",
  value,
  unit: "°C",
  model,
});

describe("mergeForecastSegments (MeteogramChart.test.tsx)", () => {
  const modelChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
  ];
  const ts0 = "2026-09-11T00:00:00Z";
  const ts48 = "2026-09-13T00:00:00Z";
  const ts49 = "2026-09-13T01:00:00Z";

  it("continues across adjacent horizons; +48 h is the first ICON-EU instant", () => {
    const merged = mergeForecastSegments(
      modelChain,
      {
        "ICON-D2": [point("ICON-D2", ts0, 10), point("ICON-D2", ts48, 15)],
        "ICON-EU": [point("ICON-EU", ts48, 15.1), point("ICON-EU", ts49, 16)],
      },
      ["temperature"],
    );
    expect(merged.map((p) => [p.timestamp, p.model, p.value])).toEqual([
      [ts0, "ICON-D2", 10],
      [ts48, "ICON-EU", 15.1],
      [ts49, "ICON-EU", 16],
    ]);
  });

  it("lets the valid value of the owning model win at the boundary", () => {
    const merged = mergeForecastSegments(
      modelChain,
      { "ICON-D2": [point("ICON-D2", ts0, 10), point("ICON-D2", ts48, null)], "ICON-EU": [point("ICON-EU", ts48, 15.2)] },
      ["temperature"],
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ timestamp: ts48, value: 15.2, model: "ICON-EU" });
  });

  it("keeps genuinely missing intervals without a timeline", () => {
    const ts03 = "2026-09-11T03:00:00Z";
    const merged = mergeForecastSegments(
      modelChain,
      { "ICON-D2": [point("ICON-D2", ts0, 10), point("ICON-D2", ts03, 12)] },
      ["temperature"],
    );
    expect(merged.map((p) => p.timestamp)).toEqual([ts0, ts03]);
  });

  it("leaves an empty model's slice null without falling back to other models", () => {
    const merged = mergeForecastSegments(
      modelChain,
      {
        "ICON-D2": [],
        "ICON-EU": [point("ICON-EU", ts0, 18), point("ICON-EU", ts48, 19), point("ICON-EU", ts49, 20)],
      },
      ["temperature"],
    );
    expect(merged.map((p) => [p.model, p.value])).toEqual([
      ["ICON-D2", null],
      ["ICON-EU", 19],
      ["ICON-EU", 20],
    ]);
  });

  it("gives past hours to the first model and counts horizons from the forecast start", () => {
    const chain = [
      { name: "ICON-D2", max_forecast_horizon_hours: 10 },
      { name: "ICON-EU", max_forecast_horizon_hours: 30 },
    ];
    const times = [
      "2026-09-12T00:00:00Z",
      "2026-09-12T06:00:00Z",
      "2026-09-12T12:00:00Z",
      "2026-09-12T17:00:00Z",
      "2026-09-12T22:00:00Z",
      "2026-09-13T03:00:00Z",
    ];
    const merged = mergeForecastSegments(
      chain,
      {
        "ICON-D2": times.map((t, i) => point("ICON-D2", t, 10 + i)),
        "ICON-EU": times.map((t, i) => point("ICON-EU", t, 20 + i)),
      },
      ["temperature"],
      "2026-09-12T12:00:00Z",
    );
    expect(merged.map((p) => p.model)).toEqual(["ICON-D2", "ICON-D2", "ICON-D2", "ICON-D2", "ICON-EU", "ICON-EU"]);
  });

  it("never selects models with an empty slice", () => {
    const chain = [
      { name: "ICON-D2", max_forecast_horizon_hours: 0 },
      { name: "ICON-EU", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 48 },
      { name: "ECMWF", max_forecast_horizon_hours: 120 },
    ];
    const ts24 = "2026-09-12T00:00:00Z";
    const ts72 = "2026-09-14T00:00:00Z";
    const merged = mergeForecastSegments(
      chain,
      {
        "ICON-D2": [point("ICON-D2", ts0, 10)],
        "ICON-EU": [point("ICON-EU", ts0, 12), point("ICON-EU", ts24, 14)],
        GFS: [point("GFS", ts24, 15)],
        ECMWF: [point("ECMWF", ts72, 18)],
      },
      ["temperature"],
    );
    expect(merged.map((p) => [p.timestamp, p.model, p.value])).toEqual([
      [ts0, "ICON-EU", 12],
      [ts24, "ICON-EU", 14],
      [ts72, "ECMWF", 18],
    ]);
  });

  it("fills the whole timeline and gives null points a fallback unit", () => {
    const merged = mergeForecastSegments(
      [{ name: "A", max_forecast_horizon_hours: 3 }],
      { A: [point("A", ts0, 1)] },
      ["temperature", "snow_depth"],
      ts0,
      ts0,
      "2026-09-11T03:00:00Z",
      { snow_depth: "m" },
    );
    expect(merged).toHaveLength(6);
    expect(merged.filter((p) => p.variable === "snow_depth").every((p) => p.unit === "m" && p.value === null)).toBe(true);
  });
});

describe("chain helpers (service.py)", () => {
  const tNow = Date.UTC(2026, 9, 6, 12);

  it("computes the hours a run delivers", () => {
    expect(computeAvailableHours([], tNow, 24)).toEqual([null, null]);
    expect(computeAvailableHours([tNow - HOUR_MS], tNow, 24)).toEqual([0, "2026-10-06T12:00:00Z"]);
    expect(computeAvailableHours([tNow, tNow + 6 * HOUR_MS], tNow, 24)).toEqual([7, "2026-10-06T19:00:00Z"]);
    // Data through the end of the fetched window: the run does not limit it.
    expect(computeAvailableHours([tNow + 23 * HOUR_MS], tNow, 24)).toEqual([null, null]);
  });

  it("caps boundaries to the delivered hours and keeps them non-decreasing", () => {
    const chain = [
      { name: "A", max_forecast_horizon_hours: 10 },
      { name: "B", max_forecast_horizon_hours: 20 },
      { name: "C", max_forecast_horizon_hours: 30 },
    ];
    const capped = capChainToAvailability(chain, {
      A: { model: "A", chain: "main", available_hours: 7 },
      B: { model: "B", chain: "main", available_hours: 3 },
    });
    expect(capped.map((m) => m.max_forecast_horizon_hours)).toEqual([7, 7, 30]);
    expect(activeChain(capped).map((m) => m.name)).toEqual(["A", "C"]);
    expect(chain[0]?.max_forecast_horizon_hours).toBe(10);
  });

  it("resolves chain entries from the catalogue", () => {
    const [d2, eu, custom] = resolveChainModels(
      ["ICON-D2", { id: "icon_eu", max_forecast_horizon_hours: 72 }, { name: "Own", max_forecast_horizon_hours: 5 }],
      catalogue,
    );
    expect(d2).toMatchObject({ name: "ICON-D2", id: "icon_d2", max_forecast_horizon_hours: 48 });
    expect(eu).toMatchObject({ name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 72 });
    expect(custom).toMatchObject({ name: "Own", id: "own", max_forecast_horizon_hours: 5 });
    expect(() => resolveChainModels(["Unknown"], catalogue)).toThrow(/no horizon/);
  });
});
