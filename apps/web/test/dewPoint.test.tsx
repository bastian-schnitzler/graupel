// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Dew point of the meteogram (REQ-593): the option Auto, On or Off in the settings popup (section Meteogram), stored,
 * exported and imported, Off by default (REQ-621; Auto, the default before, was not stored and so counts as Off now,
 * a stored On stays); the page passes it to @graupel/meteogram as the value of the layout switch `dewPoint` (REQ-661) for the chart on the
 * page, the full-screen view and the copied or saved picture. The dew point is fetched with every forecast, whatever
 * the option. Auto shows it over the whole chart as soon as its condition holds anywhere in the period shown and a
 * temperature there reaches 5 °C, else not at all (REQ-605, REQ-620). Drawing, the Auto rule and the axis belong to the
 * library (REQ-595, REQ-604, REQ-620); here only that the charts follow the option. The PNG export of the core is
 * mocked (jsdom has no canvas).
 */
import { createClient, toMeteogramInput } from "@graupel/download";
import { meteogramToPng } from "@graupel/meteogram/png";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import { imageRenderOptions, meteogramToggles, WEB_LAYOUT } from "../src/regions/MeteogramPanel/layout.ts";
import { resetModelData } from "../src/services/modelData.ts";
import {
  ChainProvider,
  DEFAULT_DEW_POINT,
  DEW_POINT_STORAGE_KEY,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  SETTINGS_FILE_FORMAT,
  createForecastLoader,
  dewPointChoice,
  parseSettingsFile,
  readDewPoint,
  resetDisplaySettings,
  serializeSettingsFile,
  setDewPoint,
  type ForecastLoader,
} from "../src/state/index.ts";
import { HOUR, forecastFixture } from "./forecastFixture.ts";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

vi.mock("@graupel/meteogram/png", () => ({
  meteogramToPng: vi.fn(() => Promise.resolve(PNG)),
}));

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

/**
 * Dew point 1 K below the temperature for six hours of the fixture's second day (Auto's condition holds there, so Auto
 * shows it everywhere), 10 K below at every other hour; always below 15 °C.
 */
const dewPoint = (hour: number, temperature: number) => temperature - (hour >= 24 && hour < 30 ? 1 : 10);
/** Dew point 10 K below the temperature at every hour: Auto's condition holds nowhere. */
const dryDewPoint = (_hour: number, temperature: number) => temperature - 10;
/** Dew point 1 K below the temperature at every hour: Auto's spread condition holds everywhere. */
const moistDewPoint = (_hour: number, temperature: number) => temperature - 1;
/** Temperature of the fixture lowered by 6 K: from −6 to 4 °C, below 5 °C at every hour (REQ-620). */
const coldTemperature = (hour: number) => Math.sin(hour / 4) * 5 - 1;
/** As cold, but 5 °C at one hour of today, after the forecast start. */
const oneWarmHour = (hour: number) => (hour === 40 ? 5 : coldTemperature(hour));

const dewPaths = (root: ParentNode) => [...root.querySelectorAll('[data-testid="dew-point-path"]')];
const spreadFills = (root: ParentNode) => [...root.querySelectorAll('[data-testid="dew-point-spread"]')];

/** Hours the dew point line covers in `root`, from the start and end of each of its stretches. */
const coveredHours = (root: ParentNode) =>
  dewPaths(root).reduce(
    (sum, path) => sum + (Date.parse(path.getAttribute("data-end")!) - Date.parse(path.getAttribute("data-start")!)),
    0,
  ) / HOUR;

/** Header (with the settings popup) and the meteogram of a forecast with dew point, as on the page. */
async function renderPage(dew = dewPoint, temperature?: (hour: number) => number) {
  const loader = vi.fn<ForecastLoader>(async () => forecastFixture({ dewPoint: dew, temperature }));
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <NoticesProvider>
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
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
  await screen.findByTestId("meteogram-attribution");
}

const embedded = () => screen.getByTestId("meteogram-scroll");
const fullscreen = () => screen.queryByTestId("meteogram-fullscreen");

/** Opens the settings popup at a tab (REQ-686). */
const openSettings = (tab: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = within(screen.getByRole("dialog", { name: "Settings" }));
  fireEvent.click(dialog.getByRole("tab", { name: tab }));
  return dialog;
};

