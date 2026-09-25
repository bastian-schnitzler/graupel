import { describe, it, expect } from "vitest";
import {
  calculateTemperatureExtremes,
  calculateMaxPrecipitation,
  calculateDailyTemperatureExtremes,
} from "./meteogramExtremes";
import type { DataPoint } from "../types";

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
      expect(minTemp).toBe(0); // 5 - 2 = 3, but rawMin <= 15 and min > 0 => 0
      expect(maxTemp).toBe(27); // 25 + 2 = 27
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
