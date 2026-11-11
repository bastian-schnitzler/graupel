// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Settings of REQ-470, REQ-472 and REQ-473: start place, model headers, day slider and days. An own choice in the
 * settings popup overrides config.json, without one config.json applies, and each goes through export and import.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig, type Place } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  ChainProvider,
  DAYS_STORAGE_KEY,
  DAY_SLIDER_STORAGE_KEY,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  MODEL_HEADERS_STORAGE_KEY,
  START_LOCATION_STORAGE_KEY,
  daySliderChoice,
  daysChoice,
  effectiveDaySlider,
  effectiveStartLocation,
  modelHeadersChoice,
  parseSettingsFile,
  resetDisplaySettings,
  serializeSettingsFile,
  startLocationChoice,
  storeFavorites,
  useDaySlider,
  useLocation,
  useModelHeaders,
  useStartLocation,
  type ForecastLoader,
  type StartLocationChoice,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const MATTERHORN: Place = { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 };
const INNSBRUCK: Place = { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 };
const ORTLER: Place = { name: "Ortler", lat: 46.5089, lon: 10.5446, elevation: 3905 };

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe() {
  const start = useStartLocation();
  const daySlider = useDaySlider();
  return (
    <output data-testid="probe">
      {JSON.stringify({ start, modelHeaders: useModelHeaders(), daySlider, place: useLocation().place.name })}
    </output>
  );
}

const probe = () =>
  JSON.parse(screen.getByTestId("probe").textContent!) as {
    start: StartLocationChoice;
    modelHeaders: boolean;
    daySlider: GraupelConfig["daySlider"];
    place: string;
  };

function setup(config: Partial<GraupelConfig> = {}) {
  return render(
    <ConfigProvider config={{ ...DEFAULT_CONFIG, ...config }}>
      <I18nProvider browserLanguages={["en"]}>
        <DialogsProvider>
          <LocationProvider>
            <Header />
            <Probe />
          </LocationProvider>
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

/** Opens the settings popup at a tab (REQ-686). */
const openSettings = (tab: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = within(screen.getByRole("dialog", { name: "Settings" }));
  fireEvent.click(dialog.getByRole("tab", { name: tab }));
  return dialog;
};

describe("start place (REQ-470)", () => {
  it("is the own choice, else (without a remembered place, REQ-599) startLocation from config.json", () => {
    expect(effectiveStartLocation(null, MATTERHORN)).toEqual(MATTERHORN);
    expect(effectiveStartLocation(null, "gps")).toBe("gps");
    expect(effectiveStartLocation("gps", MATTERHORN)).toBe("gps");
    expect(effectiveStartLocation(INNSBRUCK, "gps")).toEqual(INNSBRUCK);
  });

  it("follows config.json without a stored choice and without a remembered place", () => {
    setup({ startLocation: ORTLER });
    expect(startLocationChoice.read()).toBeNull();
    // No own choice: the place shown last (REQ-599); none is remembered yet.
    expect(probe()).toMatchObject({ start: "last", place: "Ortler" });
  });

  it("starts at a stored fixed place instead of the one of config.json", () => {
    window.localStorage.setItem(START_LOCATION_STORAGE_KEY, JSON.stringify(INNSBRUCK));
    setup({ startLocation: ORTLER });
    expect(probe()).toMatchObject({ start: INNSBRUCK, place: "Innsbruck" });
  });

  it("ignores a stored value that is no start place", () => {
    window.localStorage.setItem(START_LOCATION_STORAGE_KEY, '{"name":"x","lat":200,"lon":0}');
    setup({ startLocation: ORTLER });
    expect(startLocationChoice.read()).toBeNull();
    expect(probe().place).toBe("Ortler");
  });

  it("with GPS shows the first own favourite and asks for the position at start (DEC-107)", async () => {
    // The browser asks the user, who has yet to answer.
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition },
      permissions: { query: vi.fn(async () => ({ state: "prompt" })) },
    });
    storeFavorites([INNSBRUCK, MATTERHORN]);
    startLocationChoice.set("gps");
    setup({ startLocation: ORTLER });
    expect(probe()).toMatchObject({ start: "gps", place: "Innsbruck" });
    await act(async () => {});
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(probe()).toMatchObject({ start: "gps", place: "Innsbruck" });
  });

  it("with GPS uses the position at start when the browser already allows it", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 47.123456, longitude: 11.654321 } } as GeolocationPosition),
    );
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition },
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
    });
    startLocationChoice.set("gps");
    setup();
    await waitFor(() => expect(probe().place).toBe("My location"));
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("is chosen in the settings popup from the place shown last, GPS and the favourites", () => {
    storeFavorites([MATTERHORN, INNSBRUCK]);
    setup({ startLocation: ORTLER });
    const dialog = openSettings("Start");
    const select = dialog.getByRole("combobox", { name: "Start place" }) as HTMLSelectElement;
    // The place shown last comes first and is the default (REQ-599); the fixed place of config.json is no favourite:
    // offered too.
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Last selected place",
      "Current position (GPS)",
      "Ortler",
      "Matterhorn",
      "Innsbruck",
    ]);
    expect(select.selectedOptions[0]!.textContent).toBe("Last selected place");

    fireEvent.change(select, { target: { value: select.options[4]!.value } });
    expect(startLocationChoice.read()).toEqual(INNSBRUCK);
    expect(JSON.parse(window.localStorage.getItem(START_LOCATION_STORAGE_KEY)!)).toEqual(INNSBRUCK);
    expect(probe().start).toEqual(INNSBRUCK);
    // The place shown now stays; the choice applies at the next start.
    expect(probe().place).toBe("Ortler");

    fireEvent.change(select, { target: { value: "gps" } });
    expect(window.localStorage.getItem(START_LOCATION_STORAGE_KEY)).toBe("gps");
    expect(select.value).toBe("gps");
  });
});

