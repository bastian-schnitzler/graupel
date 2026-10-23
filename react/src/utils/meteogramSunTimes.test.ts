import { describe, expect, it } from "vitest";
import { calculateSunTimeLabels } from "./meteogramSunTimes";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 19); // UTC midnight, timezone UTC

// 7 days, sunrise 06:30, sunset 18:15.
const sunPhases = Array.from({ length: 7 }, (_, i) => ({
  day: new Date(START + i * DAY).toISOString().slice(0, 10),
  sunrise: new Date(START + i * DAY + 6.5 * HOUR).toISOString(),
  sunset: new Date(START + i * DAY + 18.25 * HOUR).toISOString(),
}));

const base = (startMs: number, endMs: number) => ({
  sunPhases,
  startMs,
  endMs,
  timeZone: "UTC",
  // 100 units per day from the start of the visible range.
  getX: (ts: number) => ((ts - startMs) / DAY) * 100,
  top: 0,
  bottom: 100,
});

const summary = (labels: ReturnType<typeof calculateSunTimeLabels>) =>
  labels.map((l) => `${l.dayKey} ${l.kind} ${l.text}`);

describe("sunrise / sunset labels (spec §16.8, #171)", () => {
  it("labels only the first and the last complete day", () => {
    // From 12:00 on day 0 to 12:00 on day 5: complete days 1..4.
    const labels = calculateSunTimeLabels(base(START + 12 * HOUR, START + 5 * DAY + 12 * HOUR));
    expect(summary(labels)).toEqual([
      "2026-10-20 sunrise 06:30",
      "2026-10-20 sunset 18:15",
      "2026-10-23 sunrise 06:30",
      "2026-10-23 sunset 18:15",
    ]);
    const sunrise = labels[0];
    // At the instant: 06:30 on day 1 = 50 + 27.08 units; top / bottom edge.
    expect(sunrise.x).toBeCloseTo(50 + 6.5 / 24 * 100, 5);
    expect(sunrise.y).toBeLessThan(15);
    expect(labels[1].y).toBeGreaterThan(90);
  });

  it("follows the visible range", () => {
    const zoomed = calculateSunTimeLabels(base(START + 2 * DAY, START + 4 * DAY));
    expect(summary(zoomed).map((s) => s.slice(0, 10))).toEqual([
      "2026-10-21", "2026-10-21", "2026-10-22", "2026-10-22",
    ]);
    // One complete day: labelled once.
    const single = calculateSunTimeLabels(base(START + DAY, START + 2 * DAY));
    expect(summary(single)).toEqual([
      "2026-10-20 sunrise 06:30",
      "2026-10-20 sunset 18:15",
    ]);
    // No complete day, no data.
    expect(calculateSunTimeLabels(base(START + 3 * HOUR, START + DAY + 3 * HOUR))).toEqual([]);
    expect(calculateSunTimeLabels({ ...base(START, START + 3 * DAY), sunPhases: [] })).toEqual([]);
  });

  it("never leaves a label out: a narrow day centres it", () => {
    // 16 visible days in 100 units: each day is 6.25 units, narrower than
    // the text, so the labels sit in the middle of their day.
    const range = {
      ...base(START, START + 7 * DAY),
      getX: (ts: number) => ((ts - START) / (16 * DAY)) * 100,
    };
    const labels = calculateSunTimeLabels(range);
    expect(labels).toHaveLength(4);
    expect(labels[0].x).toBeCloseTo(6.25 / 2, 5);
    expect(labels[1].x).toBeCloseTo(6.25 / 2, 5);
  });
});
