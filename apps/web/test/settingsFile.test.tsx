// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig, type Place } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, LANGUAGE_STORAGE_KEY, storeLanguage, translate } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { LocationPicker } from "../src/regions/LocationPicker/index.ts";
import {
  COLOR_MODE_STORAGE_KEY,
  FAVORITES_STORAGE_KEY,
  cloudChainChoice,
  daySliderChoice,
  daysChoice,
  modelHeadersChoice,
  readArchiveDays,
  readDewPoint,
  readHistorySlider,
  readLegend,
  readRelativeHumidity,
  readScaleToVisibleRange,
  setArchiveDays,
  setDewPoint,
  setHistorySlider,
  setLegend,
  setScaleToVisibleRange,
  startLocationChoice,
  LocationProvider,
  MAP_PROVIDER_STORAGE_KEY,
  SETTINGS_FILE_FORMAT,
  SETTINGS_FILE_MAX_BYTES,
  SETTINGS_FILE_VERSION,
  parseSettingsFile,
  initColorMode,
  readSettingsFile,
  readStoredColorMode,
  readStoredFavorites,
  readStoredMapProvider,
  resetModelChainView,
  serializeSettingsFile,
  setColorMode,
  setMapProvider,
  settingsFileName,
  storeFavorites,
  weatherChainChoice,
} from "../src/state/index.ts";

const MATTERHORN: Place = { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 };
const INNSBRUCK: Place = { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 };
const BRUSSELS: Place = { name: "Brussels", lat: 50.8503, lon: 4.3517 };

const file = (body: unknown) => JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, ...(body as object) });

