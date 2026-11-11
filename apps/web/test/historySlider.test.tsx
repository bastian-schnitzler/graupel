// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * History slider of the phone (REQ-685): the days from the archive (each day once with its last fetch, at most 16 with
 * today on the right), the one marked day, and the strip itself: only on a phone with the setting, in the installed
 * app and with a history; a tap shows the day's last fetch or the current values.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { HistorySlider } from "../src/regions/History/index.ts";
import { archiveId, createMemoryArchive, type ArchivedFetch, type ArchivedFetchInfo } from "../src/services/fetchArchive.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HISTORY_SLIDER_DAYS,
  HistoryProvider,
  LocationProvider,
  createAppModeStore,
  historyDays,
  markedHistoryDay,
  resetDisplaySettings,
  setHistorySlider,
  useForecast,
  useForecastDays,
  useHistory,
  type AppModeWindow,
  type ForecastDaysState,
  type ForecastLoader,
  type ForecastState,
  type HistoryState,
} from "../src/state/index.ts";
import { PHONE_QUERY } from "../src/state/phoneLandscape.ts";
import { forecastFixture } from "./forecastFixture.ts";

const DAY = 86_400_000;
const ZONE = "Europe/Vienna";
const POINT = `${DEFAULT_PLACE.lat.toFixed(4)},${DEFAULT_PLACE.lon.toFixed(4)}`;
const info = (fetchedAt: number): ArchivedFetchInfo => ({ id: archiveId(POINT, fetchedAt), point: POINT, fetchedAt });

/** Tuesday, 27 October 2026, 10:30 UTC. */
const NOW = Date.UTC(2026, 9, 27, 10, 30);

describe("days of the history slider", () => {
  it("ends with today, standing for the current values, and lists each earlier day once with its last fetch", () => {
    const fetches = [
      info(Date.UTC(2026, 9, 27, 6)), // earlier today: today stays the current values
      info(Date.UTC(2026, 9, 25, 18)),
      info(Date.UTC(2026, 9, 25, 7)),
      info(Date.UTC(2026, 9, 25, 12)),
      info(Date.UTC(2026, 9, 20, 9)),
    ];
    const days = historyDays(fetches, NOW, ZONE);
    expect(days.map((day) => day.key)).toEqual(["2026-10-20", "2026-10-25", "2026-10-27"]);
    expect(days.map((day) => day.fetch?.fetchedAt ?? null)).toEqual([
      Date.UTC(2026, 9, 20, 9),
      Date.UTC(2026, 9, 25, 18),
      null,
    ]);
    expect(days.at(-1)!.time).toBe(NOW);
  });

  it("counts days in the given time zone", () => {
    // 23:30 UTC on 25 October is already 26 October in Vienna.
    const late = info(Date.UTC(2026, 9, 25, 23, 30));
    expect(historyDays([late], NOW, ZONE)[0]!.key).toBe("2026-10-26");
    expect(historyDays([late], NOW, "UTC")[0]!.key).toBe("2026-10-25");
  });

  it("keeps at most 16 days: today and the last 15 earlier ones", () => {
    const fetches = Array.from({ length: 30 }, (_, index) => info(NOW - (index + 1) * DAY));
    const days = historyDays(fetches, NOW, ZONE);
    expect(HISTORY_SLIDER_DAYS).toBe(16);
    expect(days).toHaveLength(16);
    expect(days[0]!.key).toBe("2026-10-12");
    expect(days[14]!.key).toBe("2026-10-26");
    expect(days[15]).toEqual({ key: "2026-10-27", time: NOW, fetch: null });
  });

  it("only today without earlier days; a fetch after today (clock set back) is left out", () => {
    expect(historyDays([info(NOW + 2 * DAY)], NOW, ZONE).map((day) => day.key)).toEqual(["2026-10-27"]);
    expect(historyDays([], NOW, ZONE)).toHaveLength(1);
  });

  it("marks exactly one day: today with the current values, else the day of the fetch shown", () => {
    const last = info(Date.UTC(2026, 9, 25, 18));
    const earlier = info(Date.UTC(2026, 9, 25, 7));
    const days = historyDays([info(Date.UTC(2026, 9, 20, 9)), last, earlier], NOW, ZONE);
    expect(markedHistoryDay(days, null, ZONE)).toBe(2);
    expect(markedHistoryDay(days, last, ZONE)).toBe(1);
    // An earlier fetch of the day (chosen in the menu) marks its day too.
    expect(markedHistoryDay(days, earlier, ZONE)).toBe(1);
    // A fetch of today chosen in the menu marks today.
    expect(markedHistoryDay(days, info(Date.UTC(2026, 9, 27, 6)), ZONE)).toBe(2);
    // A fetch older than the slider's days marks none.
    expect(markedHistoryDay(days, info(Date.UTC(2026, 8, 1, 9)), ZONE)).toBe(-1);
  });
});

// --- the strip ----------------------------------------------------------------------------------------------------

function stubMedia(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === PHONE_QUERY,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

const display = (installed: boolean) =>
  createAppModeStore({
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: installed } as AppModeWindow["navigator"],
  });

const CURRENT = forecastFixture({ latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon });
const archived = (fetchedAt: number, name: string): ArchivedFetch => ({
  ...info(fetchedAt),
  result: forecastFixture({
    latitude: DEFAULT_PLACE.lat,
    longitude: DEFAULT_PLACE.lon,
    start: "2026-10-23T22:00:00Z",
    now: "2026-10-25T10:00:00Z",
    end: "2026-10-30T11:00:00Z",
    name,
  }),
});

