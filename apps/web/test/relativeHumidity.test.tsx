// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Relative humidity of the meteogram (REQ-650): the option On or Off in the settings popup (section Meteogram,
 * directly below the dew point), Off by default, stored like the dew point, exported and imported; the page passes it
 * to @graupel/meteogram as the value of the layout switch `relativeHumidity` (REQ-661) for the chart on the page, the full-screen view and
 * the copied or saved picture. The layout helpers that measure the chart leave its right axis out unless it is on.
 * The relative humidity is fetched with every forecast, whatever the option. Drawing the line and its axis ("100 %" and
 * "0 %" right of the temperature area) belongs to the library (REQ-649); here only that the charts follow the option.
 * The PNG export of the core is mocked (jsdom has no canvas).
 */
import { createClient, toMeteogramInput } from "@graupel/download";
import { meteogramToPng } from "@graupel/meteogram/png";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, MESSAGES } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  chartHeights,
  chartTopRoom,
  imageRenderOptions,
  meteogramToggles,
  rightLabelsTop,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "../src/regions/MeteogramPanel/layout.ts";
import { resetModelData } from "../src/services/modelData.ts";
import {
  ChainProvider,
  DEFAULT_RELATIVE_HUMIDITY,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  RELATIVE_HUMIDITY_STORAGE_KEY,
  SETTINGS_FILE_FORMAT,
  createForecastLoader,
  parseSettingsFile,
  readRelativeHumidity,
  relativeHumidityChoice,
  resetDisplaySettings,
  serializeSettingsFile,
  setDewPoint,
  setRelativeHumidity,
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

/** Relative humidity of the fixture: between 40 and 90 %. */
const humidity = (hour: number) => 65 + Math.sin(hour / 6) * 25;

const humidityPaths = (root: ParentNode) => [...root.querySelectorAll('[data-testid="relative-humidity-path"]')];

/** Texts of the temperature area in `root` that read `text` (a label in two lines, value and unit, reads as one). */
const temperatureLabels = (root: ParentNode, text: string) => {
  const area = root.querySelector('[data-area-id="temp"]');
  const wanted = text.replace(/\s/g, "");
  return [...(area?.querySelectorAll("text") ?? [])].filter(
    (element) => (element.textContent ?? "").replace(/\s/g, "") === wanted,
  );
};

/** Whether the chart in `root` shows the relative humidity: its line and its labels "100 %" and "0 %". */
const showsHumidity = (root: ParentNode) => ({
  line: humidityPaths(root).length > 0,
  max: temperatureLabels(root, "100 %").length,
  min: temperatureLabels(root, "0 %").length,
});
const SHOWN = { line: true, max: 1, min: 1 };
const HIDDEN = { line: false, max: 0, min: 0 };

/**
 * Header (with the settings popup) and the meteogram of a forecast with relative humidity and dew point, as on the
 * page.
 */
async function renderPage() {
  const loader = vi.fn<ForecastLoader>(async () =>
    forecastFixture({ relativeHumidity: humidity, dewPoint: (_hour, temperature) => temperature - 2 }),
  );
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

describe("relative humidity option (REQ-650)", () => {
  it("is Off without a stored choice; On is stored, Off is not", () => {
    expect(DEFAULT_RELATIVE_HUMIDITY).toBe("off");
    expect(readRelativeHumidity()).toBe("off");
    expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBeNull();
    setRelativeHumidity("on");
    expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBe("on");
    expect(readRelativeHumidity()).toBe("on");
    setRelativeHumidity("off");
    expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBeNull();
    expect(relativeHumidityChoice.read()).toBeNull();
    expect(readRelativeHumidity()).toBe("off");
  });

  it("keeps a stored On and a stored Off and ignores a stored value that is no option", () => {
    window.localStorage.setItem(RELATIVE_HUMIDITY_STORAGE_KEY, "on");
    expect(readRelativeHumidity()).toBe("on");
    window.localStorage.setItem(RELATIVE_HUMIDITY_STORAGE_KEY, "off");
    expect(readRelativeHumidity()).toBe("off");
    window.localStorage.setItem(RELATIVE_HUMIDITY_STORAGE_KEY, "auto");
    expect(readRelativeHumidity()).toBe("off");
  });

  it("has its texts in every language", () => {
    for (const messages of Object.values(MESSAGES)) {
      for (const key of [
        "settings.meteogram.relativeHumidity",
        "settings.meteogram.relativeHumidity.on",
        "settings.meteogram.relativeHumidity.off",
      ]) {
        expect(messages[key]).toBeTruthy();
      }
    }
    expect(MESSAGES.de["settings.meteogram.relativeHumidity"]).toBe("Relative Luftfeuchte");
    expect(MESSAGES.de["settings.meteogram.relativeHumidity.on"]).toBe("An");
    expect(MESSAGES.de["settings.meteogram.relativeHumidity.off"]).toBe("Aus");
  });

  it("shows a stored On in the chart and in the popup", async () => {
    window.localStorage.setItem(RELATIVE_HUMIDITY_STORAGE_KEY, "on");
    await renderPage();
    expect(showsHumidity(embedded())).toEqual(SHOWN);
    const group = openSettings("Meteogram").getByRole("radiogroup", { name: "Relative humidity" });
    expect(within(group).getByRole("radio", { name: "On" })).toHaveProperty("checked", true);
  });

  it("is chosen in the meteogram section directly below the dew point; the chart follows", async () => {
    await renderPage();
    // Off without a choice: no line, no axis.
    expect(showsHumidity(embedded())).toEqual(HIDDEN);

    const section = openSettings("Meteogram").getByRole("heading", { name: "Meteogram" }).closest("section")!;
    expect(section.dataset.settings).toBe("meteogram");
    const group = within(section).getByRole("radiogroup", { name: "Relative humidity" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual(["On", "Off"]);
    expect(within(group).getByRole("radio", { name: "Off" })).toHaveProperty("checked", true);
    // Directly below the dew point and its hint: the next field of the section.
    const dewPoint = within(section).getByRole("radiogroup", { name: "Dew point" });
    const hint = document.getElementById(dewPoint.getAttribute("aria-describedby")!)!;
    expect(hint.nextElementSibling).toBe(group.closest(".settings__field"));

    // On, stored: the line and "100 %" and "0 %" right of the temperature area.
    fireEvent.click(within(group).getByRole("radio", { name: "On" }));
    expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBe("on");
    await waitFor(() => expect(showsHumidity(embedded())).toEqual(SHOWN));

    // Off: neither, nothing stored.
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(showsHumidity(embedded())).toEqual(HIDDEN));
  });

  it("stays apart from the dew point option", async () => {
    await renderPage();
    act(() => setDewPoint("on"));
    await waitFor(() => expect(embedded().querySelector('[data-testid="dew-point-path"]')).not.toBeNull());
    expect(showsHumidity(embedded())).toEqual(HIDDEN);
    act(() => setRelativeHumidity("on"));
    await waitFor(() => expect(showsHumidity(embedded())).toEqual(SHOWN));
    expect(embedded().querySelector('[data-testid="dew-point-path"]')).not.toBeNull();
  });

  it("is followed by the full-screen view", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    expect(fullscreen()).not.toBeNull();
    expect(showsHumidity(fullscreen()!)).toEqual(HIDDEN);

    act(() => setRelativeHumidity("on"));
    await waitFor(() => expect(showsHumidity(fullscreen()!)).toEqual(SHOWN));
    expect(showsHumidity(embedded())).toEqual(SHOWN);

    act(() => setRelativeHumidity("off"));
    await waitFor(() => expect(showsHumidity(fullscreen()!)).toEqual(HIDDEN));
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
      // Off without a choice.
      // Beside the render options the picture gets its background and scale (REQ-714); it has the model headers as the
      // chart on screen (modelHeaders of the default config, REQ-539, DEC-094).
      expect(toPng).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ render: imageRenderOptions(true, meteogramToggles("off", "off", true)) }),
      );
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({
        toggles: { relativeHumidity: "off" },
        layout: WEB_LAYOUT,
      });

      act(() => setRelativeHumidity("on"));
      await waitFor(() => expect(showsHumidity(embedded())).toEqual(SHOWN));
      await copy();
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { relativeHumidity: "on" } });
      // The picture of the full-screen view as well.
      fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
      const view = within(fullscreen()!.closest("dialog")!);
      fireEvent.click(view.getByRole("button", { name: "Copy the meteogram as a picture" }));
      await waitFor(() => expect(toPng).toHaveBeenCalledTimes(3));
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { relativeHumidity: "on" } });
      expect(write).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("goes into the render options of the picture", () => {
    for (const mode of ["on", "off"] as const) {
      expect(imageRenderOptions(true, meteogramToggles("auto", mode, true))).toMatchObject({
        toggles: { relativeHumidity: mode, dewPoint: "auto" },
        forceModelHeaders: true,
      });
      expect(imageRenderOptions(false, meteogramToggles("off", mode, true))).toMatchObject({
        toggles: { relativeHumidity: mode, dewPoint: "off" },
        forceModelHeaders: false,
      });
    }
  });
});

