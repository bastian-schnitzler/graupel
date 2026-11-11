// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * History of the installed app (REQ-684): the archive of the fetches (stored, listed, replaced, cleaned up after the
 * days of REQ-686), the grouping of its menu (10 directly, months of this year, years with months, fold-outs with a
 * single entry resolved), the scroll rule and the provider that archives fetches and shows an archived one.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { HistoryList, formatMonth } from "../src/regions/History/index.ts";
import {
  archiveCutoff,
  archiveFetch,
  archiveId,
  archivedResult,
  createMemoryArchive,
  type ArchivedFetch,
  type ArchivedFetchInfo,
  type FetchArchive,
} from "../src/services/fetchArchive.ts";
import {
  ARCHIVE_DAYS_OPTIONS,
  ARCHIVE_DAYS_STORAGE_KEY,
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HistoryProvider,
  LocationProvider,
  carrySelection,
  createAppModeStore,
  groupHistory,
  readArchiveDays,
  resetDisplaySettings,
  resultDays,
  setArchiveDays,
  useDaySelection,
  useForecast,
  useForecastDays,
  useHistory,
  useLocation,
  type AppModeWindow,
  type ForecastLoader,
  type ForecastState,
  type ForecastDaysState,
  type HistoryNode,
  type HistoryState,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DAY = 86_400_000;
/** Local time of the device: the menu groups by it. */
const at = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month, day, hour, minute).getTime();
const POINT = "47.2627,11.3945";
const info = (fetchedAt: number, point = POINT): ArchivedFetchInfo => ({
  id: archiveId(point, fetchedAt),
  point,
  fetchedAt,
});
const entry = (fetchedAt: number, point = POINT): ArchivedFetch => ({
  ...info(fetchedAt, point),
  result: forecastFixture(),
});

/** Current forecast (Mon 26.10. to Sun 1.11.) and one fetched two days before (Sat 24.10. to Fri 30.10.). */
const CURRENT = forecastFixture({ latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon });
const EARLIER = forecastFixture({
  latitude: DEFAULT_PLACE.lat,
  longitude: DEFAULT_PLACE.lon,
  start: "2026-10-23T22:00:00Z",
  now: "2026-10-25T10:00:00Z",
  end: "2026-10-30T11:00:00Z",
  name: "Earlier",
});

describe("fetch archive", () => {
  it("stores, lists the fetches of a place newest first and reads one back", async () => {
    const archive = createMemoryArchive();
    await archive.put(entry(at(2026, 10, 1)));
    await archive.put(entry(at(2026, 10, 3)));
    await archive.put(entry(at(2026, 10, 2), "1.0000,2.0000"));
    expect((await archive.list(POINT)).map((fetch) => fetch.fetchedAt)).toEqual([at(2026, 10, 3), at(2026, 10, 1)]);
    expect(await archive.list("1.0000,2.0000")).toEqual([info(at(2026, 10, 2), "1.0000,2.0000")]);
    const read = await archive.get(archiveId(POINT, at(2026, 10, 3)));
    expect(read?.result.location.name).toBe("Innsbruck");
    expect(await archive.get("nothing")).toBeUndefined();
  });

  it("keeps one entry per fetch: a chain rebuilt from the same fetch replaces it", async () => {
    const archive = createMemoryArchive();
    await archive.put(entry(at(2026, 10, 1)));
    await archive.put({ ...entry(at(2026, 10, 1)), result: forecastFixture({ name: "Rebuilt" }) });
    expect(await archive.list(POINT)).toHaveLength(1);
    expect((await archive.get(archiveId(POINT, at(2026, 10, 1))))?.result.location.name).toBe("Rebuilt");
  });

  it("deletes fetches older than the days to keep (REQ-686), unlimited keeps every one", async () => {
    const now = at(2026, 10, 10);
    expect(archiveCutoff("unlimited", now)).toBeNull();
    expect(archiveCutoff(5, now)).toBe(now - 5 * DAY);
    const archive = createMemoryArchive([entry(now - 400 * DAY), entry(now - 100 * DAY), entry(now - 6 * DAY)]);
    await archiveFetch(archive, entry(now), "unlimited", now);
    expect(await archive.list(POINT)).toHaveLength(4);
    await archiveFetch(archive, entry(now), 365, now);
    expect((await archive.list(POINT)).map((fetch) => fetch.fetchedAt)).toEqual([
      now,
      now - 6 * DAY,
      now - 100 * DAY,
    ]);
    await archiveFetch(archive, entry(now), 5, now);
    expect((await archive.list(POINT)).map((fetch) => fetch.fetchedAt)).toEqual([now]);
  });

  it("stores the forecast without its raw series and with the models' errors as text", () => {
    const result = { ...forecastFixture(), raw: [{} as never], errors: { ICON: new Error("down") } };
    const stored = archivedResult(result);
    expect(stored.raw).toEqual([]);
    expect(stored.errors).toEqual({ ICON: "Error: down" });
    expect(stored.combined).toBe(result.combined);
  });

  it("keeps unlimited by default; the settings offer unlimited, 365, 90, 14 and 5 days", () => {
    expect(ARCHIVE_DAYS_OPTIONS).toEqual(["unlimited", 365, 90, 14, 5]);
    expect(readArchiveDays()).toBe("unlimited");
    setArchiveDays(14);
    expect(window.localStorage.getItem(ARCHIVE_DAYS_STORAGE_KEY)).toBe("14");
    expect(readArchiveDays()).toBe(14);
    setArchiveDays("unlimited");
    expect(window.localStorage.getItem(ARCHIVE_DAYS_STORAGE_KEY)).toBeNull();
    window.localStorage.setItem(ARCHIVE_DAYS_STORAGE_KEY, "7");
    expect(readArchiveDays()).toBe("unlimited");
  });
});

