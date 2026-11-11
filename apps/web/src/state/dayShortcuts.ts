// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Keyboard shortcuts of the day slider (REQ-533), matched by the key's position (`KeyboardEvent.code`), so they are the
 * same keys on a German and an English layout:
 *
 * - `Backquote` (^ / `) selects all days, like „Alle“.
 * - `Digit1`…`Digit9` select yesterday, today and the following days: 1 yesterday and today, 2 yesterday to tomorrow,
 *   N yesterday to today + N − 1.
 * - `Digit0` selects ten days in all, counted from the first selected day (yesterday or today).
 * - `Minus` (ß / -) shows or removes yesterday in the current selection; the digit keys follow that choice (without
 *   yesterday, 1 is today alone).
 *
 * "Today" is the day of the forecast's "now" (the red line, the moment the forecast was loaded), not the clock's
 * current day: `ForecastDay.isToday` comes from the forecast's pinned `timeline.now`.
 */
import type { DaySelection, ForecastDay } from "./days.ts";

/** What a shortcut key does. */
export type DayShortcut = { kind: "all" } | { kind: "digit"; digit: number } | { kind: "yesterday" };

/** The shortcut of a key position, or null for other keys. */
export function dayShortcutForCode(code: string): DayShortcut | null {
  if (code === "Backquote") return { kind: "all" };
  if (code === "Minus") return { kind: "yesterday" };
  const match = /^Digit([0-9])$/.exec(code);
  return match ? { kind: "digit", digit: Number(match[1]) } : null;
}

/** Days selected by `Digit0`, yesterday included when shown. */
export const DIGIT_ZERO_DAYS = 10;

/** Index of today (the forecast's "now"), or -1. */
export const todayIndex = (days: readonly ForecastDay[]) => days.findIndex((day) => day.isToday);

/** Whether the days have a yesterday (a day before today). */
export const hasYesterday = (days: readonly ForecastDay[]) => todayIndex(days) > 0;

/**
 * The selection of a digit key: from yesterday (when `withYesterday` and there is one) or today to today + digit − 1;
 * `0` selects ten days from that first day. Clamped to the days; null without a today.
 */
export function digitSelection(
  days: readonly ForecastDay[],
  digit: number,
  withYesterday: boolean,
): DaySelection | null {
  const today = todayIndex(days);
  if (today < 0) return null;
  const start = withYesterday && today > 0 ? today - 1 : today;
  const end = digit === 0 ? start + DIGIT_ZERO_DAYS - 1 : today + Math.max(1, digit) - 1;
  return { start, end: Math.min(days.length - 1, end) };
}

/**
 * Shows or removes yesterday in `selection`. A selection that includes yesterday starts today afterwards (a selection of
 * yesterday alone becomes today); any other selection reaches back to yesterday. Null when there is no yesterday.
 */
export function toggleYesterday(
  days: readonly ForecastDay[],
  selection: DaySelection,
): { selection: DaySelection; withYesterday: boolean } | null {
  const today = todayIndex(days);
  if (today <= 0) return null;
  const yesterday = today - 1;
  if (selection.start <= yesterday) {
    return { selection: { start: today, end: Math.max(today, selection.end) }, withYesterday: false };
  }
  return { selection: { start: yesterday, end: Math.max(yesterday, selection.end) }, withYesterday: true };
}

/**
 * Applies a shortcut: the new selection (null is the whole period) and whether yesterday is shown afterwards, or
 * undefined when the key does nothing here.
 */
export function applyDayShortcut(
  shortcut: DayShortcut,
  days: readonly ForecastDay[],
  selection: DaySelection,
  withYesterday: boolean,
): { selection: DaySelection | null; withYesterday: boolean } | undefined {
  if (days.length === 0) return undefined;
  if (shortcut.kind === "all") return { selection: null, withYesterday };
  if (shortcut.kind === "yesterday") return toggleYesterday(days, selection) ?? undefined;
  const next = digitSelection(days, shortcut.digit, withYesterday);
  return next ? { selection: next, withYesterday } : undefined;
}

/** Elements that take typed text: the shortcuts stay out of them. */
function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return element.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") !== null;
}

/**
 * Whether a key press may act as a day shortcut: no Ctrl, Meta or Alt, not typing, no dialog (also the meteogram on the
 * whole screen) or popup open, and not `Digit0` or `Minus` while the meteogram has the focus (its zoom keys).
 */
export function dayShortcutAllowed(event: KeyboardEvent, shortcut: DayShortcut, doc: Document = document): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (isTextEntry(target) || isTextEntry(doc.activeElement)) return false;
  if (doc.querySelector("dialog[open], [aria-modal='true'], [aria-expanded='true']")) return false;
  const zoomKey = shortcut.kind === "yesterday" || (shortcut.kind === "digit" && shortcut.digit === 0);
  if (zoomKey && (target?.closest(".graupel-meteogram") || doc.activeElement?.closest(".graupel-meteogram"))) {
    return false;
  }
  return true;
}
