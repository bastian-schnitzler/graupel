// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Meteogram with layout schema v2 of @graupel/meteogram (REQ-661): the website's layout is a layout of version 2 with
 * the switches (`toggles`) dew point (off, on, auto), relative humidity (off, on) and "adjust axes when zooming" (off,
 * on). The settings go to the library as values of these switches (render option `toggles`) for the chart on the page,
 * the full-screen view and the picture; the render options `dewPoint`, `relativeHumidity` and `scaleToVisibleRange`
 * are no longer set. Stored settings keep their meaning. How the charts look with each setting is covered by
 * dewPoint.test.tsx, relativeHumidity.test.tsx and scaleToVisibleRange.test.tsx; the PNG export of the core is mocked
 * (jsdom has no canvas).
 */
import { resolveChartLayout, toggleValues } from "@graupel/meteogram";
import { meteogramToPng } from "@graupel/meteogram/png";
import type { MeteogramComponentOptions, MeteogramProps } from "@graupel/meteogram-react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  chartHeights,
  followsVisibleRange,
  imageRenderOptions,
  meteogramToggles,
  rightLabelsTop,
  scaleLayoutAreas,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "../src/regions/MeteogramPanel/layout.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  DEW_POINT_STORAGE_KEY,
  ForecastProvider,
  LocationProvider,
  RELATIVE_HUMIDITY_STORAGE_KEY,
  resetDisplaySettings,
  SCALE_TO_VISIBLE_RANGE_STORAGE_KEY,
  setDewPoint,
  setRelativeHumidity,
  setScaleToVisibleRange,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

vi.mock("@graupel/meteogram/png", () => ({
  meteogramToPng: vi.fn(() => Promise.resolve(PNG)),
}));

/** Options of every chart drawn, in order: the real component draws, the wrapper only notes its options. */
const drawn = vi.hoisted(() => [] as MeteogramComponentOptions[]);

vi.mock("@graupel/meteogram-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@graupel/meteogram-react")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Meteogram: (props: MeteogramProps) => {
      if (props.options) drawn.push(props.options);
      return createElement(actual.Meteogram, props);
    },
  };
});