/** The menu in short: fetches by local "D.M. H:00", fold-outs by kind, year (and month) with their entries. */
function outline(nodes: readonly HistoryNode[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === "fetch") {
      const date = new Date(node.fetch.fetchedAt);
      return `${date.getDate()}.${date.getMonth() + 1}. ${date.getHours()}:00`;
    }
    const name = node.kind === "year" ? `${node.year}` : `${node.year}-${node.month + 1}`;
    return { [name]: outline(node.children) };
  });
}

describe("history menu", () => {
  const NOW = at(2026, 10, 10, 15);

  it("lists up to 10 fetches directly, newest first", () => {
    const fetches = Array.from({ length: 10 }, (_, index) => info(at(2026, 10, 10, 14 - index)));
    const nodes = groupHistory([...fetches].reverse(), NOW);
    expect(nodes).toHaveLength(10);
    expect(outline(nodes)).toEqual(Array.from({ length: 10 }, (_, index) => `10.11. ${14 - index}:00`));
  });

  it("puts older fetches in fold-outs per month of the year, then per year with months", () => {
    const direct = Array.from({ length: 10 }, (_, index) => info(at(2026, 10, 9, 20 - index)));
    const fetches = [
      ...direct,
      // Still November, beyond the 10: a fold-out of November.
      info(at(2026, 10, 2, 9)),
      info(at(2026, 10, 1, 9)),
      // October with three, September with one (shown directly).
      info(at(2026, 9, 30)),
      info(at(2026, 9, 15)),
      info(at(2026, 9, 1)),
      info(at(2026, 8, 12)),
      // 2025: two months.
      info(at(2025, 11, 24)),
      info(at(2025, 11, 1)),
      info(at(2025, 2, 3)),
      // 2024: one month with two fetches, shown as that month.
      info(at(2024, 6, 2)),
      info(at(2024, 6, 1)),
      // 2023: one fetch, shown directly.
      info(at(2023, 4, 5, 8)),
    ];
    expect(outline(groupHistory(fetches, NOW))).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `9.11. ${20 - index}:00`),
      { "2026-11": ["2.11. 9:00", "1.11. 9:00"] },
      { "2026-10": ["30.10. 12:00", "15.10. 12:00", "1.10. 12:00"] },
      "12.9. 12:00",
      { "2025": [{ "2025-12": ["24.12. 12:00", "1.12. 12:00"] }, "3.3. 12:00"] },
      { "2024-7": ["2.7. 12:00", "1.7. 12:00"] },
      "5.5. 8:00",
    ]);
  });

  it("shows the fold-outs in the list, closed, with month names (and the year outside its own fold-out)", () => {
    const fetches = [
      ...Array.from({ length: 10 }, (_, index) => info(at(2026, 10, 9, 20 - index))),
      info(at(2026, 9, 30)),
      info(at(2026, 9, 15)),
      info(at(2024, 6, 2)),
      info(at(2024, 6, 1)),
    ];
    const onShow = vi.fn();
    render(
      <I18nProvider languages={["de"]} fallbackLanguage="de">
        <HistoryList fetches={fetches} shown={null} onShow={onShow} onCurrent={() => {}} now={NOW} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("history-current").getAttribute("aria-current")).toBe("true");
    const fetchItems = screen.getAllByTestId("history-fetch");
    expect(fetchItems).toHaveLength(14);
    // The 10 newest directly, the others in closed fold-outs.
    expect(fetchItems.filter((item) => !item.closest("[hidden]"))).toHaveLength(10);
    const groups = screen.getAllByTestId("history-group");
    expect(groups.map((group) => group.textContent)).toEqual([
      formatMonth(2026, 9, "de-DE", false),
      formatMonth(2024, 6, "de-DE", true),
    ]);
    expect(groups[1]!.textContent).toContain("2024");
    expect(groups[0]!.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(groups[0]!);
    expect(groups[0]!.getAttribute("aria-expanded")).toBe("true");
    const october = within(groups[0]!.parentElement!).getAllByTestId("history-fetch");
    fireEvent.click(october[0]!);
    expect(onShow).toHaveBeenCalledWith(info(at(2026, 9, 30)));
  });

  it("opens the fold-out holding the fetch shown and marks it", () => {
    const fetches = [
      ...Array.from({ length: 10 }, (_, index) => info(at(2026, 10, 9, 20 - index))),
      info(at(2026, 9, 30)),
      info(at(2026, 9, 15)),
    ];
    render(
      <I18nProvider languages={["en"]} fallbackLanguage="en">
        <HistoryList fetches={fetches} shown={info(at(2026, 9, 15))} onShow={() => {}} onCurrent={() => {}} now={NOW} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("history-group").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("history-current").getAttribute("aria-current")).toBeNull();
    const marked = screen.getAllByTestId("history-fetch").filter((item) => item.getAttribute("aria-current"));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain("15");
  });
});

