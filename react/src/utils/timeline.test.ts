import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  assertSameTimelineX,
  buildHourlyTimeline,
  canonicalTimestamp,
  createTimelineScale,
  findNearestTimestamp,
  findTimestampAtOrBefore,
  getBoundaryTimestamp,
  normalizeTimestamp,
  validateTimestampSequence,
} from './timeline';

describe('canonical meteogram timeline', () => {
  it('normalizes explicit offsets and legacy timezone-less values to stable UTC instants', () => {
    expect(normalizeTimestamp('2026-09-14T15:00:00+02:00')).toBe(
      normalizeTimestamp('2026-09-14T13:00:00Z'),
    );
    expect(canonicalTimestamp('2026-09-14T15:00')).toBe('2026-09-14T15:00:00.000Z');
  });

  it('maps equal timestamps from every dataset to exactly the same x coordinate', () => {
    const scale = createTimelineScale('2026-09-14T00:00Z', '2026-09-15T00:00Z', 50, 970);
    const variants = [
      '2026-09-14T15:00:00Z',
      '2026-09-14T17:00:00+02:00',
      normalizeTimestamp('2026-09-14T15:00:00Z'),
    ];
    assertSameTimelineX(scale, variants);
    expect(new Set(variants.map((timestamp) => scale.timestampToX(timestamp))).size).toBe(1);
  });

  it('uses absolute time for differently spaced datasets and detects a missing hour', () => {
    const scale = createTimelineScale('2026-09-14T00:00Z', '2026-09-14T06:00Z', 0, 600);
    expect(scale.timestampToX('2026-09-14T03:00Z')).toBe(300);
    expect(scale.timestampToX('2026-09-14T03:00Z')).toBe(
      scale.timestampToX('2026-09-14T05:00+02:00'),
    );
    const anomalies = validateTimestampSequence([
      '2026-09-14T00:00Z',
      '2026-09-14T01:00Z',
      '2026-09-14T03:00Z',
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].actualMs).toBe(2 * HOUR_MS);
  });

  it('keeps hourly start-stamped intervals separate from point coordinates', () => {
    const scale = createTimelineScale('2026-09-14T00:00Z', '2026-09-14T04:00Z', 0, 400);
    expect(scale.timestampToX('2026-09-14T01:00Z')).toBe(100);
    expect(scale.intervalToGeometry('2026-09-14T01:00Z')).toEqual({ x: 100, width: 100 });
  });

  it('round-trips a 120-hour boundary without drift after repeated moves', () => {
    const start = '2026-09-14T01:00Z';
    const end = getBoundaryTimestamp(start, 384);
    const scale = createTimelineScale(start, end, 50, 970);
    const original = scale.timestampToX(getBoundaryTimestamp(start, 120));
    for (let count = 0; count < 100; count += 1) {
      scale.timestampToX(getBoundaryTimestamp(start, 72));
      scale.timestampToX(getBoundaryTimestamp(start, 180));
    }
    expect(scale.timestampToX(getBoundaryTimestamp(start, 120))).toBe(original);
    expect(scale.xToTimestamp(original)).toBe(getBoundaryTimestamp(start, 120));
  });

  it('builds half-open forecast windows and selects nearest timestamps without index assumptions', () => {
    const timestamps = buildHourlyTimeline('2026-09-14T00:00Z', '2026-09-14T03:00Z');
    expect(timestamps).toEqual([
      normalizeTimestamp('2026-09-14T00:00Z'),
      normalizeTimestamp('2026-09-14T01:00Z'),
      normalizeTimestamp('2026-09-14T02:00Z'),
    ]);
    expect(findNearestTimestamp(timestamps, normalizeTimestamp('2026-09-14T01:29Z'))).toBe(
      normalizeTimestamp('2026-09-14T01:00Z'),
    );
    expect(findTimestampAtOrBefore(
      timestamps,
      normalizeTimestamp('2026-09-14T01:59Z'),
    )).toBe(normalizeTimestamp('2026-09-14T01:00Z'));
  });
});
