// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The newest fetch counts as the current values only while it is at most 20 minutes old (REQ-757): then it stands in
 * gold on top of the history with a gold clock at the button and in the phone's menu entry; older, there is no gold
 * entry, its fetch stands without gold among the earlier ones and the clock is no longer gold. The switch happens by
 * itself while the page stays open: a timer, a check when the history opens and when the page shows again.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { PhoneMenu } from "../src/regions/Header/index.ts";
import { HistorySplitButton } from "../src/regions/History/index.ts";
import { archiveId, createMemoryArchive } from "../src/services/fetchArchive.ts";
import {
  CURRENT_MAX_AGE,
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HistoryProvider,
  LocationProvider,
  createAppModeStore,
  createInstallPromptStore,
  isCurrentFetch,
  resetDisplaySettings,
  type AppModeWindow,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const installedApp = () =>
  createAppModeStore({
    matchMedia: () =>
      ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: true } as AppModeWindow["navigator"],
  });

const CURRENT = forecastFixture({ latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon });
const EARLIER = forecastFixture({
  latitude: DEFAULT_PLACE.lat,
  longitude: DEFAULT_PLACE.lon,
  start: "2026-10-23T22:00:00Z",
  now: "2026-10-25T10:00:00Z",
  end: "2026-10-30T11:00:00Z",
  name: "Earlier",
});
const point = `${DEFAULT_PLACE.lat.toFixed(4)},${DEFAULT_PLACE.lon.toFixed(4)}`;
/** Device time: the current fetch on 27 October 2026 at 10:30, the earlier one on 25 October at 10:12. */
const NOW = new Date(2026, 9, 27, 10, 30).getTime();
const EARLIER_AT = new Date(2026, 9, 25, 10, 12).getTime();
const MINUTE = 60_000;
/** 19:59 and 20:01 minutes. */
const JUST_CURRENT = 19 * MINUTE + 59_000;
const JUST_OLD = 20 * MINUTE + 1_000;

function renderApp() {
  const loader = vi.fn<ForecastLoader>(async () => CURRENT);
  const archive = createMemoryArchive([
    { id: archiveId(point, EARLIER_AT), point, fetchedAt: EARLIER_AT, result: EARLIER },
  ]);
  const installPrompt = createInstallPromptStore(new EventTarget() as Window);
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={DEFAULT_CONFIG.languages} fallbackLanguage="en" browserLanguages={["en"]}>
        <DialogsProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <HistoryProvider archive={archive} appMode={installedApp()}>
                    <HistorySplitButton />
                    <PhoneMenu appMode={installedApp()} installPrompt={installPrompt} />
                  </HistoryProvider>
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const flush = () => act(async () => {});
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const button = () => screen.getByTestId("history-button");
const goldClock = () => screen.getByTestId("history-main").classList.contains("location__history-main--current");
const phoneEntry = () =>
  within(screen.getByTestId("phone-menu-panel")).getByRole("button", { name: /^History/, hidden: true });

/** Opens the desktop's menu (closed before) and returns its current entry and its fetches. */
function openMenu() {
  fireEvent.click(screen.getByTestId("history-arrow"));
  return {
    current: within(button()).queryByTestId("history-current"),
    fetches: within(button())
      .queryAllByTestId("history-fetch")
      .map((entry) => entry.textContent),
  };
}

describe("current values only up to 20 minutes (REQ-757)", () => {
  it("counts a fetch as current up to 20 minutes, not beyond", () => {
    expect(CURRENT_MAX_AGE).toBe(20 * MINUTE);
    expect(isCurrentFetch(NOW, NOW)).toBe(true);
    expect(isCurrentFetch(NOW, NOW + JUST_CURRENT)).toBe(true);
    expect(isCurrentFetch(NOW, NOW + 20 * MINUTE)).toBe(true);
    expect(isCurrentFetch(NOW, NOW + JUST_OLD)).toBe(false);
    // A clock set back: still current.
    expect(isCurrentFetch(NOW, NOW - MINUTE)).toBe(true);
  });

  it("19:59 minutes old: gold entry on top, gold clock at the button and in the phone's entry", async () => {
    renderApp();
    await settle();
    act(() => vi.advanceTimersByTime(JUST_CURRENT));
    expect(goldClock()).toBe(true);
    expect(phoneEntry().className).toContain("phone-menu__item--history-current");
    const { current, fetches } = openMenu();
    expect(current?.textContent).toBe("27/10/2026, 10:30");
    expect(current?.className).toContain("history-list__current");
    expect(fetches).toEqual(["25/10/2026, 10:12"]);
  });

  it("20:01 minutes old: no current entry, the fetch among the earlier ones, no gold clock, by itself", async () => {
    renderApp();
    await settle();
    act(() => vi.advanceTimersByTime(JUST_OLD));
    expect(goldClock()).toBe(false);
    expect(phoneEntry().className).not.toContain("phone-menu__item--history-current");
    const { current, fetches } = openMenu();
    expect(current).toBeNull();
    expect(within(button()).queryByRole("separator")).toBeNull();
    expect(fetches).toEqual(["27/10/2026, 10:30", "25/10/2026, 10:12"]);
    const entry = within(button()).getAllByTestId("history-fetch")[0]!;
    expect(entry.className).not.toContain("history-list__current");
    // Still the current values: marked, and choosing it keeps them.
    expect(entry.getAttribute("aria-current")).toBe("true");
    fireEvent.click(entry);
    await settle();
    expect(screen.getByTestId("history-day").textContent).toBe("27/10");
  });

  it("checks again when the menu opens and when the page shows again (timers may sleep)", async () => {
    renderApp();
    await settle();
    // The clock jumps without the timer running.
    act(() => vi.setSystemTime(NOW + JUST_OLD));
    expect(goldClock()).toBe(true);
    expect(openMenu().current).toBeNull();
    expect(goldClock()).toBe(false);
    cleanup();

    vi.setSystemTime(NOW);
    renderApp();
    await settle();
    act(() => vi.setSystemTime(NOW + JUST_OLD));
    expect(goldClock()).toBe(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(goldClock()).toBe(false);
  });

  it("checks again when the phone's menu opens", async () => {
    renderApp();
    await settle();
    act(() => vi.setSystemTime(NOW + JUST_OLD));
    expect(phoneEntry().className).toContain("phone-menu__item--history-current");
    fireEvent.click(within(screen.getByTestId("phone-menu")).getByRole("button", { name: "Menu" }));
    expect(phoneEntry().className).not.toContain("phone-menu__item--history-current");
  });
});
