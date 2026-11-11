// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { DataPoint } from './types';
import { normalizeTimestamp } from "./timeline";
export interface IconSlot { id: string; start: number; end: number; center: number }
/**
 * Equal half-open slots covering each visible calendar-day portion. With the
 * data's timestamps, a day portion gets no more slots than it has data points,
 * so a zoomed-in chart shows no more icons than the data's resolution
 * (e.g. one per hour, REQ-571).
 */
export function buildIconSlots(days: { id: string; start: number; end: number }[], visibleStart: number, visibleEnd: number, pixelsPerMs: number, footprintPx: number, timestamps?: readonly number[]): IconSlot[] {
  return days.flatMap(day => {
    const start = Math.max(day.start, visibleStart), end = Math.min(day.end, visibleEnd);
    const fitting = Math.floor(Math.max(0, end - start) * pixelsPerMs / footprintPx);
    const count = timestamps ? Math.min(fitting, timestamps.filter(ts => ts >= start && ts < end).length) : fitting;
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
