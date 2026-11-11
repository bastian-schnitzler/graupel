// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/**
 * Dew point as a line with its spread to the temperature, modes off, on and auto, default off (REQ-595,
 * REQ-604, REQ-620).
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_LAYOUTS,
  POWER_DEFAULT_LAYOUT_ID,
  computeAreaScales,
  computeChartGeometry,
  getBuiltinLayout,
  resolveChartLayout,
  type ExtremesLookup,
  DARK_THEME,
  LIGHT_THEME,
  calculateSpreadStretches,
  spreadAxisFloor,
  temperatureSpreadFloor,
  type DataPoint,
  type MeteogramInput,
} from "../src";
import { meteogramToSvgString } from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const HOUR = 3_600_000;

describe("stretches", () => {
  const times = [0, 1, 2, 3, 4, 5].map((hour) => hour * HOUR);
  const temperature = [10, 10, 10, 10, 10, 10];
  // Spread 8, 6, 4, 4, 6, 8 K.
  const dew = [2, 4, 6, 6, 4, 2];
  type Values = (number | null)[];
  const on = (upper: Values, lower: Values) => calculateSpreadStretches(times, upper, lower, "on");
  const auto = (upper: Values, lower: Values, range?: { start: number; end: number }) =>
    calculateSpreadStretches(times, upper, lower, "auto", range);

  it("draws nothing when off", () => {
    expect(calculateSpreadStretches(times, temperature, dew, "off")).toEqual([]);
  });

  it("draws everywhere when on", () => {
    const stretches = on(temperature, dew);
    expect(stretches).toHaveLength(1);
    expect(stretches[0]!.map((point) => point.time)).toEqual(times);
    expect(stretches[0]!.map((point) => point.lower)).toEqual(dew);
  });

  it("draws as on across the whole width when auto and the spread is at most 5 K somewhere (REQ-604)", () => {
    expect(auto(temperature, dew)).toEqual(on(temperature, dew));
    expect(spreadAxisFloor(auto(temperature, dew))).toBe(spreadAxisFloor(on(temperature, dew)));
  });

  it("draws as on when auto and the condition holds at a single hour only", () => {
    // Spread 5 K at 3 h only (14.1 − 9.1 is not exactly 5 in floating point), 6 K and more elsewhere.
    const upper = [14.1, 14.1, 14.1, 14.1, 14.1, 14.1];
    const lower = [4.1, 6.1, 8.1, 9.1, 8.1, 6.1];
    expect(auto(upper, lower)).toEqual(on(upper, lower));
    expect(auto(upper, lower)).toHaveLength(1);
    // Dew point reaching 15 °C at 2 h only, with a wide spread.
    const warm = [25, 25, 25, 25, 25, 25];
    const humid = [12, 14, 15, 14, 12, 10];
    expect(auto(warm, humid)).toEqual(on(warm, humid));
    expect(spreadAxisFloor(auto(warm, humid))).toBe(spreadAxisFloor(on(warm, humid)));
  });

  it("draws as on when auto and the condition holds only between two hours of the displayed range", () => {
    // Spread 5.5 K at 1.25 h and 4.5 K at 1.75 h: no hour lies in the range, the interpolated spread reaches 5 K.
    expect(auto(temperature, dew, { start: 1.25 * HOUR, end: 1.75 * HOUR })).toEqual(on(temperature, dew));
    // Dew point 14 °C at 2 h and 16 °C at 3 h (15.2 °C at 2.6 h), spread 9 K and more.
    const warm = [25, 25, 25, 25, 25, 25];
    const humid = [12, 13, 14, 16, 13, 12];
    expect(auto(warm, humid, { start: 2.1 * HOUR, end: 2.6 * HOUR })).toEqual(on(warm, humid));
    // Up to 2.4 h it stays below 15 °C (14.8 °C).
    expect(auto(warm, humid, { start: 1.1 * HOUR, end: 2.4 * HOUR })).toEqual([]);
  });

  it("draws nothing when auto and the condition holds nowhere in the displayed range", () => {
    expect(auto(temperature, [2, 4, 4, 4, 4, 2])).toEqual([]);
    expect(auto([25, 25, 25, 25, 25, 25], [12, 14, 14.9, 14, 12, 10])).toEqual([]);
    // Spread 8 K at 0 h and 6 K at 1 h, 5.2 K at 1.4 h: the range ends before the spread reaches 5 K.
    expect(auto(temperature, dew, { start: 0, end: 1.4 * HOUR })).toEqual([]);
    expect(auto(temperature, dew, { start: 4.25 * HOUR, end: 5 * HOUR })).toEqual([]);
    // Another range decides anew: it holds at 3 h.
    expect(auto(temperature, dew, { start: 3 * HOUR, end: 5 * HOUR })).toEqual(on(temperature, dew));
  });

  it("draws as on when auto, the condition holds and a temperature reaches 5 °C (REQ-620)", () => {
    // Spread 4 K at 2 h, temperatures up to 6 °C.
    const upper = [2, 3, 6, 4, 3, 2];
    const lower = [-6, -5, 2, -4, -5, -6];
    expect(auto(upper, lower)).toEqual(on(upper, lower));
    expect(auto(upper, lower)).toHaveLength(1);
    expect(spreadAxisFloor(auto(upper, lower))).toBe(spreadAxisFloor(on(upper, lower)));
    // The warm hour need not be the humid one.
    const warmEarly = [7, 3, 2, 2, 2, 2];
    const humidLate = [0, -5, -6, -6, -6, 0];
    expect(auto(warmEarly, humidLate)).toEqual(on(warmEarly, humidLate));
  });

  it("draws nothing when auto and the condition holds but all temperatures stay below 5 °C (REQ-620)", () => {
    // Spread 2 K everywhere, at most 4.9 °C.
    const cold = [1, 2, 4.9, 4.9, 3, 1];
    const lower = cold.map((value) => value - 2);
    expect(on(cold, lower)).toHaveLength(1);
    expect(auto(cold, lower)).toEqual([]);
    // Below freezing with saturated air (fog, spread 0 K).
    const frost = [-8, -7, -6, -6, -7, -8];
    expect(auto(frost, frost)).toEqual([]);
  });

  it("counts a temperature of exactly 5 °C when auto (REQ-620)", () => {
    const upper = [1, 2, 5, 4, 3, 1];
    const lower = upper.map((value) => value - 2);
    expect(auto(upper, lower)).toEqual(on(upper, lower));
    // 8.2 − 3.2 is not exactly 5 in floating point (a temperature computed from other values).
    const sum = [1, 2, 8.2 - 3.2, 4, 3, 1];
    expect(auto(sum, sum.map((value) => value - 2))).toEqual(on(sum, sum.map((value) => value - 2)));
    // 5 °C between two hours of the displayed range: 4 °C at 2 h, 6 °C at 3 h, 5 °C at 2.5 h.
    const rising = [4, 4, 4, 6, 6, 6];
    const humid = rising.map((value) => value - 1);
    expect(auto(rising, humid, { start: 2.1 * HOUR, end: 2.5 * HOUR })).toEqual(on(rising, humid));
    expect(auto(rising, humid, { start: 2.1 * HOUR, end: 2.4 * HOUR })).toEqual([]);
  });

  it("decides the temperature by the displayed range when auto (REQ-620)", () => {
    // Spread 2 K everywhere, 8 °C only at 0 h.
    const upper = [8, 4, 4, 4, 4, 4];
    const lower = upper.map((value) => value - 2);
    expect(auto(upper, lower, { start: 0, end: 2 * HOUR })).toEqual(on(upper, lower));
    expect(auto(upper, lower, { start: 2 * HOUR, end: 5 * HOUR })).toEqual([]);
    // A temperature without a dew point counts as well.
    const lowerGap = [null, 2, 2, 2, 2, 2];
    expect(auto(upper, lowerGap)).toEqual(on(upper, lowerGap));
  });

  it("draws nothing when auto, warm and without the spread condition", () => {
    // 20 °C, spread 8 K, dew point 12 °C.
    const warm = [20, 20, 20, 20, 20, 20];
    expect(auto(warm, warm.map((value) => value - 8))).toEqual([]);
  });

  it("breaks at gaps", () => {
    const gappy = [2, 4, null, 6, 4, 2];
    expect(on(temperature, gappy).map((stretch) => stretch.length)).toEqual([2, 3]);
    expect(auto(temperature, gappy)).toEqual(on(temperature, gappy));
  });

  it("checks the condition only where both values are when auto", () => {
    // The dew point at 2 h would give a spread of 4 K, but the temperature is missing there.
    const upper = [10, 10, null, 10, 10, 10];
    const lower = [2, 2, 6, 2, 2, 2];
    expect(auto(upper, lower)).toEqual([]);
    expect(on(upper, lower).map((stretch) => stretch.map((point) => point.time / HOUR))).toEqual([
      [0, 1],
      [3, 4, 5],
    ]);
  });

  it("floors the axis at the lowest max(dew point, temperature − 5 K)", () => {
    expect(spreadAxisFloor(on(temperature, dew))).toBeCloseTo(5);
    expect(spreadAxisFloor([])).toBeNull();
  });
});

