import { describe, expect, it } from 'vitest';
import { HOUR_MS } from './timeline';
import {
  calculateZoomedTimeRange,
  getPreviousLocalMidnight,
  normalizeWheelZoomDirection,
  type TimeRange,
  calculateDayRange,
  findActiveDayRange,
} from './meteogramZoom';

const maximumRange: TimeRange = { start: 0, end: 240 * HOUR_MS };

function position(range: TimeRange, hoverTime: number) {
  return (hoverTime - range.start) / (range.end - range.start);
}

describe('calculateZoomedTimeRange', () => {
  it('keeps the left edge fixed without hover and moves only the right edge', () => {
    const zoomedIn = calculateZoomedTimeRange({
      range: maximumRange,
      maximumRange,
      hoverTime: null,
      direction: 'in',
    });
    expect(zoomedIn.start).toBe(maximumRange.start);
    expect(zoomedIn.end).toBeLessThan(maximumRange.end);
    expect(calculateZoomedTimeRange({
      range: zoomedIn,
      maximumRange,
      hoverTime: null,
      direction: 'out',
    })).toEqual(maximumRange);
  });

  it('zooms symmetrically around a centered hover timestamp', () => {
    const hoverTime = maximumRange.end / 2;
    const result = calculateZoomedTimeRange({
      range: maximumRange,
      maximumRange,
      hoverTime,
      direction: 'in',
    });
    expect(hoverTime - result.start).toBeCloseTo(result.end - hoverTime, 5);
    expect(position(result, hoverTime)).toBeCloseTo(0.5, 10);
  });

  it.each([0.25, 0.01])('moves a left hover at p=%s progressively toward center', (p) => {
    const hoverTime = maximumRange.end * p;
    const result = calculateZoomedTimeRange({
      range: maximumRange,
      maximumRange,
      hoverTime,
      direction: 'in',
    });
    expect(hoverTime - result.start).toBeLessThan(hoverTime - maximumRange.start);
    expect(result.end - hoverTime).toBeLessThan(maximumRange.end - hoverTime);
    expect(position(result, hoverTime)).toBeGreaterThan(p);
    expect(position(result, hoverTime)).toBeLessThan(0.5);
  });

  it.each([0.75, 0.99])('moves a right hover at p=%s progressively toward center', (p) => {
    const hoverTime = maximumRange.end * p;
    const result = calculateZoomedTimeRange({
      range: maximumRange,
      maximumRange,
      hoverTime,
      direction: 'in',
    });
    expect(position(result, hoverTime)).toBeLessThan(p);
    expect(position(result, hoverTime)).toBeGreaterThan(0.5);
  });

  it('keeps ranges valid through repeated operations and returns to exact maximum bounds', () => {
    const hoverTime = maximumRange.end * 0.2;
    let range = maximumRange;
    for (let count = 0; count < 100; count += 1) {
      range = calculateZoomedTimeRange({ range, maximumRange, hoverTime, direction: 'in' });
      expect(range.start).toBeLessThan(hoverTime);
      expect(range.end).toBeGreaterThan(hoverTime);
    }
    for (let count = 0; count < 100; count += 1) {
      range = calculateZoomedTimeRange({ range, maximumRange, hoverTime, direction: 'out' });
    }
    expect(range).toEqual(maximumRange);
  });

  it('intersects an existing viewport with a smaller replacement maximum range', () => {
    const result = calculateZoomedTimeRange({
      range: { start: 40 * HOUR_MS, end: 180 * HOUR_MS },
      maximumRange: { start: 80 * HOUR_MS, end: 140 * HOUR_MS },
      hoverTime: null,
      direction: 'out',
    });
    expect(result.start).toBe(80 * HOUR_MS);
    expect(result.end).toBe(140 * HOUR_MS);
  });
});

describe('zoom input and local maximum range', () => {
  it('normalizes wheel directions across delta modes', () => {
    expect(normalizeWheelZoomDirection(-1, 1)).toBe('in');
    expect(normalizeWheelZoomDirection(1, 2)).toBe('out');
    expect(normalizeWheelZoomDirection(0, 0)).toBeNull();
  });

  it('finds previous local midnight across a daylight-saving offset', () => {
    expect(new Date(getPreviousLocalMidnight(
      Date.parse('2026-09-14T15:00:00Z'),
      'Europe/Berlin',
    )).toISOString()).toBe('2026-09-12T22:00:00.000Z');
  });
});

describe('day-range buttons (spec §16.1, #162)', () => {
  const DAY = 24 * 3600 * 1000;
  // Yesterday 00:00 Berlin (CEST, UTC+2) to 16 days later.
  const start = Date.UTC(2026, 9, 19, 22);
  const maximum = { start, end: start + 16 * DAY + 3600 * 1000 };

  it('spans N local days from the timeline start', () => {
    expect(calculateDayRange(maximum, 4, 'Europe/Berlin')).toEqual({
      start,
      end: start + 4 * DAY,
    });
    expect(calculateDayRange(maximum, null, 'Europe/Berlin')).toEqual(maximum);
  });

  it('keeps local midnight across a DST change', () => {
    // 25 Oct 2026: CEST -> CET, that day has 25 hours.
    const end = calculateDayRange(maximum, 7, 'Europe/Berlin').end;
    expect(end - start).toBe(7 * DAY + 3600 * 1000);
    expect(new Date(end).toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('clamps to the available range', () => {
    const short = { start, end: start + 5 * DAY };
    expect(calculateDayRange(short, 7, 'UTC')).toEqual(short);
    expect(calculateDayRange(short, 14, 'UTC')).toEqual(short);
  });

  it('highlights the matching button, the chosen one when several match', () => {
    expect(
      findActiveDayRange({ start, end: start + 10 * DAY }, maximum, undefined, 'UTC'),
    ).toBe(10);
    const short = { start, end: start + 5 * DAY };
    // 7, 14 and All all equal the 5 available days: nothing chosen -> All.
    expect(findActiveDayRange(short, short, undefined, 'UTC')).toBeNull();
    expect(findActiveDayRange(short, short, 14, 'UTC')).toBe(14);
    // Wheel zoom: no button matches.
    expect(
      findActiveDayRange({ start, end: start + 3 * DAY }, maximum, 4, 'UTC'),
    ).toBeUndefined();
  });
});
