// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Start place "Last selected place" (REQ-599): the first option and the default of the start place setting. The page
 * remembers every place it shows after the start and opens it next time; without a remembered place config.json
 * applies. A GPS or fixed-place choice stays as it was; the choice goes through export and import, the remembered
 * place does not.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig, type Place } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, translate, type Language } from "../src/i18n/index.ts";
import { LANGUAGES } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { LocationPicker, type LocationPickerProps } from "../src/regions/LocationPicker/index.ts";
import {
  LAST_PLACE_STORAGE_KEY,
  LocationProvider,
  SETTINGS_FILE_FORMAT,
  START_LOCATION_STORAGE_KEY,
  effectiveStartLocation,
  parseSettingsFile,
  readLastPlace,
  rememberPlace,
  resetDisplaySettings,
  serializeSettingsFile,
  startLocationChoice,
  storeFavorites,
  useLocation,
  useStartLocation,
} from "../src/state/index.ts";

const MATTERHORN: Place = { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 };
const INNSBRUCK: Place = { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 };
const ORTLER: Place = { name: "Ortler", lat: 46.5086, lon: 10.5447, elevation: 3905 };
const LIENZ: Place = { name: "Lienz", lat: 46.8289, lon: 12.7696, elevation: 673 };

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
  const { place } = useLocation();
  return <output data-testid="probe">{JSON.stringify({ choice: useStartLocation(), place })}</output>;
}

const probe = () =>
  JSON.parse(screen.getByTestId("probe").textContent!) as { choice: ReturnType<typeof useStartLocation>; place: Place };

const remembered = () => JSON.parse(window.localStorage.getItem(LAST_PLACE_STORAGE_KEY) ?? "null") as Place | null;

/** A page start: header (settings), location picker and the probe, with the given config.json. */
function start(config: Partial<GraupelConfig> = {}, props: LocationPickerProps = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ elevation: [100] }))),
  );
  return render(
    <ConfigProvider config={{ ...DEFAULT_CONFIG, ...config }}>
      <I18nProvider browserLanguages={["en"]}>
        <NoticesProvider>
          <DialogsProvider>
            <LocationProvider>
              <Header />
              <LocationPicker searchDelay={0} {...props} />
              <Probe />
            </LocationProvider>
          </DialogsProvider>
        </NoticesProvider>
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

const startSelect = () =>
  openSettings("Start").getByRole("combobox", { name: "Start place" }) as HTMLSelectElement;

/**
 * Stubs the browser's geolocation, answering a little later; `granted`: the page may read the position (no prompt),
 * else the user denies it when asked.
 */
function stubGeolocation(granted: boolean, latitude = 47.123456, longitude = 11.654321) {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) =>
    queueMicrotask(() =>
      granted
        ? success({ coords: { latitude, longitude } } as GeolocationPosition)
        : failure?.({ code: 1, message: "" } as GeolocationPositionError),
    ),
  );
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: { getCurrentPosition },
    permissions: { query: vi.fn(async () => ({ state: granted ? "granted" : "prompt" })) },
  });
  return getCurrentPosition;
}