describe("temperature axis with a dew point (DEC-051)", () => {
  it("rounds the floor down to 5 °C steps, at most to the step within 5 K below the lowest temperature", () => {
    expect(temperatureSpreadFloor(-26, -21)).toBe(-25);
    expect(temperatureSpreadFloor(-24, -20)).toBe(-25);
    expect(temperatureSpreadFloor(-3, 1)).toBe(0);
    expect(temperatureSpreadFloor(2, 6)).toBe(5);
    expect(temperatureSpreadFloor(7, 12)).toBe(10);
    expect(temperatureSpreadFloor(7, null)).toBe(5);
  });

  it("lowers the temperature axis only when a 5 K spread would not be visible", () => {
    const layout = resolveChartLayout(getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID)).layout;
    const area = computeChartGeometry(layout, { backgroundHasData: true }).areas[0]!;
    const lookup =
      (min: number, max: number): ExtremesLookup =>
      (quantities) => {
        // The dew point does not count for the range of its axis.
        expect(quantities).not.toContain("dew_point");
        return { min, max };
      };
    const axis = (min: number, max: number, floor: number | null) => {
      const scale = computeAreaScales(area, lookup(min, max), { floors: { left: floor } }).left!;
      return [scale.min, scale.max];
    };
    expect(axis(0.5, 10, null)).toEqual([0, 10]);
    expect(axis(0.5, 10, 3)).toEqual([0, 10]);
    expect(axis(0, 10, -4.5)).toEqual([-5, 10]);
    expect(axis(0, 10, -9)).toEqual([-5, 10]);
    // Not below the 5 °C step within 5 K below the lowest temperature: a lower dew point is cut off.
    expect(axis(0.5, 10, -4.5)).toEqual([0, 10]);
    expect(axis(-1, 10, -7)).toEqual([-5, 10]);
  });
});

