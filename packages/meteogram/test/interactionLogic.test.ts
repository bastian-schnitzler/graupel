// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/** Hover and zoom logic of the controller, without a DOM. */
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "../src/core/timeline";
import { calculateZoomedTimeRange } from "../src/core/zoom";
import {
  buildHoverInfo,
  calculatePopupPosition,
  formatModelRunTime,
  hoverAtPointer,
  hoverAtTime,
} from "../src/interaction/hover";
import { cursorShiftAfterZoom, wheelDirection, zoomStep } from "../src/interaction/zoom";
import { createMeteogramScene } from "../src/render/scene";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const POWER_START = Date.UTC(2026, 9, 15, 0);
const scene = createMeteogramScene(powerInput, powerOptions);

describe("hoverAtPointer", () => {
  const rect = { left: 100, width: 500 };

  it("maps the pointer through the rendered width to the timeline", () => {
    // 300 px of 500 = viewBox x 400.
    const position = hoverAtPointer(scene, 100 + 200, rect)!;
    expect(position.time).toBeCloseTo(scene.timeline.xToTimestamp(400, true));
    expect(position.timestamp).not.toBeNull();
    expect(position.timestamp!).toBeLessThanOrEqual(position.time);
    expect(position.time - position.timestamp!).toBeLessThan(HOUR_MS);
    expect(scene.timestamps).toContain(position.timestamp);
  });

  it("ignores the left and right padding and an unmeasured chart", () => {
    // viewBox x < 50 and > 950.
    expect(hoverAtPointer(scene, 100 + 20, rect)).toBeNull();
    expect(hoverAtPointer(scene, 100 + 490, rect)).toBeNull();
    expect(hoverAtPointer(scene, 300, { left: 0, width: 0 })).toBeNull();
  });
});

describe("buildHoverInfo", () => {
  it("collects values, wet-spell sums, LPI and the run of the hovered hour", () => {
    // Hour 13: rain from hour 10 to 15, LPI 4 J/kg, first ICON-D2 run.
    const hour13 = POWER_START + 13 * HOUR_MS;
    const info = buildHoverInfo(scene, hoverAtTime(scene, hour13 + 10 * 60_000), powerInput);
    expect(info.timestamp).toBe(hour13);
    expect(info.data?.["temperature"]?.value).toBeTypeOf("number");
    expect(info.model).toBe("ICON-D2");
    // 0.4 + (h % 4) * 0.6 for h = 10..15.
    const rain = [10, 11, 12, 13, 14, 15].reduce(
      (sum, h) => sum + Math.round((0.4 + (h % 4) * 0.6) * 10) / 10,
      0,
    );
    expect(info.accumulatedPrecip).toBeCloseTo(rain);
    expect(info.accumulatedSnowfall).toBeNull();
    expect(info.lpiValue).toBe(4);
    expect(info.runInfo).toBe("Run 15.10. 02:00 + 48h");
    expect(info.dateParts).toEqual({ hour: "15", minute: "00" });
    expect(info.x).toBeCloseTo(scene.getX(hour13 + 10 * 60_000));
  });

  it("sums snowfall only in wet, snowy hours", () => {
    const info = buildHoverInfo(scene, hoverAtTime(scene, POWER_START + 47 * HOUR_MS), powerInput);
    // Snowfall 0.3 * (h - 45) at h = 46..48.
    expect(info.accumulatedSnowfall).toBeCloseTo(0.3 + 0.6 + 0.9);
    expect(info.runInfo).toBeNull();
  });
});

describe("calculatePopupPosition", () => {
  const base = {
    container: { left: 100, top: 200, width: 1000, height: 500 },
    svg: { left: 100, top: 200, width: 1000, height: 500 },
    popup: { width: 200, height: 150 },
    hoverX: 100,
    svgWidth: 1000,
    dayHeaderBottom: 44,
    totalSvgHeight: 500,
  };

  it("pins the popup to the side opposite the cursor, below the day header", () => {
    // Cursor left of the middle: right border, 1100 - 200 - 12.
    expect(calculatePopupPosition({ ...base, clientX: 300 })).toEqual({ top: 248, left: 888 });
    // Cursor right of the middle: left border, 100 + 12.
    expect(calculatePopupPosition({ ...base, clientX: 900 })).toEqual({ top: 248, left: 112 });
  });

  it("uses the cursor line without a pointer and shifts up to stay inside", () => {
    // hoverX 100 of 1000 -> client 200, left half.
    expect(calculatePopupPosition({ ...base, clientX: null }).left).toBe(888);
    const tall = calculatePopupPosition({ ...base, clientX: 300, popup: { width: 200, height: 460 } });
    // 700 - 12 - 460 = 228 is above the preferred 248.
    expect(tall.top).toBe(228);
  });
});

describe("zoomStep", () => {
  it("zooms in around the hover time and back out to the maximum range", () => {
    const anchor = (scene.timeline.startMs + scene.timeline.endMs) / 2 + 5 * HOUR_MS;
    const zoomedIn = zoomStep(scene, "in", anchor)!;
    expect(zoomedIn).toEqual(
      calculateZoomedTimeRange({
        range: { start: scene.timeline.startMs, end: scene.timeline.endMs },
        maximumRange: scene.maximumRange!,
        hoverTime: anchor,
        direction: "in",
      }),
    );
    expect(zoomedIn.end - zoomedIn.start).toBeLessThan(scene.timeline.endMs - scene.timeline.startMs);
    expect(zoomedIn.start).toBeLessThan(anchor);
    expect(zoomedIn.end).toBeGreaterThan(anchor);
    // Fully zoomed out: nothing to do.
    expect(zoomStep(scene, "out", anchor)).toBeNull();
  });

  it("ignores a hover time outside the visible range", () => {
    const zoomed = zoomStep(scene, "in", scene.timeline.endMs + HOUR_MS)!;
    expect(zoomed.start).toBe(scene.timeline.startMs);
  });

  it("reads the wheel direction", () => {
    expect(wheelDirection({ deltaY: -3, deltaMode: 1 })).toBe("in");
    expect(wheelDirection({ deltaY: 100, deltaMode: 0 })).toBe("out");
    expect(wheelDirection({ deltaY: 0, deltaMode: 0 })).toBeNull();
  });

  it("computes how far the cursor line moves on screen", () => {
    const anchor = scene.timeline.startMs + 0.25 * (scene.timeline.endMs - scene.timeline.startMs);
    const next = zoomStep(scene, "in", anchor)!;
    const shift = cursorShiftAfterZoom(scene, next, anchor, 500);
    const zoomedScene = createMeteogramScene(powerInput, { ...powerOptions, visibleRange: next });
    expect(shift).toBeCloseTo(
      ((zoomedScene.getX(anchor) - scene.getX(anchor)) / scene.svgWidth) * 500,
    );
  });
});

describe("formatModelRunTime", () => {
  it("formats a run start in the chart's time zone", () => {
    expect(formatModelRunTime("2026-10-06T06:00:00Z", "Europe/Berlin")).toBe("06.10. 08:00");
    expect(formatModelRunTime("not a date")).toBeNull();
    expect(formatModelRunTime(null)).toBeNull();
  });
});