beforeEach(() => {
  window.localStorage.clear();
  initColorMode();
  resetModelChainView();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  initColorMode();
  resetModelChainView();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings file", () => {
  it("round-trips settings and favourites", () => {
    const text = serializeSettingsFile(
      { settings: { language: "de", colorMode: "dark" }, favorites: [MATTERHORN, BRUSSELS] },
      new Date("2026-10-26T12:00:00Z"),
    );
    expect(JSON.parse(text)).toEqual({
      format: "graupel-settings",
      version: SETTINGS_FILE_VERSION,
      exported: "2026-10-26T12:00:00.000Z",
      settings: { language: "de", colorMode: "dark" },
      favorites: [MATTERHORN, BRUSSELS],
    });
    expect(SETTINGS_FILE_VERSION).toBe(1);
    expect(parseSettingsFile(text)).toEqual({
      ok: true,
      value: { settings: { language: "de", colorMode: "dark" }, favorites: [MATTERHORN, BRUSSELS] },
    });
  });

  it("keeps a missing language choice as null and drops extra place fields", () => {
    const text = serializeSettingsFile({
      settings: { language: null },
      favorites: [{ ...INNSBRUCK, country: "Austria" } as Place],
    });
    expect(parseSettingsFile(text)).toEqual({ ok: true, value: { settings: { language: null }, favorites: [INNSBRUCK] } });
  });

  it("keeps the name and the mark of a renamed map-point favourite (REQ-489)", () => {
    const hill = { name: "Hausberg", lat: 47.1718, lon: 12.6806, mapPoint: true as const };
    const text = serializeSettingsFile({ settings: {}, favorites: [MATTERHORN, hill] });
    expect(JSON.parse(text).favorites).toEqual([MATTERHORN, hill]);
    expect(parseSettingsFile(text)).toEqual({ ok: true, value: { settings: {}, favorites: [MATTERHORN, hill] } });
    // Only `true` marks a map point; older files without the mark read as before.
    expect(parseSettingsFile(file({ favorites: [{ ...MATTERHORN, mapPoint: "yes" }] }))).toEqual({
      ok: true,
      value: { settings: {}, favorites: [MATTERHORN] },
    });
  });

  it("keeps a place listed twice once", () => {
    const twice = { ...MATTERHORN, name: "Cervino", lat: MATTERHORN.lat + 0.00001 };
    expect(parseSettingsFile(file({ favorites: [MATTERHORN, BRUSSELS, twice] }))).toEqual({
      ok: true,
      value: { settings: {}, favorites: [MATTERHORN, BRUSSELS] },
    });
  });

  it("reads whether the model chain is shown; older files without it leave it out", () => {
    expect(parseSettingsFile(file({ settings: { showModelChain: true } }))).toEqual({
      ok: true,
      value: { settings: { showModelChain: true } },
    });
    // REQ-503: one switch per card, `null` for no own choice.
    expect(parseSettingsFile(file({ settings: { showWeatherChain: true, showCloudChain: null } }))).toEqual({
      ok: true,
      value: { settings: { showWeatherChain: true, showCloudChain: null } },
    });
    expect(parseSettingsFile(file({ settings: { colorMode: "dark" } }))).toEqual({
      ok: true,
      value: { settings: { colorMode: "dark" } },
    });
  });

  it("reads the map provider or no choice; older files without it leave it out (REQ-467)", () => {
    expect(parseSettingsFile(file({ settings: { map: "maptoolkit" } }))).toEqual({
      ok: true,
      value: { settings: { map: "maptoolkit" } },
    });
    expect(parseSettingsFile(file({ settings: { map: null } }))).toEqual({ ok: true, value: { settings: { map: null } } });
    expect(parseSettingsFile(file({ settings: { language: "de", colorMode: "dark", showModelChain: true } }))).toEqual({
      ok: true,
      value: { settings: { language: "de", colorMode: "dark", showModelChain: true } },
    });
  });

  it("reads the days the archive keeps and the history slider; older files without them leave them out (REQ-686)", () => {
    for (const archiveDays of ["unlimited", 365, 90, 14, 5] as const) {
      expect(parseSettingsFile(file({ settings: { archiveDays } }))).toEqual({ ok: true, value: { settings: { archiveDays } } });
    }
    expect(parseSettingsFile(file({ settings: { historySlider: true } }))).toEqual({
      ok: true,
      value: { settings: { historySlider: true } },
    });
    expect(parseSettingsFile(file({ settings: { archiveDays: 14, historySlider: false } }))).toEqual({
      ok: true,
      value: { settings: { archiveDays: 14, historySlider: false } },
    });
    expect(parseSettingsFile(file({ settings: { legend: true } }))).toEqual({ ok: true, value: { settings: { legend: true } } });
    // Values the settings do not offer are refused.
    for (const archiveDays of [30, "90", null, 0, "all"]) {
      expect(parseSettingsFile(file({ settings: { archiveDays } }))).toEqual({ ok: false, error: "content" });
    }
    for (const historySlider of ["true", null, 1]) {
      expect(parseSettingsFile(file({ settings: { historySlider } }))).toEqual({ ok: false, error: "content" });
    }
  });

  it("leaves out what the file does not contain and skips unknown settings", () => {
    expect(parseSettingsFile(file({}))).toEqual({ ok: true, value: { settings: {} } });
    expect(parseSettingsFile(file({ settings: { units: "imperial" }, favorites: [] }))).toEqual({
      ok: true,
      value: { settings: {}, favorites: [] },
    });
  });

  it.each([
    ["not JSON", "{favorites:"],
    ["an array", "[]"],
    ["JSON without format", JSON.stringify({ version: 1, settings: {} })],
    ["another format", JSON.stringify({ format: "other", version: 1 })],
    ["no version", JSON.stringify({ format: SETTINGS_FILE_FORMAT })],
    ["a version as text", JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: "1" })],
    ["version 0", JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 0 })],
    ["a fractional version", JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1.5 })],
  ])("refuses %s as invalid", (_, text) => {
    expect(parseSettingsFile(text)).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses files of a newer version", () => {
    expect(parseSettingsFile(file({ version: SETTINGS_FILE_VERSION + 1 }))).toEqual({ ok: false, error: "newer" });
  });

  it.each([
    ["settings that are no object", { settings: "de" }],
    ["an unknown language", { settings: { language: "xx" } }],
    ["an unknown colour mode", { settings: { colorMode: "purple" } }],
    ["no colour mode", { settings: { colorMode: null } }],
    ["a model chain choice that is no boolean", { settings: { showModelChain: "yes" } }],
    ["a weather chain choice that is no boolean", { settings: { showWeatherChain: "yes" } }],
    ["a cloud chain choice that is no boolean", { settings: { showCloudChain: 1 } }],
    ["an unknown map provider", { settings: { map: "google" } }],
    ["favourites that are no list", { favorites: { name: "Matterhorn" } }],
    ["a favourite without coordinates", { favorites: [MATTERHORN, { name: "Nowhere" }] }],
    ["a favourite outside the globe", { favorites: [{ name: "Far", lat: 91, lon: 0 }] }],
  ])("refuses %s as invalid content", (_, body) => {
    expect(parseSettingsFile(file(body))).toEqual({ ok: false, error: "content" });
  });

  it("reads files and refuses too large ones without reading them", async () => {
    const good = new Blob([file({ settings: { language: "fr" } })]);
    expect(await readSettingsFile(good)).toEqual({ ok: true, value: { settings: { language: "fr" } } });
    const big = new Blob(["x"]);
    Object.defineProperty(big, "size", { value: SETTINGS_FILE_MAX_BYTES + 1 });
    const text = vi.spyOn(big, "text");
    expect(await readSettingsFile(big)).toEqual({ ok: false, error: "invalid" });
    expect(text).not.toHaveBeenCalled();
  });

  it("names the file after the local date", () => {
    expect(settingsFileName(new Date(2026, 0, 5, 23, 30))).toBe("graupel-settings-2026-01-05.json");
  });
});