/** Spread 2 K at 15 UTC, 12 K at 3 UTC. */
const dailySpread = (time: number) => 7 - 5 * Math.cos((((time / HOUR) % 24) - 15) / 24 * 2 * Math.PI);

/** The power fixture with a dew point `spreadAt(time)` below the temperature. */
function withDewPoint(
  spreadAt: (time: number) => number = dailySpread,
  base: MeteogramInput = powerInput,
): MeteogramInput {
  const temperatures = base.series.filter((point) => point.variable === "temperature");
  const dew: DataPoint[] = temperatures.map((point) => {
    const spread = spreadAt(Date.parse(point.timestamp));
    return {
      ...point,
      variable: "dew_point",
      value: point.value === null ? null : Math.round((point.value - spread) * 10) / 10,
    };
  });
  return { ...base, series: [...base.series, ...dew] };
}

const autoOptions = { ...powerOptions, dewPoint: "auto" } as const;
const onOptions = { ...powerOptions, dewPoint: "on" } as const;

const parse = (markup: string) => new DOMParser().parseFromString(markup, "image/svg+xml");
const testIds = (doc: Document, id: string) => [...doc.querySelectorAll(`[data-testid="${id}"]`)];

describe("drawing (REQ-595)", () => {
  const input = withDewPoint();

  it("is part of the temperature area of the built-in layouts, filled to the temperature", () => {
    for (const layout of BUILTIN_LAYOUTS) {
      const series = layout.areas.flatMap((area) => area.series).find((entry) => entry?.quantity === "dew_point");
      expect(series).toMatchObject({ style: "line", fillTo: "temperature" });
    }
  });

  it("draws nothing without the option dewPoint (default off, REQ-620)", () => {
    const markup = meteogramToSvgString(input, powerOptions);
    expect(testIds(parse(markup), "dew-point-spread")).toHaveLength(0);
    expect(testIds(parse(markup), "dew-point-path")).toHaveLength(0);
    expect(markup).toBe(meteogramToSvgString(input, { ...powerOptions, dewPoint: "off" }));
    expect(markup).toBe(meteogramToSvgString(powerInput, powerOptions));
    expect(meteogramToSvgString(input, { ...powerOptions, dewPoint: null })).toBe(markup);
    expect(createMeteogramScene(input, powerOptions).dewPoint).toBe("off");
  });

  it("draws line and transparent spread in the dew point colour across the whole width when auto", () => {
    const doc = parse(meteogramToSvgString(input, autoOptions));
    const fills = testIds(doc, "dew-point-spread");
    const lines = testIds(doc, "dew-point-path");
    // The spread reaches 5 K in the afternoons: drawn as on, without gaps (REQ-604).
    expect(fills).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(meteogramToSvgString(input, autoOptions)).toBe(
      meteogramToSvgString(input, { ...powerOptions, dewPoint: "on" }),
    );
    for (const fill of fills) {
      expect(fill.getAttribute("fill")).toBe(LIGHT_THEME.series.dew_point);
      expect(Number(fill.getAttribute("fill-opacity"))).toBeGreaterThan(0);
      expect(Number(fill.getAttribute("fill-opacity"))).toBeLessThan(0.5);
    }
    expect(lines[0]!.getAttribute("stroke")).toBe(LIGHT_THEME.series.dew_point);
    expect(LIGHT_THEME.series.dew_point).toBe("#059669");
    expect(LIGHT_THEME.series.dew_point).not.toBe(LIGHT_THEME.series.temperature);
    expect(createMeteogramScene(input, autoOptions).dewPoint).toBe("auto");
  });

  it("draws one stretch over the whole series when on", () => {
    const doc = parse(meteogramToSvgString(input, { ...powerOptions, dewPoint: "on" }));
    expect(testIds(doc, "dew-point-spread")).toHaveLength(1);
    expect(testIds(doc, "dew-point-path")).toHaveLength(1);
  });

  it("draws the chart as without a dew point when off", () => {
    expect(meteogramToSvgString(input, { ...powerOptions, dewPoint: "off" })).toBe(
      meteogramToSvgString(powerInput, powerOptions),
    );
  });

  it("draws the chart as without a dew point when auto and the condition holds nowhere", () => {
    // Spread 8 K everywhere, dew point far below 15 °C.
    expect(meteogramToSvgString(withDewPoint(() => 8), autoOptions)).toBe(
      meteogramToSvgString(powerInput, autoOptions),
    );
  });

  it("draws the chart as without a dew point when auto and every temperature stays below 5 °C (REQ-620)", () => {
    // The power fixture 6 K colder (at most below 5 °C), with the humid afternoons of the daily spread.
    const shift = (point: DataPoint): DataPoint =>
      point.variable === "temperature" && point.value !== null ? { ...point, value: point.value - 6 } : point;
    const cold: MeteogramInput = {
      ...powerInput,
      series: powerInput.series.map(shift),
      modelSeries: Object.fromEntries(
        Object.entries(powerInput.modelSeries ?? {}).map(([model, points]) => [model, points.map(shift)]),
      ),
    };
    const temperatures = cold.series.filter((point) => point.variable === "temperature");
    expect(Math.max(...temperatures.map((point) => point.value ?? -Infinity))).toBeLessThan(5);
    const coldWithDew = withDewPoint(dailySpread, cold);
    expect(testIds(parse(meteogramToSvgString(coldWithDew, onOptions)), "dew-point-path")).toHaveLength(1);
    expect(meteogramToSvgString(coldWithDew, autoOptions)).toBe(meteogramToSvgString(cold, autoOptions));
  });

  it("uses the dark theme colour", () => {
    const doc = parse(meteogramToSvgString(input, { ...powerOptions, theme: "dark", dewPoint: "on" }));
    expect(testIds(doc, "dew-point-path")[0]!.getAttribute("stroke")).toBe(DARK_THEME.series.dew_point);
  });

  it("leaves the axis as it is without a visible dew point", () => {
    const axisOf = (options: object) => {
      const scene = createMeteogramScene(input, { ...powerOptions, ...options });
      const scale = scene.areaScales[0]!.left!;
      return [scale.min, scale.max];
    };
    const plain = createMeteogramScene(powerInput, powerOptions).areaScales[0]!.left!;
    expect(axisOf({ dewPoint: "off" })).toEqual([plain.min, plain.max]);
    // The dew point does not widen the axis by its own values.
    const on = axisOf({ dewPoint: "on" });
    expect(on[1]).toBe(plain.max);
    expect(Number.isInteger(on[0]! / 5)).toBe(true);
    // At most to the 5 °C step within 5 K below the lowest temperature.
    const lowest = Math.min(
      ...[...powerInput.series, ...(powerInput.modelSeries?.["ICON-EU"] ?? [])]
        .filter((point) => point.variable === "temperature" || point.variable === "apparent_temperature")
        .map((point) => point.value ?? Infinity),
    );
    expect(on[0]!).toBeGreaterThanOrEqual(Math.ceil((lowest - 5) / 5) * 5);
    expect(on[0]!).toBeLessThanOrEqual(plain.min);
  });

  it("decides by the visible range when auto, then draws across the whole timeline as on", () => {
    const start = Date.parse(powerInput.timeline!.start!);
    // Spread 2 K from +48 h to +54 h, 8 K elsewhere.
    const humid = withDewPoint((time) => (time >= start + 48 * HOUR && time <= start + 54 * HOUR ? 2 : 8));
    const { timestamps } = createMeteogramScene(humid, autoOptions);
    const at = (visibleRange: { start: number; end: number }, dewPoint: "auto" | "on" = "auto") => ({
      ...powerOptions,
      visibleRange,
      dewPoint,
    });
    const leftAxis = (chartInput: MeteogramInput, options: object) => {
      const scale = createMeteogramScene(chartInput, options).areaScales[0]!.left!;
      return [scale.min, scale.max];
    };

    const dry = { start: start + 12 * HOUR, end: start + 36 * HOUR };
    expect(meteogramToSvgString(humid, at(dry))).toBe(meteogramToSvgString(powerInput, at(dry)));
    expect(leftAxis(humid, at(dry))).toEqual(leftAxis(powerInput, at(dry)));

    // The condition holds only at the start of this range, at +54 h.
    for (const range of [
      { start: start + 40 * HOUR, end: start + 64 * HOUR },
      { start: start + 54 * HOUR, end: start + 70 * HOUR },
    ]) {
      const markup = meteogramToSvgString(humid, at(range));
      expect(markup).toBe(meteogramToSvgString(humid, at(range, "on")));
      expect(leftAxis(humid, at(range))).toEqual(leftAxis(humid, at(range, "on")));
      const lines = testIds(parse(markup), "dew-point-path");
      expect(lines).toHaveLength(1);
      expect(lines[0]!.getAttribute("data-start")).toBe(new Date(timestamps[0]!).toISOString());
      expect(lines[0]!.getAttribute("data-end")).toBe(new Date(timestamps[timestamps.length - 1]!).toISOString());
    }
    // Just after it the range is dry again.
    const later = { start: start + 55 * HOUR, end: start + 70 * HOUR };
    expect(meteogramToSvgString(humid, at(later))).toBe(meteogramToSvgString(powerInput, at(later)));
  });

  it("matches the SVG snapshot with a dew point", async () => {
    await expect(
      meteogramToSvgString(input, { ...autoOptions, xmlDeclaration: true }),
    ).toMatchFileSnapshot("./__snapshots__/power.dew-point.svg");
  });
});
