import { describe, it, expect } from 'vitest';
import {
  buildSvgLinePath,
  buildPrecipitationProbabilityPath,
  calculateDaylightSpans,
  calculateNoonPositions,
  calculateModelSliceEnds,
  buildScaledLinePath,
  findCurveMarkers,
  findCurveStarts,
  findCurveStops,
  CURVE_STOP_HALF_HEIGHT,
} from './meteogramPaths';
import { createTimelineScale } from '../../utils/timeline';

describe('meteogramPaths', () => {
  it('buildSvgLinePath handles continuous lines and null gaps', () => {
    const values = [10, 20, null, 15];
    const timestamps = [0, 1, 2, 3];
    const getX = (t: any) => Number(t) * 10;

    const path = buildSvgLinePath(values, 0, 30, 0, 100, timestamps, getX, 0, 0);
    expect(path).toBe('M 0.0 66.7 L 10.0 33.3M 30.0 50.0');
  });

  it('buildPrecipitationProbabilityPath handles clamped values and gaps', () => {
    const values = [20, 80, null, 100];
    const timestamps = [0, 1, 2, 3];
    const getX = (t: any) => Number(t) * 10;

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
      const getX = (t: any) => (Number(t) / H) * 10;
      const path = buildScaledLinePath(
        [null, 5, 6], ts.slice(0, 3), getX, (v: number) => v, new Set([1]),
      );
      expect(path).toBe(
        `M 10 5 M 10 ${5 - CURVE_STOP_HALF_HEIGHT} L 10 ${5 + CURVE_STOP_HALF_HEIGHT} M 10 5 L 20 6`,
      );
    });

    it('appends a short vertical bar at the stop', () => {
      const getX = (t: any) => (Number(t) / H) * 10;
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
});
