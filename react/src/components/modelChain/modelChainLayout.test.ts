import { describe, it, expect } from "vitest";
import {
  getBaselineWidthPct,
  getMinimumWidthPct,
  calculateModelChainLayout,
  calculatePixelWidths,
  normalizeWidths,
  resizeBoundaryPair,
  getDefaultModelChainWidthsPct,
  areModelChainsEqual,
} from "./modelChainLayout";
import type { WeatherModel, ModelMetadata } from "../../types";

const MOCK_MODELS_META: Record<string, ModelMetadata> = {
  "ICON-D2": {
    id: "icon_d2",
    name: "ICON-D2",
    description: "DWD High Resolution",
    spatial_resolution: 2.2,
    temporal_resolution: 1,
    max_forecast_horizon_hours: 48,
    supported_variables: ["temperature"],
  },
  "ICON-EU": {
    id: "icon_eu",
    name: "ICON-EU",
    description: "DWD Europe",
    spatial_resolution: 7,
    temporal_resolution: 1,
    max_forecast_horizon_hours: 120,
    supported_variables: ["temperature"],
  },
  GFS: {
    id: "gfs_seamless",
    name: "GFS",
    description: "NOAA Global",
    spatial_resolution: 13,
    temporal_resolution: 1,
    max_forecast_horizon_hours: 384,
    supported_variables: ["temperature"],
  },
  "ECMWF-IFS": {
    id: "ecmwf_ifs025",
    name: "ECMWF-IFS",
    description: "ECMWF Global",
    spatial_resolution: 25,
    temporal_resolution: 1,
    max_forecast_horizon_hours: 240,
    supported_variables: ["temperature"],
  },
};

