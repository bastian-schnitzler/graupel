// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The date of the fetch shown at the history (REQ-726): beside the clock of the desktop's split button and in the
 * phone's menu entry, for the current values as for an archived fetch, in the active language. The list names the
 * current values by the date and time of their fetch, in gold with a gold bar at the side (REQ-727).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { PhoneMenu } from "../src/regions/Header/index.ts";
import { HistoryList, HistorySplitButton } from "../src/regions/History/index.ts";
import { archiveId, createMemoryArchive, type FetchArchive } from "../src/services/fetchArchive.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HistoryProvider,
  LocationProvider,
  createAppModeStore,
  createInstallPromptStore,
  resetDisplaySettings,
  type AppModeWindow,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/regions/History/History.css"),
  "utf8",
);

/** The installed app (the history is kept only there). */
const installedApp = () =>
  createAppModeStore({
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
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
/** Device time: the current fetch on Tuesday 27 October 2026 at 10:30, the earlier one on 25 October at 10:12. */
const NOW = new Date(2026, 9, 27, 10, 30).getTime();
const EARLIER_AT = new Date(2026, 9, 25, 10, 12).getTime();

const archiveWithEarlier = (): FetchArchive =>
  createMemoryArchive([{ id: archiveId(point, EARLIER_AT), point, fetchedAt: EARLIER_AT, result: EARLIER }]);

function renderApp(language: string, archive = archiveWithEarlier()) {
  const loader = vi.fn<ForecastLoader>(async () => CURRENT);
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={DEFAULT_CONFIG.languages} fallbackLanguage="en" browserLanguages={[language]}>
        <DialogsProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <HistoryProvider archive={archive} appMode={installedApp()}>
                    <HistorySplitButton />
                    <PhoneMenu appMode={installedApp()} installPrompt={createInstallPromptStore(new EventTarget() as Window)} />
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const phoneEntry = () =>
  within(screen.getByTestId("phone-menu-panel")).getByRole("button", { name: /^(Historie|History)/, hidden: true });

describe("date at the history (REQ-726)", () => {
  it("names the current values' day beside the clock and in the phone's entry, in the language", async () => {
    renderApp("de");
    await settle();
    expect(screen.getByTestId("history-day").textContent).toBe("27.10.");
    // Still the gold clock of the current values, its name with date and time.
    expect(screen.getByTestId("history-main").className).toContain("location__history-main--current");
    expect(screen.getByTestId("history-main").getAttribute("aria-label")).toBe(
      "Abruf vom 27.10.2026, 10:30. Historie anzeigen",
    );
    expect(phoneEntry().textContent).toBe("Historie · 27.10.");
  });

  it("follows the fetch chosen, and back to the current values", async () => {
    renderApp("en");
    await settle();
    expect(screen.getByTestId("history-day").textContent).toBe("27/10");
    fireEvent.click(screen.getByTestId("history-arrow"));
    fireEvent.click(within(screen.getByTestId("history-button")).getByTestId("history-fetch"));
    await settle();
    expect(screen.getByTestId("history-day").textContent).toBe("25/10");
    expect(phoneEntry().textContent).toBe("History · 25/10");
    expect(screen.getByTestId("history-main").getAttribute("aria-label")).toBe(
      "Fetched on 25/10/2026, 10:12. Back to the current values",
    );
    fireEvent.click(screen.getByTestId("history-main"));
    await settle();
    expect(screen.getByTestId("history-day").textContent).toBe("27/10");
    expect(phoneEntry().textContent).toBe("History · 27/10");
  });
});

describe("current values in the list (REQ-727)", () => {
  it("names them by date and time instead of 'current values', in the gold class", async () => {
    renderApp("de");
    await settle();
    fireEvent.click(screen.getByTestId("history-arrow"));
    const current = within(screen.getByTestId("history-button")).getByTestId("history-current");
    expect(current.textContent).toBe("27.10.2026, 10:30");
    expect(current.textContent).not.toContain("Aktuelle Werte");
    expect(current.getAttribute("aria-label")).toBe("Aktuelle Werte: 27.10.2026, 10:30");
    expect(current.className).toContain("history-list__current");
    expect(current.getAttribute("aria-current")).toBe("true");
  });

  it("says 'current values' only without a fetch time", () => {
    render(
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={["en"]}>
        <HistoryList fetches={[]} shown={null} onShow={() => {}} onCurrent={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("history-current").textContent).toBe("Current values");
  });

  it("gives the entry gold text and a gold bar at the side, marked, focused or not", () => {
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".history-list")).toMatch(/--history-current: #b7791f/);
    const current = rule('.history-list__current,\n.history-list__current[aria-current="true"]');
    expect(current).toMatch(/color: var\(--history-current\)/);
    expect(current).toMatch(/box-shadow: inset 3px 0 0 var\(--history-current\)/);
    expect(rule(".history-list__current:focus")).toMatch(/box-shadow: inset 3px 0 0 var\(--history-current\)/);
    // A dark theme has its own gold.
    expect(css).toMatch(/\[data-theme="dark"\] \.history-list \{\s*--history-current: #e0a940/);
  });
});
