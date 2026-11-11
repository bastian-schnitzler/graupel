// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, it, expect } from 'vitest';
import {
  buildSvgLinePath,
  buildPrecipitationProbabilityPath,
  calculateDaylightSpans,
  calculateNoonPositions,
  calculateModelSliceEnds,
  buildScaledLinePath,
  anchoredDashPieces,
  dashAnchorHours,
  dashPatternPeriod,
  splitDashedPath,
  DASH_PERIODS_PER_ANCHOR,
  DEFAULT_SERIES_DASH_ARRAY,
  PAIRED_SERIES_DASH_ARRAY,
  type DashPiece,
  findCurveMarkers,
  findCurveStarts,
  findCurveStops,
  CURVE_STOP_HALF_HEIGHT,
} from "../src";
import { createTimelineScale } from "../src";

describe('meteogramPaths', () => {
  it('buildSvgLinePath handles continuous lines and null gaps', () => {
    const values = [10, 20, null, 15];
    const timestamps = [0, 1, 2, 3];
    const getX = (t: number | string) => Number(t) * 10;

    const path = buildSvgLinePath(values, 0, 30, 0, 100, timestamps, getX, 0, 0);
    expect(path).toBe('M 0.0 66.7 L 10.0 33.3M 30.0 50.0');
  });

  it('buildPrecipitationProbabilityPath handles clamped values and gaps', () => {
    const values = [20, 80, null, 100];
    const timestamps = [0, 1, 2, 3];
    const getX = (t: number | string) => Number(t) * 10;

    const path = buildPrecipitationProbabilityPath(values, timestamps, 200, 100, getX);
    expect(path).toContain('M 0 180');
    expect(path).toContain('L 10 120');
    expect(path).toContain('M 30 100');
  });

  it('calculateDaylightSpans clamps spans to timeline bounds', () => {
    const timeline = createTimelineScale(1000, 5000, 0, 100);
    const sunPhases = [
      { day: '2026-09-16', sunrise: '1970-01-01T00:00:02.000Z', sunset: '1970-01-01T00:00:04.000Z' },
    ];

    const spans = calculateDaylightSpans(sunPhases, timeline);
    expect(spans.length).toBe(1);
    expect(spans[0].dayKey).toBe('2026-09-16');
    expect(spans[0].x).toBe(25);
    expect(spans[0].width).toBe(50);
  });

  it('calculateNoonPositions finds 12:00 timestamp for day groups', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const noonMs = Date.parse('2026-09-16T12:00:00Z');
    const endMs = Date.parse('2026-09-16T23:00:00Z');
    const timestamps = [startMs, noonMs, endMs];
    const timeline = createTimelineScale(startMs, endMs, 0, 100);
    const visibleDayGroups = [{ dayKey: '2026-09-16', indices: [0, 1, 2] }];

    const noons = calculateNoonPositions(visibleDayGroups, timestamps, 'UTC', timeline);
    expect(noons.length).toBe(1);
    expect(noons[0].dayKey).toBe('2026-09-16');
  });

  describe('curve stops', () => {
    const H = 3_600_000;
    const ts = [0, 1, 2, 3, 4, 5].map((h) => h * H);
    // Model A covers [0h, 3h), model B [3h, 6h); B has a 0h-span neighbour.
    const sliceEnds = calculateModelSliceEnds(
      [
        { max_forecast_horizon_hours: 3 },
        { max_forecast_horizon_hours: 3 },
        { max_forecast_horizon_hours: 6 },
      ],
      0,
    );

    it('calculateModelSliceEnds skips 0h-span models', () => {
      expect(sliceEnds).toEqual([3 * H, 6 * H]);
    });

    it('marks a curve ending before its model slice ends', () => {
      expect([...findCurveStops([1, 2, null, 4, 5, 6], ts, sliceEnds)]).toEqual([1]);
    });

    it('ignores ends at a slice boundary and at the timeline end', () => {
      expect(findCurveStops([1, 2, 3, null, null, null], ts, sliceEnds).size).toBe(0);
      expect(findCurveStops([1, 2, 3, 4, 5, 6], ts, sliceEnds).size).toBe(0);
      // Beyond the chain no model covers the next hour.
      expect(findCurveStops([1, 2, null], ts.slice(0, 3), [2 * H]).size).toBe(0);
    });

    it('marks a curve resuming after a gap, not at the timeline start', () => {
      expect([...findCurveStarts([1, 2, null, 4, 5, 6])]).toEqual([3]);
      expect(findCurveStarts([1, 2, 3, 4, 5, 6]).size).toBe(0);
      expect(findCurveStarts([null, null, 3, 4]).size).toBe(1);
      expect(findCurveStarts([3, 4, 5]).size).toBe(0);
      // Stop before and start after the gap.
      expect([...findCurveMarkers([1, 2, null, 4, 5, 6], ts, sliceEnds)].sort()).toEqual([1, 3]);
      // Resuming in the next model slice after an early stop.
      expect([...findCurveMarkers([1, null, null, 4, 5, 6], ts, sliceEnds)].sort()).toEqual([0, 3]);
    });

    it('draws a start bar and continues the curve from it', () => {
      const getX = (t: number | string) => (Number(t) / H) * 10;
      const path = buildScaledLinePath(
        [null, 5, 6], ts.slice(0, 3), getX, (v: number) => v, new Set([1]),
      );
      expect(path).toBe(
        `M 10 5 M 10 ${5 - CURVE_STOP_HALF_HEIGHT} L 10 ${5 + CURVE_STOP_HALF_HEIGHT} M 10 5 L 20 6`,
      );
    });

    it('appends a short vertical bar at the stop', () => {
      const getX = (t: number | string) => (Number(t) / H) * 10;
      const path = buildSvgLinePath(
        [0, 10, null, 0, 0, 0], 0, 20, 0, 100, ts, getX, 0, 0, new Set([1]),
      );
      expect(path).toBe(
        `M 0.0 100.0 L 10.0 50.0 M 10.0 ${(50 - CURVE_STOP_HALF_HEIGHT).toFixed(1)} ` +
          `L 10.0 ${(50 + CURVE_STOP_HALF_HEIGHT).toFixed(1)}M 30.0 100.0 L 40.0 100.0 L 50.0 100.0`,
      );
      const prob = buildPrecipitationProbabilityPath(
        [20, 50, null], ts.slice(0, 3), 200, 100, getX, new Set([1]),
      );
      expect(prob).toBe(`M 0 180 L 10 150 M 10 ${150 - CURVE_STOP_HALF_HEIGHT} L 10 ${150 + CURVE_STOP_HALF_HEIGHT}`);
    });
  });

  describe('dashed lines in anchored pieces (REQ-572, REQ-579)', () => {
    const H = 3_600_000;
    // Starts at 05:00 UTC, between two anchors.
    const START = Date.UTC(2026, 9, 30, 5);
    const HOURS = 72;
    const timestamps = Array.from({ length: HOURS }, (_, hour) => START + hour * H);
    // As on the phone: an hour is 2.5 units wide, shorter than one period of "2 2".
    const HOUR_WIDTH = 2.5;
    const PERIOD = 4;
    const timeline = createTimelineScale(START, START + HOURS * H, 50, 50 + HOURS * HOUR_WIDTH);
    const getX = (t: number | string) => timeline.timestampToX(t);
    // Steep and flat parts, like the curve of the report.
    const lively = (hour: number) =>
      Math.round((-6 + 5 * Math.sin(hour / 4) + 2.5 * Math.sin(hour / 1.6) + (hour % 24 < 5 ? -2 : 0)) * 10) / 10;
    const pathOf = (values: (number | null)[]) =>
      buildSvgLinePath(values, -20, 5, 0, 200, timestamps, getX);
    const piecesOf = (values: (number | null)[]) =>
      anchoredDashPieces(pathOf(values), PAIRED_SERIES_DASH_ARRAY, HOUR_WIDTH, timeline.xToTimestamp)!;
    const vertices = (d: string) => [...d.matchAll(/[ML] (\S+) (\S+)/g)].map(([, x, y]) => [Number(x), Number(y)] as const);
    const lengthOf = (d: string) =>
      vertices(d).reduce((length, [x, y], index, all) =>
        index === 0 ? 0 : length + Math.hypot(x - all[index - 1]![0], y - all[index - 1]![1]), 0);
    const hourOf = (x: number) => Math.round(timeline.xToTimestamp(x) / H);

    it('reads the period of a dash pattern and picks the anchor distance from the hour width', () => {
      expect(dashPatternPeriod(PAIRED_SERIES_DASH_ARRAY)).toBe(4);
      expect(dashPatternPeriod(DEFAULT_SERIES_DASH_ARRAY)).toBe(6);
      expect(dashPatternPeriod('3')).toBe(6);
      expect(dashPatternPeriod('1, 2')).toBe(3);
      expect(dashPatternPeriod('')).toBeNull();
      expect(dashPatternPeriod('none')).toBeNull();
      expect(DASH_PERIODS_PER_ANCHOR).toBe(4);
      // Phone (2.5 units per hour), desktop (2.3), a three-day chart (12.5), zoomed in (30).
      expect(dashAnchorHours(2.5, 4)).toBe(8);
      expect(dashAnchorHours(2.3, 4)).toBe(8);
      expect(dashAnchorHours(2.3, 6)).toBe(12);
      expect(dashAnchorHours(12.5, 4)).toBe(2);
      expect(dashAnchorHours(30, 4)).toBe(1);
      // Very long charts: whole days.
      expect(dashAnchorHours(0.1, 4)).toBe(168);
      expect(dashAnchorHours(0, 4)).toBe(24);
    });

    it('fits whole dash periods between two anchors, stretched only a little, also when an hour is narrower than one period', () => {
      const pieces = piecesOf(timestamps.map((_, hour) => lively(hour)));
      expect(HOUR_WIDTH).toBeLessThan(PERIOD);
      expect(pieces.length).toBeGreaterThan(5);
      for (const piece of pieces) {
        const periods = piece.pathLength / PERIOD;
        expect(Number.isInteger(periods) && periods >= DASH_PERIODS_PER_ANCHOR).toBe(true);
        // Dash and gap take the length of the piece divided by the whole periods, near "2 2".
        const stretch = lengthOf(piece.d) / piece.pathLength;
        expect(Math.abs(stretch - 1)).toBeLessThanOrEqual(1 / (2 * DASH_PERIODS_PER_ANCHOR));
      }
      // The pieces join at anchors: every 8 hours (00, 08, 16 UTC).
      const bounds = pieces.slice(1).map((piece) => hourOf(vertices(piece.d)[0]![0]));
      expect(bounds.every((hour) => hour % 8 === 0)).toBe(true);
      pieces.slice(1).forEach((piece, index) => {
        const previous = vertices(pieces[index]!.d);
        expect(vertices(piece.d)[0]).toEqual(previous[previous.length - 1]);
      });
      // Together they are the whole line.
      const joined = pieces.map((piece, index) => (index === 0 ? piece.d : piece.d.replace(/^M \S+ \S+/, ''))).join('');
      expect(joined).toBe(pathOf(timestamps.map((_, hour) => lively(hour))));
    });

    it('moves only the dashes of the pieces whose data change when a model boundary moves (REQ-572)', () => {
      // Model A until 36 h, then model B, 1.5 degrees warmer; the boundary moves to 30 h.
      const modelB = (hour: number) => lively(hour) + 1.5;
      const before = piecesOf(timestamps.map((_, hour) => (hour < 36 ? lively(hour) : modelB(hour))));
      const after = piecesOf(timestamps.map((_, hour) => (hour < 30 ? lively(hour) : modelB(hour))));
      const key = (piece: DashPiece) => `${piece.pathLength}|${piece.d}`;
      const unchanged = new Set(before.map(key));
      const changed = after.filter((piece) => !unchanged.has(key(piece)));
      // Hours 30 to 35 change: only the pieces 24-32 h and 32-40 h (from the start, 05:00 UTC) contain them.
      expect(changed.map((piece) => vertices(piece.d).map(([x]) => hourOf(x) - hourOf(getX(START))))).toEqual([
        [27, 28, 29, 30, 31, 32, 33, 34, 35],
        [35, 36, 37, 38, 39, 40, 41, 42, 43],
      ]);
      expect(after.length).toBe(before.length);
      expect(after.length - changed.length).toBe(before.length - 2);
    });

    it('keeps the anchors at their time when the window moves', () => {
      const values = timestamps.map((_, hour) => lively(hour));
      const shifted = createTimelineScale(START + 3 * H, START + (HOURS + 3) * H, 50, 50 + HOURS * HOUR_WIDTH);
      const path = buildSvgLinePath(values, -20, 5, 0, 200, timestamps, (t) => shifted.timestampToX(t));
      const moved = anchoredDashPieces(path, PAIRED_SERIES_DASH_ARRAY, HOUR_WIDTH, shifted.xToTimestamp)!;
      const pieces = piecesOf(values);
      const startHours = (list: DashPiece[], scale: typeof timeline) =>
        list.map((piece) => Math.round(scale.xToTimestamp(vertices(piece.d)[0]![0]) / H));
      expect(startHours(moved, shifted)).toEqual(startHours(pieces, timeline));
      expect(moved.map((piece) => piece.pathLength)).toEqual(pieces.map((piece) => piece.pathLength));
    });

    it('splits at gaps, drops single points and leaves a short line in one piece', () => {
      const values: (number | null)[] = timestamps.map((_, hour) => lively(hour));
      values[20] = null;
      values[22] = null;
      const pieces = piecesOf(values);
      // Hour 21 alone draws nothing; no piece crosses the gap.
      expect(pieces.some((piece) => vertices(piece.d).some(([x]) => [20, 21, 22].includes(hourOf(x) - hourOf(getX(START)))))).toBe(false);
      expect(piecesOf(timestamps.map((_, hour) => (hour < 3 ? lively(hour) : null)))).toHaveLength(1);
      // A flat line from 05:00: the start piece up to 08:00 is shorter than four periods and joins the next one.
      const flat = piecesOf(timestamps.map(() => 0));
      expect(new Date(timeline.xToTimestamp(vertices(flat[1]!.d)[0]![0])).toISOString()).toBe('2026-10-30T16:00:00.000Z');
      expect(flat[0]!.pathLength).toBe(7 * PERIOD);
      expect(splitDashedPath('M 0 10 L 12 10', 4, () => 0)).toEqual([{ d: 'M 0 10 L 12 10', pathLength: 12, minX: 0, maxX: 12 }]);
      expect(anchoredDashPieces('M 0 10 L 10 20', 'none', HOUR_WIDTH, timeline.xToTimestamp)).toBeNull();
    });
  });
});