describe("dew point option (REQ-593, REQ-621)", () => {
  it("is Off without a stored choice and the stored choice otherwise; Auto and On are stored, Off is not", () => {
    expect(DEFAULT_DEW_POINT).toBe("off");
    expect(readDewPoint()).toBe("off");
    setDewPoint("auto");
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("auto");
    expect(readDewPoint()).toBe("auto");
    setDewPoint("on");
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("on");
    expect(readDewPoint()).toBe("on");
    setDewPoint("off");
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBeNull();
    expect(dewPointChoice.read()).toBeNull();
    expect(readDewPoint()).toBe("off");
  });

  it("keeps a stored On and a stored Off; the old default Auto, never stored, now counts as Off (REQ-621)", () => {
    // Stored before REQ-621: On and Off were stored, Auto (the default then) was not.
    window.localStorage.setItem(DEW_POINT_STORAGE_KEY, "on");
    expect(readDewPoint()).toBe("on");
    window.localStorage.setItem(DEW_POINT_STORAGE_KEY, "off");
    expect(readDewPoint()).toBe("off");
    window.localStorage.removeItem(DEW_POINT_STORAGE_KEY);
    expect(readDewPoint()).toBe("off");
    // Chosen again, Auto is stored and stays.
    window.localStorage.setItem(DEW_POINT_STORAGE_KEY, "auto");
    expect(readDewPoint()).toBe("auto");
  });

  it("ignores a stored value that is no option", () => {
    window.localStorage.setItem(DEW_POINT_STORAGE_KEY, "sometimes");
    expect(readDewPoint()).toBe("off");
  });

  it("shows a stored On in the chart and in the popup (REQ-621)", async () => {
    window.localStorage.setItem(DEW_POINT_STORAGE_KEY, "on");
    await renderPage();
    expect(dewPaths(embedded())).toHaveLength(1);
    expect(spreadFills(embedded())).toHaveLength(1);
    const group = openSettings("Meteogram").getByRole("radiogroup", { name: "Dew point" });
    expect(within(group).getByRole("radio", { name: "On" })).toHaveProperty("checked", true);
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("on");
  });

  it("is chosen in the meteogram section of the settings popup, with a hint on Auto; the chart follows", async () => {
    await renderPage();
    // Off without a choice (REQ-621): nothing.
    expect(dewPaths(embedded())).toHaveLength(0);
    expect(spreadFills(embedded())).toHaveLength(0);

    const section = openSettings("Meteogram").getByRole("heading", { name: "Meteogram" }).closest("section")!;
    expect(section.dataset.settings).toBe("meteogram");
    const group = within(section).getByRole("radiogroup", { name: "Dew point" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual(["Auto", "On", "Off"]);
    expect(within(group).getByRole("radio", { name: "Off" })).toHaveProperty("checked", true);
    const hint = document.getElementById(group.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe(
      "Auto shows the dew point and the spread across the whole chart as soon as the air is nearly saturated " +
        "(spread up to 5\u00a0K) or muggy (dew point from 15\u00a0°C) at any time in the period shown and the " +
        "temperature (2\u00a0m) reaches 5\u00a0°C at least once in it, otherwise not at all. The dew point is always " +
        "loaded.",
    );
    // Below the choice, in the same section.
    expect(section.contains(hint)).toBe(true);
    expect(group.compareDocumentPosition(hint!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Auto, stored: the spread is small for six hours and the temperature reaches 10 °C, so line and spread cover the
    // whole forecast in one stretch, as with On.
    fireEvent.click(within(group).getByRole("radio", { name: "Auto" }));
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("auto");
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(1));
    expect(spreadFills(embedded())).toHaveLength(1);
    const autoHours = coveredHours(embedded());
    expect(autoHours).toBeGreaterThan(48);

    // On: everywhere, the same stretch as Auto here.
    fireEvent.click(within(group).getByRole("radio", { name: "On" }));
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("on");
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(1));
    expect(spreadFills(embedded())).toHaveLength(1);
    expect(coveredHours(embedded())).toBeCloseTo(autoHours, 6);

    // Off: nowhere, nothing stored.
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(0));
    expect(spreadFills(embedded())).toHaveLength(0);

    // Back to Auto: stored again, the whole forecast again.
    fireEvent.click(within(group).getByRole("radio", { name: "Auto" }));
    expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("auto");
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(1));
    expect(coveredHours(embedded())).toBeCloseTo(autoHours, 6);
  });

  it("shows nothing with Auto while every temperature stays below 5 °C, everything with On (REQ-621)", async () => {
    setDewPoint("auto");
    // The spread is 1 K at every hour, but the temperature never reaches 5 °C.
    await renderPage(moistDewPoint, coldTemperature);
    expect(dewPaths(embedded())).toHaveLength(0);
    expect(spreadFills(embedded())).toHaveLength(0);

    act(() => setDewPoint("on"));
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(1));
    expect(spreadFills(embedded())).toHaveLength(1);
    expect(coveredHours(embedded())).toBeGreaterThan(48);

    act(() => setDewPoint("auto"));
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(0));
    expect(spreadFills(embedded())).toHaveLength(0);
  });

  it("shows the whole chart with Auto once one temperature reaches 5 °C (REQ-621)", async () => {
    setDewPoint("auto");
    await renderPage(moistDewPoint, oneWarmHour);
    expect(dewPaths(embedded())).toHaveLength(1);
    expect(spreadFills(embedded())).toHaveLength(1);
    expect(coveredHours(embedded())).toBeGreaterThan(48);
  });

  it("shows nothing with Auto where the condition holds at no hour, everything with On (REQ-605)", async () => {
    setDewPoint("auto");
    await renderPage(dryDewPoint);
    expect(dewPaths(embedded())).toHaveLength(0);
    expect(spreadFills(embedded())).toHaveLength(0);

    act(() => setDewPoint("on"));
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(1));
    expect(spreadFills(embedded())).toHaveLength(1);
    expect(coveredHours(embedded())).toBeGreaterThan(48);

    act(() => setDewPoint("auto"));
    await waitFor(() => expect(dewPaths(embedded())).toHaveLength(0));
    expect(spreadFills(embedded())).toHaveLength(0);
  });

  it("is followed by the full-screen view", async () => {
    // Off without a choice (REQ-621).
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    expect(fullscreen()).not.toBeNull();
    expect(dewPaths(fullscreen()!)).toHaveLength(0);
    expect(spreadFills(fullscreen()!)).toHaveLength(0);

    act(() => setDewPoint("on"));
    await waitFor(() => expect(dewPaths(fullscreen()!)).toHaveLength(1));
    expect(spreadFills(fullscreen()!)).toHaveLength(1);
    expect(dewPaths(embedded())).toHaveLength(1);

    act(() => setDewPoint("auto"));
    await waitFor(() => expect(dewPaths(fullscreen()!)).toHaveLength(1));
    expect(spreadFills(fullscreen()!)).toHaveLength(1);
    expect(coveredHours(fullscreen()!)).toBeCloseTo(coveredHours(embedded()), 6);
  });

  it("is followed by the copied picture", async () => {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly items: unknown) {}
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    try {
      const toPng = vi.mocked(meteogramToPng);
      toPng.mockClear();
      await renderPage();
      const copy = () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy the meteogram as a picture" }));
        return screen.findByText("Meteogram copied");
      };
      await copy();
      // Off without a choice (REQ-621).
      // Beside the render options the picture gets its background and scale (REQ-714); it has the model headers as the
      // chart on screen (modelHeaders of the default config, REQ-539, DEC-094).
      expect(toPng).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ render: imageRenderOptions(true, meteogramToggles("off", "off", true)) }),
      );
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { dewPoint: "off" }, layout: WEB_LAYOUT });

      for (const mode of ["auto", "on"] as const) {
        act(() => setDewPoint(mode));
        await copy();
        expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { dewPoint: mode } });
      }
      // The picture of the full-screen view as well.
      fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
      const view = within(fullscreen()!.closest("dialog")!);
      fireEvent.click(view.getByRole("button", { name: "Copy the meteogram as a picture" }));
      await waitFor(() => expect(toPng).toHaveBeenCalledTimes(4));
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { dewPoint: "on" } });
      expect(write).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("goes into the render options of the picture", () => {
    for (const mode of ["auto", "on", "off"] as const) {
      expect(imageRenderOptions(true, meteogramToggles(mode, "off", true))).toMatchObject({
        toggles: { dewPoint: mode },
        forceModelHeaders: true,
      });
      expect(imageRenderOptions(false, meteogramToggles(mode, "off", true))).toMatchObject({
        toggles: { dewPoint: mode },
        forceModelHeaders: false,
      });
    }
  });
});

