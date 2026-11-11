// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Harmonization, with the registry of @graupel/model-data.
import { describe, expect, it } from "vitest";
import registry from "@graupel/model-data/quantities.json";
import {
  TimelineIntegrityError,
  convertValueAndUnit,
  harmonize,
  harmonizeAll,
  normalizeVariable,
  type RawForecastData,
} from "../src/index";

describe("normalizeVariable (test_harmonizer.py)", () => {
  it.each([
    ["temperature", "temperature"],
    ["temperature_2m", "temperature"],
    ["temp_2m", "temperature"],
    ["temp", "temperature"],
    ["t2m", "temperature"],
    ["apparent_temperature", "apparent_temperature"],
    ["apparent_temp", "apparent_temperature"],
    ["feels_like", "apparent_temperature"],
    ["wind_speed", "wind_speed"],
    ["wind_speed_10m", "wind_speed"],
    ["windspeed_10m", "wind_speed"],
    ["wind_gusts", "wind_gusts"],
    ["wind_gusts_10m", "wind_gusts"],
    ["wind_direction", "wind_direction"],
    ["winddirection_10m", "wind_direction"],
    ["cloud_cover", "cloud_cover"],
    ["cloudcover", "cloud_cover"],
    ["precipitation", "precipitation"],
    ["precip", "precipitation"],
    ["precipitation_probability", "precipitation_probability"],
    ["precip_prob", "precipitation_probability"],
    ["unknown_var", "unknown_var"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeVariable(raw, registry)).toBe(expected);
  });

  it("ignores case", () => {
    expect(normalizeVariable("Temperature_2M", registry)).toBe("temperature");
  });
});

describe("convertValueAndUnit (test_harmonizer.py)", () => {
  it("converts temperatures to °C", () => {
    expect(convertValueAndUnit(20.0, "°C", "temperature", registry)).toEqual([20.0, "°C"]);
    expect(convertValueAndUnit(293.15, "K", "temperature", registry)).toEqual([20.0, "°C"]);
    expect(convertValueAndUnit(68.0, "°F", "temperature", registry)).toEqual([20.0, "°C"]);
    expect(convertValueAndUnit(14.0, "°F", "apparent_temperature", registry)).toEqual([-10.0, "°C"]);
  });

  it("converts wind speed and gusts to km/h", () => {
    expect(convertValueAndUnit(10.0, "m/s", "wind_speed", registry)).toEqual([36.0, "km/h"]);
    expect(convertValueAndUnit(10.0, "knots", "wind_gusts", registry)).toEqual([18.52, "km/h"]);
    expect(convertValueAndUnit(10.0, "mph", "wind_speed", registry)).toEqual([16.09, "km/h"]);
    // Open-Meteo's own spelling with wind_speed_unit=kn.
    expect(convertValueAndUnit(10.0, "kn", "wind_speed", registry)).toEqual([18.52, "km/h"]);
    expect(convertValueAndUnit(12.5, "km/h", "wind_gusts", registry)).toEqual([12.5, "km/h"]);
  });

  it("keeps other quantities and gives them the registry unit", () => {
    expect(convertValueAndUnit(180.0, "°", "wind_direction", registry)).toEqual([180.0, "°"]);
    expect(convertValueAndUnit(75.0, "%", "cloud_cover", registry)).toEqual([75.0, "%"]);
    expect(convertValueAndUnit(2.5, "mm", "precipitation", registry)).toEqual([2.5, "mm"]);
    expect(convertValueAndUnit(80.0, "%", "precipitation_probability", registry)).toEqual([80.0, "%"]);
  });

  it("keeps null and the unit of unknown names", () => {
    expect(convertValueAndUnit(null, "K", "temperature", registry)).toEqual([null, "°C"]);
    expect(convertValueAndUnit(3, "foo", "unknown_var", registry)).toEqual([3, "foo"]);
  });
});