const OLD_OPTIONS = ["dewPoint", "relativeHumidity", "scaleToVisibleRange"] as const;

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
  drawn.length = 0;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderPage() {
  const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <NoticesProvider>
          <DialogsProvider>
            <LocationProvider>
              <ChainProvider>
                <ForecastProvider loader={loader}>
                  <DaySelectionProvider>
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

/** Options of the chart drawn last in the given mode (the embedded chart has none). */
const lastOptions = (mode: "embedded" | "fullscreen") => {
  const found = drawn.filter((options) => (options.mode ?? "embedded") === mode).at(-1);
  expect(found).toBeDefined();
  return found!;
};

const expectNoOldOptions = (options: object) => {
  for (const name of OLD_OPTIONS) expect(options).not.toHaveProperty(name);
};

describe("layout of the website (REQ-661)", () => {
  it("is a layout of version 2 with the switches of the settings", () => {
    for (const layout of [WEB_LAYOUT, WEB_LAYOUT_WITHOUT_HEADERS]) {
      expect(layout.version).toBe(2);
      expect(layout.toggles).toEqual({
        dewPoint: { values: ["off", "on", "auto"], default: "off" },
        relativeHumidity: { values: ["off", "on"], default: "off" },
        scaleToVisibleRange: { values: ["off", "on"], default: "on" },
      });
      const resolved = resolveChartLayout(layout);
      expect(resolved.warning ?? null).toBeNull();
      expect(resolved.layout.version).toBe(2);
      // Every setting is a value its switch has.
      for (const dewPoint of ["off", "on", "auto"] as const) {
        for (const relativeHumidity of ["off", "on"] as const) {
          for (const scale of [true, false]) {
            const toggles = meteogramToggles(dewPoint, relativeHumidity, scale);
            expect(toggleValues(resolved.layout, toggles)).toEqual(toggles);
          }
        }
      }
    }
  });

  it("keeps its switches in the lower areas of a phone in portrait", () => {
    expect(scaleLayoutAreas(WEB_LAYOUT, 0.5).toggles).toEqual(WEB_LAYOUT.toggles);
    expect(scaleLayoutAreas(WEB_LAYOUT, 0.5).version).toBe(2);
  });

  it("takes the settings as switch values", () => {
    expect(meteogramToggles("off", "off", true)).toEqual({
      dewPoint: "off",
      relativeHumidity: "off",
      scaleToVisibleRange: "on",
    });
    expect(meteogramToggles("auto", "on", false)).toEqual({
      dewPoint: "auto",
      relativeHumidity: "on",
      scaleToVisibleRange: "off",
    });
    expect(meteogramToggles("on", "off", true).dewPoint).toBe("on");
    expect(followsVisibleRange(meteogramToggles("off", "off", true))).toBe(true);
    expect(followsVisibleRange(meteogramToggles("off", "off", false))).toBe(false);
    // Without the switch the layout's default applies: on.
    expect(followsVisibleRange(null)).toBe(true);
    expect(followsVisibleRange({})).toBe(true);
  });

  it("measures the chart with the relative humidity only where its switch is on", () => {
    const drawnAs = { forceModelHeaders: true, backgroundHasData: true };
    const off = rightLabelsTop(WEB_LAYOUT, { ...drawnAs, toggles: meteogramToggles("auto", "off", true) });
    expect(off).toBe(rightLabelsTop(WEB_LAYOUT, drawnAs));
    const on = rightLabelsTop(WEB_LAYOUT, { ...drawnAs, toggles: meteogramToggles("off", "on", false) });
    expect(on).toBeLessThan(off!);
    // The dew point and the axes when zoomed change nothing of the chart's size.
    expect(chartHeights(WEB_LAYOUT, { ...drawnAs, toggles: meteogramToggles("on", "off", false) })).toEqual(
      chartHeights(WEB_LAYOUT, drawnAs),
    );
  });

  it("draws the picture with the switches, without the render options of their own", () => {
    const toggles = meteogramToggles("auto", "on", false);
    for (const headers of [true, false]) {
      const options = imageRenderOptions(headers, toggles);
      expect(options.toggles).toEqual({ dewPoint: "auto", relativeHumidity: "on", scaleToVisibleRange: "off" });
      expectNoOldOptions(options);
    }
  });
});

describe("charts of the page with the switches (REQ-661)", () => {
  it("pass the defaults as switch values, not as render options", async () => {
    await renderPage();
    const options = lastOptions("embedded");
    expect(options.toggles).toEqual({ dewPoint: "off", relativeHumidity: "off", scaleToVisibleRange: "on" });
    expect(options.layout).toBe(WEB_LAYOUT);
    expectNoOldOptions(options);
  });

  it("follow the settings on the page and in the full-screen view", async () => {
    await renderPage();
    act(() => {
      setDewPoint("auto");
      setRelativeHumidity("on");
      setScaleToVisibleRange(false);
    });
    const wanted = { dewPoint: "auto", relativeHumidity: "on", scaleToVisibleRange: "off" };
    await waitFor(() => expect(lastOptions("embedded").toggles).toEqual(wanted));
    expectNoOldOptions(lastOptions("embedded"));

    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    await waitFor(() => expect(lastOptions("fullscreen").toggles).toEqual(wanted));
    expectNoOldOptions(lastOptions("fullscreen"));

    act(() => setDewPoint("on"));
    await waitFor(() => expect(lastOptions("fullscreen").toggles).toMatchObject({ dewPoint: "on" }));
    expect(lastOptions("embedded").toggles).toMatchObject({ dewPoint: "on" });
  });

  it("read the settings stored before (unchanged keys and values)", async () => {
    window.localStorage.setItem(DEW_POINT_STORAGE_KEY, "on");
    window.localStorage.setItem(RELATIVE_HUMIDITY_STORAGE_KEY, "on");
    window.localStorage.setItem(SCALE_TO_VISIBLE_RANGE_STORAGE_KEY, "false");
    resetDisplaySettings();
    await renderPage();
    expect(lastOptions("embedded").toggles).toEqual({
      dewPoint: "on",
      relativeHumidity: "on",
      scaleToVisibleRange: "off",
    });
  });

  it("pass them to the picture as well", async () => {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly items: unknown) {}
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    try {
      const toPng = vi.mocked(meteogramToPng);
      toPng.mockClear();
      act(() => setDewPoint("auto"));
      await renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Copy the meteogram as a picture" }));
      await screen.findByText("Meteogram copied");
      const render = toPng.mock.lastCall![1]!.render!;
      expect(render.toggles).toEqual({ dewPoint: "auto", relativeHumidity: "off", scaleToVisibleRange: "on" });
      expectNoOldOptions(render);

      fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
      const dialog = within(screen.getByRole("dialog", { name: "Meteogram (full screen)" }));
      act(() => setScaleToVisibleRange(false));
      fireEvent.click(dialog.getByRole("button", { name: "Copy the meteogram as a picture" }));
      await waitFor(() => expect(toPng).toHaveBeenCalledTimes(2));
      const fullscreenRender = toPng.mock.lastCall![1]!.render!;
      expect(fullscreenRender.toggles).toEqual({ dewPoint: "auto", relativeHumidity: "off", scaleToVisibleRange: "off" });
      expectNoOldOptions(fullscreenRender);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});
