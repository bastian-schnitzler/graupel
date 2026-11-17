// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Switching to an older fetch in the installed app (REQ-782), as in the bug report from the iPhone: two fetches of the
 * place 18 minutes apart, the newest still current (gold, REQ-757). The older one chosen stays shown when the page goes
 * to the background and comes back (visibilitychange) and when the history opens again; the history marks it as shown
 * (`aria-current`, a check at its end) and the newest, still gold, without that mark. The cause was the look: the state
 * held the older fetch, but its entry only turned blue while the gold entry kept its bar at the side, which looked chosen.
 * The fix marks the entry shown with a check (DEC-145: the gold entry keeps its bar).
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
import { HistorySplitButton } from "../src/regions/History/index.ts";
import { archiveId, createMemoryArchive } from "../src/services/fetchArchive.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HistoryProvider,
  LocationProvider,
  createAppModeStore,
  createInstallPromptStore,
  useForecast,
  type AppModeWindow,
  type ForecastLoader,
  resetDisplaySettings,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/regions/History/History.css"),
  "utf8",
);

/** The installed app on the iPhone: `navigator.standalone`, the display mode not matching. */
const installedApp = () =>
  createAppModeStore({
    matchMedia: () =>
      ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: true } as AppModeWindow["navigator"],
  });

const CURRENT = forecastFixture({ latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon, name: "Newer" });
const OLDER = forecastFixture({ latitude: DEFAULT_PLACE.lat, longitude: DEFAULT_PLACE.lon, name: "Older" });
const point = `${DEFAULT_PLACE.lat.toFixed(4)},${DEFAULT_PLACE.lon.toFixed(4)}`;
/** Device time: the newest fetch on 12 November 2026 at 00:49, the older one at 00:31. */
const NOW = new Date(2026, 10, 12, 0, 49).getTime();
const OLDER_AT = new Date(2026, 10, 12, 0, 31).getTime();

/** What the page shows as the forecast: the name of its result and the time of its fetch. */
function Shown() {
  const { result, fetchedAt } = useForecast();
  return <output data-testid="shown">{`${result?.location.name ?? ""} ${fetchedAt ?? ""}`}</output>;
}

function renderApp() {
  const loader = vi.fn<ForecastLoader>(async () => CURRENT);
  const archive = createMemoryArchive([{ id: archiveId(point, OLDER_AT), point, fetchedAt: OLDER_AT, result: OLDER }]);
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
                    <Shown />
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

/** The page goes to the background and comes back, as when switching apps. */
function backgroundAndBack() {
  for (const state of ["hidden", "visible"] as const) {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
}

/** Opens the phone's history dialog from its menu and returns it. */
function openDialog(): HTMLElement {
  fireEvent.click(within(screen.getByTestId("phone-menu")).getByRole("button", { name: "Menu" }));
  fireEvent.click(within(screen.getByTestId("phone-menu-panel")).getByRole("button", { name: /^History/, hidden: true }));
  return screen.getByRole("dialog", { name: "History" });
}

/** Whether an entry carries the mark of the fetch shown: `aria-current` and the check. */
const marked = (entry: HTMLElement) =>
  entry.getAttribute("aria-current") === "true" && within(entry).queryByTestId("history-shown-check") !== null;

describe("an older fetch chosen in the installed app (REQ-782)", () => {
  it("phone's dialog: stays shown over visibilitychange and reopening, marked; the newest gold but not marked", async () => {
    renderApp();
    await settle();
    expect(screen.getByTestId("shown").textContent).toBe(`Newer ${NOW}`);
    let dialog = openDialog();
    let current = within(dialog).getByTestId("history-current");
    expect(current.textContent).toBe("12/11/2026, 00:49");
    expect(marked(current)).toBe(true);
    const older = within(dialog).getByTestId("history-fetch");
    expect(older.textContent).toBe("12/11/2026, 00:31");
    expect(marked(older)).toBe(false);
    fireEvent.click(older);
    await settle();
    expect(screen.queryByRole("dialog", { name: "History" })).toBeNull();
    expect(screen.getByTestId("shown").textContent).toBe(`Older ${OLDER_AT}`);

    backgroundAndBack();
    await settle();
    expect(screen.getByTestId("shown").textContent).toBe(`Older ${OLDER_AT}`);
    dialog = openDialog();
    current = within(dialog).getByTestId("history-current");
    // Still current (18 minutes): gold, but not marked as shown.
    expect(current.className).toContain("history-list__current");
    expect(current.getAttribute("aria-current")).toBeNull();
    expect(marked(current)).toBe(false);
    expect(within(current).queryByTestId("history-shown-check")).toBeNull();
    expect(marked(within(dialog).getByTestId("history-fetch"))).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("shown").textContent).toBe(`Older ${OLDER_AT}`);
  });

  it("desktop's menu: the same mark after visibilitychange", async () => {
    renderApp();
    await settle();
    fireEvent.click(screen.getByTestId("history-arrow"));
    fireEvent.click(within(screen.getByTestId("history-button")).getByTestId("history-fetch"));
    await settle();
    expect(screen.getByTestId("shown").textContent).toBe(`Older ${OLDER_AT}`);
    backgroundAndBack();
    await settle();
    fireEvent.click(screen.getByTestId("history-arrow"));
    const menu = screen.getByTestId("history-button");
    expect(marked(within(menu).getByTestId("history-fetch"))).toBe(true);
    expect(marked(within(menu).getByTestId("history-current"))).toBe(false);
    expect(screen.getByTestId("shown").textContent).toBe(`Older ${OLDER_AT}`);
  });

  it("the entry shown has the check but no bar of its own; the gold entry keeps its bar (REQ-782, DEC-145)", () => {
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    const shown = rule('.history-list__item[aria-current="true"]');
    expect(shown).toMatch(/font-weight: 600/);
    expect(shown).not.toMatch(/box-shadow/);
    // The gold entry has its bar whether it is shown or not.
    expect(rule(".history-list__current")).toMatch(/box-shadow: inset 3px 0 0 var\(--history-current\)/);
    expect(rule(".history-list__item:focus")).not.toMatch(/box-shadow/);
  });
});