describe("scroll rule", () => {
  const ZONE = "Europe/Vienna";
  // Current: Mon 26.10. to Sun 1.11.; fetched two days earlier: Sat 24.10. to Fri 30.10.
  const current = resultDays(CURRENT);
  const archived = resultDays(EARLIER);

  it("keeps the day on the left when the other forecast has it", () => {
    expect(current).toHaveLength(7);
    expect(archived).toHaveLength(7);
    // Every day selected: the left day (26.10.) stays on the left, every day after it selected.
    expect(carrySelection(current, ZONE, null, archived, ZONE)).toEqual({ start: 2, end: 6 });
    // Two days from Wed 28.10.: the same two days.
    expect(carrySelection(current, ZONE, { start: 2, end: 3 }, archived, ZONE)).toEqual({ start: 4, end: 5 });
    // A selection to the last day goes to the last day.
    expect(carrySelection(current, ZONE, { start: 3, end: 6 }, archived, ZONE)).toEqual({ start: 5, end: 6 });
    // Back: 26.10. is the current forecast's first day, every day selected again.
    expect(carrySelection(archived, ZONE, { start: 2, end: 6 }, current, ZONE)).toBeNull();
  });

  it("starts at the front when the day on the left is not in the other forecast", () => {
    // 24.10. is not in the current forecast.
    expect(carrySelection(archived, ZONE, null, current, ZONE)).toBeNull();
    expect(carrySelection(archived, ZONE, { start: 0, end: 1 }, current, ZONE)).toEqual({ start: 0, end: 1 });
    // Sat 31.10. is not in the archived one: as many days from its front.
    expect(carrySelection(current, ZONE, { start: 5, end: 5 }, archived, ZONE)).toEqual({ start: 0, end: 0 });
  });
});

// --- provider -----------------------------------------------------------------------------------------------------

/** A display that is the website or the installed app. */
const display = (installed: boolean) =>
  createAppModeStore({
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: installed } as AppModeWindow["navigator"],
  });

let history: HistoryState;
let forecast: ForecastState;
let forecastDaysState: ForecastDaysState;
let setSelection: ReturnType<typeof useDaySelection>["setSelection"];
let location: ReturnType<typeof useLocation>;

function Probe() {
  const value = useHistory();
  const shown = useForecast();
  const days = useForecastDays();
  const selection = useDaySelection();
  const place = useLocation();
  useEffect(() => {
    history = value;
    forecast = shown;
    forecastDaysState = days;
    setSelection = selection.setSelection;
    location = place;
  });
  return null;
}

function renderHistory(archive: FetchArchive, installed = true, loader?: ForecastLoader) {
  const load = loader ?? vi.fn<ForecastLoader>(async () => CURRENT);
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <LocationProvider>
        <ChainProvider>
          <ForecastProvider loader={load}>
            <DaySelectionProvider>
              <HistoryProvider archive={archive} appMode={display(installed)}>
                <Probe />
              </HistoryProvider>
            </DaySelectionProvider>
          </ForecastProvider>
        </ChainProvider>
      </LocationProvider>
    </ConfigProvider>,
  );
  return load;
}

const flush = () => act(async () => {});
const point = `${DEFAULT_PLACE.lat.toFixed(4)},${DEFAULT_PLACE.lon.toFixed(4)}`;
const earlierAt = Date.UTC(2026, 9, 25, 10, 12);

