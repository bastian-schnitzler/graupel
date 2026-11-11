// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The embedded chart never draws a shape of negative height (REQ-749): its areas get lower to fit the height the rest
 * of the page leaves (REQ-608), but an area with a cloud background stays as high as the library's margin in it, so
 * the ground of the terrain mask stays inside the area. Drawn as SVG markup from a forecast with a cloud profile at a
 * place 1200 m high.
 */
import { describe, expect, it } from "vitest";
import { toMeteogramInput } from "@graupel/download";
import { getCloudAltitudeY, HEIGHT_PER_WEIGHT, meteogramToSvgString, type MeteogramInput } from "@graupel/meteogram";
import {
  chartHeights,
  CLOUD_BACKGROUND_MARGIN,
  NARROW_CHART_OPTIONS,
  narrowAxisLabels,
  portraitAreaScale,
  scaleLayoutAreas,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "../src/regions/MeteogramPanel/layout.ts";
import { forecastFixture, HOUR } from "./forecastFixture.ts";

/** The fixture with a cloud profile for every hour and its place 1200 m high. */
function input(): MeteogramInput {
  const base = toMeteogramInput(forecastFixture());
  const start = Date.parse(base.series[0]!.timestamp);
  const location = { ...base.location!, elevation: 1200 };
  return {
    ...base,
    location,
    cloudProfile: {
      location,
      profiles: Array.from({ length: base.series.length }, (_, hour) => ({
        timestamp: new Date(start + hour * HOUR).toISOString(),
        source_model_id: "icon_d2",
        levels: [
          { pressure_hpa: 900, altitude_m_asl: 1000, cloud_cover_percent: (hour * 13) % 100 },
          { pressure_hpa: 700, altitude_m_asl: 3000, cloud_cover_percent: (hour * 29) % 90 },
          { pressure_hpa: 300, altitude_m_asl: 9200, cloud_cover_percent: 20 },
        ],
      })),
    },
  };
}

/** Heights and widths of every rect in the chart drawn with its areas `scale` times as high. */
function rects(scale: number) {
  const markup = meteogramToSvgString(input(), {
    layout: scaleLayoutAreas(WEB_LAYOUT, scale),
    forceModelHeaders: true,
    ...NARROW_CHART_OPTIONS,
    axisLabels: narrowAxisLabels(true),
  });
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  return {
    mask: svg.querySelector('[data-testid="terrain-mask"] > rect'),
    all: [...svg.querySelectorAll("rect")].map((rect) => ({
      height: Number(rect.getAttribute("height") ?? 0),
      width: Number(rect.getAttribute("width") ?? 0),
    })),
  };
}

const withBackground = { forceModelHeaders: true, backgroundHasData: true };

describe("least scale of the areas (REQ-749)", () => {
  it("the margin is the library's: the highest altitude stands that far below an area's top", () => {
    expect(CLOUD_BACKGROUND_MARGIN).toBeGreaterThan(0);
    const area = { top: 30, height: 120 };
    expect(getCloudAltitudeY(area, 12, 12)).toBeCloseTo(area.top + CLOUD_BACKGROUND_MARGIN, 9);
  });

  it("keeps the area with the cloud background as high as the margin; 5 % without a background", () => {
    const heights = chartHeights(WEB_LAYOUT, withBackground);
    const cloud = WEB_LAYOUT.areas.find((area) => area.background)!;
    const cloudHeight = ((cloud.heightWeight ?? 1) + (cloud.background!.heightWeight ?? 0)) * HEIGHT_PER_WEIGHT;
    expect(heights.leastScale).toBeGreaterThan(0.05);
    expect(heights.leastScale * cloudHeight).toBeGreaterThanOrEqual(CLOUD_BACKGROUND_MARGIN);
    expect((heights.leastScale - 0.001) * cloudHeight).toBeLessThan(CLOUD_BACKGROUND_MARGIN);
    // Without data the background is not drawn: then no area needs more than 5 %.
    expect(chartHeights(WEB_LAYOUT, { ...withBackground, backgroundHasData: false }).leastScale).toBe(0.05);
    expect(chartHeights(WEB_LAYOUT_WITHOUT_HEADERS, { ...withBackground, forceModelHeaders: false }).leastScale).toBe(
      heights.leastScale,
    );
  });

  it("portraitAreaScale with very little height gives a scale at which every area is at least 0 high", () => {
    const heights = chartHeights(WEB_LAYOUT, withBackground);
    // Screens so low that even 40 % of them leave the areas less than their least height.
    for (const [available, screen] of [
      [0, 200],
      [40, 250],
      [60, 280],
    ] as const) {
      const scale = portraitAreaScale(heights, 1.2, available, screen);
      expect(scale).toBe(heights.leastScale);
      const { mask, all } = rects(scale);
      expect(mask).not.toBeNull();
      expect(Number(mask!.getAttribute("height"))).toBeGreaterThanOrEqual(0);
      for (const rect of all) {
        expect(rect.height).toBeGreaterThanOrEqual(0);
        expect(rect.width).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("below that scale the terrain mask would get a negative height (the bug)", () => {
    const { mask } = rects(0.05);
    expect(Number(mask!.getAttribute("height"))).toBeLessThan(0);
  });
});
