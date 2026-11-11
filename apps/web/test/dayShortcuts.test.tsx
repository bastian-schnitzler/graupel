// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Keyboard shortcuts of the day slider (REQ-533): ^/` all days, 1–9 and 0 from yesterday on, ß/- shows or removes
 * yesterday; by key position (`code`), not while typing, with a modifier, a dialog open or for the meteogram's own keys.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { I18nProvider } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  applyDayShortcut,
  dayShortcutForCode,
  digitSelection,
  toggleYesterday,
} from "../src/state/dayShortcuts.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  type ForecastDay,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** `count` days with today at `today` (-1: none). */
const makeDays = (count: number, today: number): ForecastDay[] =>
  Array.from({ length: count }, (_, i) => ({ start: i, end: i + 1, isToday: i === today }));

describe("day shortcuts: keys", () => {
  it("maps key positions, not characters", () => {
    expect(dayShortcutForCode("Backquote")).toEqual({ kind: "all" });
    expect(dayShortcutForCode("Minus")).toEqual({ kind: "yesterday" });
    expect(dayShortcutForCode("Digit1")).toEqual({ kind: "digit", digit: 1 });
    expect(dayShortcutForCode("Digit0")).toEqual({ kind: "digit", digit: 0 });
    expect(dayShortcutForCode("Numpad1")).toBeNull();
    expect(dayShortcutForCode("KeyA")).toBeNull();
    expect(dayShortcutForCode("Equal")).toBeNull();
  });
});

describe("day shortcuts: selection", () => {
  // 16 days, today is the second one (index 1), yesterday the first.
  const days = makeDays(16, 1);

  it("selects yesterday to today + N − 1 for the digits 1 to 9", () => {
    expect(digitSelection(days, 1, true)).toEqual({ start: 0, end: 1 });
    expect(digitSelection(days, 2, true)).toEqual({ start: 0, end: 2 });
    expect(digitSelection(days, 5, true)).toEqual({ start: 0, end: 5 });
    expect(digitSelection(days, 9, true)).toEqual({ start: 0, end: 9 });
  });

  it("selects ten days in all with 0, yesterday and today included", () => {
    expect(digitSelection(days, 0, true)).toEqual({ start: 0, end: 9 });
  });

  it("starts today without yesterday: 1 is today alone, 0 ten days from today", () => {
    expect(digitSelection(days, 1, false)).toEqual({ start: 1, end: 1 });
    expect(digitSelection(days, 3, false)).toEqual({ start: 1, end: 3 });
    expect(digitSelection(days, 0, false)).toEqual({ start: 1, end: 10 });
  });

  it("clamps to the available days", () => {
    const few = makeDays(4, 1);
    expect(digitSelection(few, 9, true)).toEqual({ start: 0, end: 3 });
    expect(digitSelection(few, 0, false)).toEqual({ start: 1, end: 3 });
  });

  it("behaves as without yesterday when the data has none, and does nothing without a today", () => {
    const noYesterday = makeDays(8, 0);
    expect(digitSelection(noYesterday, 1, true)).toEqual({ start: 0, end: 0 });
    expect(digitSelection(noYesterday, 0, true)).toEqual({ start: 0, end: 7 });
    expect(toggleYesterday(noYesterday, { start: 0, end: 3 })).toBeNull();
    expect(applyDayShortcut({ kind: "yesterday" }, noYesterday, { start: 0, end: 3 }, true)).toBeUndefined();
    expect(digitSelection(makeDays(5, -1), 2, true)).toBeNull();
  });

  it("removes yesterday from a selection that has it and adds it to one that has not", () => {
    expect(toggleYesterday(days, { start: 0, end: 15 })).toEqual({
      selection: { start: 1, end: 15 },
      withYesterday: false,
    });
    expect(toggleYesterday(days, { start: 0, end: 0 })).toEqual({
      selection: { start: 1, end: 1 },
      withYesterday: false,
    });
    expect(toggleYesterday(days, { start: 1, end: 3 })).toEqual({
      selection: { start: 0, end: 3 },
      withYesterday: true,
    });
    expect(toggleYesterday(days, { start: 4, end: 6 })).toEqual({
      selection: { start: 0, end: 6 },
      withYesterday: true,
    });
  });

  it("selects all days with the key before 1 and keeps the yesterday choice", () => {
    expect(applyDayShortcut({ kind: "all" }, days, { start: 1, end: 2 }, false)).toEqual({
      selection: null,
      withYesterday: false,
    });
    expect(applyDayShortcut({ kind: "all" }, [], { start: 0, end: 0 }, true)).toBeUndefined();
  });
});

