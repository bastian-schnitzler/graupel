import type { DataPoint } from '../types';
import { normalizeTimestamp } from './timeline';
export interface IconSlot { id: string; start: number; end: number; center: number }
/** Equal half-open slots covering each visible calendar-day portion. */
export function buildIconSlots(days: { id: string; start: number; end: number }[], visibleStart: number, visibleEnd: number, pixelsPerMs: number, footprintPx: number): IconSlot[] {
  return days.flatMap(day => {
    const start = Math.max(day.start, visibleStart), end = Math.min(day.end, visibleEnd);
    const count = Math.floor(Math.max(0, end - start) * pixelsPerMs / footprintPx);
    if (count < 1) return [];
    return Array.from({ length: count }, (_, i) => {
      const slotStart = start + (end - start) * i / count;
      const slotEnd = start + (end - start) * (i + 1) / count;
      return { id: `${day.id}-${i}`, start: slotStart, end: slotEnd, center: (slotStart + slotEnd) / 2 };
    });
  });
}
/** Aggregate only the harmonized active main-chain data, never raw forecasts. */
export function aggregateThunderstorms(slots: IconSlot[], data: DataPoint[]) {
  const storms = data.flatMap(point => point.variable === 'weather_code' && [95, 96, 99].includes(point.value!)
    ? [{ time: normalizeTimestamp(point.timestamp), code: point.value! }] : []);
  return slots.flatMap(slot => {
    let code = 0;
    for (const storm of storms) if (storm.time >= slot.start && storm.time < slot.end) code = Math.max(code, storm.code);
    return code ? [{ ...slot, code }] : [];
  });
}