let history: HistoryState;
let forecast: ForecastState;
let forecastDays: ForecastDaysState;

function Probe() {
  const value = useHistory();
  const shown = useForecast();
  const days = useForecastDays();
  useEffect(() => {
    history = value;
    forecast = shown;
    forecastDays = days;
  });
  return null;
}

async function renderSlider(entries: ArchivedFetch[], installed = true) {
  const loader = vi.fn<ForecastLoader>(async () => CURRENT);
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={DEFAULT_CONFIG.languages} browserLanguages={["en"]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <HistoryProvider archive={createMemoryArchive(entries)} appMode={display(installed)}>
                  <HistorySlider />
                  <Probe />
                </HistoryProvider>
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}

const slider = () => screen.queryByTestId("history-slider");
const days = () => screen.getAllByTestId("history-slider-day");

describe("HistorySlider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.localStorage.clear();
    resetDisplaySettings();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    resetDisplaySettings();
  });

  const MON = Date.UTC(2026, 9, 26, 12);
  const SAT_EARLY = Date.UTC(2026, 9, 24, 8);
  const SAT_LATE = Date.UTC(2026, 9, 24, 16);

  it("only on a phone, with the setting, in the installed app and with a history", async () => {
    const entries = [archived(MON, "Monday")];
    stubMedia(true);
    await renderSlider(entries);
    // The setting is off by default.
    expect(slider()).toBeNull();
    cleanup();
    setHistorySlider(true);
    await renderSlider(entries);
    expect(slider()).not.toBeNull();
    cleanup();
    // The website keeps no history.
    await renderSlider(entries, false);
    expect(slider()).toBeNull();
    cleanup();
    // No earlier fetch.
    await renderSlider([]);
    expect(slider()).toBeNull();
    cleanup();
    // Not on a desktop.
    stubMedia(false);
    await renderSlider(entries);
    expect(slider()).toBeNull();
  });

  it("puts today on the right, each day once, and leaves the fields before them empty", async () => {
    stubMedia(true);
    setHistorySlider(true);
    await renderSlider([archived(SAT_EARLY, "Early"), archived(SAT_LATE, "Late"), archived(MON, "Monday")]);
    expect(screen.getByRole("group", { name: "Days with kept fetches" })).toBeTruthy();
    expect(days().map((day) => day.dataset.day)).toEqual(["2026-10-24", "2026-10-26", "2026-10-27"]);
    // Sixteen fields, the days in the last three.
    expect(days().map((day) => day.style.gridColumn)).toEqual(["14", "15", "16"]);
    expect(days().map((day) => day.textContent)).toEqual(["Sa24", "Mo26", "Tu27"]);
    const today = days()[2]!;
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.getAttribute("aria-label")).toBe("Tuesday 27 October: Current values");
    expect(days()[0]!.getAttribute("aria-label")).toMatch(/^Saturday 24 October: Fetched on 24\/10\/2026, /);
  });

  it("marks one day: today purple and gold with the current values, else the day shown", async () => {
    stubMedia(true);
    setHistorySlider(true);
    await renderSlider([archived(SAT_EARLY, "Early"), archived(SAT_LATE, "Late"), archived(MON, "Monday")]);
    const marked = () => days().filter((day) => day.getAttribute("aria-pressed") === "true");
    expect(marked().map((day) => day.dataset.day)).toEqual(["2026-10-27"]);
    expect(days()[2]!.className).toContain("history-day--today");
    expect(days()[2]!.className).toContain("history-day--marked");
    // A tap on Saturday loads its last fetch, with the scroll rule: Monday 26 stays on the left.
    expect(forecastDays.days).toHaveLength(7);
    fireEvent.click(days()[0]!);
    await act(async () => {});
    expect(forecast.archived).toBe(true);
    expect(forecast.result?.location.name).toBe("Late");
    expect(history.shown?.fetchedAt).toBe(SAT_LATE);
    expect(forecastDays.selection).toEqual({ start: 2, end: 6 });
    expect(marked().map((day) => day.dataset.day)).toEqual(["2026-10-24"]);
    // Today keeps its gold, unmarked.
    expect(days()[2]!.className).toContain("history-day--today");
    expect(days()[2]!.className).not.toContain("history-day--marked");
    // Today goes back to the current values.
    fireEvent.click(days()[2]!);
    await act(async () => {});
    expect(forecast.archived).toBeUndefined();
    expect(history.shown).toBeNull();
    expect(forecastDays.whole).toBe(true);
    expect(marked().map((day) => day.dataset.day)).toEqual(["2026-10-27"]);
  });

  it("a fetch of today chosen in the menu marks today, and today goes back to the current values", async () => {
    stubMedia(true);
    setHistorySlider(true);
    const early = Date.UTC(2026, 9, 27, 6);
    await renderSlider([archived(early, "This morning"), archived(MON, "Monday")]);
    expect(days().map((day) => day.dataset.day)).toEqual(["2026-10-26", "2026-10-27"]);
    await act(() => history.show(archiveId(POINT, early)));
    expect(forecast.result?.location.name).toBe("This morning");
    expect(days()[1]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(days()[1]!);
    await act(async () => {});
    expect(history.shown).toBeNull();
  });
});
