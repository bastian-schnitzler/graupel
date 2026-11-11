// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import {
  calculateWindIcons,
  getWindDirectionAtTime,
  HOUR_MS,
  interpolateWindDirection,
} from "../src";

describe("circular wind direction interpolation", () => {
  it("interpolates 0° and 90° at 0%, 25%, 50%, 75%, 100%", () => {
    expect(interpolateWindDirection(0, 90, 1.0, 0.0)).toBe(0);
    expect(interpolateWindDirection(0, 90, 0.75, 0.25)).toBeCloseTo(18.43, 1);
    expect(interpolateWindDirection(0, 90, 0.5, 0.5)).toBeCloseTo(45, 1);
    expect(interpolateWindDirection(0, 90, 0.25, 0.75)).toBeCloseTo(71.57, 1);
    expect(interpolateWindDirection(0, 90, 0.0, 1.0)).toBe(90);
  });

  it("handles wraparound across 0° / 360°", () => {
    expect(interpolateWindDirection(350, 10, 0.5, 0.5)).toBe(0);
    expect(interpolateWindDirection(10, 350, 0.5, 0.5)).toBe(0);
    expect(interpolateWindDirection(359, 1, 0.5, 0.5)).toBe(0);
    expect(interpolateWindDirection(1, 359, 0.5, 0.5)).toBe(0);

    const w355 = interpolateWindDirection(350, 10, 0.75, 0.25);
    expect(w355).toBeGreaterThan(350);
    expect(w355).toBeLessThan(360);

    const w5 = interpolateWindDirection(350, 10, 0.25, 0.75);
    expect(w5).toBeGreaterThan(0);
    expect(w5).toBeLessThan(10);
  });
});

describe("wind direction along the timeline", () => {
  const samples = [
    { timeMs: 0, direction: 0, model: "A" },
    { timeMs: HOUR_MS, direction: 90, model: "A" },
    { timeMs: 2 * HOUR_MS, direction: 180, model: "B" },
  ];

  it("interpolates inside one model and never across a handover", () => {
    expect(getWindDirectionAtTime(samples, HOUR_MS / 2)).toBeCloseTo(45, 5);
    expect(getWindDirectionAtTime(samples, 1.5 * HOUR_MS)).toBe(90);
    expect(getWindDirectionAtTime(samples, 2 * HOUR_MS)).toBe(180);
  });

  it("holds the edge values outside the samples", () => {
    expect(getWindDirectionAtTime([], 0)).toBeNull();
    expect(getWindDirectionAtTime(samples, -HOUR_MS)).toBe(0);
    expect(getWindDirectionAtTime(samples, 5 * HOUR_MS)).toBe(180);
  });

  it("places one arrow per slot, pointing downwind", () => {
    const icons = calculateWindIcons(
      [{ id: "d-0", center: HOUR_MS / 2 }],
      samples,
      (ts) => ts / HOUR_MS,
    );
    expect(icons).toEqual([
      {
        id: "wind-arrow-d-0",
        x: 0.5,
        timestamp: "1970-01-01T00:30:00.000Z",
        dir: 45,
        arrowAngle: 225,
      },
    ]);
  });
});