describe("model headers (REQ-472)", () => {
  it.each([true, false])("follow config.json (%s) without a stored choice", (modelHeaders) => {
    setup({ modelHeaders });
    expect(modelHeadersChoice.read()).toBeNull();
    expect(probe().modelHeaders).toBe(modelHeaders);
  });

  it("follow a stored choice instead of config.json", () => {
    window.localStorage.setItem(MODEL_HEADERS_STORAGE_KEY, "false");
    setup({ modelHeaders: true });
    expect(probe().modelHeaders).toBe(false);
    cleanup();
    window.localStorage.setItem(MODEL_HEADERS_STORAGE_KEY, "true");
    setup({ modelHeaders: false });
    expect(probe().modelHeaders).toBe(true);
  });

  it("are switched in the settings popup and leave the meteogram", async () => {
    const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
    const { container } = render(
      <ConfigProvider config={DEFAULT_CONFIG}>
        <I18nProvider browserLanguages={["en"]}>
          <DialogsProvider>
            <LocationProvider>
              <ChainProvider>
                <ForecastProvider loader={loader}>
                  <DaySelectionProvider>
                    <Header />
                    <MeteogramPanel />
                  </DaySelectionProvider>
                </ForecastProvider>
              </ChainProvider>
            </LocationProvider>
          </DialogsProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    await screen.findByTestId("meteogram-attribution");
    const headers = () => container.querySelectorAll('[data-region="meteogram"] [data-testid="model-header-shape"]');
    expect(headers().length).toBeGreaterThan(0);

    const checkbox = openSettings("Models").getByRole("checkbox", { name: "Show model headers" });
    expect(checkbox).toHaveProperty("checked", true);
    fireEvent.click(checkbox);
    expect(window.localStorage.getItem(MODEL_HEADERS_STORAGE_KEY)).toBe("false");
    await waitFor(() => expect(headers()).toHaveLength(0));
  });
});

describe("day slider and days (REQ-473)", () => {
  const CONFIG = { enabled: true, days: "all" } as const;

  it("is the own choice, else daySlider from config.json; the days count with the slider off", () => {
    expect(effectiveDaySlider(null, null, CONFIG)).toEqual(CONFIG);
    expect(effectiveDaySlider(null, null, { enabled: false, days: 5 })).toEqual({ enabled: false, days: 5 });
    expect(effectiveDaySlider(false, null, { enabled: true, days: 5 })).toEqual({ enabled: false, days: 5 });
    expect(effectiveDaySlider(false, 3, CONFIG)).toEqual({ enabled: false, days: 3 });
    expect(effectiveDaySlider(null, 3, { enabled: false, days: "all" })).toEqual({ enabled: false, days: 3 });
    // With the slider on, its days stay those of config.json.
    expect(effectiveDaySlider(true, 3, { enabled: false, days: 7 })).toEqual({ enabled: true, days: 7 });
  });

  it("follows config.json without a stored choice", () => {
    setup({ daySlider: { enabled: false, days: 5 } });
    expect(daySliderChoice.read()).toBeNull();
    expect(daysChoice.read()).toBeNull();
    expect(probe().daySlider).toEqual({ enabled: false, days: 5 });
  });

  it("follows a stored choice instead of config.json", () => {
    window.localStorage.setItem(DAY_SLIDER_STORAGE_KEY, "false");
    window.localStorage.setItem(DAYS_STORAGE_KEY, "2");
    setup({ daySlider: CONFIG });
    expect(probe().daySlider).toEqual({ enabled: false, days: 2 });
  });

  it("ignores stored days that are no day count", () => {
    window.localStorage.setItem(DAY_SLIDER_STORAGE_KEY, "false");
    for (const value of ["0", "2.5", "-1", "many"]) {
      window.localStorage.setItem(DAYS_STORAGE_KEY, value);
      expect(daysChoice.read()).toBeNull();
    }
  });

  it("is switched off in the settings popup, which then enables the days to show (REQ-500)", () => {
    render(
      <ConfigProvider config={DEFAULT_CONFIG}>
        <App />
      </ConfigProvider>,
    );
    expect(document.querySelector('[data-region="day-slider"]')).toBeTruthy();
    const dialog = openSettings("Start");
    // The days stay in place, disabled while the slider is on, so the popup keeps its height (REQ-500).
    expect((dialog.getByRole("combobox", { name: "Days shown" }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(dialog.getByRole("checkbox", { name: "Show the day slider" }));
    expect(window.localStorage.getItem(DAY_SLIDER_STORAGE_KEY)).toBe("false");
    expect(document.querySelector('[data-region="day-slider"]')).toBeNull();

    const days = dialog.getByRole("combobox", { name: "Days shown" }) as HTMLSelectElement;
    expect(days.disabled).toBe(false);
    expect(days.value).toBe("all");
    expect(days.options[0]!.textContent).toBe("All days");
    fireEvent.change(days, { target: { value: "3" } });
    expect(window.localStorage.getItem(DAYS_STORAGE_KEY)).toBe("3");
    expect(days.value).toBe("3");
  });

  it("limits the meteogram to the chosen days while the slider is off", async () => {
    daySliderChoice.set(false);
    daysChoice.set(3);
    const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
    function Panel() {
      const daySlider = useDaySlider();
      return (
        <>
          {daySlider.enabled && <DaySlider />}
          <MeteogramPanel />
        </>
      );
    }
    render(
      <ConfigProvider config={DEFAULT_CONFIG}>
        <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <Panel />
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    await screen.findByTestId("meteogram-attribution");
    expect(document.querySelector('[data-region="day-slider"]')).toBeNull();
    const svg = document.querySelector("svg.meteogram-svg-integrated")!;
    const range = () =>
      [svg.getAttribute("data-visible-start-time"), svg.getAttribute("data-visible-end-time")].map((time) =>
        new Date(Date.parse(time!)).toISOString(),
      );
    // The day before today and three days from today on (as with daySlider.days: 3).
    expect(range()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-29T23:00:00.000Z"]);

    act(() => daysChoice.set("all"));
    await waitFor(() => expect(range()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]));
  });
});

describe("settings file", () => {
  it("round-trips the new settings", () => {
    for (const settings of [
      { startLocation: "gps" as const, modelHeaders: false, daySlider: false, days: 4 },
      { startLocation: MATTERHORN, modelHeaders: true, daySlider: true, days: "all" as const },
      { startLocation: null, modelHeaders: null, daySlider: null, days: null },
    ]) {
      expect(parseSettingsFile(serializeSettingsFile({ settings }))).toEqual({ ok: true, value: { settings } });
    }
  });

  it("reads older files without the new settings", () => {
    const text = JSON.stringify({ format: "graupel-settings", version: 1, settings: { colorMode: "dark" } });
    expect(parseSettingsFile(text)).toEqual({ ok: true, value: { settings: { colorMode: "dark" } } });
  });

  it.each([
    { startLocation: "ip" },
    { startLocation: { name: "x", lat: 100, lon: 0 } },
    { modelHeaders: "yes" },
    { daySlider: 1 },
    { days: 0 },
    { days: 2.5 },
    { days: "none" },
  ])("refuses invalid values: %j", (settings) => {
    const text = JSON.stringify({ format: "graupel-settings", version: 1, settings });
    expect(parseSettingsFile(text)).toEqual({ ok: false, error: "content" });
  });

  it("drops extra fields of a start place", () => {
    const text = JSON.stringify({
      format: "graupel-settings",
      version: 1,
      settings: { startLocation: { ...INNSBRUCK, country: "Austria" } },
    });
    expect(parseSettingsFile(text)).toEqual({ ok: true, value: { settings: { startLocation: INNSBRUCK } } });
  });
});
