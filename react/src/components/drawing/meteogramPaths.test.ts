import { describe, it, expect } from 'vitest';
import {
  buildSvgLinePath,
  buildPrecipitationProbabilityPath,
  calculateDaylightSpans,
  calculateNoonPositions,
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
});