describe("start place that applies (REQ-599)", () => {
  it("is the remembered place with 'last' or without an own choice, else config.json; GPS and places as chosen", () => {
    expect(effectiveStartLocation(null, ORTLER, INNSBRUCK)).toEqual(INNSBRUCK);
    expect(effectiveStartLocation("last", ORTLER, INNSBRUCK)).toEqual(INNSBRUCK);
    expect(effectiveStartLocation(null, ORTLER, null)).toEqual(ORTLER);
    expect(effectiveStartLocation("last", "gps", null)).toBe("gps");
    expect(effectiveStartLocation("last", "gps", INNSBRUCK)).toEqual(INNSBRUCK);
    expect(effectiveStartLocation("gps", ORTLER, INNSBRUCK)).toBe("gps");
    expect(effectiveStartLocation(MATTERHORN, "gps", INNSBRUCK)).toEqual(MATTERHORN);
  });

  it("is 'last' without an own choice, the first option of the settings and selected there", () => {
    storeFavorites([MATTERHORN, INNSBRUCK]);
    start({ startLocation: ORTLER });
    expect(startLocationChoice.read()).toBeNull();
    expect(probe().choice).toBe("last");
    const select = startSelect();
    // The fixed place of config.json is no favourite: offered too.
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Last selected place",
      "Current position (GPS)",
      "Ortler",
      "Matterhorn",
      "Innsbruck",
    ]);
    expect(select.value).toBe("last");
    expect(select.selectedOptions[0]!.textContent).toBe("Last selected place");
    const hint = select.parentElement!.querySelector(".settings__text")!.textContent;
    expect(hint).toContain("“Last selected place” opens the place you viewed last, on the first visit the site's start place.");
    expect(hint).toContain("With GPS the page asks for your position when it opens");
  });

  it("names the option and explains it in every language", () => {
    for (const language of LANGUAGES as readonly Language[]) {
      const label = translate(language, "settings.startLocation.last");
      expect(label).not.toBe("");
      if (language !== "en") expect(label).not.toBe(translate("en", "settings.startLocation.last"));
      expect(translate(language, "settings.startLocation.text")).toContain(label);
    }
    expect(translate("de", "settings.startLocation.last")).toBe("Zuletzt gewählter Ort");
    expect(translate("de", "settings.startLocation.text")).toBe(
      "Gilt beim nächsten Öffnen der Seite. „Zuletzt gewählter Ort“ öffnet den Ort, den du zuletzt angesehen hast, " +
        "beim ersten Besuch den Startort der Seite. Mit GPS fragt die Seite beim Öffnen nach deinem Standort; bis er " +
        "da ist oder wenn er nicht erlaubt wird, erscheint der erste Favorit.",
    );
  });

  it("opens the place shown last at the next start, with or without the stored choice 'last'", () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, JSON.stringify(INNSBRUCK));
    const first = start({ startLocation: ORTLER });
    expect(probe().place).toEqual(INNSBRUCK);
    first.unmount();

    startLocationChoice.set("last");
    start({ startLocation: ORTLER });
    expect(window.localStorage.getItem(START_LOCATION_STORAGE_KEY)).toBe("last");
    expect(probe()).toEqual({ choice: "last", place: INNSBRUCK });
  });

  it("falls back to config.json without a remembered place: a fixed place", () => {
    start({ startLocation: ORTLER });
    expect(probe().place).toEqual(ORTLER);
    // Nothing is remembered before the place changes.
    expect(remembered()).toBeNull();
  });

  it("ignores a remembered value that is no place", () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, '{"name":"x","lat":200,"lon":0}');
    expect(readLastPlace()).toBeNull();
    start({ startLocation: ORTLER });
    expect(probe().place).toEqual(ORTLER);
  });

  it('falls back to config.json "gps" like the GPS choice and remembers the position found at start', async () => {
    const getCurrentPosition = stubGeolocation(true);
    start({ startLocation: "gps", favorites: { enabled: true, presets: [MATTERHORN, INNSBRUCK] } });
    // The first favourite until the position is there.
    expect(probe().place.name).toBe("Matterhorn");
    await waitFor(() => expect(probe().place).toMatchObject({ name: "My location", lat: 47.1235, lon: 11.6543 }));
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(remembered()).toMatchObject({ name: "My location", lat: 47.1235, lon: 11.6543 });
  });

  it('with config.json "gps" asks for the position at start; denied: favourite stays, nothing remembered', async () => {
    const getCurrentPosition = stubGeolocation(false);
    start({ startLocation: "gps", favorites: { enabled: true, presets: [MATTERHORN] } });
    expect(probe().place).toEqual(MATTERHORN);
    await act(async () => {});
    // DEC-107: asked at start (the browser asks the user).
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(probe().place).toEqual(MATTERHORN);
    expect(remembered()).toBeNull();
  });

  it("keeps an existing GPS choice: the remembered place does not apply", async () => {
    const getCurrentPosition = stubGeolocation(false);
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, JSON.stringify(INNSBRUCK));
    startLocationChoice.set("gps");
    start({ startLocation: ORTLER, favorites: { enabled: true, presets: [MATTERHORN] } });
    expect(probe()).toEqual({ choice: "gps", place: MATTERHORN });
    await act(async () => {});
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(probe().place).toEqual(MATTERHORN);
    expect(startSelect().value).toBe("gps");
  });

  it("keeps an existing fixed-place choice: the remembered place does not apply", () => {
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, JSON.stringify(INNSBRUCK));
    window.localStorage.setItem(START_LOCATION_STORAGE_KEY, JSON.stringify(MATTERHORN));
    start({ startLocation: ORTLER });
    expect(probe()).toEqual({ choice: MATTERHORN, place: MATTERHORN });
    expect(startSelect().selectedOptions[0]!.textContent).toBe("Matterhorn");
  });

  it("stores 'last' when it is chosen again in the settings", () => {
    start({ startLocation: ORTLER });
    const select = startSelect();
    fireEvent.change(select, { target: { value: "gps" } });
    expect(window.localStorage.getItem(START_LOCATION_STORAGE_KEY)).toBe("gps");
    fireEvent.change(select, { target: { value: "last" } });
    expect(window.localStorage.getItem(START_LOCATION_STORAGE_KEY)).toBe("last");
    expect(startLocationChoice.read()).toBe("last");
    expect(select.value).toBe("last");
  });
});

