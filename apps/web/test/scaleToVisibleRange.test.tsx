// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Axes when zoomed (REQ-656): the option „Achsen beim Zoomen anpassen“ On or Off in the settings popup (section
 * Meteogram, last, with a hint that it concerns precipitation and wind), On by default, stored, exported and imported;
 * the page passes it to @graupel/meteogram as the value of the layout switch `scaleToVisibleRange` (REQ-661) for the chart on the page, the
 * full-screen view and the copied or saved picture. With it on and fewer days in the day slider than the whole
 * forecast, the precipitation and wind axes reach only as far as the values of the days shown; while the slider is
 * dragged they stay, and they adapt once it is released (DEC-061). Working out the axes belongs to the library
 * (REQ-655); here only that the charts follow the option. The PNG export of the core is mocked (jsdom has no canvas).
 */
import { meteogramToPng } from "@graupel/meteogram/png";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, MESSAGES } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import { imageRenderOptions, meteogramToggles } from "../src/regions/MeteogramPanel/layout.ts";
import {
  ChainProvider,
  DEFAULT_SCALE_TO_VISIBLE_RANGE,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  SCALE_TO_VISIBLE_RANGE_STORAGE_KEY,
  SETTINGS_FILE_FORMAT,
  parseSettingsFile,
  readScaleToVisibleRange,
  resetDisplaySettings,
  scaleToVisibleRangeChoice,
  serializeSettingsFile,
  setScaleToVisibleRange,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

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
 * Weather of the fixture (hour 0 is Monday 00:00 in Vienna, day index = hour / 24): a storm (wind 40 km/h, gusts
 * 70 km/h, 8 mm of rain every third hour) except on Wednesday and Thursday (days 2 and 3) and an hour around them,
 * which are calm (wind 5 km/h, gusts 12 km/h, 0.4 mm every sixth hour).
 */
const calm = (hour: number) => hour >= 46 && hour <= 98;
const wind = (hour: number) => (calm(hour) ? 5 : 40);
const gusts = (hour: number) => (calm(hour) ? 12 : 70);
const precipitation = (hour: number) => (calm(hour) ? (hour % 6 === 0 ? 0.4 : 0) : hour % 3 === 0 ? 8 : 0);

/** Highest labels of the precipitation and wind axes of the chart in `root` (value and unit joined by a space). */
function axisTops(root: ParentNode) {
  const text = (element: Element) => {
    const spans = [...element.querySelectorAll("tspan")];
    const lines = spans.length > 0 ? spans.map((span) => span.textContent ?? "") : [element.textContent ?? ""];
    return lines.map((line) => line.trim()).join(" ");
  };
  const top = (area: string, unit: string) => {
    const values = [...root.querySelectorAll(`[data-area-id="${area}"] text`)]
      .filter((element) => element.getAttribute("data-testid") !== "axis-mid")
      .map(text)
      .filter((label) => label.endsWith(` ${unit}`))
      .map((label) => Number(label.slice(0, -unit.length - 1)));
    return values.length > 0 ? `${Math.max(...values)} ${unit}` : null;
  };
  return { precip: top("precip", "mm"), wind: top("wind", "km/h") };
}

/** Axes over the whole forecast, storm included. */
const WHOLE = { precip: "10 mm", wind: "75 km/h" };
/** Axes of a calm day. */
const CALM = { precip: "2 mm", wind: "15 km/h" };

/** Header (with the settings popup), day slider and meteogram of the stormy forecast, as on the page. */
async function renderPage() {
  const loader = vi.fn<ForecastLoader>(async () => forecastFixture({ wind, gusts, precipitation }));
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
                    <DaySlider />
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
  return screen.findAllByTestId("day-card");
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

/** Selects one day with a click from the keyboard (selects the day, never the whole period). */
const selectDay = (cards: HTMLElement[], index: number) => fireEvent.click(cards[index]!, { detail: 0 });

describe("option „Achsen beim Zoomen anpassen“ (REQ-656)", () => {
  it("is On without a stored choice; Off is stored, On is not", () => {
    expect(DEFAULT_SCALE_TO_VISIBLE_RANGE).toBe(true);
    expect(readScaleToVisibleRange()).toBe(true);
    expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBeNull();
    setScaleToVisibleRange(false);
    expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBe("false");
    expect(readScaleToVisibleRange()).toBe(false);
    setScaleToVisibleRange(true);
    expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBeNull();
    expect(scaleToVisibleRangeChoice.read()).toBeNull();
    expect(readScaleToVisibleRange()).toBe(true);
  });

  it("keeps a stored Off and On and ignores a stored value that is no option", () => {
    window.localStorage.setItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY, "false");
    expect(readScaleToVisibleRange()).toBe(false);
    window.localStorage.setItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY, "true");
    expect(readScaleToVisibleRange()).toBe(true);
    window.localStorage.setItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY, "off");
    expect(readScaleToVisibleRange()).toBe(true);
  });

  it("has its texts in every language", () => {
    for (const messages of Object.values(MESSAGES)) {
      for (const key of [
        "settings.meteogram.scaleToVisibleRange",
        "settings.meteogram.scaleToVisibleRange.on",
        "settings.meteogram.scaleToVisibleRange.off",
        "settings.meteogram.scaleToVisibleRange.hint",
      ]) {
        expect(messages[key]).toBeTruthy();
      }
    }
    expect(Object.keys(MESSAGES).sort()).toEqual(["cs", "da", "de", "en", "fr", "it", "nl", "sl"]);
    expect(MESSAGES.de["settings.meteogram.scaleToVisibleRange"]).toBe("Achsen beim Zoomen anpassen");
    expect(MESSAGES.de["settings.meteogram.scaleToVisibleRange.on"]).toBe("An");
    expect(MESSAGES.de["settings.meteogram.scaleToVisibleRange.off"]).toBe("Aus");
    expect(MESSAGES.de["settings.meteogram.scaleToVisibleRange.hint"]).toMatch(/Niederschlag und Wind/);
  });

  it("is chosen in the meteogram section below the legend, with its hint; the chart follows", async () => {
    const cards = await renderPage();
    // All days: the axes of the whole forecast.
    expect(axisTops(embedded())).toEqual(WHOLE);

    const section = openSettings("Meteogram").getByRole("heading", { name: "Meteogram" }).closest("section")!;
    expect(section.dataset.settings).toBe("meteogram");
    const group = within(section).getByRole("radiogroup", { name: "Adjust axes when zooming" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual(["On", "Off"]);
    expect(within(group).getByRole("radio", { name: "On" })).toHaveProperty("checked", true);
    // Directly below the legend (REQ-686), with the hint as its description; the dew point follows the hint.
    const legend = within(section).getByRole("checkbox", { name: "Show the legend" });
    expect(legend.closest("label")!.nextElementSibling).toBe(group.closest(".settings__field"));
    const hint = document.getElementById(group.getAttribute("aria-describedby")!)!;
    expect(hint.textContent).toBe(
      "Applies to precipitation and wind: their axes follow the values in the period shown.",
    );
    expect(group.closest(".settings__field")!.nextElementSibling).toBe(hint);
    const dewPoint = within(section).getByRole("radiogroup", { name: "Dew point" });
    expect(hint.nextElementSibling).toBe(dewPoint.closest(".settings__field"));

    // A calm day in the slider: smaller axes.
    act(() => selectDay(cards, 2));
    await waitFor(() => expect(axisTops(embedded())).toEqual(CALM));

    // Off, stored: the axes of the whole forecast for the same day.
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBe("false");
    await waitFor(() => expect(axisTops(embedded())).toEqual(WHOLE));

    // On again: nothing stored, the calm day's axes.
    fireEvent.click(within(group).getByRole("radio", { name: "On" }));
    expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(axisTops(embedded())).toEqual(CALM));
  });

  it("shows a stored Off in the popup and keeps the axes of the whole forecast", async () => {
    window.localStorage.setItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY, "false");
    const cards = await renderPage();
    act(() => selectDay(cards, 3));
    const start = () => embedded().querySelector("svg")!.getAttribute("data-visible-start-time");
    await waitFor(() => expect(start()).toContain("2026-10-28T23:00"));
    expect(axisTops(embedded())).toEqual(WHOLE);
    const group = openSettings("Meteogram").getByRole("radiogroup", { name: "Adjust axes when zooming" });
    expect(within(group).getByRole("radio", { name: "Off" })).toHaveProperty("checked", true);
  });

  it("adapts the axes when the day slider is released, not while it is dragged (DEC-061)", async () => {
    const cards = await renderPage();
    act(() => selectDay(cards, 2));
    await waitFor(() => expect(axisTops(embedded())).toEqual(CALM));
    // Cards in jsdom have no size: the track gets one, 100 pixels per day.
    const track = screen.getByTestId("day-slider-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: cards.length * 100,
      width: cards.length * 100,
      top: 0,
      bottom: 60,
      height: 60,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    // Dragging the end grip from Wednesday to Saturday: the stormy days are marked, the axes stay.
    const end = screen.getByTestId("day-slider-end");
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 450 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 600 });
    expect(screen.getByTestId("day-slider-marker").dataset.end).toBe("5");
    expect(axisTops(embedded())).toEqual(CALM);
    // Released: the axes of Wednesday to Saturday.
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 600 });
    await waitFor(() => expect(axisTops(embedded())).toEqual(WHOLE));
  });

  it("is followed by the full-screen view", async () => {
    const cards = await renderPage();
    act(() => selectDay(cards, 2));
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    expect(fullscreen()).not.toBeNull();
    await waitFor(() => expect(axisTops(fullscreen()!)).toEqual(CALM));

    act(() => setScaleToVisibleRange(false));
    await waitFor(() => expect(axisTops(fullscreen()!)).toEqual(WHOLE));
    expect(axisTops(embedded())).toEqual(WHOLE);

    act(() => setScaleToVisibleRange(true));
    await waitFor(() => expect(axisTops(fullscreen()!)).toEqual(CALM));
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
      // On without a choice.
      // Beside the render options the picture gets its background and scale (REQ-714); it has the model headers as the
      // chart on screen (modelHeaders of the default config, REQ-539, DEC-094).
      expect(toPng).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ render: imageRenderOptions(true, meteogramToggles("off", "off", true)) }),
      );
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { scaleToVisibleRange: "on" } });

      act(() => setScaleToVisibleRange(false));
      await copy();
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { scaleToVisibleRange: "off" } });
      // The picture of the full-screen view as well.
      fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
      const view = within(fullscreen()!.closest("dialog")!);
      fireEvent.click(view.getByRole("button", { name: "Copy the meteogram as a picture" }));
      await waitFor(() => expect(toPng).toHaveBeenCalledTimes(3));
      expect(toPng.mock.lastCall![1]!.render).toMatchObject({ toggles: { scaleToVisibleRange: "off" } });
      expect(write).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("goes into the render options of the picture", () => {
    for (const on of [true, false]) {
      const value = on ? "on" : "off";
      expect(imageRenderOptions(true, meteogramToggles("auto", "on", on))).toMatchObject({
        toggles: { scaleToVisibleRange: value, relativeHumidity: "on" },
        forceModelHeaders: true,
      });
      expect(imageRenderOptions(false, meteogramToggles("off", "off", on))).toMatchObject({
        toggles: { scaleToVisibleRange: value },
        forceModelHeaders: false,
      });
    }
  });
});

