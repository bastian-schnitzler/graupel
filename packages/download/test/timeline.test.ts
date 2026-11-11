// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Hourly timeline.
import { afterEach, describe, expect, it } from "vitest";
import {
  HOUR_MS,
  TimelineIntegrityError,
  buildHourlyTimeline,
  canonicalTimestamp,
  canonicalTimestampKey,
  getUserTimezone,
  modelEndTimestamp,
  normalizeTimestamp,
  resolveTimezone,
  validateTimestampSequence,
} from "../src/index";

describe("timeline (test_timeline.py)", () => {
  it("gives equivalent offsets one canonical instant", () => {
    const utc = "2026-09-14T13:00:00Z";
    const berlin = "2026-09-14T15:00:00+02:00";

    expect(canonicalTimestamp(berlin)).toBe(utc);
    expect(canonicalTimestampKey(berlin)).toBe(canonicalTimestampKey(utc));
  });

  it("reads timezone-less values in the explicit default timezone", () => {
    expect(canonicalTimestamp("2026-09-14T15:00", "Europe/Berlin")).toBe("2026-09-14T13:00:00Z");
  });

  it("rejects duplicate or reversed timestamps", () => {
    expect(() => validateTimestampSequence(["2026-09-14T14:00Z", "2026-09-14T14:00Z"])).toThrow(
      TimelineIntegrityError,
    );
    expect(() => validateTimestampSequence(["2026-09-14T14:00Z", "2026-09-14T14:00Z"])).toThrow(
      /strictly increasing/,
    );
    expect(() => validateTimestampSequence(["2026-09-14T15:00Z", "2026-09-14T14:00Z"])).toThrow(
      /strictly increasing/,
    );
  });

  it("reports a missing hour without shifting the later timestamp", () => {
    const timestamps = ["2026-09-14T14:00Z", "2026-09-14T16:00Z"];

    const anomalies = validateTimestampSequence(timestamps);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.actualMs).toBe(2 * HOUR_MS);
    expect(anomalies[0]?.expectedMs).toBe(HOUR_MS);
    expect(canonicalTimestamp(timestamps[1] as string)).toBe("2026-09-14T16:00:00Z");
  });

  it("builds half-open hourly windows and model horizons", () => {
    const start = "2026-09-14T00:00Z";
    const end = modelEndTimestamp(start, 3);

    expect(end).toBe("2026-09-14T03:00:00Z");
    expect(buildHourlyTimeline(start, end).map((ms) => canonicalTimestamp(ms))).toEqual([
      "2026-09-14T00:00:00Z",
      "2026-09-14T01:00:00Z",
      "2026-09-14T02:00:00Z",
    ]);
  });

  it("keeps DST fallback instants strictly hourly in UTC", () => {
    // The local clock reads 02:30 twice on this date, but the explicit offsets
    // preserve two different instants separated by one real hour.
    const timestamps = ["2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00"];

    expect(validateTimestampSequence(timestamps, HOUR_MS)).toEqual([]);
  });

  it.each(["GMT", "gmt", "UTC", "utc", "Etc/UTC", "etc/utc", "Etc/GMT", "etc/gmt", "Z", "z", " UTC ", "\tgmt\n"])(
    "resolves the UTC alias %j to UTC",
    (alias) => {
      expect(resolveTimezone(alias)).toBe("UTC");
    },
  );

  it("resolves an IANA timezone", () => {
    const resolved = resolveTimezone("Europe/Berlin");
    expect(resolved).toBe("Europe/Berlin");
    // 2026-07-01 12:00 local is 10:00 UTC: offset +02:00 in summer.
    expect(canonicalTimestamp("2026-07-01T12:00:00", resolved)).toBe("2026-07-01T10:00:00Z");
  });

  it.each(["Invalid/Timezone", "Europ/Berlin", "foo", "", "   "])(
    "rejects the invalid timezone %j",
    (invalid) => {
      expect(() => resolveTimezone(invalid)).toThrow(TimelineIntegrityError);
      expect(() => resolveTimezone(invalid)).toThrow(/Invalid/);
    },
  );

  it.each(["GMT", "UTC", "Etc/UTC", "Etc/GMT"])("reads naive timestamps in %s as UTC", (tz) => {
    const naive = "2026-09-14T12:00:00";
    expect(canonicalTimestamp(naive, tz)).toBe("2026-09-14T12:00:00Z");
    expect(normalizeTimestamp(naive, tz)).toBe(Date.UTC(2026, 8, 14, 12, 0, 0));
  });

  it("never overrides explicit UTC or offsets with the default timezone", () => {
    const tsZ = "2026-09-14T12:00:00Z";
    const tsOffsetZero = "2026-09-14T12:00:00+00:00";
    const tsOffsetPlus2 = "2026-09-14T14:00:00+02:00";

    expect(canonicalTimestamp(tsZ, "America/New_York")).toBe("2026-09-14T12:00:00Z");
    expect(canonicalTimestamp(tsOffsetZero, "Europe/Berlin")).toBe("2026-09-14T12:00:00Z");
    expect(canonicalTimestamp(tsOffsetPlus2, "UTC")).toBe("2026-09-14T12:00:00Z");

    expect(normalizeTimestamp(tsOffsetPlus2)).toBe(normalizeTimestamp(tsZ));
  });

  describe("user timezone", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it("derives a valid timezone and follows the TZ environment in Node", () => {
      const name = getUserTimezone();
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      expect(resolveTimezone(name)).toBe(name);

      process.env.TZ = "America/New_York";
      expect(getUserTimezone()).toBe("America/New_York");

      process.env.TZ = "Asia/Tokyo";
      expect(getUserTimezone()).toBe("Asia/Tokyo");
    });
  });
});

describe("timeline (additional cases)", () => {
  it("resolves ambiguous local times to the earlier instant and skipped ones forward", () => {
    // Europe/Berlin: 2026-10-25 02:30 occurs twice, 2026-03-29 02:30 does not exist.
    expect(canonicalTimestamp("2026-10-25T02:30", "Europe/Berlin")).toBe("2026-10-25T00:30:00Z");
    expect(canonicalTimestamp("2026-03-29T02:30", "Europe/Berlin")).toBe("2026-03-29T01:30:00Z");
    // Midnight of the day before a DST change.
    expect(canonicalTimestamp("2026-10-24", "Europe/Berlin")).toBe("2026-10-23T22:00:00Z");
    expect(canonicalTimestamp("2026-10-26", "Europe/Berlin")).toBe("2026-10-25T23:00:00Z");
  });

  it("rejects malformed timestamps", () => {
    for (const value of ["", "yesterday", "2026-13-01T00:00", "2026-02-30", "2026-09-14T24:00"]) {
      expect(() => normalizeTimestamp(value)).toThrow(TimelineIntegrityError);
    }
    expect(() => normalizeTimestamp(Number.NaN)).toThrow(TimelineIntegrityError);
    expect(() => normalizeTimestamp(new Date(Number.NaN))).toThrow(TimelineIntegrityError);
  });

  it("keeps non-zero milliseconds in canonical timestamps", () => {
    expect(canonicalTimestamp("2026-09-14T12:00:00.250Z")).toBe("2026-09-14T12:00:00.250Z");
  });
});
