// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * History of the installed app (REQ-684): only there (`useAppMode()`), every successful fetch of the forecast goes into
 * the archive (`services/fetchArchive.ts`) with the place and the time it was fetched; fetches older than the archive
 * keeps (REQ-686, default unlimited) are deleted. The history lists the earlier fetches of the current place (the one
 * shown as current values is not among them) and shows one of them in place of the current forecast: the provider
 * hands it to everything inside as the forecast (`ForecastOverride`), so the day slider and the meteogram follow it.
 * Another place, a reload or "current values" end it.
 *
 * Scroll rule: the day that stood on the left before (the first selected day) stands on the left again when the new
 * forecast has it, with as many days selected as before (every day to the last when the selection reached the last
 * day, e.g. every day selected); without it the meteogram starts at its front. The same holds on the way back to the
 * current values.
 *
 * The menu (`groupHistory`): at most 10 fetches directly, newest first, the older ones in fold-outs per month of the
 * current year, then per year with fold-outs per month; a fold-out that would hold one entry only shows that entry.
 */
import type { ForecastResult } from "@graupel/download";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  archiveCutoff,
  archiveFetch,
  archiveId,
  archivedResult,
  defaultFetchArchive,
  type ArchivedFetch,
  type ArchivedFetchInfo,
  type FetchArchive,
} from "../services/fetchArchive.ts";
import { useAppMode, type AppModeStore } from "./appMode.ts";
import { dayKey, fitSelection, resultDays, useDaySelection, type DaySelection, type ForecastDay } from "./days.ts";
import { useArchiveDays, useDaySlider } from "./displaySettings.ts";
import { ForecastOverride, useForecast, type ForecastState } from "./forecast.ts";
import { useLocation } from "./location.tsx";
import { placeKey } from "./place.ts";

// --- menu ---------------------------------------------------------------------------------------------------------

/** Fetches the menu lists directly before the fold-outs (REQ-684). */
export const HISTORY_DIRECT_ENTRIES = 10;

/** An entry of the history menu: a fetch, or a fold-out of a month or a year. */
export type HistoryNode =
  | { kind: "fetch"; fetch: ArchivedFetchInfo }
  /** `month` 0 to 11. */
  | { kind: "month"; year: number; month: number; children: HistoryNode[] }
  | { kind: "year"; year: number; children: HistoryNode[] };

const newestFirst = (a: ArchivedFetchInfo, b: ArchivedFetchInfo) => b.fetchedAt - a.fetchedAt;

/** A fold-out with a single entry is that entry (REQ-684). */
const unfold = (node: HistoryNode): HistoryNode =>
  node.kind !== "fetch" && node.children.length === 1 ? node.children[0]! : node;

/** Fold-outs per month (newest first) of fetches sorted newest first, in the device's local time. */
function byMonth(fetches: readonly ArchivedFetchInfo[]): HistoryNode[] {
  const months: { year: number; month: number; children: HistoryNode[] }[] = [];
  for (const fetch of fetches) {
    const date = new Date(fetch.fetchedAt);
    const year = date.getFullYear();
    const month = date.getMonth();
    let group = months.at(-1);
    if (!group || group.year !== year || group.month !== month) {
      group = { year, month, children: [] };
      months.push(group);
    }
    group.children.push({ kind: "fetch", fetch });
  }
  return months.map((group) => unfold({ kind: "month", ...group }));
}

/**
 * The history menu of `fetches` at `now` (REQ-684): the 10 newest fetches directly, then fold-outs for the months of
 * the current year, then for the years before it, each with fold-outs per month. A fold-out with one entry is replaced
 * by it (a year with a single month by that month's fold-out). Months and years in the device's local time.
 */
