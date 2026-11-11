// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Height of the embedded chart on a phone in portrait (REQ-608, DEC-053): it takes the height the rest of the page
 * leaves on the screen, at least 40 % of the screen, at most its own; only its areas get lower. Whether it fits decides
 * about the room below the footer for Safari's bar (REQ-614).
 */
import {
  AREA_GAP,
  BOTTOM_PADDING,
  DAY_HEADER_HEIGHT,
  HEIGHT_PER_WEIGHT,
  MODEL_HEADER_HEIGHT,
} from "@graupel/meteogram";
import { describe, expect, it } from "vitest";
import {
  chartHeights,
  PORTRAIT_MIN_SCREEN_SHARE,
  portraitAreaScale,
  portraitChartHeight,
  scaleLayoutAreas,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "../src/regions/MeteogramPanel/layout.ts";

const weights = (withBackground: boolean) =>
  WEB_LAYOUT.areas.reduce(
    (sum, area) => sum + (area.heightWeight ?? 1) + (withBackground ? (area.background?.heightWeight ?? 0) : 0),
    0,
  );

describe("chartHeights", () => {
  it("is the library's height: headers, areas, gaps and padding", () => {
    for (const backgroundHasData of [false, true]) {
      const heights = chartHeights(WEB_LAYOUT, { forceModelHeaders: true, backgroundHasData });
      const areas = weights(backgroundHasData) * HEIGHT_PER_WEIGHT;
      expect(heights.areas).toBeCloseTo(areas, 6);
      const gaps = (WEB_LAYOUT.areas.length - 1) * AREA_GAP;
      expect(heights.total).toBeCloseTo(
        MODEL_HEADER_HEIGHT + DAY_HEADER_HEIGHT + areas + gaps + BOTTOM_PADDING,
        6,
      );
    }
    // Without model headers (unless forced) they take no height.
    const plain = chartHeights(WEB_LAYOUT_WITHOUT_HEADERS, { forceModelHeaders: false, backgroundHasData: false });
    const headed = chartHeights(WEB_LAYOUT, { forceModelHeaders: true, backgroundHasData: false });
    expect(headed.total - plain.total).toBe(MODEL_HEADER_HEIGHT);
  });
});

describe("scaleLayoutAreas", () => {
  it("makes every area and its background lower in the same ratio; the rest stays", () => {
    expect(scaleLayoutAreas(WEB_LAYOUT, 1)).toBe(WEB_LAYOUT);
    const half = scaleLayoutAreas(WEB_LAYOUT, 0.5);
    const options = { forceModelHeaders: true, backgroundHasData: true };
    const before = chartHeights(WEB_LAYOUT, options);
    const after = chartHeights(half, options);
    expect(after.areas).toBeCloseTo(before.areas / 2, 6);
    expect(after.total - after.areas).toBeCloseTo(before.total - before.areas, 6);
    half.areas.forEach((area, index) => {
      const original = WEB_LAYOUT.areas[index]!;
      expect(area.heightWeight).toBeCloseTo((original.heightWeight ?? 1) / 2, 9);
      const rest = { heightWeight: 0, background: null };
      expect({ ...area, ...rest }).toEqual({ ...original, ...rest });
      const background = original.background?.heightWeight ?? 0;
      if (original.background) expect(area.background!.heightWeight).toBeCloseTo(background / 2, 9);
    });
    // The website's layout itself is left as it is.
    expect(chartHeights(WEB_LAYOUT, options)).toEqual(before);
  });
});

describe("portraitAreaScale", () => {
  // As on a 390 px phone with all days: 1.437 px per unit, 345 units of areas in 429 (84 for headers, gaps, padding).
  const heights = { total: 429, areas: 345 };
  const px = 1.437;
  const natural = heights.total * px;
  const fixed = (heights.total - heights.areas) * px;
  const height = (scale: number) => fixed + scale * heights.areas * px;

  it("takes the height left on the screen, whatever it is", () => {
    for (const available of [600, 500, 400, 350]) {
      const scale = portraitAreaScale(heights, px, available, 844);
      expect(scale).toBeLessThan(1);
      expect(height(scale)).toBeCloseTo(available, 6);
    }
  });

  it("is never higher than its own height", () => {
    expect(portraitAreaScale(heights, px, natural, 844)).toBe(1);
    expect(portraitAreaScale(heights, px, natural + 200, 1400)).toBe(1);
  });

  it("keeps 40 % of the screen when less is left (then the page scrolls)", () => {
    for (const screen of [560, 700, 844]) {
      const scale = portraitAreaScale(heights, px, 100, screen);
      expect(height(scale)).toBeCloseTo(PORTRAIT_MIN_SCREEN_SHARE * screen, 6);
    }
  });

  it("leaves the areas some height on a screen too low even for that", () => {
    const scale = portraitAreaScale(heights, px, 0, 200);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(0.1);
  });

  it("changes nothing without a measured page", () => {
    expect(portraitAreaScale(heights, 0, 500, 844)).toBe(1);
    expect(portraitAreaScale(heights, px, Number.NaN, 844)).toBe(1);
    expect(portraitAreaScale({ total: 100, areas: 0 }, px, 50, 844)).toBe(1);
  });
});

describe("portraitChartHeight", () => {
  // As on a 390 px phone with all days.
  const heights = { total: 429, areas: 345 };
  const px = 1.437;

  it("is the chart's height with its areas scaled: headers, gaps and padding keep theirs", () => {
    expect(portraitChartHeight(heights, px, 1)).toBeCloseTo(heights.total * px, 9);
    expect(portraitChartHeight(heights, px, 0.5)).toBeCloseTo((heights.total - heights.areas / 2) * px, 9);
  });

  it("fits the height left on the screen with the scale portraitAreaScale finds, unless it keeps 40 %", () => {
    // Fits: the page does not scroll, so Safari needs no room below the footer (REQ-614).
    const fit = Math.floor(portraitAreaScale(heights, px, 450, 844) * 1000) / 1000;
    expect(portraitChartHeight(heights, px, fit)).toBeLessThanOrEqual(450 + 1);
    // Too little left: 40 % of the screen, more than is left, so the page scrolls and keeps the room.
    const low = Math.floor(portraitAreaScale(heights, px, 150, 560) * 1000) / 1000;
    expect(portraitChartHeight(heights, px, low)).toBeGreaterThan(150 + 1);
  });
});