describe("settings file with the dew point (REQ-593, REQ-621)", () => {
  const file = (settings: unknown) => JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings });

  it("round-trips each option", () => {
    for (const mode of ["auto", "on", "off"] as const) {
      const settings = { dewPoint: mode };
      expect(parseSettingsFile(serializeSettingsFile({ settings }))).toEqual({ ok: true, value: { settings } });
    }
  });

  it("reads older files without it, leaving it out", () => {
    expect(parseSettingsFile(file({ colorMode: "dark", modelHeaders: false }))).toEqual({
      ok: true,
      value: { settings: { colorMode: "dark", modelHeaders: false } },
    });
  });

  it.each([{ dewPoint: "yes" }, { dewPoint: null }, { dewPoint: true }, { dewPoint: "AUTO" }])(
    "refuses invalid values: %j",
    (settings) => {
      expect(parseSettingsFile(file(settings))).toEqual({ ok: false, error: "content" });
    },
  );

  describe("in the settings popup", () => {
    function captureDownloads() {
      const blobs: Blob[] = [];
      vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return "blob:settings";
      });
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      return blobs;
    }

    function setup() {
      render(
        <ConfigProvider config={DEFAULT_CONFIG}>
          <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
            <NoticesProvider>
              <DialogsProvider>
                <LocationProvider>
                  <Header />
                </LocationProvider>
              </DialogsProvider>
            </NoticesProvider>
          </I18nProvider>
        </ConfigProvider>,
      );
      return openSettings("Meteogram");
    }

    /** A choice of the dew point option; the relative humidity below it has an On and an Off as well (REQ-650). */
    const dewOption = (popup: ReturnType<typeof within>, name: "Auto" | "On" | "Off") =>
      within(popup.getByRole("radiogroup", { name: "Dew point" })).getByRole("radio", { name });

    const exportSettings = async (popup: ReturnType<typeof within>, blobs: Blob[]) => {
      fireEvent.click(popup.getByRole("button", { name: "Export settings" }));
      const parsed = parseSettingsFile(await blobs[blobs.length - 1]!.text());
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.value.settings;
    };

    const importFile = async (popup: ReturnType<typeof within>, content: string) => {
      await act(async () => {
        fireEvent.change(popup.getByTestId("settings-import-file"), {
          target: { files: [new File([content], "settings.json", { type: "application/json" })] },
        });
      });
      await waitFor(() =>
        expect(popup.getByRole("status").textContent).toBe("Settings and favourites imported."),
      );
    };

    it("exports Off without a choice and the chosen option otherwise", async () => {
      const blobs = captureDownloads();
      const popup = setup();
      expect((await exportSettings(popup, blobs)).dewPoint).toBe("off");
      fireEvent.click(dewOption(popup, "Auto"));
      expect((await exportSettings(popup, blobs)).dewPoint).toBe("auto");
      fireEvent.click(dewOption(popup, "On"));
      expect((await exportSettings(popup, blobs)).dewPoint).toBe("on");
      fireEvent.click(dewOption(popup, "Off"));
      expect((await exportSettings(popup, blobs)).dewPoint).toBe("off");
    });

    it("imports each option, stores Auto and On, and shows it in the popup", async () => {
      const popup = setup();
      expect(dewOption(popup, "Off")).toHaveProperty("checked", true);
      await importFile(popup, file({ dewPoint: "on" }));
      expect(readDewPoint()).toBe("on");
      expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("on");
      expect(dewOption(popup, "On")).toHaveProperty("checked", true);
      await importFile(popup, file({ dewPoint: "auto" }));
      expect(readDewPoint()).toBe("auto");
      expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBe("auto");
      expect(dewOption(popup, "Auto")).toHaveProperty("checked", true);
      await importFile(popup, file({ dewPoint: "off" }));
      expect(readDewPoint()).toBe("off");
      expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBeNull();
      expect(dewOption(popup, "Off")).toHaveProperty("checked", true);
    });

    it("keeps the option when an older file without it is imported", async () => {
      const popup = setup();
      await importFile(popup, file({ colorMode: "system", modelHeaders: true }));
      expect(readDewPoint()).toBe("off");
      expect(window.localStorage.getItem(DEW_POINT_STORAGE_KEY)).toBeNull();
      expect(dewOption(popup, "Off")).toHaveProperty("checked", true);
      act(() => setDewPoint("auto"));
      await importFile(popup, file({ colorMode: "dark" }));
      expect(readDewPoint()).toBe("auto");
      expect(dewOption(popup, "Auto")).toHaveProperty("checked", true);
    });
  });
});