describe("HistoryProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 27, 10, 30));
  });

  it("archives each fetch in the installed app and lists only the earlier ones", async () => {
    const archive = createMemoryArchive([{ id: archiveId(point, earlierAt), point, fetchedAt: earlierAt, result: EARLIER }]);
    renderHistory(archive);
    await flush();
    await flush();
    expect(forecast.status).toBe("ready");
    const stored = await archive.list(point);
    expect(stored.map((fetch) => fetch.fetchedAt)).toEqual([Date.UTC(2026, 9, 27, 10, 30), earlierAt]);
    expect(history.available).toBe(true);
    // The fetch shown as current values is not in the history.
    expect(history.fetches).toEqual([info(earlierAt, point)]);
    expect(history.shown).toBeNull();
  });

  it("keeps no history on the website", async () => {
    const archive = createMemoryArchive([{ id: archiveId(point, earlierAt), point, fetchedAt: earlierAt, result: EARLIER }]);
    renderHistory(archive, false);
    await flush();
    await flush();
    expect(forecast.status).toBe("ready");
    expect(await archive.list(point)).toHaveLength(1);
    expect(history.available).toBe(false);
    expect(history.fetches).toEqual([]);
  });

  it("deletes older fetches after the days to keep", async () => {
    setArchiveDays(5);
    const old = Date.UTC(2026, 9, 10);
    const archive = createMemoryArchive([
      { id: archiveId(point, old), point, fetchedAt: old, result: EARLIER },
      { id: archiveId(point, earlierAt), point, fetchedAt: earlierAt, result: EARLIER },
    ]);
    renderHistory(archive);
    await flush();
    await flush();
    expect((await archive.list(point)).map((fetch) => fetch.fetchedAt)).not.toContain(old);
    expect(history.fetches).toEqual([info(earlierAt, point)]);
  });

  it("shows an archived fetch with the scroll rule and goes back to the current values", async () => {
    const archive = createMemoryArchive([{ id: archiveId(point, earlierAt), point, fetchedAt: earlierAt, result: EARLIER }]);
    renderHistory(archive);
    await flush();
    await flush();
    expect(forecastDaysState.days).toHaveLength(7);
    await act(() => history.show(archiveId(point, earlierAt)));
    expect(forecast.result?.location.name).toBe("Earlier");
    expect(forecast.archived).toBe(true);
    expect(forecast.fetchedAt).toBe(earlierAt);
    expect(history.shown).toEqual(info(earlierAt, point));
    // Monday 26.10. stood on the left (every day selected) and stands there again: third day of the archived fetch.
    expect(forecastDaysState.selection).toEqual({ start: 2, end: 6 });
    expect(forecastDaysState.days[2]!.start).toBe(Date.UTC(2026, 9, 25, 23));
    // Back: 26.10. is the first day again, every day selected.
    act(() => history.showCurrent());
    expect(forecast.archived).toBeUndefined();
    expect(forecast.result?.location.name).toBe("Innsbruck");
    expect(forecastDaysState.whole).toBe(true);
    // Saturday 31.10. on the left is not in the archived fetch: it starts at its front.
    act(() => setSelection({ start: 5, end: 5 }));
    await act(() => history.show(archiveId(point, earlierAt)));
    expect(forecastDaysState.selection).toEqual({ start: 0, end: 0 });
  });

  it("ends the archived view on another place and on a reload", async () => {
    const archive = createMemoryArchive([{ id: archiveId(point, earlierAt), point, fetchedAt: earlierAt, result: EARLIER }]);
    const loader = vi.fn<ForecastLoader>(async (request) =>
      forecastFixture({ latitude: request.location.latitude, longitude: request.location.longitude }),
    );
    renderHistory(archive, true, loader);
    await flush();
    await flush();
    await act(() => history.show(archiveId(point, earlierAt)));
    expect(forecast.archived).toBe(true);
    vi.setSystemTime(Date.UTC(2026, 9, 27, 11));
    act(() => forecast.reload());
    expect(history.shown).toBeNull();
    await flush();
    await flush();
    expect(forecast.status).toBe("ready");
    // The fetch shown before the reload is now an earlier one.
    expect(history.fetches.map((fetch) => fetch.fetchedAt)).toEqual([Date.UTC(2026, 9, 27, 10, 30), earlierAt]);
    await act(() => history.show(archiveId(point, earlierAt)));
    expect(forecast.archived).toBe(true);
    act(() => location.setLocation({ name: "Elsewhere", lat: 46, lon: 12 }));
    expect(history.shown).toBeNull();
    expect(forecast.archived).toBeUndefined();
    await flush();
    await flush();
    expect(history.fetches).toEqual([]);
  });

  it("ignores a fetch of another place", async () => {
    const other = "46.0000,12.0000";
    const archive = createMemoryArchive([{ id: archiveId(other, earlierAt), point: other, fetchedAt: earlierAt, result: EARLIER }]);
    renderHistory(archive);
    await flush();
    await flush();
    expect(history.fetches).toEqual([]);
    await act(() => history.show(archiveId(other, earlierAt)));
    expect(history.shown).toBeNull();
    expect((forecast.result as ForecastResult).location.name).toBe("Innsbruck");
  });
});