describe("settings file with the axes when zoomed (REQ-656)", () => {
  const file = (settings: unknown) => JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings });

  it("round-trips both choices", () => {
    for (const scaleToVisibleRange of [true, false]) {
      const settings = { relativeHumidity: "off", scaleToVisibleRange } as const;
      expect(parseSettingsFile(serializeSettingsFile({ settings }))).toEqual({ ok: true, value: { settings } });
    }
  });

  it("reads older files without it, leaving it out", () => {
    expect(parseSettingsFile(file({ colorMode: "dark", relativeHumidity: "on" }))).toEqual({
      ok: true,
      value: { settings: { colorMode: "dark", relativeHumidity: "on" } },
    });
  });

  it.each([
    { scaleToVisibleRange: "on" },
    { scaleToVisibleRange: null },
    { scaleToVisibleRange: 1 },
    { scaleToVisibleRange: "false" },
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
      within(popup.getByRole("radiogroup", { name: "Adjust axes when zooming" })).getByRole("radio", { name });

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

    it("exports On without a choice and the chosen option otherwise", async () => {
      const blobs = captureDownloads();
      const popup = setup();
      expect((await exportSettings(popup, blobs)).scaleToVisibleRange).toBe(true);
      fireEvent.click(option(popup, "Off"));
      expect((await exportSettings(popup, blobs)).scaleToVisibleRange).toBe(false);
      fireEvent.click(option(popup, "On"));
      expect((await exportSettings(popup, blobs)).scaleToVisibleRange).toBe(true);
    });

    it("imports both choices, stores Off, and shows it in the popup", async () => {
      const popup = setup();
      expect(option(popup, "On")).toHaveProperty("checked", true);
      await importFile(popup, file({ scaleToVisibleRange: false }));
      expect(readScaleToVisibleRange()).toBe(false);
      expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBe("false");
      expect(option(popup, "Off")).toHaveProperty("checked", true);
      await importFile(popup, file({ scaleToVisibleRange: true }));
      expect(readScaleToVisibleRange()).toBe(true);
      expect(window.localStorage.getItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY)).toBeNull();
      expect(option(popup, "On")).toHaveProperty("checked", true);
    });

    it("keeps the option when an older file without it is imported", async () => {
      const popup = setup();
      act(() => setScaleToVisibleRange(false));
      await importFile(popup, file({ colorMode: "dark", relativeHumidity: "on" }));
      expect(readScaleToVisibleRange()).toBe(false);
      expect(option(popup, "Off")).toHaveProperty("checked", true);
    });
  });
});
