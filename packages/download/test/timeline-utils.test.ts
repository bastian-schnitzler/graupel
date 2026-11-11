// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Timeline helpers (the pixel scale belongs to the meteogram).
import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  buildHourlyTimeline,
  canonicalTimestamp,
  findNearestTimestamp,
  findTimestampAtOrBefore,
  getBoundaryTimestamp,
  getZonedDateParts,
  indexByTimestamp,
  normalizeTimestamp,
  normalizeTimestampValues,
  uniqueSortedTimestamps,
  validateTimestampSequence,
} from "../src/index";

describe("timeline utilities", () => {
  it("normalizes explicit offsets and timezone-less values to stable UTC instants", () => {
    expect(normalizeTimestamp("2026-09-14T15:00:00+02:00")).toBe(normalizeTimestamp("2026-09-14T13:00:00Z"));
    expect(canonicalTimestamp("2026-09-14T15:00")).toBe("2026-09-14T15:00:00Z");
    expect(normalizeTimestamp("2026-09-14")).toBe(Date.UTC(2026, 8, 14));
    expect(normalizeTimestamp(new Date(Date.UTC(2026, 8, 14, 15)))).toBe(Date.UTC(2026, 8, 14, 15));
  });

  it("detects a missing hour in differently spaced data", () => {
    const anomalies = validateTimestampSequence(["2026-09-14T00:00Z", "2026-09-14T01:00Z", "2026-09-14T03:00Z"]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.actualMs).toBe(2 * HOUR_MS);
    expect(validateTimestampSequence(["2026-09-14T00:00Z", "2026-09-14T03:00Z"], null)).toEqual([]);
  });

  it("computes boundaries without drift", () => {
    const start = "2026-09-14T01:00Z";
    expect(getBoundaryTimestamp(start, 120)).toBe(normalizeTimestamp(start) + 120 * HOUR_MS);
    expect(() => getBoundaryTimestamp(start, Number.POSITIVE_INFINITY)).toThrow(/Invalid horizon/);
  });

  it("builds half-open windows and selects nearest timestamps without index assumptions", () => {
    const timestamps = buildHourlyTimeline("2026-09-14T00:00Z", "2026-09-14T03:00Z");
    expect(timestamps).toEqual([
      normalizeTimestamp("2026-09-14T00:00Z"),
      normalizeTimestamp("2026-09-14T01:00Z"),
      normalizeTimestamp("2026-09-14T02:00Z"),
    ]);
    expect(buildHourlyTimeline("2026-09-14T03:00Z", "2026-09-14T03:00Z")).toEqual([]);
    expect(findNearestTimestamp(timestamps, normalizeTimestamp("2026-09-14T01:29Z"))).toBe(
      normalizeTimestamp("2026-09-14T01:00Z"),
    );
    expect(findTimestampAtOrBefore(timestamps, normalizeTimestamp("2026-09-14T01:59Z"))).toBe(
      normalizeTimestamp("2026-09-14T01:00Z"),
    );
    expect(findNearestTimestamp([], 0)).toBeNull();
    expect(findTimestampAtOrBefore([], 0)).toBeNull();
  });

  it("deduplicates, sorts and indexes timestamps", () => {
    expect(uniqueSortedTimestamps(["2026-09-14T01:00Z", "2026-09-14T03:00+02:00", "2026-09-14T00:00Z"])).toEqual([
      normalizeTimestamp("2026-09-14T00:00Z"),
      normalizeTimestamp("2026-09-14T01:00Z"),
    ]);
    const index = indexByTimestamp([
      { timestamp: "2026-09-14T01:00Z", value: 2 },
      { timestamp: "2026-09-14T00:00Z", value: 1 },
    ]);
    expect([...index.keys()]).toEqual([normalizeTimestamp("2026-09-14T00:00Z"), normalizeTimestamp("2026-09-14T01:00Z")]);
    expect(() =>
      indexByTimestamp([
        { timestamp: "2026-09-14T01:00Z" },
        { timestamp: "2026-09-14T03:00+02:00" },
      ]),
    ).toThrow(/strictly increasing/);
    expect(normalizeTimestampValues(["2026-09-14T15:00"], "Europe/Berlin")).toEqual(["2026-09-14T13:00:00Z"]);
  });

  it("splits an instant into calendar parts of a timezone", () => {
    expect(getZonedDateParts("2026-09-14T22:30Z", "Europe/Berlin")).toEqual({
      year: "2026",
      month: "09",
      day: "15",
      hour: "00",
      minute: "30",
      weekday: "Tue",
      dayKey: "2026-09-15",
    });
    expect(getZonedDateParts("2026-09-14T22:30Z", "auto").dayKey).toBe("2026-09-14");
    expect(getZonedDateParts("2026-09-14T22:30Z", "Nowhere/City").hour).toBe("22");
  });
});