export function groupHistory(fetches: readonly ArchivedFetchInfo[], now: number): HistoryNode[] {
  const sorted = [...fetches].sort(newestFirst);
  const nodes: HistoryNode[] = sorted
    .slice(0, HISTORY_DIRECT_ENTRIES)
    .map((fetch) => ({ kind: "fetch", fetch }) as HistoryNode);
  const rest = sorted.slice(HISTORY_DIRECT_ENTRIES);
  const currentYear = new Date(now).getFullYear();
  // Fetches of this year (or, with a clock set back, a later one) by month.
  nodes.push(...byMonth(rest.filter((fetch) => new Date(fetch.fetchedAt).getFullYear() >= currentYear)));
  const years: { year: number; fetches: ArchivedFetchInfo[] }[] = [];
  for (const fetch of rest) {
    const year = new Date(fetch.fetchedAt).getFullYear();
    if (year >= currentYear) continue;
    let group = years.at(-1);
    if (!group || group.year !== year) {
      group = { year, fetches: [] };
      years.push(group);
    }
    group.fetches.push(fetch);
  }
  for (const group of years) nodes.push(unfold({ kind: "year", year: group.year, children: byMonth(group.fetches) }));
  return nodes;
}

// --- current values -----------------------------------------------------------------------------------------------

/** How long the newest fetch counts as the current values (REQ-757): 20 minutes. */
export const CURRENT_MAX_AGE = 20 * 60 * 1000;

/**
 * Whether the fetch of `fetchedAt` still counts as the current values at `now` (REQ-757): at most 20 minutes old (or
 * "later" than now, with a clock set back). Only then does the history show it in gold on top, with a gold clock;
 * older, it stands without gold among the earlier fetches.
 */
export const isCurrentFetch = (fetchedAt: number, now: number): boolean => now - fetchedAt <= CURRENT_MAX_AGE;

// --- scroll rule --------------------------------------------------------------------------------------------------

/**
 * Selection of the day slider after a switch between two forecasts of a place (REQ-684): the first selected day of
 * `from` (the day on the left) is selected first again when `to` has it, with as many days as before, or every day to
 * the last when the selection reached the last day of `from` (every day selected, too); otherwise the selection starts
 * at the first day. `null` is every day.
 */
export function carrySelection(
  from: readonly ForecastDay[],
  fromZone: string,
  selection: DaySelection | null,
  to: readonly ForecastDay[],
  toZone: string,
): DaySelection | null {
  const fitted = fitSelection(selection, from.length);
  const toEnd = selection === null || fitted.end >= from.length - 1;
  const left = from[fitted.start];
  const key = left ? dayKey(left.start, fromZone) : null;
  const found = key === null ? -1 : to.findIndex((day) => dayKey(day.start, toZone) === key);
  const start = Math.max(0, found);
  const last = Math.max(0, to.length - 1);
  const end = toEnd ? last : Math.min(last, start + (fitted.end - fitted.start));
  return start === 0 && end >= last ? null : { start, end };
}

// --- history slider -----------------------------------------------------------------------------------------------

/** Fields of the phone's history slider (REQ-685): today on the right and at most 15 earlier days before it. */
export const HISTORY_SLIDER_DAYS = 16;

/** A day of the history slider (REQ-685). */
export interface HistoryDay {
  /** Calendar date (`dayKey`) in the device's time zone. */
  key: string;
  /** A time on that day for its labels: the fetch's, today the current time. */
  time: number;
  /** The last fetch of that day; `null` for today, which stands for the current values. */
  fetch: ArchivedFetchInfo | null;
}

