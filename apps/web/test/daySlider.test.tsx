// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Day slider and meteogram (REQ-436): day cards, dragging the marker's edges, moving it, the whole period by double
 * click (REQ-640), and the meteogram's time axis following the marker.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { I18nProvider, LANGUAGES, type Language } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import { UPDATING_DELAY_MS } from "../src/regions/MeteogramPanel/MeteogramPanel.tsx";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  fitSelection,
  forecastDays,
  dragEdge,
  moveSelection,
  resizeSelection,
  selectionRange,
  startOfLocalDay,
  useChainSelection,
  type ForecastLoader,
} from "../src/state/index.ts";
import { FIXTURE_END, FIXTURE_NOW, FIXTURE_START, forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DAY_WIDTH = 100;
const ms = (iso: string) => Date.parse(iso);
/** Local midnight in Vienna (CET, UTC+1) at the start of the given day of October/November 2026. */
const viennaMidnight = (date: string) => ms(`${date}T00:00:00+01:00`);

describe("forecast days", () => {
  const data = { start: ms(FIXTURE_START), end: ms(FIXTURE_END) };

  it("makes one day per local calendar day; a partly covered day is a whole day", () => {
    const days = forecastDays(data, "Europe/Vienna", ms(FIXTURE_NOW));
    expect(days.map((day) => new Date(day.start).toISOString())).toEqual([
      "2026-10-25T23:00:00.000Z",
      "2026-10-26T23:00:00.000Z",
      "2026-10-27T23:00:00.000Z",
      "2026-10-28T23:00:00.000Z",
      "2026-10-29T23:00:00.000Z",
      "2026-10-30T23:00:00.000Z",
      "2026-10-31T23:00:00.000Z",
    ]);
    expect(days.at(-1)!.end).toBe(viennaMidnight("2026-11-02"));
    expect(days.map((day) => day.isToday)).toEqual([false, true, false, false, false, false, false]);
  });

  it("keeps the days before today and the configured number of days from today on", () => {
    expect(forecastDays(data, "Europe/Vienna", ms(FIXTURE_NOW), 3)).toHaveLength(4);
    expect(forecastDays(data, "Europe/Vienna", ms(FIXTURE_NOW), 30)).toHaveLength(7);
  });

  it("finds local midnight across the change from summer to winter time", () => {
    // 25.10.2026: CEST until 03:00, then CET; the day began at 00:00 CEST (22:00Z the day before).
    expect(new Date(startOfLocalDay(ms("2026-10-25T12:00:00Z"), "Europe/Vienna")).toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(forecastDays({ start: ms("2026-10-24T22:00:00Z"), end: ms("2026-10-26T12:00:00Z") }, "Europe/Vienna", 0))
      .toHaveLength(2);
  });

  it("drags a phone edge by the finger's travel, a day after a third, snapping to the ends (REQ-558)", () => {
    const selection = { start: 2, end: 5 };
    // A third of a day moves the end on by one, less does not; the same backwards and for the start.
    expect(dragEdge(selection, "end", 0.3, 6.3, 17)).toEqual({ start: 2, end: 5 });
    expect(dragEdge(selection, "end", 0.34, 6.34, 17)).toEqual({ start: 2, end: 6 });
    expect(dragEdge(selection, "end", 1.4, 7.4, 17)).toEqual({ start: 2, end: 7 });
    expect(dragEdge(selection, "end", -0.4, 5.6, 17)).toEqual({ start: 2, end: 4 });
    expect(dragEdge(selection, "start", -0.4, 1.6, 17)).toEqual({ start: 1, end: 5 });
    expect(dragEdge(selection, "end", -9, 0, 17)).toEqual({ start: 2, end: 2 });
    // Outwards into the outer half of the last or first day: the end or start snaps there.
    expect(dragEdge({ start: 2, end: 12 }, "end", 2, 16.5, 17)).toEqual({ start: 2, end: 16 });
    expect(dragEdge({ start: 2, end: 12 }, "end", 2, 16.4, 17)).toEqual({ start: 2, end: 14 });
    expect(dragEdge({ start: 4, end: 9 }, "start", -2, 0.5, 17)).toEqual({ start: 0, end: 9 });
    // Moving inwards there does not snap.
    expect(dragEdge({ start: 2, end: 16 }, "end", -0.1, 16.7, 17)).toEqual({ start: 2, end: 16 });
    expect(dragEdge({ start: 2, end: 16 }, "end", -0.5, 16.6, 17)).toEqual({ start: 2, end: 15 });
  });

  it("resizes, moves and clamps a selection", () => {
    expect(resizeSelection({ start: 1, end: 3 }, "start", 5, 7)).toEqual({ start: 3, end: 3 });
    expect(resizeSelection({ start: 1, end: 3 }, "end", 0, 7)).toEqual({ start: 1, end: 1 });
    expect(resizeSelection({ start: 1, end: 3 }, "end", 99, 7)).toEqual({ start: 1, end: 6 });
    expect(moveSelection({ start: 1, end: 3 }, 2, 7)).toEqual({ start: 3, end: 5 });
    expect(moveSelection({ start: 1, end: 3 }, 9, 7)).toEqual({ start: 4, end: 6 });
    expect(moveSelection({ start: 1, end: 3 }, -9, 7)).toEqual({ start: 0, end: 2 });
    expect(moveSelection({ start: 0, end: 6 }, 1, 7)).toEqual({ start: 0, end: 6 });
    expect(fitSelection(null, 7)).toEqual({ start: 0, end: 6 });
    expect(fitSelection({ start: 5, end: 9 }, 4)).toEqual({ start: 3, end: 3 });
  });

  it("clamps the time range of the selected days to the data", () => {
    const days = forecastDays(data, "Europe/Vienna", ms(FIXTURE_NOW));
    expect(selectionRange(days, { start: 1, end: 2 }, data)).toEqual({
      start: viennaMidnight("2026-10-27"),
      end: viennaMidnight("2026-10-29"),
    });
    expect(selectionRange(days, { start: 5, end: 6 }, data)).toEqual({
      start: viennaMidnight("2026-10-31"),
      end: data.end,
    });
  });
});

function renderPage(
  options: { config?: GraupelConfig; loader?: ForecastLoader; language?: Language; children?: ReactNode } = {},
) {
  const language = options.language ?? "en";
  const loader = options.loader ?? vi.fn<ForecastLoader>(async () => forecastFixture());
  const view = render(
    <ConfigProvider config={options.config ?? DEFAULT_CONFIG}>
      <I18nProvider languages={[language]} fallbackLanguage={language} browserLanguages={[]}>
        <NoticesProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <DaySlider />
                  <MeteogramPanel />
                  {options.children}
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
  return { ...view, loader };
}

/** Cards in jsdom have no size: the track gets one, `DAY_WIDTH` pixels per day from x = 0. */
async function renderSlider(options: Parameters<typeof renderPage>[0] = {}) {
  const view = renderPage(options);
  const cards = await screen.findAllByTestId("day-card");
  const track = screen.getByTestId("day-slider-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: cards.length * DAY_WIDTH,
    width: cards.length * DAY_WIDTH,
    top: 0,
    bottom: 60,
    height: 60,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return { ...view, cards };
}

function visibleRange(): [string, string] {
  const svg = document.querySelector("svg.meteogram-svg-integrated");
  if (!svg) throw new Error("no meteogram");
  return [
    new Date(Date.parse(svg.getAttribute("data-visible-start-time")!)).toISOString(),
    new Date(Date.parse(svg.getAttribute("data-visible-end-time")!)).toISOString(),
  ];
}

/** Labels of a card for wide cards and for narrow ones (CSS shows one of them). */
const longLabel = (card: HTMLElement) =>
  [...card.querySelectorAll(".day-card__long")].map((element) => element.textContent).join("");
const shortLabel = (card: HTMLElement) =>
  [...card.querySelectorAll(".day-card__short")].map((element) => element.textContent).join("");

const marker = () => {
  const element = screen.getByTestId("day-slider-marker");
  return [Number(element.dataset.start), Number(element.dataset.end)];
};

/** Whether the marker covers the whole period. */
const wholeSelected = () => screen.getByTestId("day-slider-marker").classList.contains("day-slider__marker--whole");

function drag(element: Element, fromX: number, toX: number, release = true) {
  fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: fromX });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: (fromX + toX) / 2 });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: toX });
  if (release) fireEvent.pointerUp(element, { pointerId: 1, clientX: toX });
}

