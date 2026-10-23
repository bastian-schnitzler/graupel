import { describe, it, expect } from "vitest";
import { calculateAccumulatedPrecipitation } from "./meteogramCalculations";

describe("calculateAccumulatedPrecipitation", () => {
  it("sums only contiguous snowy precipitation bars when snow amounts are masked by wet hours", () => {
    const hours = [0, 1, 2, 3, 4].map((hour) => Date.parse("2026-01-01T00:00:00Z") + hour * 3600000);
    const precipitation = [1, 2, 3, 0, 1];
    const snowfall = [0.5, 1, 0, 2, 0.5];
    const whiteBars = snowfall.map((snow, index) => precipitation[index] > 0 && snow > 0 ? snow : null);
    expect(calculateAccumulatedPrecipitation(0, whiteBars, hours)).toBe(1.5);
    expect(calculateAccumulatedPrecipitation(1, whiteBars, hours)).toBe(1.5);
    expect(calculateAccumulatedPrecipitation(2, whiteBars, hours)).toBeNull();
    expect(calculateAccumulatedPrecipitation(3, whiteBars, hours)).toBeNull();
    expect(calculateAccumulatedPrecipitation(4, whiteBars, hours)).toBe(0.5);
  });
  const ONE_HOUR = 3600 * 1000;
  const t0 = 1726488000000;
  const timestamps = [
    t0,
    t0 + ONE_HOUR,
    t0 + 2 * ONE_HOUR,
    t0 + 3 * ONE_HOUR,
    t0 + 4 * ONE_HOUR,
    t0 + 5 * ONE_HOUR,
    t0 + 7 * ONE_HOUR, // Gap of 2 hours at index 6
    t0 + 8 * ONE_HOUR,
  ];

  it("returns null for null, negative, or out of bounds index", () => {
    expect(
      calculateAccumulatedPrecipitation(null, [1, 2], timestamps),
    ).toBeNull();
    expect(
      calculateAccumulatedPrecipitation(-1, [1, 2], timestamps),
    ).toBeNull();
    expect(
      calculateAccumulatedPrecipitation(10, [1, 2], timestamps),
    ).toBeNull();
  });

  it("returns null for dry hours (0 or negative or NaN)", () => {
    expect(
      calculateAccumulatedPrecipitation(0, [0, 2, 3], timestamps),
    ).toBeNull();
    expect(
      calculateAccumulatedPrecipitation(0, [-1, 2, 3], timestamps),
    ).toBeNull();
    expect(
      calculateAccumulatedPrecipitation(0, [NaN, 2, 3], timestamps),
    ).toBeNull();
    expect(
      calculateAccumulatedPrecipitation(0, [null, 2, 3], timestamps),
    ).toBeNull();
  });

  it("sums contiguous wet hours in both directions", () => {
    // Indices: 0: 0mm, 1: 1.5mm, 2: 2.0mm, 3: 0.5mm, 4: 0mm, 5: 3.0mm
    const precip = [0, 1.5, 2.0, 0.5, 0, 3.0, 1.0, 1.0];
    // Hovering index 2: 1.5 + 2.0 + 0.5 = 4.0
    expect(
      calculateAccumulatedPrecipitation(2, precip, timestamps),
    ).toBeCloseTo(4.0);
    // Hovering index 1: 1.5 + 2.0 + 0.5 = 4.0
    expect(
      calculateAccumulatedPrecipitation(1, precip, timestamps),
    ).toBeCloseTo(4.0);
    // Hovering index 3: 1.5 + 2.0 + 0.5 = 4.0
    expect(
      calculateAccumulatedPrecipitation(3, precip, timestamps),
    ).toBeCloseTo(4.0);
    // Hovering index 5: isolated wet hour = 3.0
    expect(
      calculateAccumulatedPrecipitation(5, precip, timestamps),
    ).toBeCloseTo(3.0);
  });

  it("stops scanning when a timestamp gap exceeds 1 hour", () => {
    // Gap is between index 5 and 6 (2 hours)
    const precip = [0, 0, 0, 0, 0, 2.0, 3.0, 1.0];
    // Hovering index 6: 3.0 + 1.0 = 4.0 (should not include index 5 because of gap)
    expect(
      calculateAccumulatedPrecipitation(6, precip, timestamps),
    ).toBeCloseTo(4.0);
    // Hovering index 5: should only be 2.0 because forward gap stops at index 6
    expect(
      calculateAccumulatedPrecipitation(5, precip, timestamps),
    ).toBeCloseTo(2.0);
  });
});