function renderSlider() {
  const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <NoticesProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <input data-testid="text" />
                  <DaySlider />
                  <MeteogramPanel />
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const marker = () => {
  const element = screen.getByTestId("day-slider-marker");
  return [Number(element.dataset.start), Number(element.dataset.end)];
};

function visibleRange(): [string, string] {
  const svg = document.querySelector("svg.meteogram-svg-integrated");
  if (!svg) throw new Error("no meteogram");
  return [
    new Date(Date.parse(svg.getAttribute("data-visible-start-time")!)).toISOString(),
    new Date(Date.parse(svg.getAttribute("data-visible-end-time")!)).toISOString(),
  ];
}

const press = (code: string, init: KeyboardEventInit = {}, target: Element | Document = document.body) =>
  fireEvent.keyDown(target, { code, key: "x", ...init });

describe("DaySlider keyboard shortcuts (REQ-533)", () => {
  // The fixture's "now" is Tue 27.10. (index 1, yesterday Mon 26.10.), days up to Sun 01.11. (index 6). The test clock
  // runs later: today is the day of the forecast's "now", not the clock's.
  it("selects days by key position and the meteogram follows", async () => {
    renderSlider();
    await screen.findAllByTestId("day-card");
    press("Digit1");
    expect(marker()).toEqual([0, 1]);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-27T23:00:00.000Z"]);
    press("Digit2");
    expect(marker()).toEqual([0, 2]);
    press("Digit0");
    expect(marker()).toEqual([0, 6]);
    press("Digit3");
    press("Backquote");
    expect(marker()).toEqual([0, 6]);
    expect(screen.getByTestId("day-slider-marker").classList.contains("day-slider__marker--whole")).toBe(true);
  });

  it("shows and removes yesterday with the key after 0; the digits follow", async () => {
    renderSlider();
    await screen.findAllByTestId("day-card");
    press("Digit2");
    press("Minus");
    expect(marker()).toEqual([1, 2]);
    expect(visibleRange()[0]).toBe("2026-10-26T23:00:00.000Z");
    press("Digit1");
    expect(marker()).toEqual([1, 1]);
    press("Digit3");
    expect(marker()).toEqual([1, 3]);
    press("Minus");
    expect(marker()).toEqual([0, 3]);
    press("Digit1");
    expect(marker()).toEqual([0, 1]);
  });

  it("ignores the keys while typing, with a modifier and while a dialog is open", async () => {
    renderSlider();
    await screen.findAllByTestId("day-card");
    press("Digit1", {}, screen.getByTestId("text"));
    press("Digit1", { ctrlKey: true });
    press("Digit1", { altKey: true });
    press("Digit1", { metaKey: true });
    expect(marker()).toEqual([0, 6]);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    press("Digit1");
    expect(marker()).toEqual([0, 6]);
    dialog.remove();
    press("Digit1");
    expect(marker()).toEqual([0, 1]);
  });

  it("leaves 0 and the key after 0 to the focused meteogram, but not the other digits", async () => {
    renderSlider();
    await screen.findAllByTestId("day-card");
    const chart = await screen.findByTestId("meteogram");
    press("Digit0", { key: "0" }, chart);
    press("Minus", { key: "-" }, chart);
    expect(marker()).toEqual([0, 6]);
    press("Digit2", { key: "2" }, chart);
    expect(marker()).toEqual([0, 2]);
  });
});