describe("download of the dew point (REQ-593)", () => {
  /** Unit of an Open-Meteo hourly variable, as the API names it. */
  const unit = (variable: string) =>
    variable.includes("temp") || variable.includes("dew_point")
      ? "°C"
      : variable.includes("direction")
        ? "°"
        : variable.includes("wind")
          ? "km/h"
          : variable === "precipitation"
            ? "mm"
            : variable === "snowfall"
              ? "cm"
              : variable === "snow_depth" || variable.includes("height")
                ? "m"
                : variable === "weather_code"
                  ? "wmo code"
                  : "%";

  /** A fake Open-Meteo: every hourly variable for `past_hours + forecast_hours` hours from the current hour. */
  function fakeOpenMeteo(url: string): Response {
    const answer = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    const params = new URL(url).searchParams;
    if (!url.startsWith("https://api.open-meteo.com/v1/forecast")) return answer({});
    if (params.has("daily")) return answer({ timezone: "GMT", daily: { time: [], sunrise: [], sunset: [] } });
    const variables = (params.get("hourly") ?? "").split(",").filter(Boolean);
    const past = Number(params.get("past_hours") ?? 0);
    const count = past + Number(params.get("forecast_hours") ?? 24);
    const nowHour = Math.floor(Date.now() / HOUR) * HOUR;
    const times = Array.from({ length: count }, (_, i) =>
      new Date(nowHour + (i - past) * HOUR).toISOString().slice(0, 16),
    );
    const hourly: Record<string, unknown> = { time: times };
    const units: Record<string, string> = {};
    for (const variable of variables) {
      hourly[variable] = times.map(() => (variable === "dew_point_2m" ? 3 : 5));
      units[variable] = unit(variable);
    }
    return answer({ timezone: "GMT", hourly, hourly_units: units });
  }

  it("asks every model for dew_point_2m and hands the dew point to the meteogram", async () => {
    // Regions from the test's fetch; the client's own fetch is the fake Open-Meteo.
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"type":"FeatureCollection","features":[]}')));
    resetModelData();
    const requests: string[] = [];
    const client = createClient({
      maxRetries: 0,
      cache: null,
      fetch: async (url) => {
        requests.push(url);
        return fakeOpenMeteo(url);
      },
    });
    const load = createForecastLoader({ client });
    const result = await load({
      location: { name: "Mont Blanc", latitude: 45.8326, longitude: 6.8652 },
      auto: true,
      runSegments: false,
    });
    // Every request for the weather (with the temperature) asks for the dew point too, whatever the option.
    const weather = requests
      .map((url) => new URL(url).searchParams.get("hourly")?.split(",") ?? [])
      .filter((hourly) => hourly.includes("temperature_2m"));
    expect(weather.length).toBeGreaterThan(0);
    for (const hourly of weather) expect(hourly).toContain("dew_point_2m");
    const input = toMeteogramInput(result);
    const dew = input.series.filter((point) => point.variable === "dew_point");
    expect(dew.length).toBeGreaterThan(0);
    expect(dew.every((point) => point.value === 3 && point.unit === "°C")).toBe(true);
    resetModelData();
  });
});