describe("layout helpers with the relative humidity (REQ-650)", () => {
  const drawnAs = { forceModelHeaders: true, backgroundHasData: true };

  it("measure the right axis of the temperature area only when the relative humidity is on", () => {
    const off = rightLabelsTop(WEB_LAYOUT, drawnAs);
    expect(rightLabelsTop(WEB_LAYOUT, { ...drawnAs, toggles: { relativeHumidity: "off" } })).toBe(off);
    const on = rightLabelsTop(WEB_LAYOUT, { ...drawnAs, toggles: { relativeHumidity: "on" } });
    // On: the right labels begin with the temperature area, above the cloud background.
    expect(on).toBeLessThan(off!);
    // Without cloud data the humidity's axis alone stands right of the plot.
    expect(rightLabelsTop(WEB_LAYOUT, { ...drawnAs, backgroundHasData: false })).toBeNull();
    expect(rightLabelsTop(WEB_LAYOUT, { ...drawnAs, backgroundHasData: false, toggles: { relativeHumidity: "on" } })).toBe(on);
    const plain = { forceModelHeaders: false, backgroundHasData: false, toggles: { relativeHumidity: "on" } };
    expect(rightLabelsTop(WEB_LAYOUT_WITHOUT_HEADERS, plain)).toBeLessThan(on!);
  });

  it("keep the chart's heights and the room above it", () => {
    for (const backgroundHasData of [false, true]) {
      const off = { forceModelHeaders: true, backgroundHasData };
      const on = { ...off, toggles: { relativeHumidity: "on" } };
      expect(chartHeights(WEB_LAYOUT, on)).toEqual(chartHeights(WEB_LAYOUT, off));
      expect(chartTopRoom(WEB_LAYOUT, on)).toBe(chartTopRoom(WEB_LAYOUT, off));
    }
  });
});

