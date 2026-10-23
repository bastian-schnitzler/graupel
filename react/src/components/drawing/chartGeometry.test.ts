import { describe, expect, it } from "vitest";
import {
  AREA_GAP,
  BOTTOM_PADDING,
  DAY_HEADER_HEIGHT,
  MODEL_HEADER_HEIGHT,
  computeAreaScales,
  computeChartGeometry,
  valueToY,
  type ExtremesLookup,
} from "./chartGeometry";
import {
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  getBuiltinLayout,
  resolveChartLayout,
} from "../../layouts/layoutResolution";
import type { ChartLayout, LayoutArea } from "../../layouts/types";

const resolve = (input: ChartLayout) => {
  const { layout, warning } = resolveChartLayout(input);
  expect(warning).toBeNull();
  return layout;
};
const custom = (areas: LayoutArea[], extra: Partial<ChartLayout> = {}) =>
  resolve({ id: "custom", name: "Custom", areas, ...extra });
const tempArea = (id: string, heightWeight?: number): LayoutArea => ({
  id,
  heightWeight,
  series: [{ quantity: "temperature", style: "line" }],
});

const noData: ExtremesLookup = () => ({ min: null, max: null });

describe("computeChartGeometry", () => {
  it("reproduces the fixed panel positions of today's chart", () => {
    const power = resolve(getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID));
    const withClouds = computeChartGeometry(power, { backgroundHasData: true });
    expect(withClouds.dayHeaderTop).toBe(22);
    expect(withClouds.dayHeaderBottom).toBe(44);
    expect(
      withClouds.areas.map(({ name, top, height }) => [name, top, height]),
    ).toEqual([
      ["temperature", 44, 115],
      ["precipitation", 174, 125],
      ["wind", 314, 105],
      ["convective", 434, 130],
    ]);
    expect(withClouds.areas[3].zeroY).toBe(499);
    expect(withClouds.totalHeight).toBe(574);

    const withoutClouds = computeChartGeometry(power, {
      backgroundHasData: false,
    });
    expect(withoutClouds.areas[1].height).toBe(95);
    expect(withoutClouds.areas[1].hasBackground).toBe(false);
    expect(withoutClouds.totalHeight).toBe(544);
  });

  it.each([1, 2, 3, 5])("stacks %i areas with constant gaps", (count) => {
    const layout = custom(
      Array.from({ length: count }, (_, index) => tempArea(`a${index}`)),
    );
    const geometry = computeChartGeometry(layout, { backgroundHasData: false });
    expect(geometry.areas).toHaveLength(count);
    geometry.areas.forEach((area, index) => {
      expect(area.height).toBe(100);
      if (index > 0) {
        expect(area.top - geometry.areas[index - 1].bottom).toBe(AREA_GAP);
      }
    });
    expect(geometry.areas[0].top).toBe(MODEL_HEADER_HEIGHT + DAY_HEADER_HEIGHT);
    expect(geometry.totalHeight).toBe(geometry.plotBottom + BOTTOM_PADDING);
  });

  it("gives every area heightWeight / Σ heightWeight of the plot height", () => {
    const geometry = computeChartGeometry(
      custom([tempArea("a", 1), tempArea("b", 2), tempArea("c", 0.5)]),
      { backgroundHasData: false },
    );
    const heights = geometry.areas.map((area) => area.height);
    const total = heights.reduce((sum, height) => sum + height, 0);
    expect(heights.map((height) => height / total)).toEqual([
      1 / 3.5,
      2 / 3.5,
      0.5 / 3.5,
    ]);
  });

  it("drops the header rows when model headers and day header are off", () => {
    const geometry = computeChartGeometry(
      custom([tempArea("a")], { showModelHeaders: false, showDayHeader: false }),
      { backgroundHasData: false },
    );
    expect(geometry.dayHeaderTop).toBe(0);
    expect(geometry.dayHeaderBottom).toBe(0);
    expect(geometry.areas[0].top).toBe(0);
  });

  it("starts the normal layout directly with the day header", () => {
    const geometry = computeChartGeometry(
      resolve(getBuiltinLayout(NORMAL_LAYOUT_ID)),
      { backgroundHasData: true },
    );
    expect(geometry.dayHeaderTop).toBe(0);
    expect(geometry.areas.map((area) => area.name)).toEqual([
      "temperature",
      "precipitation",
      "wind",
    ]);
    // The cloud profile background adds its own height (system.md §4.4, Q1).
    expect(geometry.areas[1].height).toBe(125);
  });
});

describe("computeAreaScales", () => {
  const scalesOf = (layout: ChartLayout, extremes: ExtremesLookup) => {
    const geometry = computeChartGeometry(resolve(layout), {
      backgroundHasData: true,
    });
    return geometry.areas.map((area) => computeAreaScales(area, extremes));
  };

  it("keeps today's axis rules for the power default", () => {
    const extremes: ExtremesLookup = (quantities, transform) => {
      if (quantities.includes("temperature")) return { min: -3.2, max: 18.4 };
      if (quantities.includes("wind_speed")) return { min: 0, max: 80 };
      if (quantities.includes("precipitation")) return { min: 0, max: 2 };
      if (quantities.includes("cape")) return { min: 0, max: 1000 };
      if (quantities.includes("convective_inhibition")) {
        return { min: 0, max: transform === "absolute" ? 150 : 0 };
      }
      return { min: null, max: null };
    };
    const [temp, precip, wind, convective] = scalesOf(
      getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID),
      extremes,
    );
    expect([temp.left!.min, temp.left!.max]).toEqual([-6, 21]);
    expect([precip.left!.min, precip.left!.max]).toEqual([0, 2.5]);
    // Probability: own hidden 0–100 % scale over the full area.
    expect(precip.bySeries[1]).toMatchObject({
      min: 0,
      max: 100,
      clamped: true,
      top: 174,
      bottom: 299,
    });
    expect(wind.left!.max).toBe(92);
    expect(convective.bySeries[0]).toMatchObject({ max: 1100, top: 434, bottom: 499 });
    expect(convective.bySeries[1]).toMatchObject({
      max: 165,
      top: 499,
      bottom: 564,
      absolute: true,
    });
    expect(convective.bySeries[2]).toMatchObject({ min: 0, max: 30, clamped: true });
  });

  it("uses the 2.5 mm / 50 km/h defaults without data", () => {
    const [, precip, wind] = scalesOf(
      getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID),
      noData,
    );
    expect(precip.left!.max).toBe(2.5);
    expect(wind.left!.max).toBe(50);
  });

  it("supports fixed and zero-based ranges on any axis", () => {
    const [area] = scalesOf(
      {
        id: "custom",
        name: "Custom",
        areas: [
          {
            id: "a",
            axes: {
              left: { quantity: "temperature", range: "fixed", min: -10, max: 30 },
              right: { quantity: "snow_depth", range: "zero-based" },
            },
            series: [
              { quantity: "temperature", style: "line" },
              { quantity: "snow_depth", style: "line", axis: "right" },
            ],
          },
        ],
      },
      () => ({ min: 0.2, max: 1.5 }),
    );
    expect(area.left).toMatchObject({ min: -10, max: 30, clamped: true });
    expect(area.right).toMatchObject({ min: 0, clamped: false });
    expect(area.right!.max).toBeCloseTo(1.65);
    // Clamped scales keep out-of-range values on the area border.
    expect(valueToY(area.left!, 100)).toBe(valueToY(area.left!, 30));
  });
});
