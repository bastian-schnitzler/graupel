// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import {
  buildDataPointTimeMap,
  buildVerticalCloudMap,
  calculateCloudCellGeometry,
  extractWindDirectionSamples,
  formatTooltipHeaderDate,
  getCardinalDirection,
  getCloudAltitudeY,
  getExtraTooltipQuantities,
  prepareRenderDayGroups,
  type DataPoint,
} from "../src";

const point = (timestamp: string, variable: string, value: number | null): DataPoint => ({
  timestamp,
  variable,
  value,
  unit: "",
  model: "ICON-D2",
});

describe("tooltip logic", () => {
  it("formats cardinal wind directions", () => {
    expect(getCardinalDirection(null)).toBe("-");
    expect(getCardinalDirection(0)).toBe("0° N");
    expect(getCardinalDirection(270)).toBe("270° W");
    expect(getCardinalDirection(350)).toBe("350° N");
    expect(getCardinalDirection(202.5)).toBe("203° SSW");
  });

  it("formats the header date in the location timezone", () => {
    const date = new Date("2026-09-16T23:30:00Z");
    expect(formatTooltipHeaderDate(date, "UTC")).toBe("Wed, 9/16");
    expect(formatTooltipHeaderDate(date, "Europe/Berlin")).toBe("Thu, 9/17");
    expect(formatTooltipHeaderDate(date, "Not/AZone")).toBe("Wed, 9/16");
  });

  it("lists layout quantities without their own popup group", () => {
    expect(getExtraTooltipQuantities(undefined)).toEqual([]);
    expect(
      getExtraTooltipQuantities(new Set(["temperature", "cloud_cover", "cape"])),
    ).toEqual(["cloud_cover"]);
  });
});

describe("cloud profile geometry", () => {
  const area = { top: 100, height: 110 };

  it("maps altitudes into the area with headroom at the top", () => {
    expect(getCloudAltitudeY(area, 10, 0)).toBe(210);
    expect(getCloudAltitudeY(area, 10, 10)).toBe(110);
    expect(getCloudAltitudeY(area, 10, 20)).toBe(110);
  });

  it("sizes a cell between two levels with clamped opacity", () => {
    const toY = (km: number) => getCloudAltitudeY(area, 10, km);
    expect(calculateCloudCellGeometry(50, 1, 2, 10, toY)).toEqual({
      y: 190,
      height: 10,
      opacity: 0.5,
    });
    expect(calculateCloudCellGeometry(0, 1, 1, 10, toY)).toMatchObject({
      height: 1.5,
      opacity: 0.1,
    });
    expect(calculateCloudCellGeometry(100, 1, 2, 10, toY).opacity).toBe(0.95);
  });
});

describe("chart data preparation", () => {
  const data = [
    point("2026-09-16T00:00:00Z", "wind_direction", 90),
    point("2026-09-16T00:00:00Z", "temperature", 12),
    point("2026-09-16T01:00:00Z", "wind_direction", null),
  ];

  it("indexes points by time and quantity", () => {
    const map = buildDataPointTimeMap(data);
    const t0 = Date.parse("2026-09-16T00:00:00Z");
    expect(map.get(t0)?.temperature?.value).toBe(12);
    expect(
      extractWindDirectionSamples([t0, t0 + 3600_000], map),
    ).toEqual([{ timeMs: t0, direction: 90, model: "ICON-D2" }]);
  });

  it("indexes cloud profiles by time", () => {
    expect(buildVerticalCloudMap(null).size).toBe(0);
    const map = buildVerticalCloudMap({
      location: { name: "X", latitude: 0, longitude: 0 },
      profiles: [{ timestamp: "2026-09-16T00:00", source_model_id: "m", levels: [] }],
    });
    expect([...map.keys()]).toEqual([Date.parse("2026-09-16T00:00:00Z")]);
  });

  it("clamps visible days to the plot", () => {
    const hour = 3600_000;
    const start = Date.parse("2026-09-16T00:00:00Z");
    const timestamps = Array.from({ length: 48 }, (_, i) => start + i * hour);
    const dayGroups = [
      { dayKey: "a", indices: timestamps.slice(0, 24).map((_, i) => i) },
      { dayKey: "b", indices: timestamps.slice(24).map((_, i) => i + 24) },
    ];
    const items = prepareRenderDayGroups({
      visibleDayGroups: dayGroups.map((g) => ({ ...g, dateLabel: "", weekdayLabel: "" })),
      dayGroups,
      timestamps,
      getX: (ts) => (Number(ts) - start) / hour,
      outerLeftX: 6,
      outerRightX: 40,
      resolvedTimezone: "UTC",
    });
    expect(items.map(({ dayKey, firstX, rightX, isEven, isBoundaryVisible }) => ({
      dayKey,
      firstX,
      rightX,
      isEven,
      isBoundaryVisible,
    }))).toEqual([
      { dayKey: "a", firstX: 6, rightX: 24, isEven: true, isBoundaryVisible: false },
      { dayKey: "b", firstX: 24, rightX: 40, isEven: false, isBoundaryVisible: true },
    ]);
  });
});