describe("DaySlider", () => {
  it("shows a card per day with weekday and date and highlights today", async () => {
    const { cards } = await renderSlider();
    expect(cards).toHaveLength(7);
    expect(cards.map(longLabel)).toEqual([
      "Mon26/10",
      "Tue27/10",
      "Wed28/10",
      "Thu29/10",
      "Fri30/10",
      "Sat31/10",
      "Sun01/11",
    ]);
    const today = cards.filter((card) => card.getAttribute("aria-current") === "date");
    expect(today).toEqual([cards[1]]);
    expect(today[0]!.className).toContain("day-card--today");
    expect(marker()).toEqual([0, 6]);
    expect(wholeSelected()).toBe(true);
  });

  it("writes weekday and date in the page's language", async () => {
    const { cards } = await renderSlider({ language: "de" });
    expect(cards.map(longLabel)).toEqual([
      "Mo26.10.",
      "Di27.10.",
      "Mi28.10.",
      "Do29.10.",
      "Fr30.10.",
      "Sa31.10.",
      "So01.11.",
    ]);
    // Narrow cards: the weekday's first two letters (REQ-626) and the day of the month.
    expect(cards.map(shortLabel)).toEqual(["Mo26", "Di27", "Mi28", "Do29", "Fr30", "Sa31", "So1"]);
    // No whole-period button any more; the grips and the selection explain the double click instead (REQ-640).
    expect(screen.queryByRole("button", { name: "Alle" })).toBeNull();
    for (const testId of ["day-slider-start", "day-slider-body", "day-slider-end"]) {
      expect(screen.getByTestId(testId).getAttribute("title")).toBe("Doppelklick wählt den ganzen Zeitraum");
    }
  });

  // REQ-667: in no language a weekday's abbreviation ends with a dot, on wide cards ("mar", "tirs", "čet") and narrow
  // ones (REQ-626), and the hidden copy that measures the switch to short labels (REQ-520) has the same text.
  for (const language of LANGUAGES) {
    it(`ends no weekday abbreviation with a dot in ${language} (REQ-667)`, async () => {
      const { cards } = await renderSlider({ language });
      const weekdays = (form: "long" | "short") =>
        cards.map((card) => card.querySelector(`.day-card__weekday .day-card__${form}`)!.textContent ?? "");
      const long = weekdays("long");
      const short = weekdays("short");
      const measured = [...document.querySelectorAll(".day-slider__measure-weekday")].map((e) => e.textContent ?? "");
      expect(measured).toEqual(long);
      for (const weekday of [...long, ...short]) {
        expect(weekday.length, weekday).toBeGreaterThanOrEqual(2);
        expect(weekday, weekday).not.toMatch(/[.\s]$/u);
      }
      // A whole week, seven different abbreviations.
      expect(new Set(long).size).toBe(7);
    });
  }

  it("shows the whole forecast in the meteogram at the start", async () => {
    await renderSlider();
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("drags the end edge; the time axis follows when the drag ends", async () => {
    await renderSlider();
    const end = screen.getByTestId("day-slider-end");
    drag(end, 700, 300, false);
    expect(marker()).toEqual([0, 2]);
    // Still the old range while dragging.
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 300 });
    expect(marker()).toEqual([0, 2]);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-28T23:00:00.000Z"]);
    expect(wholeSelected()).toBe(false);
  });

  it("drags the start edge and stops it at the end edge", async () => {
    await renderSlider();
    drag(screen.getByTestId("day-slider-start"), 0, 210);
    expect(marker()).toEqual([2, 6]);
    expect(visibleRange()).toEqual(["2026-10-27T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
    drag(screen.getByTestId("day-slider-start"), 200, 1000);
    expect(marker()).toEqual([6, 6]);
    expect(visibleRange()).toEqual(["2026-10-31T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("moves the marker while it is smaller than the whole period, up to the last day", async () => {
    await renderSlider();
    drag(screen.getByTestId("day-slider-end"), 700, 300);
    expect(marker()).toEqual([0, 2]);
    const body = screen.getByTestId("day-slider-body");
    drag(body, 150, 450);
    expect(marker()).toEqual([3, 5]);
    expect(visibleRange()).toEqual(["2026-10-28T23:00:00.000Z", "2026-10-31T23:00:00.000Z"]);
    drag(body, 350, 1200);
    expect(marker()).toEqual([4, 6]);
    drag(body, 650, -500);
    expect(marker()).toEqual([0, 2]);
  });

  it("does not move the marker over the whole period: dragging it marks days; a tap selects the day under it", async () => {
    const { cards } = await renderSlider();
    const body = screen.getByTestId("day-slider-body");
    drag(body, 150, 450);
    expect(marker()).toEqual([1, 4]);
    expect(visibleRange()).toEqual(["2026-10-26T23:00:00.000Z", "2026-10-30T23:00:00.000Z"]);
    fireEvent.doubleClick(cards[0]!);
    expect(marker()).toEqual([0, 6]);
    fireEvent.pointerDown(body, { pointerId: 2, button: 0, clientX: 420 });
    fireEvent.pointerUp(body, { pointerId: 2, clientX: 421 });
    expect(marker()).toEqual([4, 4]);
    expect(visibleRange()).toEqual(["2026-10-29T23:00:00.000Z", "2026-10-30T23:00:00.000Z"]);
  });

  // REQ-752: Chrome on Android may end a touch with pointercancel instead of pointerup; the slider used to throw the
  // drag away then, and the selection jumped back to the one before the drag.
  it("keeps the selection a grip shows when the browser cancels its drag (REQ-752)", async () => {
    await renderSlider();
    const end = screen.getByTestId("day-slider-end");
    drag(end, 700, 300, false);
    expect(marker()).toEqual([0, 2]);
    fireEvent.pointerCancel(end, { pointerId: 1, clientX: 0 });
    expect(marker()).toEqual([0, 2]);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-28T23:00:00.000Z"]);
    // The release that may still come elsewhere, and a later capture loss, change nothing.
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 700 });
    fireEvent.lostPointerCapture(end, { pointerId: 1 });
    expect(marker()).toEqual([0, 2]);
  });

  it("keeps the selection the marker shows when the browser cancels moving it (REQ-752)", async () => {
    await renderSlider();
    drag(screen.getByTestId("day-slider-end"), 700, 300);
    const body = screen.getByTestId("day-slider-body");
    drag(body, 150, 450, false);
    expect(marker()).toEqual([3, 5]);
    fireEvent.pointerCancel(body, { pointerId: 1 });
    expect(marker()).toEqual([3, 5]);
    expect(visibleRange()).toEqual(["2026-10-28T23:00:00.000Z", "2026-10-31T23:00:00.000Z"]);
  });

  it("keeps the selection a grip shows when it loses its pointer without a release (REQ-752)", async () => {
    await renderSlider();
    const end = screen.getByTestId("day-slider-end");
    drag(end, 700, 400, false);
    fireEvent.lostPointerCapture(end, { pointerId: 1 });
    expect(marker()).toEqual([0, 3]);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-29T23:00:00.000Z"]);
  });

  it("changes nothing when the browser cancels a grip before it moved (REQ-752)", async () => {
    await renderSlider();
    const end = screen.getByTestId("day-slider-end");
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, clientX: 700 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 702 });
    fireEvent.pointerCancel(end, { pointerId: 1 });
    expect(marker()).toEqual([0, 6]);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("has no whole-period button; a double click on a grip resets to the whole period (REQ-640)", async () => {
    await renderSlider({ language: "en" });
    expect(screen.queryByTestId("day-slider-whole")).toBeNull();
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
    const end = screen.getByTestId("day-slider-end");
    drag(end, 700, 300);
    drag(screen.getByTestId("day-slider-body"), 150, 350);
    expect(marker()).toEqual([2, 4]);
    expect(end.getAttribute("title")).toBe("Double-click selects the whole period");
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(end, { pointerId: 5 + i, button: 0, clientX: 500, clientY: 20 });
      fireEvent.pointerUp(end, { pointerId: 5 + i, clientX: 500, clientY: 20 });
    }
    expect(marker()).toEqual([0, 6]);
    expect(wholeSelected()).toBe(true);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("frames all days over the whole period, however they were selected (REQ-506)", async () => {
    const { cards } = await renderSlider();
    const element = screen.getByTestId("day-slider-marker");
    const extended = () => element.classList.contains("day-slider__marker--whole");
    expect(extended()).toBe(true);
    // Fewer days: the marker over its days only.
    drag(screen.getByTestId("day-slider-end"), 700, 300);
    expect(extended()).toBe(false);
    expect(element.style.getPropertyValue("--marker-start")).toBe("1");
    expect(element.style.getPropertyValue("--marker-end")).toBe("4");
    // Marking all days by dragging over them, live while dragging.
    fireEvent.pointerDown(cards[0]!, { pointerId: 3, button: 0, clientX: 50 });
    fireEvent.pointerMove(cards[0]!, { pointerId: 3, clientX: 650 });
    expect(extended()).toBe(true);
    fireEvent.pointerUp(cards[0]!, { pointerId: 3, clientX: 650 });
    expect(marker()).toEqual([0, 6]);
    expect(extended()).toBe(true);
    // Dragging the end grip back from the last day selects fewer days.
    drag(screen.getByTestId("day-slider-end"), 700, 520);
    expect(marker()).toEqual([0, 4]);
    expect(extended()).toBe(false);
  });

  it("switches to short labels where the long ones of the page's language stop fitting (REQ-520)", async () => {
    // Labels 8 px per character for the weekday, 7 px for the date; cards 31.8 px wide (no padding without CSS).
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const text = this.textContent ?? "";
      const width = this.dataset.day
        ? 31.8
        : this.classList.contains("day-slider__measure-weekday")
          ? text.length * 8
          : this.classList.contains("day-slider__measure-date")
            ? text.length * 7
            : 0;
      return { left: 0, right: width, width, top: 0, bottom: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const labels = async (language: Language) => {
      renderPage({ language });
      await screen.findAllByTestId("day-card");
      const track = screen.getByTestId("day-slider-track");
      const result = [track.dataset.labels, track.classList.contains("day-slider--short")];
      cleanup();
      return result;
    };
    // German "Mo" and "26.10." fit (the date shrinks to 76 %), English "Mon" does, Danish "tirs" (32 px) does not.
    // French "lun" fits since its dot is gone (REQ-667); "lun." would need 32 px as well.
    expect(await labels("de")).toEqual(["long", false]);
    expect(await labels("en")).toEqual(["long", false]);
    expect(await labels("fr")).toEqual(["long", false]);
    expect(await labels("da")).toEqual(["short", true]);
  });

  it("has no selected period in words (REQ-528)", async () => {
    const { cards } = await renderSlider({ language: "de" });
    expect(screen.queryByTestId("day-slider-period")).toBeNull();
    fireEvent.click(cards[3]!);
    expect(screen.queryByTestId("day-slider-period")).toBeNull();
    expect(screen.queryByText(/29\.10\. –/)).toBeNull();
  });

  it("selects a single day by clicking its card", async () => {
    const { cards } = await renderSlider();
    drag(screen.getByTestId("day-slider-end"), 700, 300);
    fireEvent.click(cards[5]!);
    expect(marker()).toEqual([5, 5]);
    expect(cards[5]!.getAttribute("aria-pressed")).toBe("true");
    expect(visibleRange()).toEqual(["2026-10-30T23:00:00.000Z", "2026-10-31T23:00:00.000Z"]);
  });

  it("selects all days with a double click on a day card (REQ-485, REQ-640)", async () => {
    const { cards } = await renderSlider();
    drag(screen.getByTestId("day-slider-end"), 700, 300);
    expect(marker()).toEqual([0, 2]);
    fireEvent.click(cards[5]!, { detail: 1 });
    expect(marker()).toEqual([5, 5]);
    fireEvent.click(cards[5]!, { detail: 2 });
    fireEvent.doubleClick(cards[5]!);
    expect(marker()).toEqual([0, 6]);
    expect(wholeSelected()).toBe(true);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("selects all days with a dblclick event alone (REQ-485)", async () => {
    const { cards } = await renderSlider();
    fireEvent.click(cards[2]!);
    expect(marker()).toEqual([2, 2]);
    fireEvent.doubleClick(cards[2]!);
    expect(marker()).toEqual([0, 6]);
  });

  it("selects all days with a double tap, also when the second tap lands on the marker (REQ-485)", async () => {
    await renderSlider();
    const body = screen.getByTestId("day-slider-body");
    const tap = (x: number, pointerId: number) => {
      fireEvent.pointerDown(body, { pointerId, button: 0, clientX: x });
      fireEvent.pointerUp(body, { pointerId, clientX: x });
    };
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    tap(420, 1);
    expect(marker()).toEqual([4, 4]);
    now.mockReturnValue(10_250);
    tap(430, 2);
    expect(marker()).toEqual([0, 6]);

    // Slow taps or taps on different days each select one day.
    tap(120, 3);
    now.mockReturnValue(11_000);
    tap(120, 4);
    expect(marker()).toEqual([1, 1]);
    now.mockReturnValue(11_100);
    tap(350, 5);
    expect(marker()).toEqual([3, 3]);
  });

  it("does not treat a drag followed by a double click on the marker as a double click (REQ-485)", async () => {
    await renderSlider();
    drag(screen.getByTestId("day-slider-end"), 700, 300);
    const body = screen.getByTestId("day-slider-body");
    drag(body, 150, 350);
    expect(marker()).toEqual([2, 4]);
    fireEvent.doubleClick(body);
    expect(marker()).toEqual([2, 4]);
  });

  it("marks the days from a pressed day to the right while dragging, committed on release (REQ-490)", async () => {
    const { cards } = await renderSlider();
    fireEvent.click(cards[0]!);
    expect(marker()).toEqual([0, 0]);
    fireEvent.pointerDown(cards[2]!, { pointerId: 3, button: 0, clientX: 250 });
    fireEvent.pointerMove(cards[2]!, { pointerId: 3, clientX: 360 });
    expect(marker()).toEqual([2, 3]);
    fireEvent.pointerMove(cards[2]!, { pointerId: 3, clientX: 580 });
    expect(marker()).toEqual([2, 5]);
    // Live in the slider, the meteogram follows on release.
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-26T23:00:00.000Z"]);
    fireEvent.pointerUp(cards[2]!, { pointerId: 3, clientX: 580 });
    // The click that follows the drag does not select the pressed day.
    fireEvent.click(cards[2]!, { detail: 1 });
    expect(marker()).toEqual([2, 5]);
    expect(visibleRange()).toEqual(["2026-10-27T23:00:00.000Z", "2026-10-31T23:00:00.000Z"]);
    // The next click selects a single day again.
    fireEvent.click(cards[6]!, { detail: 1 });
    expect(marker()).toEqual([6, 6]);
  });

  it("marks the days from a pressed day to the left, clamped to the first day (REQ-490)", async () => {
    const { cards } = await renderSlider();
    fireEvent.click(cards[6]!);
    drag(cards[4]!, 450, 120);
    expect(marker()).toEqual([1, 4]);
    drag(cards[5]!, 550, -300);
    expect(marker()).toEqual([0, 5]);
    expect(wholeSelected()).toBe(false);
    drag(cards[6]!, 650, -300);
    expect(wholeSelected()).toBe(true);
  });

  it("marks days when dragging from the day under a one-day marker (REQ-490)", async () => {
    const { cards } = await renderSlider();
    fireEvent.click(cards[3]!);
    drag(screen.getByTestId("day-slider-body"), 350, 150);
    expect(marker()).toEqual([1, 3]);
  });

  it("cancels marking days without changing the selection (REQ-490)", async () => {
    const { cards } = await renderSlider();
    fireEvent.click(cards[1]!);
    drag(cards[3]!, 350, 650, false);
    expect(marker()).toEqual([3, 6]);
    fireEvent.pointerCancel(cards[3]!, { pointerId: 1 });
    expect(marker()).toEqual([1, 1]);
  });

  it("keeps a click with a small jitter a click (REQ-490)", async () => {
    const { cards } = await renderSlider();
    drag(cards[4]!, 450, 452);
    fireEvent.click(cards[4]!, { detail: 1 });
    expect(marker()).toEqual([4, 4]);
  });

  it("selects only the day on repeated clicks from the keyboard (REQ-485)", async () => {
    const { cards } = await renderSlider();
    fireEvent.click(cards[3]!, { detail: 0 });
    fireEvent.click(cards[3]!, { detail: 0 });
    expect(marker()).toEqual([3, 3]);
  });

  it("works with the keyboard: arrows resize the edges and move the marker", async () => {
    await renderSlider();
    const end = screen.getByRole("slider", { name: "End of the period" });
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(marker()).toEqual([0, 4]);
    expect(end.getAttribute("aria-valuetext")).toBe("Friday 30 October");
    const start = screen.getByRole("slider", { name: "Start of the period" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(marker()).toEqual([1, 4]);
    const period = screen.getByRole("slider", { name: "Selected period" });
    expect(period.getAttribute("aria-valuetext")).toBe("Tuesday 27 October to Friday 30 October");
    fireEvent.keyDown(period, { key: "End" });
    expect(marker()).toEqual([3, 6]);
    expect(visibleRange()).toEqual(["2026-10-28T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("offers only the configured days and shows them as the whole period", async () => {
    const { cards } = await renderSlider({ config: { ...DEFAULT_CONFIG, daySlider: { enabled: true, days: 3 } } });
    expect(cards).toHaveLength(4);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-10-29T23:00:00.000Z"]);
  });
});

describe("Meteogram panel", () => {
  it("has the day slider in a card of its own with the label Horizon, the chart card only its name (REQ-499, REQ-507)", async () => {
    await renderSlider();
    const card = screen.getByTestId("meteogram-card");
    expect(within(card).queryByRole("heading")).toBeNull();
    expect(screen.getByRole("region", { name: "Meteogram" })).toBe(card);
    expect(card.querySelector('[data-region="day-slider"]')).toBeNull();
    expect(card.querySelector('[data-region="meteogram"] svg.meteogram-svg-integrated')).toBeTruthy();
    const slider = screen.getByRole("region", { name: "Horizon" });
    expect(slider.getAttribute("data-region")).toBe("day-slider");
    expect(slider.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(slider).getByTestId("day-slider-label").textContent).toBe("Horizon");
    expect(within(slider).queryByRole("heading")).toBeNull();
    expect(within(slider).getByRole("group", { name: "Days" })).toBeTruthy();
    // One column per day, none for a whole-period button (REQ-640).
    expect(screen.queryByTestId("day-slider-whole")).toBeNull();
    expect(screen.getByTestId("day-slider-track").style.getPropertyValue("--day-count")).toBe("7");
    expect(screen.getByTestId("day-slider-track").style.getPropertyValue("--day-columns")).toBe("");
  });

  it("leaves out the day slider but keeps the card's name when the slider is switched off", async () => {
    render(
      <ConfigProvider config={DEFAULT_CONFIG}>
        <I18nProvider languages={["de"]} fallbackLanguage="de" browserLanguages={[]}>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={async () => forecastFixture()}>
                <DaySelectionProvider>
                  <MeteogramPanel />
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    const card = screen.getByTestId("meteogram-card");
    expect(within(card).queryByRole("heading")).toBeNull();
    expect(screen.getByRole("region", { name: "Meteogramm" })).toBe(card);
    expect(card.querySelector('[data-region="day-slider"]')).toBeNull();
  });

  it("has no mouse-wheel zoom", async () => {
    await renderSlider();
    const svg = document.querySelector("svg.meteogram-svg-integrated")!;
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    fireEvent(svg, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(visibleRange()).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-01T11:00:00.000Z"]);
  });

  it("shows only the Open-Meteo attribution, the licence is in the About tab (REQ-478)", async () => {
    await renderSlider();
    const attribution = screen.getByTestId("meteogram-attribution");
    expect(attribution.textContent).toBe("Weather data by Open-Meteo.com");
    expect(within(attribution).getByRole("link").getAttribute("href")).toBe("https://open-meteo.com/");
    const card = screen.getByTestId("meteogram-card");
    expect(within(card).queryByRole("link", { name: "CC BY 4.0" })).toBeNull();
    expect(card.textContent).not.toContain("CC BY");
    expect(card.textContent).not.toContain("harmonised");
  });

  it("shows the domain of the configuration in the middle of the footer row (REQ-464)", async () => {
    await renderSlider({ config: { ...DEFAULT_CONFIG, domain: "graupel.eu" } });
    const row = screen.getByTestId("meteogram-footer-row");
    expect([...row.children].map((child) => child.getAttribute("data-testid"))).toEqual([
      "meteogram-footer-location",
      "meteogram-footer-center",
      "meteogram-attribution",
    ]);
    expect(screen.getByTestId("meteogram-footer-center").textContent).toBe("graupel.eu");
  });

  it("leaves the middle of the footer row empty without a domain on localhost (REQ-464)", async () => {
    await renderSlider();
    expect(window.location.hostname).toBe("localhost");
    expect(screen.queryByTestId("meteogram-footer-center")).toBeNull();
  });

  it("shows loading, then an error with a retry that loads again", async () => {
    let fail = true;
    let release: () => void = () => {};
    const loader = vi.fn<ForecastLoader>(
      () =>
        new Promise((resolve, reject) => {
          release = () => (fail ? reject(new Error("offline")) : resolve(forecastFixture()));
        }),
    );
    renderPage({ loader });
    expect(screen.getByTestId("forecast-loading").textContent).toBe("Loading forecast…");
    expect(screen.getByTestId("day-slider-empty").textContent).toBe("Loading forecast…");
    await act(async () => release());
    // The message is an error card (REQ-492); in place only the retry button.
    expect(screen.getByRole("alert").textContent).toBe("The forecast could not be loaded.");
    expect(screen.getByTestId("forecast-error").textContent).toBe("Try again");
    fail = false;
    fireEvent.click(within(screen.getByTestId("forecast-error")).getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].refresh).toBe(true);
    await act(async () => release());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findAllByTestId("day-card")).toHaveLength(7);
  });

  it("shows \"Updating\" over the chart only when a new load takes a while (REQ-497)", async () => {
    let release: () => void = () => {};
    const loader = vi.fn<ForecastLoader>(
      () => new Promise((resolve) => (release = () => resolve(forecastFixture()))),
    );
    // Another chain loads anew each time (a user's reload shows the first load's message at once, REQ-637).
    const chains = [
      ["icon_d2", "ecmwf_ifs025"],
      ["icon_eu", "ecmwf_ifs025"],
    ];
    let turn = 0;
    function Reload() {
      const { setChain } = useChainSelection();
      return (
        <button type="button" onClick={() => setChain(chains[turn++ % 2]!)}>
          reload
        </button>
      );
    }
    renderPage({ loader, children: <Reload /> });
    await act(async () => release());
    expect(await screen.findAllByTestId("day-card")).toHaveLength(7);
    expect(screen.queryByTestId("forecast-loading")).toBeNull();

    vi.useFakeTimers();
    try {
      // A quick rebuild shows nothing.
      fireEvent.click(screen.getByRole("button", { name: "reload" }));
      act(() => vi.advanceTimersByTime(UPDATING_DELAY_MS - 50));
      expect(screen.queryByTestId("forecast-loading")).toBeNull();
      await act(async () => release());
      act(() => vi.advanceTimersByTime(UPDATING_DELAY_MS));
      expect(screen.queryByTestId("forecast-loading")).toBeNull();

      // A slow one shows the message as an overlay above the chart, which stays in place.
      fireEvent.click(screen.getByRole("button", { name: "reload" }));
      act(() => vi.advanceTimersByTime(UPDATING_DELAY_MS));
      const message = screen.getByTestId("forecast-loading");
      expect(message.textContent).toBe("Updating forecast…");
      expect(message.classList.contains("meteogram__status--overlay")).toBe(true);
      expect(document.querySelector("svg.meteogram-svg-integrated")).not.toBeNull();
      await act(async () => release());
      expect(screen.queryByTestId("forecast-loading")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
