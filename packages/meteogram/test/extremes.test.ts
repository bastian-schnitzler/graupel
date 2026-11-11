// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, it, expect } from "vitest";
import {
  calculateMaxWind,
  calculateTemperatureExtremes,
  calculateMaxPrecipitation,
  calculateDailyTemperatureExtremes,
} from "../src";
import type { DataPoint } from "../src";

describe("meteogramExtremes", () => {
  describe("calculateTemperatureExtremes", () => {
    it("determines min and max with margin from data and forecasts", () => {
      const tempVals = [10, 15, 20];
      const apparentVals = [8, 14, 22];
      const modelForecasts: Record<string, DataPoint[]> = {
        gfs: [
          {
            timestamp: "2026-09-16T00:00:00Z",
            value: 25,
            unit: "°C",
            variable: "temperature",
            model: "GFS",
          },
          {
            timestamp: "2026-09-16T00:00:00Z",
            value: 5,
            unit: "°C",
            variable: "temperature",
            model: "GFS",
          },
        ],
      };

      const { minTemp, maxTemp } = calculateTemperatureExtremes(
        modelForecasts,
        tempVals,
        apparentVals,
      );
      expect(minTemp).toBe(0); // 5 on the 5 grid, but rawMin <= 15 and min > 0 => 0
      expect(maxTemp).toBe(25); // 25 is already a multiple of 5
    });
  });

  describe("calculateMaxPrecipitation", () => {
    it("returns prop maxPrecipitation if valid number is supplied", () => {
      expect(calculateMaxPrecipitation(15, undefined, [2, 5])).toBe(15);
    });

    it("finds maximum among valid values and models", () => {
      const validPrecip = [1.2, 3.4];
      const modelForecasts: Record<string, DataPoint[]> = {
        icon: [
          {
            timestamp: "2026-09-16T00:00:00Z",
            value: 8.5,
            unit: "mm",
            variable: "precipitation",
            model: "ICON",
          },
        ],
      };
      expect(
        calculateMaxPrecipitation(undefined, modelForecasts, validPrecip),
      ).toBe(8.5);
    });
  });

  describe("calculateDailyTemperatureExtremes", () => {
    it("detects min and max points for day groups", () => {
      const timestamps = [1000, 2000, 3000];
      const dayGroups = [{ dayKey: "2026-09-16", indices: [0, 1, 2] }];
      const tempValues = [12, 24, 15];
      const timeline = { contains: () => true };
      const getX = (ts: number) => ts / 10;

      const extremes = calculateDailyTemperatureExtremes({
        dayGroups,
        timestamps,
        tempValues,
        minTemp: 0,
        maxTemp: 30,
        tempHeight: 115,
        tempTop: 44,
        paddingLeft: 50,
        paddingRight: 50,
        svgWidth: 1000,
        timeline,
        getX,
      });

      expect(extremes.length).toBe(1);
      expect(extremes[0].max.text).toBe("24°C");
      expect(extremes[0].min.text).toBe("12°C");
    });
  });
});

describe("calculateMaxWind", () => {
  const point = (variable: string, value: number | null): DataPoint => ({
    timestamp: "2026-09-11T00:00:00Z",
    variable,
    value,
    unit: "km/h",
    model: "ICON-EU",
  });

  it("uses speed and gusts of all models so boundary moves keep the axis", () => {
    const forecasts = {
      "ICON-D2": [point("wind_speed", 20), point("wind_gusts", 80)],
      "ICON-EU": [point("wind_speed", 10), point("wind_direction", 350)],
    };
    // Only 20 km/h is displayed, the axis still covers the 80 km/h gust.
    expect(calculateMaxWind(forecasts, [20])).toBe(100);
  });

  it("starts at the 10 km/h step and keeps the 50 km/h default without data", () => {
    expect(calculateMaxWind({ A: [point("wind_speed", 5)] }, [])).toBe(10);
    expect(calculateMaxWind(undefined, [])).toBe(50);
  });
});
