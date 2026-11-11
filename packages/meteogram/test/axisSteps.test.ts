// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import {
  POWER_DEFAULT_LAYOUT_ID,
  PRECIPITATION_AXIS_STEPS,
  WIND_AXIS_STEPS,
  WIND_ICON_RADIUS_PX,
  axisStepAtLeast,
  computeAreaScales,
  computeChartGeometry,
  getAxisPreset,
  getBuiltinLayout,
  resolveChartLayout,
  temperatureAxisRange,
  valueToY,
} from "../src";
import type { ChartLayout, ExtremesLookup } from "../src";
import type { MeteogramInput } from "../src/core/input";
import { renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, textContent } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const geometryOf = () =>
  computeChartGeometry(resolveChartLayout(getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID)).layout, {
    backgroundHasData: true,
  });

const lookup =
  (wind: number | null, precip: number | null, temp: [number, number] | null = null): ExtremesLookup =>
  (quantities) => {
    if (quantities.includes("wind_speed")) return { min: 0, max: wind };
    if (quantities.includes("precipitation")) return { min: 0, max: precip };
    if (quantities.includes("temperature")) return temp ? { min: temp[0], max: temp[1] } : { min: null, max: null };
    return { min: null, max: null };
  };

describe("axisStepAtLeast", () => {
  it("picks the smallest step at least the value", () => {
    expect(axisStepAtLeast(0, WIND_AXIS_STEPS)).toBe(10);
    expect(axisStepAtLeast(10, WIND_AXIS_STEPS)).toBe(10);
    expect(axisStepAtLeast(10.1, WIND_AXIS_STEPS)).toBe(15);
    expect(axisStepAtLeast(51, WIND_AXIS_STEPS)).toBe(75);
    expect(axisStepAtLeast(301, WIND_AXIS_STEPS)).toBe(400);
  });

  it("uses the next multiple of 100 above the last step", () => {
    expect(axisStepAtLeast(401, WIND_AXIS_STEPS)).toBe(500);
    expect(axisStepAtLeast(650, PRECIPITATION_AXIS_STEPS)).toBe(700);
  });
});

describe("wind axis (REQ-590)", () => {
  it("takes the step list 10 … 400 km/h", () => {
    expect(WIND_AXIS_STEPS).toEqual([10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400]);
    const max = getAxisPreset("wind_speed").zeroBasedMax!;
    expect(max(8)).toBe(10);
    expect(max(34)).toBe(40);
    expect(max(76)).toBe(100);
    expect(max(null)).toBe(50);
    expect(getAxisPreset("wind_gusts").zeroBasedMax).toBe(max);
  });

  for (const windIconScaleY of [1, 1.5, 2, 3]) {
    it(`keeps every value below the wind arrows (icon scale ${windIconScaleY})`, () => {
      const geometry = geometryOf();
      const windArea = geometry.areas.find((area) => area.area.series.some((s) => s.style === "arrows"))!;
      for (const value of [9, 10, 14.9, 20, 29, 30, 49, 50, 74, 99.5, 100, 140, 399, 400, 450]) {
        const scales = computeAreaScales(windArea, lookup(value, null), { windIconScaleY });
        const scale = scales.left!;
        expect(WIND_AXIS_STEPS.includes(scale.max) || scale.max % 100 === 0).toBe(true);
        const arrowBottom = windArea.top + 14 + WIND_ICON_RADIUS_PX * windIconScaleY;
        expect(valueToY(scale, value)).toBeGreaterThan(arrowBottom);
      }
    });
  }

  it("needs a larger step when the arrows are drawn larger", () => {
    const windArea = geometryOf().areas.find((area) => area.area.series.some((s) => s.style === "arrows"))!;
    const small = computeAreaScales(windArea, lookup(40, null), { windIconScaleY: 1 }).left!;
    const large = computeAreaScales(windArea, lookup(40, null), { windIconScaleY: 3 }).left!;
    expect(small.max).toBe(40);
    expect(large.max).toBe(50);
  });
});

describe("precipitation axis (REQ-591)", () => {
  it("takes the smallest step 2 … 400 mm that holds the maximum (REQ-651)", () => {
    expect(PRECIPITATION_AXIS_STEPS).toEqual([2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 400]);
    const preset = getAxisPreset("precipitation");
    expect(preset.zeroBasedMax!(0.87)).toBe(2);
    expect(preset.zeroBasedMax!(1.2)).toBe(2);
    expect(preset.zeroBasedMax!(2)).toBe(2);
    expect(preset.zeroBasedMax!(2.1)).toBe(5);
    expect(preset.zeroBasedMax!(3)).toBe(5);
    expect(preset.zeroBasedMax!(5)).toBe(5);
    expect(preset.zeroBasedMax!(5.1)).toBe(10);
    expect(preset.zeroBasedMax!(31)).toBe(50);
    expect(preset.zeroBasedMax!(null)).toBe(2);
    expect(preset.zeroBasedMax!(0)).toBe(2);
    expect(getAxisPreset("precipitation_rain_snow").zeroBasedMax!(1.2)).toBe(2);
    expect(getAxisPreset("precipitation_rain_snow").zeroBasedMax!(12)).toBe(15);
    expect(preset.formatMax!(2)).toBe("2");
    expect(preset.formatMax!(5)).toBe("5");
    expect(preset.formatMax!(75)).toBe("75");
  });

  it("keeps the fill share: 2 mm only when the maximum fits below it", () => {
    const preset = getAxisPreset("precipitation");
    expect(preset.zeroBasedMax!(1.2, 0.8)).toBe(2);
    expect(preset.zeroBasedMax!(1.8, 0.8)).toBe(5);
  });

  it("leaves the snowfall axis free (DEC-049)", () => {
    const snow = getAxisPreset("snowfall");
    expect(snow.zeroBasedMax!(2)).toBe(2.5);
    expect(snow.formatMax!(2.5)).toBe("2.5");
  });
});

