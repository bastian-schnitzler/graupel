// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Days of the forecast and the selected period of the day slider (REQ-436). The day slider sets the selection, the
 * meteogram shows its time range. A day only partly covered by the data still counts as a whole day.
 */
import type { ForecastResult } from "@graupel/download";
import { addLocalDays, getPreviousLocalMidnight, type TimeRange } from "@graupel/meteogram";
import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";
import { useDaySlider } from "./displaySettings.ts";
import { useForecast } from "./forecast.ts";

export interface ForecastDay {
  /** Local midnight that starts the day (epoch ms). */
  start: number;
  /** Local midnight that ends the day (exclusive). */
  end: number;
  /** Whether the day contains the forecast's "now". */
  isToday: boolean;
}

/** Selected days, inclusive indices into the day list. */
export interface DaySelection {
  start: number;
  end: number;
}

/** Local midnight that starts the day containing `time`. */
export function startOfLocalDay(time: number, timeZone: string): number {
  const start = addLocalDays(getPreviousLocalMidnight(time, timeZone), 1, timeZone);
  // Around a time change the computed midnight can lie after `time`; then the day began a day earlier.
  return start > time ? addLocalDays(start, -1, timeZone) : start;
}

/**
 * The local days the data range touches, with `now` marking today. `limit` keeps the days before today and at most
 * `limit` days from today on (`daySlider.days` of config.json or, with the slider off, the chosen days, REQ-473); `"all"`
 * keeps every day.
 */
export function forecastDays(
  data: TimeRange,
  timeZone: string,
  now: number,
  limit: number | "all" = "all",
): ForecastDay[] {
  const days: ForecastDay[] = [];
  if (!(data.end > data.start)) return days;
  const today = startOfLocalDay(now, timeZone);
  let start = startOfLocalDay(data.start, timeZone);
  while (start < data.end && days.length < 400) {
    const end = addLocalDays(start, 1, timeZone);
    days.push({ start, end, isToday: start === today });
    start = end;
  }
  if (limit === "all") return days;
  const todayIndex = days.findIndex((day) => day.isToday);
  return days.slice(0, Math.max(0, todayIndex) + Math.max(1, Math.floor(limit)));
}

/** Days of a forecast's timeline, as the day slider has them (`limit` as for `forecastDays`). */
export function resultDays(result: ForecastResult, limit: number | "all" = "all"): ForecastDay[] {
  const { timeline, timezone } = result;
  const data = { start: Date.parse(timeline.start), end: Date.parse(timeline.end) };
  return forecastDays(data, timezone, Date.parse(timeline.now), limit);
}

/**
 * Calendar date (`YYYY-MM-DD`) of the day containing `time` in `timeZone`: the same day of two forecasts, e.g. an
 * archived fetch and the current one (REQ-684), has the same key whatever index it has in either.
 */