describe("harmonize (test_harmonizer.py)", () => {
  it("harmonizes a raw series", () => {
    const raw: RawForecastData = {
      model_name: "ICON-D2",
      fetch_time: "2024-01-01T00:00:00Z",
      timestamps: ["2024-01-01T00:00", "2024-01-01T01:00"],
      values: [293.15, null],
      unit: "K",
      variable: "temp_2m",
      max_horizon_hours: 48,
    };
    const points = harmonize(raw, registry);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({
      timestamp: "2024-01-01T00:00:00Z",
      value: 20.0,
      unit: "°C",
      variable: "temperature",
      model: "ICON-D2",
    });
    expect(points[1]?.value).toBeNull();
    expect(points[1]?.unit).toBe("°C");
  });

  it("preserves a missing hour and pads a short value array", () => {
    const warnings: string[] = [];
    const raw: RawForecastData = {
      model_name: "GFS Seamless",
      fetch_time: "2026-09-14T00:00:00Z",
      timestamps: ["2026-09-14T14:00:00Z", "2026-09-14T16:00:00Z", "2026-09-14T17:00:00Z"],
      values: [14.0, 16.0],
      unit: "°C",
      variable: "temperature_2m",
      max_horizon_hours: 384,
    };
    const points = harmonize(raw, registry, { onWarning: (m) => warnings.push(m) });
    expect(points.map((p) => p.timestamp)).toEqual([
      "2026-09-14T14:00:00Z",
      "2026-09-14T16:00:00Z",
      "2026-09-14T17:00:00Z",
    ]);
    expect(points.map((p) => p.value)).toEqual([14.0, 16.0, null]);
    expect(warnings.join("\n")).toContain("non-hourly timestamp gap");
    expect(warnings.join("\n")).toContain("timestamp/value length mismatch");
  });

  it("converts offsets to canonical UTC and ignores extra values", () => {
    const raw: RawForecastData = {
      model_name: "ICON-EU",
      fetch_time: "2026-03-29T00:00:00Z",
      timestamps: ["2026-03-29T03:00+02:00", "2026-03-29T04:00+02:00"],
      values: [10, 20, 30],
      unit: "m/s",
      variable: "wind_speed_10m",
      max_horizon_hours: 120,
    };
    const points = harmonize(raw, registry);
    expect(points).toEqual([
      { timestamp: "2026-03-29T01:00:00Z", value: 36, unit: "km/h", variable: "wind_speed", model: "ICON-EU" },
      { timestamp: "2026-03-29T02:00:00Z", value: 72, unit: "km/h", variable: "wind_speed", model: "ICON-EU" },
    ]);
  });

  it("does not warn about a weather code the model does not deliver", () => {
    const warnings: string[] = [];
    const raw: RawForecastData = {
      model_name: "ICON-EU",
      fetch_time: "2026-09-14T00:00:00Z",
      timestamps: ["2026-09-14T14:00:00Z", "2026-09-14T15:00:00Z"],
      values: [],
      unit: "",
      variable: "weather_code",
      max_horizon_hours: 120,
    };
    const points = harmonize(raw, registry, { onWarning: (m) => warnings.push(m) });
    expect(points.map((p) => [p.value, p.unit])).toEqual([
      [null, "wmo code"],
      [null, "wmo code"],
    ]);
    expect(warnings).toEqual([]);
  });

  it("rejects timestamps that do not increase", () => {
    const raw: RawForecastData = {
      model_name: "ICON-D2",
      fetch_time: "2026-10-25T00:00:00Z",
      timestamps: ["2026-10-25T01:00:00Z", "2026-10-25T01:00:00Z"],
      values: [1, 2],
      unit: "°C",
      variable: "temperature_2m",
      max_horizon_hours: 48,
    };
    expect(() => harmonize(raw, registry)).toThrow(TimelineIntegrityError);
  });

  it("harmonizes several series at once", () => {
    const base = { fetch_time: "2024-01-01T00:00:00Z", timestamps: ["2024-01-01T00:00"], max_horizon_hours: 48 };
    const points = harmonizeAll(
      [
        { ...base, model_name: "ICON-D2", values: [5], unit: "mm", variable: "precipitation" },
        { ...base, model_name: "ICON-EU", values: [50], unit: "%", variable: "pop" },
      ],
      registry,
    );
    expect(points.map((p) => [p.model, p.variable, p.value, p.unit])).toEqual([
      ["ICON-D2", "precipitation", 5, "mm"],
      ["ICON-EU", "precipitation_probability", 50, "%"],
    ]);
  });
});
