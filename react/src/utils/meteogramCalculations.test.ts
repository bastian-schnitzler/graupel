import { describe, it, expect } from "vitest";
import { calculateAccumulatedPrecipitation } from "./meteogramCalculations";

describe("calculateAccumulatedPrecipitation", () => {
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