/** The device's time zone, in which the history names its days (as its menu, REQ-684). */
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Days of the phone's history slider at `now` (REQ-685), oldest first: today last, standing for the current values
 * (even when an earlier fetch of today is archived), before it each earlier day with archived fetches once, with its
 * last fetch, at most the last 15 of them, so that there are at most `HISTORY_SLIDER_DAYS` days. Days in `timeZone`
 * (default the device's).
 */
export function historyDays(
  fetches: readonly ArchivedFetchInfo[],
  now: number,
  timeZone: string = deviceTimeZone(),
): HistoryDay[] {
  const today = dayKey(now, timeZone);
  const latest = new Map<string, ArchivedFetchInfo>();
  for (const fetch of fetches) {
    const key = dayKey(fetch.fetchedAt, timeZone);
    // Today stands for the current values; a fetch "after" today (a clock set back) has no place before it.
    if (key >= today) continue;
    const known = latest.get(key);
    if (!known || fetch.fetchedAt > known.fetchedAt) latest.set(key, fetch);
  }
  const earlier = [...latest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-(HISTORY_SLIDER_DAYS - 1))
    .map(([key, fetch]): HistoryDay => ({ key, time: fetch.fetchedAt, fetch }));
  return [...earlier, { key: today, time: now, fetch: null }];
}

/**
 * The one marked day of the history slider (REQ-685): the day of the archived fetch shown, today with the current
 * values; -1 when the fetch shown is older than the slider's days.
 */
export function markedHistoryDay(
  days: readonly HistoryDay[],
  shown: ArchivedFetchInfo | null,
  timeZone: string = deviceTimeZone(),
): number {
  if (!shown) return days.length - 1;
  const key = dayKey(shown.fetchedAt, timeZone);
  return days.findIndex((day) => day.key === key);
}

// --- state --------------------------------------------------------------------------------------------------------

export interface HistoryState {
  /** Whether the page keeps a history: only as the installed app (REQ-684). */
  available: boolean;
  /** Earlier fetches of the current place, newest first; the fetch shown as current values is not among them. */
  fetches: readonly ArchivedFetchInfo[];
  /** The archived fetch shown instead of the current forecast; `null`: the current values. */
  shown: ArchivedFetchInfo | null;
  /**
   * Time the current values were fetched (REQ-726, REQ-727): the history names them by it, as it names the archived
   * fetches; `null` before the first fetch.
   */
  currentFetchedAt: number | null;
  /**
   * Whether the current values still count as current (REQ-757): fetched at most 20 minutes ago. Turns false by itself
   * while the page stays open (a timer, a check when the page shows again and when the history opens).
   */
  currentLive: boolean;
  /** Checks again whether the current values still count as current (REQ-757), e.g. when the history opens. */
  checkCurrent: () => void;
  /** Shows an archived fetch of the current place (by `id`), with the scroll rule. */
  show: (id: string) => Promise<void>;
  /** Back to the current values, with the scroll rule. */
  showCurrent: () => void;
}

const FALLBACK: HistoryState = {
  available: false,
  fetches: [],
  shown: null,
  currentFetchedAt: null,
  currentLive: false,
  checkCurrent: () => {},
  show: async () => {},
  showCurrent: () => {},
};

const HistoryContext = createContext<HistoryState>(FALLBACK);

/** The history of the installed app (REQ-684); outside a `HistoryProvider` and on the website empty. */
export function useHistory(): HistoryState {
  return useContext(HistoryContext);
}

export interface HistoryProviderProps {
  /** Storage of the archive (tests); default IndexedDB, in memory without it. */
  archive?: FetchArchive;
  /** Display mode source (tests); defaults to the page's window. */
  appMode?: AppModeStore;
  children?: ReactNode;
}

/** The info of an archived fetch, without its forecast. */
const infoOf = ({ id, point, fetchedAt }: ArchivedFetch): ArchivedFetchInfo => ({ id, point, fetchedAt });

/**
 * Archives the fetches of `useForecast()` in the installed app and shows archived ones instead (REQ-684). Put it inside
 * `ForecastProvider`, `LocationProvider` and `DaySelectionProvider`, around everything that shows the forecast.
 */
export function HistoryProvider({ archive: ownArchive, appMode, children }: HistoryProviderProps) {
  const [archive] = useState(() => ownArchive ?? defaultFetchArchive());
  const forecast = useForecast();
  const installed = useAppMode(appMode) === "installed";
  const { place } = useLocation();
  const point = placeKey(place);
  const days = useArchiveDays();
  const limit = useDaySlider().days;
  const { selection, setSelection } = useDaySelection();
  const [listed, setListed] = useState<{ point: string; fetches: ArchivedFetchInfo[] } | null>(null);
  // Counts changes of the archive, so that the list is read again.
  const [changes, setChanges] = useState(0);
  const [shownState, setShown] = useState<ArchivedFetch | null>(null);
  // Another place ends the archived view.
  const [shownPoint, setShownPoint] = useState(point);
  if (shownPoint !== point) {
    setShownPoint(point);
    setShown(null);
  }
  const shown = installed && shownState?.point === point ? shownState : null;

  // Every fetch of the forecast goes into the archive, the latest chain of a fetch replacing an earlier one; a chain
  // previewed while a boundary is dragged does not.
  const { status, result, fetchedAt, previewing = false } = forecast;
  useEffect(() => {
    if (!installed || status !== "ready" || previewing || !result || fetchedAt === undefined) return;
    const entry = { id: archiveId(point, fetchedAt), point, fetchedAt, result: archivedResult(result) };
    archiveFetch(archive, entry, days, Date.now())
      .catch(() => undefined)
      .then(() => setChanges((count) => count + 1));
  }, [installed, status, previewing, result, fetchedAt, point, archive, days]);

  // A shorter time to keep deletes older fetches at once (REQ-686).
  useEffect(() => {
    const cutoff = archiveCutoff(days, Date.now());
    if (!installed || cutoff === null) return;
    archive
      .removeBefore(cutoff)
      .catch(() => undefined)
      .then(() => setChanges((count) => count + 1));
  }, [installed, archive, days]);

  useEffect(() => {
    if (!installed) return;
    let active = true;
    archive.list(point).then(
      (fetches) => {
        if (active) setListed({ point, fetches });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [installed, archive, point, changes]);

  const currentId = fetchedAt !== undefined ? archiveId(point, fetchedAt) : null;
  const fetches = useMemo(
    () => (installed && listed?.point === point ? listed.fetches.filter((fetch) => fetch.id !== currentId) : []),
    [installed, listed, point, currentId],
  );

  /** The selection for switching from the forecast shown now to `to` (scroll rule). */
  const carried = useCallback(
    (to: ForecastResult): DaySelection | null => {
      const from = shown?.result ?? result;
      if (!from) return selection;
      return carrySelection(resultDays(from, limit), from.timezone, selection, resultDays(to, limit), to.timezone);
    },
    [shown, result, selection, limit],
  );

  const show = useCallback(
    async (id: string) => {
      const entry = await archive.get(id).catch(() => undefined);
      if (!entry || entry.point !== point) return;
      setSelection(carried(entry.result));
      setShown(entry);
    },
    [archive, carried, setSelection, point],
  );

  const showCurrent = useCallback(() => {
    if (!shown) return;
    if (result) setSelection(carried(result));
    setShown(null);
  }, [shown, result, carried, setSelection]);

  const { reload, setPreview } = forecast;
  const value = useMemo<ForecastState>(() => {
    if (!shown) return forecast;
    return {
      status: "ready",
      result: shown.result,
      fetchedAt: shown.fetchedAt,
      archived: true,
      // A reload loads the current forecast anew and shows it.
      reload: () => {
        showCurrent();
        reload();
      },
      setPreview,
    };
  }, [forecast, shown, showCurrent, reload, setPreview]);

  // The time the age of the current values counts to (REQ-757): taken again when they turn 20 minutes old, when the
  // page shows again (timers may sleep in the background) and when the history opens. A new fetch is later than it.
  const [clock, setClock] = useState(() => Date.now());
  const checkCurrent = useCallback(() => setClock(Date.now()), []);
  useEffect(() => {
    if (!installed || fetchedAt === undefined) return;
    const timer = setTimeout(checkCurrent, Math.max(0, fetchedAt + CURRENT_MAX_AGE - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [installed, fetchedAt, checkCurrent]);
  useEffect(() => {
    if (!installed) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkCurrent();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [installed, checkCurrent]);

  const currentFetchedAt = fetchedAt ?? null;
  const currentLive = currentFetchedAt !== null && isCurrentFetch(currentFetchedAt, clock);
  const history = useMemo<HistoryState>(
    () => ({
      available: installed,
      fetches,
      shown: shown ? infoOf(shown) : null,
      currentFetchedAt,
      currentLive,
      checkCurrent,
      show,
      showCurrent,
    }),
    [installed, fetches, shown, currentFetchedAt, currentLive, checkCurrent, show, showCurrent],
  );

  return createElement(
    HistoryContext.Provider,
    { value: history },
    createElement(ForecastOverride, { value }, children),
  );
}