describe("remembering the place shown (REQ-599)", () => {
  it("remembers the place after a search, a favourite and the GPS button, whatever the start choice", async () => {
    let answer: PositionCallback | undefined;
    const geolocation = { getCurrentPosition: vi.fn((ok: PositionCallback) => (answer = ok)) } as unknown as Geolocation;
    startLocationChoice.set(MATTERHORN);
    start(
      { startLocation: ORTLER, favorites: { enabled: true, presets: [MATTERHORN, LIENZ] } },
      { services: { searchPlaces: async () => [INNSBRUCK], fetchElevation: async () => 2000, geolocation } },
    );
    expect(remembered()).toBeNull();

    // Search.
    fireEvent.change(screen.getByRole("combobox", { name: "Search for a place" }), { target: { value: "Inns" } });
    fireEvent.click(await screen.findByRole("option", { name: /Innsbruck/ }));
    expect(probe().place).toEqual(INNSBRUCK);
    expect(remembered()).toEqual(INNSBRUCK);

    // Favourite.
    fireEvent.click(screen.getByRole("button", { name: "Show favourites" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Lienz" }));
    expect(remembered()).toEqual(LIENZ);

    // GPS button; the elevation fetched afterwards is remembered too.
    fireEvent.click(screen.getByRole("button", { name: "Current location" }));
    act(() => answer!({ coords: { latitude: 46.5, longitude: 11.25 } } as GeolocationPosition));
    expect(remembered()).toMatchObject({ name: "My location", lat: 46.5, lon: 11.25 });
    await waitFor(() => expect(remembered()).toEqual({ name: "My location", lat: 46.5, lon: 11.25, elevation: 2000 }));
    // The fixed-place choice stays.
    expect(startLocationChoice.read()).toEqual(MATTERHORN);
  });

  it("keeps working without storage: nothing is remembered and config.json applies", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLastPlace()).toBeNull();
    expect(() => rememberPlace(INNSBRUCK)).not.toThrow();
    start({ startLocation: ORTLER, favorites: { enabled: true, presets: [MATTERHORN] } });
    expect(probe().place).toEqual(ORTLER);
    fireEvent.click(screen.getByRole("button", { name: "Show favourites" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Matterhorn" }));
    expect(probe().place).toEqual(MATTERHORN);
  });
});

describe("export and import of 'last' (REQ-599)", () => {
  const file = (settings: unknown) => JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings });

  it("reads and writes 'last' like the other values", () => {
    const settings = { startLocation: "last" as const };
    expect(parseSettingsFile(serializeSettingsFile({ settings }))).toEqual({ ok: true, value: { settings } });
    expect(parseSettingsFile(file({ startLocation: "lastPlace" }))).toEqual({ ok: false, error: "content" });
  });

  /** Captures the text of the export's download. */
  function captureDownload() {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:settings";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    return () => blobs.at(-1)!.text();
  }

  const status = () => within(screen.getByRole("dialog")).getByRole("status").textContent;

  const importFile = async (content: string) => {
    const input = within(screen.getByRole("dialog")).getByTestId("settings-import-file");
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([content], "settings.json", { type: "application/json" })] } });
    });
  };

  it("exports the choice 'last' without the remembered place and imports it back", async () => {
    const exported = captureDownload();
    window.localStorage.setItem(LAST_PLACE_STORAGE_KEY, JSON.stringify(INNSBRUCK));
    start({ startLocation: ORTLER });
    const select = startSelect();
    fireEvent.change(select, { target: { value: "last" } });
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Export settings" }));
    const text = await exported();
    expect((JSON.parse(text) as { settings: Record<string, unknown> }).settings.startLocation).toBe("last");
    // The remembered place is no setting.
    expect(text).not.toContain("Innsbruck");

    fireEvent.change(select, { target: { value: "gps" } });
    await importFile(file({ startLocation: "last" }));
    await waitFor(() => expect(startLocationChoice.read()).toBe("last"));
    expect(select.value).toBe("last");
    // Importing leaves the remembered place and the place shown alone.
    expect(remembered()).toEqual(INNSBRUCK);
    expect(probe().place).toEqual(INNSBRUCK);
  });

  it("keeps the choice for an older file without the value; no choice (reset) restores the default 'last'", async () => {
    start({ startLocation: ORTLER });
    const select = startSelect();
    fireEvent.change(select, { target: { value: "gps" } });
    expect(status()).toBe("");
    await importFile(file({ colorMode: "system" }));
    await waitFor(() => expect(status()).toBe(translate("en", "settings.transfer.imported")));
    expect(startLocationChoice.read()).toBe("gps");
    expect(select.value).toBe("gps");

    await importFile(file({ startLocation: null }));
    await waitFor(() => expect(startLocationChoice.read()).toBeNull());
    expect(window.localStorage.getItem(START_LOCATION_STORAGE_KEY)).toBeNull();
    expect(select.value).toBe("last");
    expect(probe().choice).toBe("last");
  });
});