describe("export and import in the settings popup", () => {
  const PRESETS = [MATTERHORN];
  const config: GraupelConfig = { ...DEFAULT_CONFIG, favorites: { enabled: true, presets: PRESETS } };

  /** Captures the downloads started by the export. */
  function captureDownloads() {
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:settings";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { blobs, names };
  }

  function setup() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ elevation: [100] }))),
    );
    render(
      <ConfigProvider config={config}>
        <I18nProvider languages={config.languages} browserLanguages={["en"]}>
          <NoticesProvider>
            <DialogsProvider>
              <LocationProvider>
                <Header />
                <LocationPicker searchDelay={0} />
              </LocationProvider>
            </DialogsProvider>
          </NoticesProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
  }

  const favoriteNames = () =>
    [...document.querySelectorAll(".location__favorites li")].map((item) => item.textContent?.trim());
  const popup = () => screen.getByRole("dialog");
  const openSettings = (name = "Settings") => fireEvent.click(screen.getByRole("button", { name }));
  /** Selects a tab of the open settings popup (REQ-686). */
  const tab = (name: string) => fireEvent.click(within(popup()).getByRole("tab", { name }));
  const chooseFile = async (content: string) => {
    const input = within(popup()).getByTestId("settings-import-file");
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([content], "settings.json", { type: "application/json" })] } });
    });
  };

  it("exports and imports the language, the colour mode, the model chain choice, the map and the favourites", async () => {
    const downloads = captureDownloads();
    storeLanguage("de");
    setColorMode("dark");
    setDewPoint("off");
    setScaleToVisibleRange(false);
    setLegend(false);
    setArchiveDays(90);
    setHistorySlider(true);
    weatherChainChoice.set(true);
    cloudChainChoice.set(false);
    setMapProvider("maptoolkit");
    startLocationChoice.set(INNSBRUCK);
    modelHeadersChoice.set(false);
    daySliderChoice.set(false);
    daysChoice.set(3);
    storeFavorites([MATTERHORN, INNSBRUCK]);
    setup();
    openSettings("Einstellungen");
    fireEvent.click(within(popup()).getByRole("button", { name: "Einstellungen exportieren" }));
    expect(downloads.names).toEqual([settingsFileName()]);
    expect(downloads.blobs[0]?.type).toBe("application/json");
    const exported = await downloads.blobs[0]!.text();
    expect(parseSettingsFile(exported)).toEqual({
      ok: true,
      value: {
        settings: {
          language: "de",
          colorMode: "dark",
          showWeatherChain: true,
          showCloudChain: false,
          map: "maptoolkit",
          startLocation: INNSBRUCK,
          modelHeaders: false,
          daySlider: false,
          days: 3,
          dewPoint: "off",
          relativeHumidity: "off",
          scaleToVisibleRange: false,
          legend: false,
          archiveDays: 90,
          historySlider: true,
        },
        favorites: [MATTERHORN, INNSBRUCK],
      },
    });

    // Change everything, then load the export back.
    fireEvent.change(screen.getByRole("combobox", { name: "Sprache" }), { target: { value: "it" } });
    act(() => setColorMode("light"));
    act(() => setMapProvider(null));
    act(() => {
      weatherChainChoice.set(null);
      cloudChainChoice.set(true);
    });
    act(() => {
      startLocationChoice.set("gps");
      modelHeadersChoice.set(null);
      daySliderChoice.set(true);
      daysChoice.set(null);
      setDewPoint("on");
      setScaleToVisibleRange(true);
      setLegend(true);
      setArchiveDays("unlimited");
      setHistorySlider(false);
    });
    act(() => storeFavorites([BRUSSELS]));
    await chooseFile(exported);
    await waitFor(() => expect(within(popup()).getByRole("status").textContent).toBe(translate("de", "settings.transfer.imported")));
    expect(screen.getByRole("dialog", { name: "Einstellungen" })).toBeTruthy();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    expect(readStoredColorMode()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(weatherChainChoice.read()).toBe(true);
    expect(cloudChainChoice.read()).toBe(false);
    // Each setting in its tab (REQ-686).
    tab("Modelle");
    expect(within(popup()).getByRole("checkbox", { name: "Wetterkette anzeigen" })).toHaveProperty("checked", true);
    expect(within(popup()).getByRole("checkbox", { name: "Wolkenkette anzeigen" })).toHaveProperty("checked", false);
    expect(readStoredMapProvider()).toBe("maptoolkit");
    tab("Design");
    expect(within(popup()).getByRole("radio", { name: "Maptoolkit" })).toHaveProperty("checked", true);
    expect(startLocationChoice.read()).toEqual(INNSBRUCK);
    expect(modelHeadersChoice.read()).toBe(false);
    expect(daySliderChoice.read()).toBe(false);
    expect(daysChoice.read()).toBe(3);
    tab("Modelle");
    expect(within(popup()).getByRole("checkbox", { name: "Modellköpfe anzeigen" })).toHaveProperty("checked", false);
    tab("Start");
    expect(within(popup()).getByRole("combobox", { name: "Angezeigte Tage" })).toHaveProperty("value", "3");
    tab("Meteogramm");
    expect(readDewPoint()).toBe("off");
    const dewPoint = within(popup()).getByRole("radiogroup", { name: "Taupunkt" });
    expect(within(dewPoint).getByRole("radio", { name: "Aus" })).toHaveProperty("checked", true);
    expect(readRelativeHumidity()).toBe("off");
    const humidity = within(popup()).getByRole("radiogroup", { name: "Relative Luftfeuchte" });
    expect(within(humidity).getByRole("radio", { name: "Aus" })).toHaveProperty("checked", true);
    expect(readScaleToVisibleRange()).toBe(false);
    const axes = within(popup()).getByRole("radiogroup", { name: "Achsen beim Zoomen anpassen" });
    expect(within(axes).getByRole("radio", { name: "Aus" })).toHaveProperty("checked", true);
    expect(readLegend()).toBe(false);
    expect(within(popup()).getByRole("checkbox", { name: "Legende anzeigen" })).toHaveProperty("checked", false);
    // The archive of the installed app (REQ-686); its tab is not shown on the website.
    expect(readArchiveDays()).toBe(90);
    expect(readHistorySlider()).toBe(true);
    expect(within(popup()).queryByRole("tab", { name: "Archiv" })).toBeNull();
    expect(readStoredFavorites()).toEqual([MATTERHORN, INNSBRUCK]);
    expect(favoriteNames()).toEqual([expect.stringContaining("Matterhorn"), expect.stringContaining("Innsbruck")]);
  });

  it("exports the presets while no own favourites are stored", async () => {
    const downloads = captureDownloads();
    setup();
    openSettings();
    fireEvent.click(within(popup()).getByRole("button", { name: "Export settings" }));
    expect(parseSettingsFile(await downloads.blobs[0]!.text())).toEqual({
      ok: true,
      value: {
        settings: {
          language: null,
          colorMode: "system",
          showWeatherChain: null,
          showCloudChain: null,
          map: null,
          startLocation: null,
          modelHeaders: null,
          daySlider: null,
          days: null,
          // Off without a choice (REQ-621).
          dewPoint: "off",
          relativeHumidity: "off",
          // The axes follow the zoom without a choice (REQ-656).
          scaleToVisibleRange: true,
          // The legend is shown without a choice (REQ-639).
          legend: true,
          // The archive keeps every fetch, the history slider is hidden without a choice (REQ-686).
          archiveDays: "unlimited",
          historySlider: false,
        },
        favorites: PRESETS,
      },
    });
  });

  it("replaces the favourites shown in the location picker", async () => {
    setup();
    expect(favoriteNames()).toEqual([expect.stringContaining("Matterhorn")]);
    openSettings();
    await chooseFile(file({ favorites: [INNSBRUCK, BRUSSELS] }));
    await waitFor(() => expect(favoriteNames()).toHaveLength(2));
    expect(favoriteNames()).toEqual([expect.stringContaining("Innsbruck"), expect.stringContaining("Brussels")]);
    // A file without settings leaves the language and the colour mode alone.
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(MAP_PROVIDER_STORAGE_KEY)).toBeNull();
    expect(within(popup()).getByRole("status").textContent).toBe("Settings and favourites imported.");
  });

  it("exports a renamed map-point favourite and imports it with its name (REQ-489)", async () => {
    const downloads = captureDownloads();
    const hill = { name: "Hausberg", lat: 47.1718, lon: 12.6806, mapPoint: true as const };
    storeFavorites([MATTERHORN, hill]);
    setup();
    openSettings();
    fireEvent.click(within(popup()).getByRole("button", { name: "Export settings" }));
    const exported = await downloads.blobs[0]!.text();
    expect(JSON.parse(exported).favorites).toEqual([MATTERHORN, hill]);

    window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
    await chooseFile(exported);
    await waitFor(() => expect(readStoredFavorites()).toEqual([MATTERHORN, hill]));
    expect(favoriteNames()).toEqual([expect.stringContaining("Matterhorn"), expect.stringContaining("Hausberg")]);
    // Imported, it still has the pencil to rename it.
    expect(screen.getByRole("menuitem", { name: "Rename Hausberg", hidden: true })).toBeTruthy();
  });

  it("imports the single model chain switch of an older file for both cards; separate switches win (REQ-503)", async () => {
    setup();
    openSettings();
    tab("Models");
    await chooseFile(file({ settings: { showModelChain: true } }));
    await waitFor(() => expect(weatherChainChoice.read()).toBe(true));
    expect(cloudChainChoice.read()).toBe(true);
    expect(within(popup()).getByRole("checkbox", { name: "Show the weather chain" })).toHaveProperty("checked", true);
    expect(within(popup()).getByRole("checkbox", { name: "Show the cloud chain" })).toHaveProperty("checked", true);

    await chooseFile(file({ settings: { showModelChain: true, showCloudChain: false } }));
    await waitFor(() => expect(cloudChainChoice.read()).toBe(false));
    expect(weatherChainChoice.read()).toBe(true);

    // `null` removes the own choice, so config.json applies again.
    await chooseFile(file({ settings: { showWeatherChain: null, showCloudChain: null } }));
    await waitFor(() => expect(weatherChainChoice.read()).toBeNull());
    expect(cloudChainChoice.read()).toBeNull();
    expect(within(popup()).getByRole("checkbox", { name: "Show the weather chain" })).toHaveProperty("checked", false);
  });

  it.each([
    ["invalid", "not json"],
    ["newer", file({ version: SETTINGS_FILE_VERSION + 1, favorites: [] })],
    ["content", file({ settings: { language: "it" }, favorites: [{ name: "Nowhere" }] })],
  ] as const)("refuses an %s file with a translated message and changes nothing", async (error, content) => {
    storeLanguage("fr");
    storeFavorites([INNSBRUCK]);
    setup();
    openSettings("Paramètres");
    await chooseFile(content);
    // An error card (REQ-492), rendered inside the open popup since the page behind it is inert.
    await waitFor(() =>
      expect(within(popup()).getByRole("alert").textContent).toBe(translate("fr", `settings.transfer.error.${error}`)),
    );
    expect(within(popup()).getByRole("alert").getAttribute("data-testid")).toBe("error-card");
    expect(within(popup()).getByRole("status").textContent).toBe("");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr");
    expect(readStoredFavorites()).toEqual([INNSBRUCK]);
    expect(favoriteNames()).toEqual([expect.stringContaining("Innsbruck")]);
    expect(window.localStorage.getItem(FAVORITES_STORAGE_KEY)).toBe(JSON.stringify([INNSBRUCK]));
    // Closing the popup takes the card with it.
    fireEvent.click(within(popup()).getByRole("button", { name: translate("fr", "dialog.close") }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

});
