import { describe, expect, it } from 'vitest';
import { aggregateThunderstorms, buildIconSlots } from './thunderstormIcons';
import { HOUR_MS } from './timeline';
import type { DataPoint } from '../types';
const origin = Date.parse('2026-01-01T00:00:00Z');
const at = (hour: number) => origin + hour * HOUR_MS;
const point = (hour: number, value: number | null, model = 'A'): DataPoint => ({ timestamp: new Date(at(hour)).toISOString(), variable: 'weather_code', value, unit: '', model });
const days = [{ id: 'day', start: at(0), end: at(24) }];
const slots = (start = 0, end = 24) => buildIconSlots(days, at(start), at(end), 54 / ((end - start) * HOUR_MS), 18);
describe('thunderstorm interval aggregation', () => {
  it.each([95, 96, 99])('detects code %s away from an icon center', code => {
    expect(aggregateThunderstorms(slots(), [point(1, code)]).map(icon => icon.code)).toEqual([code]);
  });
  it.each([[95,96,99,99], [95,96,3,96]])('chooses severity among %s %s %s', (a,b,c,expected) => {
    expect(aggregateThunderstorms(slots(), [point(0,a),point(1,b),point(2,c)])[0].code).toBe(expected);
  });
  it('uses eight-hour slots at three icons per full day and finer/coarser zoom intervals', () => {
    expect(slots().map(slot => (slot.end-slot.start)/HOUR_MS)).toEqual([8,8,8]);
    expect((slots(0,12)[0].end-slots(0,12)[0].start)/HOUR_MS).toBe(4);
    expect((slots(0,6)[0].end-slots(0,6)[0].start)/HOUR_MS).toBe(2);
  });
  it('assigns a boundary timestamp once to the following slot', () => {
    const icons = aggregateThunderstorms(slots(), [point(8,99), point(16,96)]);
    expect(icons.map(icon => [icon.start, icon.code])).toEqual([[at(8),99],[at(16),96]]);
  });
  it('ignores hidden edge data and includes the last visible hourly observation', () => {
    expect(aggregateThunderstorms(slots(10,16), [point(9,99),point(16,99)])).toEqual([]);
    expect(aggregateThunderstorms(slots(), [point(23,95)])[0].code).toBe(95);
  });
  it('ignores missing, invalid and non-thunderstorm codes without placeholders', () => {
    expect(aggregateThunderstorms(slots(), [point(1,null), point(2,NaN),point(3,61),point(4,3)])).toEqual([]);
  });
  it('clips calendar-day slots to fractional visible edges', () => {
    const result = slots(1.5,22.5);
    expect(result[0].start).toBe(at(1.5));
    expect(result.at(-1)!.end).toBe(at(22.5));
    expect(result.every((slot,i) => i === 0 || result[i-1].end === slot.start)).toBe(true);
  });
});