describe("temperature axis (REQ-592)", () => {
  it("rounds both ends to multiples of 5", () => {
    expect(temperatureAxisRange(-21, 0)).toEqual([-25, 0]);
    expect(temperatureAxisRange(-19, -4)).toEqual([-20, 0]);
    expect(temperatureAxisRange(-3.2, 18.4)).toEqual([-5, 20]);
    expect(temperatureAxisRange(17, 31)).toEqual([15, 35]);
    expect(temperatureAxisRange(-30, -17)).toEqual([-30, -15]);
  });

  it("keeps 0 °C in range when the values come within 15 K of it", () => {
    expect(temperatureAxisRange(3, 12)).toEqual([0, 15]);
    expect(temperatureAxisRange(16, 24)).toEqual([15, 25]);
    expect(temperatureAxisRange(-12, -3)).toEqual([-15, 0]);
    expect(temperatureAxisRange(-28, -16)).toEqual([-30, -15]);
  });

  it("is used by the layouts' temperature area", () => {
    const tempArea = geometryOf().areas[0]!;
    const scale = computeAreaScales(tempArea, lookup(null, null, [-21.4, 1.6])).left!;
    expect([scale.min, scale.max]).toEqual([-25, 5]);
    expect(Object.is(temperatureAxisRange(-4, -0.5)[1], -0)).toBe(false);
  });

  it("keeps fixed ranges from the layout", () => {
    const layout = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);
    const fixed = {
      ...layout,
      areas: layout.areas.map((area, index) =>
        index === 0
          ? { ...area, axes: { ...area.axes, left: { ...(area.axes?.left ?? {}), range: "fixed", min: -7, max: 23 } } }
          : area,
      ),
    };
    const geometry = computeChartGeometry(resolveChartLayout(fixed).layout, { backgroundHasData: true });
    const scale = computeAreaScales(geometry.areas[0]!, lookup(null, null, [-21.4, 1.6])).left!;
    expect([scale.min, scale.max]).toEqual([-7, 23]);
  });
});

describe("precipitation axis in the chart (REQ-651)", () => {
  // Power layout: precipitation bars (rain and snow) with the label "<max> mm" at the top of their area.
  // One bar of `max` mm at hour 12 of the series, no snow.
  const start = Date.parse(powerInput.series[0]!.timestamp);
  const withPrecipitation = (max: number | null): MeteogramInput => ({
    ...powerInput,
    series: powerInput.series.map((point) => {
      if (point.variable === "snowfall") return { ...point, value: 0 };
      if (point.variable !== "precipitation") return point;
      const hour = (Date.parse(point.timestamp) - start) / 3_600_000;
      return { ...point, value: max !== null && hour === 12 ? max : 0 };
    }),
  });
  const precipitationLabel = (input: MeteogramInput, options: MeteogramRenderOptions = {}) => {
    const layer = renderStaticLayer(createMeteogramScene(input, { ...powerOptions, ...options }));
    const maxima = findAll(layer, (node) => node.tag === "text" && node.key === "axis-max").map(textContent);
    // Temperature, precipitation, wind.
    return maxima[1];
  };

  it("goes to 2 mm when the largest amount fits it", () => {
    expect(precipitationLabel(withPrecipitation(1.2))).toBe("2 mm");
    expect(precipitationLabel(withPrecipitation(2))).toBe("2 mm");
  });

  it("uses the next steps above 2 mm", () => {
    expect(precipitationLabel(withPrecipitation(3))).toBe("5 mm");
    expect(precipitationLabel(withPrecipitation(12))).toBe("15 mm");
  });

  it("goes to 2 mm without precipitation", () => {
    expect(precipitationLabel(withPrecipitation(null))).toBe("2 mm");
  });

  it("takes a host-given maxPrecipitation through the same steps", () => {
    // The host value replaces the data maximum (here 4 mm).
    expect(precipitationLabel(withPrecipitation(4), { maxPrecipitation: 1 })).toBe("2 mm");
    expect(precipitationLabel(withPrecipitation(4), { maxPrecipitation: 0 })).toBe("2 mm");
    expect(precipitationLabel(withPrecipitation(0.5), { maxPrecipitation: 3 })).toBe("5 mm");
  });

  it("leaves a snowfall axis free next to a 2 mm precipitation axis", () => {
    const layout: ChartLayout = {
      id: "snow",
      name: "Snow",
      areas: [
        {
          id: "precip",
          axes: {
            left: { quantity: "precipitation", range: "zero-based" },
            right: { quantity: "snowfall", range: "zero-based" },
          },
          series: [
            { quantity: "precipitation", style: "bars" },
            { quantity: "snowfall", style: "bars", axis: "right" },
          ],
        },
      ],
    };
    const geometry = computeChartGeometry(resolveChartLayout(layout).layout, { backgroundHasData: true });
    const scales = computeAreaScales(geometry.areas[0]!, () => ({ min: 0, max: 1.2 }));
    expect(scales.left!.max).toBe(2);
    expect(scales.right!.max).toBeCloseTo(1.5);
    const empty = computeAreaScales(geometry.areas[0]!, () => ({ min: null, max: null }));
    expect(empty.left!.max).toBe(2);
    expect(empty.right!.max).toBe(2);
    expect(getAxisPreset("snowfall").formatMax!(1.5)).toBe("1.5");
  });
});