export function dayKey(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(time)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** All days. */
export const wholeSelection = (count: number): DaySelection => ({ start: 0, end: Math.max(0, count - 1) });

export const isWholeSelection = (selection: DaySelection, count: number) =>
  selection.start <= 0 && selection.end >= count - 1;

const clampIndex = (value: number, count: number) => Math.min(Math.max(0, count - 1), Math.max(0, value));

/** The selection fitted to `count` days; null (whole period) stays the whole period. */
export function fitSelection(selection: DaySelection | null, count: number): DaySelection {
  if (!selection || count <= 0) return wholeSelection(count);
  const start = clampIndex(selection.start, count);
  return { start, end: Math.max(start, clampIndex(selection.end, count)) };
}

/** Moves one edge to day `index`; the edge stops at the other one (at least one day stays selected). */
export function resizeSelection(
  selection: DaySelection,
  edge: "start" | "end",
  index: number,
  count: number,
): DaySelection {
  const target = clampIndex(index, count);
  return edge === "start"
    ? { start: Math.min(target, selection.end), end: selection.end }
    : { start: selection.start, end: Math.max(target, selection.start) };
}

/** Share of a day the finger must travel before an edge dragged on a phone moves on by one day (REQ-558). */
export const EDGE_STEP_SHARE = 1 / 3;

/**
 * An edge dragged on a phone (REQ-558): it moves by the finger's travel (`delta`, in days), not to where the finger is,
 * and moves on by one day after a third of a day. Moving outwards into the outer half of the first or last day
 * (`position`, the finger's place in days from the strip's left edge) it snaps to that day, so the ends need no reach to
 * the screen's edge.
 */
export function dragEdge(
  selection: DaySelection,
  edge: "start" | "end",
  delta: number,
  position: number,
  count: number,
): DaySelection {
  const steps = Math.sign(delta) * Math.floor(Math.abs(delta) + 1 - EDGE_STEP_SHARE);
  const index = (edge === "start" ? selection.start : selection.end) + steps;
  if (edge === "end" && delta > 0 && position >= count - 0.5) return resizeSelection(selection, "end", count - 1, count);
  if (edge === "start" && delta < 0 && position <= 0.5) return resizeSelection(selection, "start", 0, count);
  return resizeSelection(selection, edge, index, count);
}

/** Shifts the selection by `delta` days, keeping its length; it stops at the first and the last day. */
export function moveSelection(selection: DaySelection, delta: number, count: number): DaySelection {
  const length = selection.end - selection.start;
  const start = Math.min(Math.max(0, selection.start + delta), Math.max(0, count - 1 - length));
  return { start, end: start + length };
}

/** Time range of the selected days, clamped to the data. */
export function selectionRange(
  days: readonly ForecastDay[],
  selection: DaySelection,
  data: TimeRange,
): TimeRange | null {
  const first = days[selection.start];
  const last = days[selection.end];
  if (!first || !last) return null;
  const start = Math.max(first.start, data.start);
  const end = Math.min(last.end, data.end);
  return end > start ? { start, end } : null;
}

// --- shared state -------------------------------------------------------------------------------------------------

interface DaySelectionContextValue {
  /** Selected days; null is the whole period. */
  selection: DaySelection | null;
  setSelection: (selection: DaySelection | null) => void;
}

const DaySelectionContext = createContext<DaySelectionContextValue | null>(null);

/** Holds the selected days for the day slider and the meteogram; starts with the whole period. */
export function DaySelectionProvider({ children }: { children?: ReactNode }) {
  const [selection, setSelection] = useState<DaySelection | null>(null);
  const value = useMemo(() => ({ selection, setSelection }), [selection]);
  return createElement(DaySelectionContext.Provider, { value }, children);
}

const FALLBACK: DaySelectionContextValue = { selection: null, setSelection: () => {} };

/**
 * The selection as stored (null: the whole period), not fitted to any days: for a switch of the forecast that carries
 * the selection over by date (REQ-684).
 */
export function useDaySelection(): DaySelectionContextValue {
  return useContext(DaySelectionContext) ?? FALLBACK;
}

export interface ForecastDaysState {
  /** Days of the slider (empty without a forecast). */
  days: ForecastDay[];
  /** Time zone of the days (the forecast's). */
  timeZone: string;
  /** Selected days, fitted to `days`. */
  selection: DaySelection;
  /** Whether every day is selected. */
  whole: boolean;
  /** Selects days; null selects the whole period. */
  setSelection: (selection: DaySelection | null) => void;
  /** Time range the meteogram shows; null shows all data. */
  visibleRange: TimeRange | null;
  /** Time range of all days (the whole selection); null without days. */
  wholeRange: TimeRange | null;
}

/** Days of the current forecast, the selection and the visible time range. */
export function useForecastDays(): ForecastDaysState {
  const { result } = useForecast();
  const daySlider = useDaySlider();
  const { selection, setSelection } = useDaySelection();
  const timeline = result?.timeline;
  const timeZone = result?.timezone ?? "UTC";
  const days = useMemo(() => {
    if (!timeline) return [];
    const data = { start: Date.parse(timeline.start), end: Date.parse(timeline.end) };
    return forecastDays(data, timeZone, Date.parse(timeline.now), daySlider.days);
  }, [timeline, timeZone, daySlider.days]);

  return useMemo(() => {
    const fitted = fitSelection(selection, days.length);
    const whole = isWholeSelection(fitted, days.length);
    let visibleRange: TimeRange | null = null;
    let wholeRange: TimeRange | null = null;
    if (timeline && days.length > 0) {
      const data = { start: Date.parse(timeline.start), end: Date.parse(timeline.end) };
      // The whole period shows all data unless the configuration limits the days.
      visibleRange = whole && days.at(-1)!.end >= data.end ? null : selectionRange(days, fitted, data);
      wholeRange = selectionRange(days, wholeSelection(days.length), data);
    }
    const select = (next: DaySelection | null) =>
      setSelection(next && !isWholeSelection(next, days.length) ? next : null);
    return { days, timeZone, selection: fitted, whole, setSelection: select, visibleRange, wholeRange };
  }, [days, timeZone, selection, setSelection, timeline]);
}