describe("settings file with the relative humidity (REQ-650)", () => {
  const file = (settings: unknown) => JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings });

  it("round-trips both options", () => {
    for (const mode of ["on", "off"] as const) {
      const settings = { dewPoint: "auto", relativeHumidity: mode } as const;
      expect(parseSettingsFile(serializeSettingsFile({ settings }))).toEqual({ ok: true, value: { settings } });
    }
  });

  it("reads older files without it, leaving it out", () => {
    expect(parseSettingsFile(file({ colorMode: "dark", dewPoint: "on" }))).toEqual({
      ok: true,
      value: { settings: { colorMode: "dark", dewPoint: "on" } },
    });
  });

  it.each([
    { relativeHumidity: "auto" },
    { relativeHumidity: null },
    { relativeHumidity: true },
    { relativeHumidity: "ON" },
  ])("refuses invalid values: %j", (settings) => {
    expect(parseSettingsFile(file(settings))).toEqual({ ok: false, error: "content" });
  });

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

    const option = (popup: ReturnType<typeof within>, name: "On" | "Off") =>
      within(popup.getByRole("radiogroup", { name: "Relative humidity" })).getByRole("radio", { name });

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
      expect((await exportSettings(popup, blobs)).relativeHumidity).toBe("off");
      fireEvent.click(option(popup, "On"));
      expect((await exportSettings(popup, blobs)).relativeHumidity).toBe("on");
      fireEvent.click(option(popup, "Off"));
      expect((await exportSettings(popup, blobs)).relativeHumidity).toBe("off");
    });

    it("imports both options, stores On, and shows it in the popup", async () => {
      const popup = setup();
      expect(option(popup, "Off")).toHaveProperty("checked", true);
      await importFile(popup, file({ relativeHumidity: "on" }));
      expect(readRelativeHumidity()).toBe("on");
      expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBe("on");
      expect(option(popup, "On")).toHaveProperty("checked", true);
      await importFile(popup, file({ relativeHumidity: "off" }));
      expect(readRelativeHumidity()).toBe("off");
      expect(window.localStorage.getItem(RELATIVE_HUMIDITY_STORAGE_KEY)).toBeNull();
      expect(option(popup, "Off")).toHaveProperty("checked", true);
    });

    it("keeps the option when an older file without it is imported", async () => {
      const popup = setup();
      act(() => setRelativeHumidity("on"));
      await importFile(popup, file({ colorMode: "dark", dewPoint: "on" }));
      expect(readRelativeHumidity()).toBe("on");
      expect(option(popup, "On")).toHaveProperty("checked", true);
    });
  });
});

describe("download of the relative humidity (REQ-650)", () => {
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
      hourly[variable] = times.map(() => (variable === "relative_humidity_2m" ? 72 : 5));
      units[variable] = variable.includes("temp") || variable.includes("dew_point") ? "°C" : "%";
    }
    return answer({ timezone: "GMT", hourly, hourly_units: units });
  }

  it("asks every model for relative_humidity_2m, with the option off, and hands it to the meteogram", async () => {
    expect(readRelativeHumidity()).toBe("off");
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
    const weather = requests
      .map((url) => new URL(url).searchParams.get("hourly")?.split(",") ?? [])
      .filter((hourly) => hourly.includes("temperature_2m"));
    expect(weather.length).toBeGreaterThan(0);
    for (const hourly of weather) expect(hourly).toContain("relative_humidity_2m");
    const input = toMeteogramInput(result);
    const values = input.series.filter((point) => point.variable === "relative_humidity");
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((point) => point.value === 72 && point.unit === "%")).toBe(true);
    resetModelData();
  });
});