describe("modelChainLayout Section 13 Test Suite", () => {
  // Test 1: 1 model: width is 100%
  it("1. 1 model: width is 100%", () => {
    const chain1: WeatherModel[] = [
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const layout = calculateModelChainLayout(chain1, MOCK_MODELS_META);
    expect(layout.length).toBe(1);
    expect(layout[0].widthPct).toBe(100);
    expect(layout[0].minWidthPct).toBe(100);
  });

  // Test 2: 2 models: equal width reference is 50% / 50%
  it("2. 2 models: equal width reference is 50% / 50%", () => {
    const chain2: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const layout = calculateModelChainLayout(chain2, MOCK_MODELS_META);
    expect(layout[0].widthPct).toBe(50);
    expect(layout[1].widthPct).toBe(50);
    expect(layout[0].widthPct + layout[1].widthPct).toBe(100);
  });

  // Test 3: 2 models: drag boundary left to maximum; verify model 1 width >= 16.667%, model 2 width <= 83.333%, sum = 100%
  it("3. 2 models: drag boundary left to maximum; verify model 1 width >= 16.667%, model 2 width <= 83.333%, sum = 100%", () => {
    const chain2: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initialWidths = [50, 50];
    const result = resizeBoundaryPair(
      chain2,
      MOCK_MODELS_META,
      initialWidths,
      0,
      0,
      -999,
    );

    expect(result.updatedWidthsPct[0]).toBeCloseTo(16.667, 2);
    expect(result.updatedWidthsPct[0]).toBeGreaterThanOrEqual(16.66);
    expect(result.updatedWidthsPct[1]).toBeCloseTo(83.333, 2);
    expect(result.updatedWidthsPct[1]).toBeLessThanOrEqual(83.34);
    expect(result.updatedWidthsPct[0] + result.updatedWidthsPct[1]).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 4: 2 models: drag boundary right to maximum; verify model 1 width <= 83.333%, model 2 width >= 16.667%, sum = 100%
  it("4. 2 models: drag boundary right to maximum; verify model 1 width <= 83.333%, model 2 width >= 16.667%, sum = 100%", () => {
    const chain2: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initialWidths = [50, 50];
    const result = resizeBoundaryPair(
      chain2,
      MOCK_MODELS_META,
      initialWidths,
      0,
      0,
      999,
    );

    expect(result.updatedWidthsPct[0]).toBeCloseTo(83.333, 2);
    expect(result.updatedWidthsPct[0]).toBeLessThanOrEqual(83.34);
    expect(result.updatedWidthsPct[1]).toBeCloseTo(16.667, 2);
    expect(result.updatedWidthsPct[1]).toBeGreaterThanOrEqual(16.66);
    expect(result.updatedWidthsPct[0] + result.updatedWidthsPct[1]).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 5: 3 models: equal width reference is 33.333% each
  it("5. 3 models: equal width reference is 33.333% each", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const layout = calculateModelChainLayout(chain3, MOCK_MODELS_META);
    expect(layout[0].widthPct).toBeCloseTo(33.333, 2);
    expect(layout[1].widthPct).toBeCloseTo(33.333, 2);
    expect(layout[2].widthPct).toBeCloseTo(33.333, 2);
    expect(layout.reduce((acc, s) => acc + s.widthPct, 0)).toBeCloseTo(100, 5);
  });

  // Test 6: 3 models: drag boundary 0 left to maximum; verify model 0 width >= 11.111%, model 1 width <= 55.556%, model 2 width unchanged at 33.333%, sum = 100%
  it("6. 3 models: drag boundary 0 left to maximum; verify model 0 width >= 11.111%, model 1 width <= 55.556%, model 2 width unchanged at 33.333%, sum = 100%", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial3 = [100 / 3, 100 / 3, 100 / 3];
    const result = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initial3,
      0,
      0,
      -999,
    );

    expect(result.updatedWidthsPct[0]).toBeCloseTo(11.111, 2);
    expect(result.updatedWidthsPct[0]).toBeGreaterThanOrEqual(11.111);
    expect(result.updatedWidthsPct[1]).toBeCloseTo(55.556, 2);
    expect(result.updatedWidthsPct[2]).toBeCloseTo(33.333, 2);
    expect(result.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 7: 3 models: drag boundary 1 right to maximum; verify model 2 width >= 11.111%, model 1 width <= 55.556%, model 0 width unchanged at 33.333%, sum = 100%
  it("7. 3 models: drag boundary 1 right to maximum; verify model 2 width >= 11.111%, model 1 width <= 55.556%, model 0 width unchanged at 33.333%, sum = 100%", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial3 = [100 / 3, 100 / 3, 100 / 3];
    const result = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initial3,
      1,
      0,
      999,
    );

    expect(result.updatedWidthsPct[0]).toBeCloseTo(33.333, 2);
    expect(result.updatedWidthsPct[1]).toBeCloseTo(55.556, 2);
    expect(result.updatedWidthsPct[2]).toBeCloseTo(11.111, 2);
    expect(result.updatedWidthsPct[2]).toBeGreaterThanOrEqual(11.111);
    expect(result.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 8: 3 models: drag boundary 0 left to max and boundary 1 right to max; verify inner model width <= 77.778%, outer models at 11.111%, sum = 100%
  it("8. 3 models: drag boundary 0 left to max and boundary 1 right to max; verify inner model width <= 77.778%, outer models at 11.111%, sum = 100%", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial3 = [100 / 3, 100 / 3, 100 / 3];
    const step1 = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initial3,
      0,
      0,
      -999,
    );
    const step2 = resizeBoundaryPair(
      step1.updatedChain,
      MOCK_MODELS_META,
      step1.updatedWidthsPct,
      1,
      0,
      999,
    );

    expect(step2.updatedWidthsPct[0]).toBeCloseTo(11.111, 2);
    expect(step2.updatedWidthsPct[1]).toBeCloseTo(77.778, 2);
    expect(step2.updatedWidthsPct[1]).toBeLessThanOrEqual(77.778);
    expect(step2.updatedWidthsPct[2]).toBeCloseTo(11.111, 2);
    expect(step2.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 9: 3 models: drag boundary 0 right to max and boundary 1 left to max; verify inner model width >= 11.111%, outer models sum = 100%
  it("9. 3 models: drag boundary 0 right to max and boundary 1 left to max; verify inner model width >= 11.111%, outer models sum = 100%", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial3 = [100 / 3, 100 / 3, 100 / 3];
    const step1 = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initial3,
      0,
      0,
      999,
    );
    const step2 = resizeBoundaryPair(
      step1.updatedChain,
      MOCK_MODELS_META,
      step1.updatedWidthsPct,
      1,
      0,
      -999,
    );

    expect(step2.updatedWidthsPct[0]).toBeCloseTo(55.556, 2);
    expect(step2.updatedWidthsPct[1]).toBeCloseTo(11.111, 2);
    expect(step2.updatedWidthsPct[1]).toBeGreaterThanOrEqual(11.111);
    expect(step2.updatedWidthsPct[2]).toBeCloseTo(33.333, 2);
    expect(step2.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 10: 4 models: base width 25% each; verify models minimum width is 8.333% (1/3 of base)
  it("10. 4 models: base width 25% each; verify models minimum width is 8.333% (1/3 of base)", () => {
    expect(getBaselineWidthPct(4)).toBe(25);
    expect(getMinimumWidthPct(4, false)).toBeCloseTo(8.333, 2);
    expect(getMinimumWidthPct(4, true)).toBeCloseTo(8.333, 2);
  });

  // Test 11: Dragging boundary i leaves all models j not in {i, i+1} strictly unchanged in width and position
  it("11. Dragging boundary i leaves all models j not in {i, i+1} strictly unchanged in width and position", () => {
    const chain4: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial4 = [25, 25, 25, 25];
    const result = resizeBoundaryPair(
      chain4,
      MOCK_MODELS_META,
      initial4,
      1,
      0,
      5,
    );

    expect(result.updatedWidthsPct[0]).toBe(25);
    expect(result.updatedWidthsPct[3]).toBe(25);
    expect(result.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 12: Local conservation: for any drag on boundary i, w_i + w_{i+1} before drag equals w_i + w_{i+1} after drag (within floating-point epsilon)
  it("12. Local conservation: for any drag on boundary i, w_i + w_{i+1} before drag equals w_i + w_{i+1} after drag", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial3 = [100 / 3, 100 / 3, 100 / 3];
    const pairBefore = initial3[0] + initial3[1];
    const result = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initial3,
      0,
      0,
      4.35,
    );
    const pairAfter = result.updatedWidthsPct[0] + result.updatedWidthsPct[1];

    expect(Math.abs(pairAfter - pairBefore)).toBeLessThan(1e-9);
  });

  // Test 13: Drag boundary, then drag back to original position: resulting widths match original widths with zero drift (< 1e-6)
  it("13. Drag boundary, then drag back to original position: resulting widths match original widths with zero drift (< 1e-6)", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initial3 = [100 / 3, 100 / 3, 100 / 3];
    const dragged = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initial3,
      0,
      0,
      7.25,
    );
    const restored = resizeBoundaryPair(
      dragged.updatedChain,
      MOCK_MODELS_META,
      dragged.updatedWidthsPct,
      0,
      0,
      -7.25,
    );

    for (let i = 0; i < 3; i++) {
      expect(Math.abs(restored.updatedWidthsPct[i] - initial3[i])).toBeLessThan(
        1e-6,
      );
    }
  });

  // Test 14: 0-hour model: set a model's transition hour equal to the previous transition hour (H_i = H_{i-1}); verify its card width is still >= minimum width and total sum is 100%
  it("14. 0-hour model: set transition hour equal to previous (H_i = H_{i-1}); verify card width >= minimum width and total sum is 100%", () => {
    const chainWithZero: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 48 }, // 48 - 48 = 0 hours
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const layout = calculateModelChainLayout(chainWithZero, MOCK_MODELS_META);

    expect(layout[1].duration).toBe(0);
    expect(layout[1].widthPct).toBeGreaterThanOrEqual(layout[1].minWidthPct);
    const totalSum = layout.reduce((a, b) => a + b.widthPct, 0);
    expect(totalSum).toBeCloseTo(100, 5);
  });

  // Test 15: Extreme time range: model with capable horizon equal to previous model; card remains rendered with minimum width and usable handles
  it("15. Extreme time range: model with capable horizon equal to previous model; card remains rendered with minimum width and usable handles", () => {
    const chainExtreme: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const layout = calculateModelChainLayout(chainExtreme, MOCK_MODELS_META);

    expect(layout[1].widthPct).toBeGreaterThanOrEqual(layout[1].minWidthPct);
    expect(layout[1].minAllowedHorizon).toBeDefined();
    expect(layout[1].maxAllowedHorizon).toBeDefined();
    expect(layout[1].maxAllowedHorizon).toBeGreaterThanOrEqual(
      layout[1].minAllowedHorizon,
    );
  });

  // Test 16: Container resize from 1200px to 800px to 400px: total width always equals parent width, card proportions preserved, no negative widths, no NaN
  it("16. Container resize from 1200px to 800px to 400px: total width always equals parent width, card proportions preserved, no negative widths, no NaN", () => {
    const widthsPct = [22.2222, 44.4444, 33.3334];

    for (const containerWidth of [1200, 800, 400]) {
      const pixelWidths = calculatePixelWidths(widthsPct, containerWidth);
      const sum = pixelWidths.reduce((a, b) => a + b, 0);

      expect(sum).toBe(containerWidth);
      pixelWidths.forEach((w) => {
        expect(isNaN(w)).toBe(false);
        expect(w).toBeGreaterThan(0);
      });
    }
  });

  // Test 17: Reordering models: chain updates, new layout recomputes reference widths, sum remains 100%
  it("17. Reordering models: chain updates, new layout recomputes reference widths, sum remains 100%", () => {
    const reorderedChain: WeatherModel[] = [
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const layout = calculateModelChainLayout(reorderedChain, MOCK_MODELS_META);

    expect(layout.length).toBe(2);
    expect(layout[0].widthPct).toBe(50);
    expect(layout[1].widthPct).toBe(50);
    expect(layout[0].widthPct + layout[1].widthPct).toBe(100);
  });

  // Test 18: Deleting a model: remaining N-1 models re-expand to fill 100% equally (or according to remaining delta), sum remains 100%
  it("18. Deleting a model: remaining N-1 models re-expand to fill 100% equally, sum remains 100%", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    // Delete middle model
    const remainingChain = [chain3[0], chain3[2]];
    const layout = calculateModelChainLayout(remainingChain, MOCK_MODELS_META);

    expect(layout.length).toBe(2);
    expect(layout[0].widthPct).toBe(50);
    expect(layout[1].widthPct).toBe(50);
    expect(layout[0].widthPct + layout[1].widthPct).toBe(100);
  });

  // Test 19: Adding a model: new N+1 models re-divide container to fill 100%, each card respects new minimum widths
  it("19. Adding a model: new N+1 models re-divide container to fill 100%, each card respects new minimum widths", () => {
    const chain2: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const chain3: WeatherModel[] = [
      chain2[0],
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      chain2[1],
    ];
    const layout = calculateModelChainLayout(chain3, MOCK_MODELS_META);

    expect(layout.length).toBe(3);
    const sum = layout.reduce((a, b) => a + b.widthPct, 0);
    expect(sum).toBeCloseTo(100, 5);
    layout.forEach((seg) => {
      expect(seg.widthPct).toBeGreaterThanOrEqual(seg.minWidthPct);
    });
  });

  // Additional check: Meteorological limits & deltaHours clamping
  it("20. Meteorological forecast horizon constraints strictly respected during hour resize", () => {
    const chain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];

    // ICON-D2 max capable horizon is 48h. Attempting to drag boundary 0 to +100h must be clamped.
    const result = resizeBoundaryPair(
      chain,
      MOCK_MODELS_META,
      [50, 50],
      0,
      100,
    );

    expect(result.updatedChain[0].max_forecast_horizon_hours).toBe(48);
    expect(result.actualDeltaHours).toBe(0);
  });

  it("21. Preserves total container width and clamps below minimums across normalizeWidths", () => {
    const minOuter = getMinimumWidthPct(3, true);
    const testWidths = [5, 45, 50];
    const normalized = normalizeWidths(testWidths, 3);
    expect(normalized[0]).toBeGreaterThanOrEqual(minOuter);
    const sum = normalized.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 5);
  });

  // Test 22: Resizing model to 0h and then back to maximum restores its exact 1/3 baseline width
  it("22. Resizing model to 0h and then back to maximum restores its exact 1/3 baseline width", () => {
    const chain3: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const initialWidths = [100 / 3, 100 / 3, 100 / 3];

    // 1. Resize ICON-D2 to 0h
    const step1 = resizeBoundaryPair(
      chain3,
      MOCK_MODELS_META,
      initialWidths,
      0,
      -48,
    );
    expect(step1.updatedChain[0].max_forecast_horizon_hours).toBe(0);
    expect(step1.updatedWidthsPct[0]).toBeCloseTo(11.111, 2);
    expect(step1.updatedWidthsPct[1]).toBeCloseTo(55.556, 2);
    expect(step1.updatedWidthsPct[2]).toBeCloseTo(33.333, 2);

    // 2. Resize ICON-D2 back to its maximum capable horizon (48h)
    const step2 = resizeBoundaryPair(
      step1.updatedChain,
      MOCK_MODELS_META,
      step1.updatedWidthsPct,
      0,
      48,
    );
    expect(step2.updatedChain[0].max_forecast_horizon_hours).toBe(48);
    // Must return to exactly 1/3 (33.333%) of total width, NOT > 1/3 (e.g. 44.444%)
    expect(step2.updatedWidthsPct[0]).toBeCloseTo(33.333, 2);
    expect(step2.updatedWidthsPct[0]).toBeLessThanOrEqual(33.334);
    expect(step2.updatedWidthsPct[1]).toBeCloseTo(33.333, 2);
    expect(step2.updatedWidthsPct[2]).toBeCloseTo(33.333, 2);
    expect(step2.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );

    // 3. Attempting to drag beyond maximum (e.g. +100h) remains clamped at 48h and 1/3 width
    const step3 = resizeBoundaryPair(
      step2.updatedChain,
      MOCK_MODELS_META,
      step2.updatedWidthsPct,
      0,
      100,
    );
    expect(step3.updatedChain[0].max_forecast_horizon_hours).toBe(48);
    expect(step3.updatedWidthsPct[0]).toBeCloseTo(33.333, 2);
    expect(step3.updatedWidthsPct[0]).toBeLessThanOrEqual(33.334);
  });

  // Test 23: Resizing middle model from 60h to 48h (0h duration) gives it 1/3 size and transfers freed width to right model
  it("23. Resizing middle model from 60h to 48h (0h duration) gives it 1/3 size and transfers freed width to right model", () => {
    const chain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 60 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];
    const initialWidths = [100 / 3, 100 / 3, 100 / 3];

    const res = resizeBoundaryPair(
      chain,
      MOCK_MODELS_META,
      initialWidths,
      1,
      -12,
    );
    expect(res.updatedChain[1].max_forecast_horizon_hours).toBe(48);
    // ICON-EU receives 1/3 size (11.11%)
    expect(res.updatedWidthsPct[1]).toBeCloseTo(11.111, 2);
    // ECMWF-IFS receives the freed width (55.56%)
    expect(res.updatedWidthsPct[2]).toBeCloseTo(55.556, 2);
    // ICON-D2 is completely unchanged (33.33%)
    expect(res.updatedWidthsPct[0]).toBeCloseTo(33.333, 2);
    expect(res.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);

    // When default layout is calculated for this 0h chain without customWidthsPct,
    // it derives the exact same widths:
    const defaultLayout = calculateModelChainLayout(
      res.updatedChain,
      MOCK_MODELS_META,
    );
    expect(defaultLayout[0].widthPct).toBeCloseTo(33.333, 2);
    expect(defaultLayout[1].widthPct).toBeCloseTo(11.111, 2);
    expect(defaultLayout[2].widthPct).toBeCloseTo(55.556, 2);
    expect(defaultLayout.reduce((a, b) => a + b.widthPct, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 24: Default width allocation for 0h models in various positions
  it("24. Default width allocation for 0h models transfers freed width to the right (or left if rightmost)", () => {
    // Leftmost model has 0h, middle model is at full capable span (120h)
    const chainLeftZero: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 0 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];
    const widthsLeftZero = getDefaultModelChainWidthsPct(
      chainLeftZero,
      MOCK_MODELS_META,
    );
    expect(widthsLeftZero[0]).toBeCloseTo(11.111, 2);
    expect(widthsLeftZero[1]).toBeCloseTo(55.556, 2);
    expect(widthsLeftZero[2]).toBeCloseTo(33.333, 2);
    expect(widthsLeftZero.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);

    // Rightmost model has 0h
    const chainRightZero: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 120 },
    ];
    const widthsRightZero = getDefaultModelChainWidthsPct(
      chainRightZero,
      MOCK_MODELS_META,
    );
    expect(widthsRightZero[0]).toBeCloseTo(33.333, 2);
    expect(widthsRightZero[1]).toBeCloseTo(55.556, 2);
    expect(widthsRightZero[2]).toBeCloseTo(11.111, 2);
    expect(widthsRightZero.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });

  // Test 25: areModelChainsEqual deep comparison
  it("25. areModelChainsEqual accurately detects structural changes vs shallow clones", () => {
    const chainA: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 48 },
    ];
    const chainB = chainA.map((m) => ({ ...m }));
    const chainC = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 60 },
    ];

    expect(chainA === chainB).toBe(false);
    expect(areModelChainsEqual(chainA, chainB)).toBe(true);
    expect(areModelChainsEqual(chainA, chainC)).toBe(false);
  });

  // Test 26: Proportional width scaling when reducing time span
  it("26. Proportionally scales card width from full size down to 0h size when time span is reduced", () => {
    // ICON-D2 (48h capable, 48h full) -> 33.33%
    // ICON-EU (120h capable, 72h full span: 48h to 120h) -> reduced to 84h (36h span, exactly 50% of full span)
    // ECMWF-IFS (240h capable) -> right recipient absorbs freed width
    const chainProportional: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 84 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];

    const widths = getDefaultModelChainWidthsPct(
      chainProportional,
      MOCK_MODELS_META,
    );
    // ICON-D2 is at full span (48h) -> 33.33%
    expect(widths[0]).toBeCloseTo(33.333, 2);
    // ICON-EU is at 50% span -> halfway between 33.33% and 11.11% = 22.22%
    expect(widths[1]).toBeCloseTo(22.222, 2);
    // ECMWF-IFS receives the 11.111% freed width -> 33.333% + 11.111% = 44.444%
    expect(widths[2]).toBeCloseTo(44.444, 2);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);

    // Verify calculateModelChainLayout matches exactly without customWidthsPct
    const layout = calculateModelChainLayout(
      chainProportional,
      MOCK_MODELS_META,
    );
    expect(layout[0].widthPct).toBeCloseTo(33.333, 2);
    expect(layout[1].widthPct).toBeCloseTo(22.222, 2);
    expect(layout[2].widthPct).toBeCloseTo(44.444, 2);
  });

  // Test 27: Multiple adjacent 0h models allocation
  it("27. Multiple adjacent 0h models each receive 1/3 baseWidth and transfer all remaining space to the active model", () => {
    // Two leading 0h models: ICON-D2 (0h-0h) and ICON-EU (0h-0h), ECMWF-IFS (0h-240h)
    const chainLeadingTwoZero: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 0 },
      { name: "ICON-EU", max_forecast_horizon_hours: 0 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];

    const widthsLeading = getDefaultModelChainWidthsPct(
      chainLeadingTwoZero,
      MOCK_MODELS_META,
    );
    // Both 0h models must be at exactly 1/3 of baseWidth (11.111%)
    expect(widthsLeading[0]).toBeCloseTo(11.111, 2);
    expect(widthsLeading[1]).toBeCloseTo(11.111, 2);
    // Active model gets 33.333% + 22.222% + 22.222% = 77.778%
    expect(widthsLeading[2]).toBeCloseTo(77.778, 2);
    expect(widthsLeading.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);

    const layoutLeading = calculateModelChainLayout(
      chainLeadingTwoZero,
      MOCK_MODELS_META,
    );
    expect(layoutLeading[0].widthPct).toBeCloseTo(11.111, 2);
    expect(layoutLeading[1].widthPct).toBeCloseTo(11.111, 2);
    expect(layoutLeading[2].widthPct).toBeCloseTo(77.778, 2);

    // Two trailing 0h models: ICON-D2 (0h-48h), ICON-EU (48h-48h), ECMWF-IFS (48h-48h)
    const chainTrailingTwoZero: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 48 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 48 },
    ];

    const widthsTrailing = getDefaultModelChainWidthsPct(
      chainTrailingTwoZero,
      MOCK_MODELS_META,
    );
    // Active model on left receives freed width from both trailing 0h models
    expect(widthsTrailing[0]).toBeCloseTo(77.778, 2);
    expect(widthsTrailing[1]).toBeCloseTo(11.111, 2);
    expect(widthsTrailing[2]).toBeCloseTo(11.111, 2);
    expect(widthsTrailing.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });

  // Test 28: Sequential drag of adjacent models to 0h via resizeBoundaryPair
  it("28. Dragging boundary 0 to 0h and then boundary 1 to 0h via resizeBoundaryPair leaves both at 1/3 baseWidth and third model at 7/3 baseWidth", () => {
    const chain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];
    const initialWidths = [100 / 3, 100 / 3, 100 / 3];

    // 1. Drag boundary 0 to 0h
    const step1 = resizeBoundaryPair(
      chain,
      MOCK_MODELS_META,
      initialWidths,
      0,
      -48,
    );
    expect(step1.updatedChain[0].max_forecast_horizon_hours).toBe(0);
    expect(step1.updatedWidthsPct[0]).toBeCloseTo(11.111, 2);
    expect(step1.updatedWidthsPct[1]).toBeCloseTo(55.556, 2);
    expect(step1.updatedWidthsPct[2]).toBeCloseTo(33.333, 2);

    // 2. Drag boundary 1 to 0h
    const step2 = resizeBoundaryPair(
      step1.updatedChain,
      MOCK_MODELS_META,
      step1.updatedWidthsPct,
      1,
      -120,
    );
    expect(step2.updatedChain[0].max_forecast_horizon_hours).toBe(0);
    expect(step2.updatedChain[1].max_forecast_horizon_hours).toBe(0);
    // Both 0-hour models must be at exactly 1/3 base width (11.111%)
    expect(step2.updatedWidthsPct[0]).toBeCloseTo(11.111, 2);
    expect(step2.updatedWidthsPct[1]).toBeCloseTo(11.111, 2);
    // Third model receives all freed space: 33.333% + 22.222% + 22.222% = 77.778%
    expect(step2.updatedWidthsPct[2]).toBeCloseTo(77.778, 2);
    expect(step2.updatedWidthsPct.reduce((a, b) => a + b, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  // Test 29: Continuous proportional scaling without jump between 118h and 120h
  it("29. Continuously scales width from full span down without discontinuity (e.g. 118h vs 120h with leading 0h model)", () => {
    // Chain where first model is at 0h
    const chain120: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 0 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];
    const widths120 = getDefaultModelChainWidthsPct(
      chain120,
      MOCK_MODELS_META,
    );
    expect(widths120[0]).toBeCloseTo(11.111, 2);
    expect(widths120[1]).toBeCloseTo(55.556, 2);
    expect(widths120[2]).toBeCloseTo(33.333, 2);

    // When ICON-EU is reduced slightly to 118h (2 hours below 120h full span)
    const chain118: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 0 },
      { name: "ICON-EU", max_forecast_horizon_hours: 118 },
      { name: "ECMWF-IFS", max_forecast_horizon_hours: 240 },
    ];
    const widths118 = getDefaultModelChainWidthsPct(
      chain118,
      MOCK_MODELS_META,
    );
    expect(widths118[0]).toBeCloseTo(11.111, 2);
    // Ratio = 118 / 120 = 0.98333
    // Width = 11.111% + 0.98333 * (55.556% - 11.111%) = 54.815%
    expect(widths118[1]).toBeCloseTo(54.815, 2);
    // Delta from 120h to 118h is only ~0.741%, showing smooth continuity without jumping down to 33%
    const delta = widths120[1] - widths118[1];
    expect(delta).toBeCloseTo(0.741, 2);
    expect(widths118[2]).toBeCloseTo(34.074, 2);
    expect(widths118.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });
});

