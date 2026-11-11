// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Full-screen meteogram (REQ-454): a double-click or the button opens it, turning a phone to landscape opens it and
 * turning it back closes it; the close button, Escape and a double-click close it. Named dialog, focus handling.
 * On a phone only the turn opens it: no button, no double-tap (REQ-532); the page behind is locked (REQ-530); a turn
 * over an open full-screen map does not open it (REQ-645). The phone's side bar: its width from every row at a long
 * value and from the date, the full, short or cut model name (REQ-588), its font size by height and width, shrinking
 * only while the view is open (REQ-576, REQ-584). On a phone the view asks for the browser's full screen without bars
 * (REQ-717) and stays open on the back button (REQ-716). On a phone in landscape the chart keeps clear of the camera only on the camera's side, known from the screen's angle (REQ-606).
 */
import { findCatalogueModel } from "@graupel/download";
import { DEFAULT_TOOLTIP_TEXTS, MINIMUM_VISIBLE_DURATION_MS, ZOOM_BASE_FACTOR } from "@graupel/meteogram";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  MAP_DIALOG_OPEN_CLASS,
  PHONE_LANDSCAPE_QUERY,
  PHONE_QUERY,
  cameraSideOf,
  isPhone,
  isPhoneLandscape,
  readCameraSide,
  type ForecastLoader,
} from "../src/state/index.ts";
import {
  SCROLL_LOCK_CLASS,
  SIDE_BAR_MAX_SCALE,
  SIDE_BAR_MAX_WIDTH,
  modelShortNames,
  shrunkSideBarFontSize,
  sideBarContentWidth,
  sideBarFontSize,
  sideBarModelName,
  sideBarWidestFontSize,
  sideBarWidthSamples,
  zoomedRange,
} from "../src/regions/MeteogramPanel/MeteogramFullscreen.tsx";
import { meteogramI18n } from "../src/i18n/meteogram.ts";
import { FULLSCREEN_HISTORY_KEY } from "../src/regions/MeteogramPanel/phoneFullscreen.ts";
import { catalogue } from "../src/services/modelData.ts";
import { forecastFixture } from "./forecastFixture.ts";

/**
 * matchMedia stand-in: the phone-landscape query matches while `landscape` is set; turning fires `change`. The phone
 * query matches in landscape and, on a phone (`phone`), in portrait as well.
 */
function fakeOrientation() {
  let landscape = false;
  let phoneDevice = false;
  const listeners = new Set<() => void>();
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const phone = query === PHONE_LANDSCAPE_QUERY || query === PHONE_QUERY;
    return {
      media: query,
      get matches() {
        if (query === PHONE_QUERY) return phoneDevice || landscape;
        return phone && landscape;
      },
      addEventListener: (_type: string, listener: () => void) => {
        if (phone) listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    turn(next: boolean) {
      landscape = next;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
    /** Makes the device a phone, held in portrait until turned. */
    phone() {
      phoneDevice = true;
    },
    /** Changes the orientation without a `change` of the query, as when a browser coalesces two turns. */
    set(next: boolean) {
      landscape = next;
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

let orientation: ReturnType<typeof fakeOrientation>;

beforeEach(() => {
  orientation = fakeOrientation();
});

afterEach(() => {
  cleanup();
  orientation.restore();
  vi.restoreAllMocks();
});

function renderPanel() {
  const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <MeteogramPanel />
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const fullscreen = () => screen.queryByRole("dialog", { name: "Meteogram (full screen)" });

async function ready() {
  renderPanel();
  await screen.findByTestId("meteogram-attribution");
}

describe("full-screen meteogram", () => {
  it("opens on a double-click on the chart, named and focused, and closes with the close button", async () => {
    await ready();
    expect(fullscreen()).toBeNull();
    const button = screen.getByRole("button", { name: "Show the meteogram full screen" });
    button.focus();
    fireEvent.doubleClick(screen.getByTestId("meteogram-scroll"));

    const dialog = fullscreen()!;
    expect(dialog).not.toBeNull();
    expect(dialog.hasAttribute("open")).toBe(true);
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    expect(dialog.querySelector('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]')).not.toBeNull();
    // The embedded chart stays as it is.
    expect(
      screen.getByTestId("meteogram-scroll").querySelector('svg.meteogram-svg-integrated[data-render-mode="embedded"]'),
    ).not.toBeNull();

    fireEvent.click(close);
    expect(fullscreen()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("opens with the button and closes on Escape and on a double-click", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    fireEvent.keyDown(fullscreen()!, { key: "Escape" });
    expect(fullscreen()).toBeNull();

    fireEvent.doubleClick(screen.getByTestId("meteogram-scroll"));
    fireEvent.doubleClick(screen.getByTestId("meteogram-fullscreen"));
    expect(fullscreen()).toBeNull();
  });

  it("on the desktop neither asks for the browser's full screen nor adds a history entry; the close request closes it (REQ-716, REQ-717)", async () => {
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: request, configurable: true });
    const push = vi.spyOn(window.history, "pushState");
    try {
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
      fireEvent.click(screen.getByTestId("meteogram-fullscreen"), { detail: 1 });
      expect(request).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      fireEvent(fullscreen()!, new Event("cancel", { cancelable: true }));
      expect(fullscreen()).toBeNull();
    } finally {
      Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    }
  });

  it("opens when a phone is turned to landscape and closes when it is turned back", async () => {
    await ready();
    orientation.turn(true);
    expect(fullscreen()).not.toBeNull();
    orientation.turn(false);
    expect(fullscreen()).toBeNull();
  });

  it("opens once the forecast is there when the phone is already in landscape", async () => {
    orientation.turn(true);
    renderPanel();
    expect(fullscreen()).toBeNull();
    await waitFor(() => expect(fullscreen()).not.toBeNull());
  });

  it("stays closed after closing in landscape until the phone is turned again", async () => {
    await ready();
    orientation.turn(true);
    // On a phone the view has no close button (REQ-537); Escape (a keyboard) closes it.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(fullscreen()!, { key: "Escape" });
    expect(fullscreen()).toBeNull();
    orientation.turn(true);
    expect(fullscreen()).toBeNull();
    orientation.turn(false);
    orientation.turn(true);
    expect(fullscreen()).not.toBeNull();
  });

  it("follows a turn reported only by resize or orientationchange", async () => {
    await ready();
    orientation.set(true);
    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
    });
    expect(fullscreen()).not.toBeNull();
    orientation.set(false);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(fullscreen()).toBeNull();
  });

  it("does not close a view the user opened when the phone is turned back", async () => {
    await ready();
    fireEvent.doubleClick(screen.getByTestId("meteogram-scroll"));
    orientation.turn(true);
    orientation.turn(false);
    expect(fullscreen()).not.toBeNull();
  });
});

/** Visible range of a chart, from its SVG's attributes. */
function shownRange(svg: Element) {
  return {
    start: Date.parse(svg.getAttribute("data-visible-start-time")!),
    end: Date.parse(svg.getAttribute("data-visible-end-time")!),
  };
}

/** Turns the wheel over `target`: up (negative) zooms in. Returns whether the page took the event. */
function wheel(target: Element, deltaY: number) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
  fireEvent(target, event);
  return event.defaultPrevented;
}

describe("zoom in the desktop's full-screen view (REQ-636)", () => {
  const HOUR = 3_600_000;
  const bounds = { start: 0, end: 100 * HOUR };

  it("zooms in by the core's step and keeps the time under the pointer where it is", () => {
    const next = zoomedRange(bounds, bounds, "in", 25 * HOUR);
    expect(next.end - next.start).toBeCloseTo(100 * HOUR * ZOOM_BASE_FACTOR);
    // The anchor stays at a quarter of the axis.
    expect((25 * HOUR - next.start) / (next.end - next.start)).toBeCloseTo(0.25);
  });

  it("zooms out around the pointer, no further than the range the view opened with", () => {
    const range = { start: 40 * HOUR, end: 60 * HOUR };
    const next = zoomedRange(range, bounds, "out", 45 * HOUR);
    expect(next.end - next.start).toBeCloseTo((20 * HOUR) / ZOOM_BASE_FACTOR);
    expect((45 * HOUR - next.start) / (next.end - next.start)).toBeCloseTo(0.25);
    // Near the edge it moves inside the bounds; at the bounds it stays.
    expect(zoomedRange({ start: 0, end: 90 * HOUR }, bounds, "out", 10 * HOUR)).toEqual(bounds);
    expect(zoomedRange({ start: 2 * HOUR, end: 50 * HOUR }, bounds, "out", 40 * HOUR).start).toBe(0);
    expect(zoomedRange(bounds, bounds, "out", 50 * HOUR)).toEqual(bounds);
  });

  it("zooms in no further than the core's shortest span", () => {
    const range = { start: 10 * HOUR, end: 17 * HOUR };
    const next = zoomedRange(range, bounds, "in", 12 * HOUR);
    expect(next.end - next.start).toBe(MINIMUM_VISIBLE_DURATION_MS);
    expect(zoomedRange(next, bounds, "in", 12 * HOUR)).toEqual(next);
  });

  it("keeps the start without a pointer over the plot, as the core does", () => {
    const range = { start: 10 * HOUR, end: 60 * HOUR };
    expect(zoomedRange(range, bounds, "in", null).start).toBe(10 * HOUR);
    expect(zoomedRange(range, bounds, "in", 70 * HOUR).start).toBe(10 * HOUR);
    expect(zoomedRange(range, bounds, "out", null).start).toBe(10 * HOUR);
  });

  it("zooms with the wheel and the zoom keys in the view, back to the range it opened with; the card does not zoom", async () => {
    await ready();
    const embedded = screen.getByTestId("meteogram-scroll").querySelector("svg.meteogram-svg-integrated")!;
    const opened = shownRange(embedded);
    expect(wheel(embedded, -100)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    const view = screen.getByTestId("meteogram-fullscreen");
    const chart = () => view.querySelector('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]')!;
    expect(shownRange(chart())).toEqual(opened);

    // In: a shorter span from the same start (no pointer position in jsdom).
    expect(wheel(chart(), -100)).toBe(true);
    let range = shownRange(chart());
    expect(range.start).toBe(opened.start);
    expect(range.end - range.start).toBeCloseTo((opened.end - opened.start) * ZOOM_BASE_FACTOR, -3);
    fireEvent.keyDown(chart(), { key: "+" });
    expect(shownRange(chart()).end - shownRange(chart()).start).toBeLessThan(range.end - range.start);
    // Out, as far as the range it opened with and no further.
    for (let step = 0; step < 6; step++) expect(wheel(chart(), 100)).toBe(true);
    expect(shownRange(chart())).toEqual(opened);
    fireEvent.keyDown(chart(), { key: "-" });
    expect(shownRange(chart())).toEqual(opened);
    // `0` goes back to it.
    wheel(chart(), -100);
    wheel(chart(), -100);
    range = shownRange(chart());
    expect(range.end - range.start).toBeLessThan(opened.end - opened.start);
    fireEvent.keyDown(chart(), { key: "0" });
    expect(shownRange(chart())).toEqual(opened);
    // A horizontal wheel is left alone; the card behind keeps its range.
    expect(wheel(chart(), 0)).toBe(false);
    expect(shownRange(embedded)).toEqual(opened);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    orientation.phone();
  });

  it("has no full-screen button and a double-tap does not open the view (REQ-532)", async () => {
    await ready();
    expect(isPhone()).toBe(true);
    expect(screen.queryByRole("button", { name: "Show the meteogram full screen" })).toBeNull();
    fireEvent.doubleClick(screen.getByTestId("meteogram-scroll"));
    expect(fullscreen()).toBeNull();
  });

  it("opens only by turning to landscape and closes on turning back; a double-tap does not close it", async () => {
    await ready();
    orientation.turn(true);
    expect(fullscreen()).not.toBeNull();
    fireEvent.doubleClick(screen.getByTestId("meteogram-fullscreen"));
    expect(fullscreen()).not.toBeNull();
    orientation.turn(false);
    expect(fullscreen()).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the meteogram full screen" })).toBeNull();
  });

  it("does not open over an open full-screen map; closed in landscape it stays closed until the next turn (REQ-645)", async () => {
    await ready();
    const root = document.documentElement;
    root.classList.add(MAP_DIALOG_OPEN_CLASS);
    try {
      orientation.turn(true);
      expect(fullscreen()).toBeNull();
      // The map is closed while the phone is still in landscape.
      root.classList.remove(MAP_DIALOG_OPEN_CLASS);
      orientation.turn(true);
      expect(fullscreen()).toBeNull();
      // Turned back and again: the view opens as before.
      orientation.turn(false);
      orientation.turn(true);
      expect(fullscreen()).not.toBeNull();
    } finally {
      root.classList.remove(MAP_DIALOG_OPEN_CLASS);
    }
  });

  it("has no wheel zoom in the view, there two fingers zoom (REQ-563, REQ-636)", async () => {
    await ready();
    orientation.turn(true);
    const chart = screen
      .getByTestId("meteogram-fullscreen")
      .querySelector('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]')!;
    const before = shownRange(chart);
    expect(wheel(chart, -100)).toBe(false);
    fireEvent.keyDown(chart, { key: "+" });
    expect(shownRange(chart)).toEqual(before);
  });

  it("asks for the browser's full screen without bars on opening and on a tap, and leaves it on closing (REQ-717)", async () => {
    const root = document.documentElement;
    let current: Element | null = null;
    const request = vi.fn((options?: FullscreenOptions) => {
      void options;
      current = root;
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      current = null;
      return Promise.resolve();
    });
    Object.defineProperty(root, "requestFullscreen", { value: request, configurable: true });
    Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
    Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
    try {
      await ready();
      expect(request).not.toHaveBeenCalled();
      orientation.turn(true);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
      // The back button left it (DEC-089): a tap asks again.
      current = null;
      fireEvent.click(screen.getByTestId("meteogram-fullscreen"), { detail: 1 });
      expect(request).toHaveBeenCalledTimes(2);
      orientation.turn(false);
      expect(fullscreen()).toBeNull();
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(root, "requestFullscreen");
      Reflect.deleteProperty(document, "exitFullscreen");
      Reflect.deleteProperty(document, "fullscreenElement");
    }
  });

  it("opens without the Fullscreen API as before (iOS Safari)", async () => {
    await ready();
    expect(typeof document.documentElement.requestFullscreen).not.toBe("function");
    orientation.turn(true);
    expect(fullscreen()).not.toBeNull();
    fireEvent.click(screen.getByTestId("meteogram-fullscreen"), { detail: 1 });
    expect(fullscreen()).not.toBeNull();
    orientation.turn(false);
    expect(fullscreen()).toBeNull();
  });

  it("stays open on the back button: neither going back nor Android's close request closes it (REQ-716)", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    await ready();
    orientation.turn(true);
    expect((window.history.state as Record<string, unknown> | null)?.[FULLSCREEN_HISTORY_KEY]).toBe(true);
    act(() => {
      window.history.replaceState(null, "");
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(fullscreen()).not.toBeNull();
    expect((window.history.state as Record<string, unknown> | null)?.[FULLSCREEN_HISTORY_KEY]).toBe(true);
    fireEvent(fullscreen()!, new Event("cancel", { cancelable: true }));
    expect(fullscreen()).not.toBeNull();
    // Turning back closes it and takes its entry away.
    orientation.turn(false);
    expect(fullscreen()).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("locks the page behind the open view and frees it on closing (REQ-530)", async () => {
    await ready();
    const root = document.documentElement;
    expect(root.classList.contains(SCROLL_LOCK_CLASS)).toBe(false);
    orientation.turn(true);
    expect(root.classList.contains(SCROLL_LOCK_CLASS)).toBe(true);
    orientation.turn(false);
    expect(root.classList.contains(SCROLL_LOCK_CLASS)).toBe(false);
  });
});

/**
 * Stand-in for `screen.orientation` with the angle `angle`; `turn` changes it and fires `change`. `restore` takes it
 * away again (jsdom has none).
 */
function fakeScreenAngle(angle: number) {
  const target = new EventTarget() as EventTarget & { angle: number };
  target.angle = angle;
  Object.defineProperty(window.screen, "orientation", { value: target, configurable: true });
  return {
    turn(next: number) {
      target.angle = next;
      act(() => {
        target.dispatchEvent(new Event("change"));
      });
    },
    restore() {
      Reflect.deleteProperty(window.screen, "orientation");
    },
  };
}

describe("side of the camera (REQ-606)", () => {
  it("is at the left when the screen is turned by 90°, at the right by 270° or −90°, else unknown", () => {
    expect(cameraSideOf(90)).toBe("left");
    expect(cameraSideOf(270)).toBe("right");
    expect(cameraSideOf(-90)).toBe("right");
    expect(cameraSideOf(450)).toBe("left");
    for (const angle of [0, 180, -180, 45, Number.NaN, null, undefined]) expect(cameraSideOf(angle)).toBeNull();
  });

  it("comes from screen.orientation, else from window.orientation, else is unknown", () => {
    expect(readCameraSide()).toBeNull();
    const legacy = window as Window & { orientation?: number };
    legacy.orientation = -90;
    try {
      expect(readCameraSide()).toBe("right");
      const angle = fakeScreenAngle(90);
      try {
        expect(readCameraSide()).toBe("left");
      } finally {
        angle.restore();
      }
    } finally {
      Reflect.deleteProperty(legacy, "orientation");
    }
    expect(readCameraSide()).toBeNull();
  });

  it("marks the phone's full-screen view with it and follows a turn; without an angle no side", async () => {
    orientation.phone();
    await ready();
    orientation.turn(true);
    expect(fullscreen()?.className).toBe("dialog meteogram-fullscreen meteogram-fullscreen--no-controls");
    orientation.turn(false);

    const angle = fakeScreenAngle(90);
    try {
      orientation.turn(true);
      expect(fullscreen()?.classList.contains("meteogram-fullscreen--camera-left")).toBe(true);
      angle.turn(270);
      expect(fullscreen()?.classList.contains("meteogram-fullscreen--camera-left")).toBe(false);
      expect(fullscreen()?.classList.contains("meteogram-fullscreen--camera-right")).toBe(true);
    } finally {
      angle.restore();
    }
  });

  it("leaves the view with buttons (desktop, tablet) as it is", async () => {
    const angle = fakeScreenAngle(90);
    try {
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
      expect(fullscreen()?.className).toBe("dialog meteogram-fullscreen");
    } finally {
      angle.restore();
    }
  });
});

describe("phone query", () => {
  it("needs a coarse pointer in portrait, so a narrow desktop window is no phone", () => {
    expect(PHONE_QUERY).toContain("(pointer: coarse) and (max-width: 30rem)");
    expect(PHONE_QUERY).toContain(PHONE_LANDSCAPE_QUERY);
    expect(isPhone()).toBe(false);
    orientation.turn(true);
    expect(isPhone()).toBe(true);
  });
});

describe("phone landscape", () => {
  it("asks for landscape, a coarse pointer and a low screen", () => {
    expect(PHONE_LANDSCAPE_QUERY).toContain("(orientation: landscape)");
    expect(PHONE_LANDSCAPE_QUERY).toContain("(pointer: coarse)");
    expect(PHONE_LANDSCAPE_QUERY).toContain("max-height");
    expect(isPhoneLandscape()).toBe(false);
    orientation.turn(true);
    expect(isPhoneLandscape()).toBe(true);
  });

  it("is false without matchMedia", () => {
    orientation.restore();
    const saved = window.matchMedia;
    // @ts-expect-error: a browser without matchMedia
    delete window.matchMedia;
    try {
      expect(isPhoneLandscape()).toBe(false);
    } finally {
      window.matchMedia = saved;
    }
  });
});

describe("width of the side bar on a phone (REQ-584, REQ-588)", () => {
  const german = () => {
    const { locale, shortTooltipTexts } = meteogramI18n("de");
    return sideBarWidthSamples({ ...DEFAULT_TOOLTIP_TEXTS, ...shortTooltipTexts }, locale);
  };

  it("measures every row with a long value next to its label, the long labels too", () => {
    const { rows } = german();
    expect(rows).toEqual(
      expect.arrayContaining([
        ["Temperatur:", "-88.8 °C"],
        ["Gefühlt:", "-88.8 °C"],
        ["Böen:", "188.8 km/h"],
        ["Richtung:", "888° WNW"],
        ["N.-Wahrsch.:", "100 %"],
        ["Niederschl.:", "88.8 mm"],
        ["Summe:", "888.8 mm"],
        ["Schneefall:", "88.8 cm"],
        ["Schneehöhe:", "8.88 m"],
      ]),
    );
    // Every label of the bar but the convection's, which the website does not show.
    expect(rows).toHaveLength(11);
  });

  it("measures the date of every weekday with two-digit day, month and time in wide digits", () => {
    const { headers } = german();
    expect(headers).toHaveLength(7);
    expect(new Set(headers.map((header) => header.slice(0, 3)))).toEqual(
      new Set(["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."]),
    );
    for (const header of headers) expect(header).toMatch(/^\p{L}+\., 88\.88\. — 88:88$/u);
  });

  /**
   * A side bar as the chart builds it, with a stand-in for the browser's layout: without a set width the bar is as wide
   * as its widest row or date, 8 px a letter (the gap between label and value one); the model name does not count.
   */
  function sideBar() {
    document.body.innerHTML = `
      <div class="hover-unified-tooltip" style="--side-bar-width: 100px">
        <div class="tooltip-header"><strong>Fr., 30.10. — 11:00</strong></div>
        <div class="tooltip-section-title">ItaliaMeteo ARPAE ICON-2i</div>
        <div class="tooltip-grid">
          <div class="tooltip-row"><span class="label">Temperatur:</span><span class="val">7.2 °C</span></div>
          <div class="tooltip-row"><span class="label">Wind:</span><span class="val">12.1 km/h</span></div>
        </div>
      </div>`;
    const tooltip = document.querySelector<HTMLElement>(".hover-unified-tooltip")!;
    const letters = (element: Element) => [...(element.textContent ?? "")].length;
    const layout = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (element !== tooltip) return layout(element, pseudo);
      const widths = [
        ...[...tooltip.querySelectorAll(".tooltip-row")].map((row) => (letters(row) + 1) * 8),
        ...[...tooltip.querySelectorAll(".tooltip-header")].map((header) => letters(header) * 8),
      ];
      const width = tooltip.style.getPropertyValue("--side-bar-width") || `${Math.max(...widths)}px`;
      return { width } as CSSStyleDeclaration;
    });
    return tooltip;
  }

  it("is as wide as its widest row at a long value, and shows only its own rows again", () => {
    const tooltip = sideBar();
    const samples = german();
    // German: "Schneesumme: 888.8 cm" is the longest row, wider than the date.
    const longest = Math.max(...samples.rows.map(([label, value]) => [...label, ...value].length));
    expect(longest).toBe([..."Schneesumme:888.8 cm"].length);
    expect(sideBarContentWidth(tooltip, samples)).toBe((longest + 1) * 8);
    expect(tooltip.querySelectorAll(".tooltip-row")).toHaveLength(2);
    expect(tooltip.querySelectorAll(".tooltip-header")).toHaveLength(1);
    expect(tooltip.querySelector(".tooltip-header")!.textContent).toBe("Fr., 30.10. — 11:00");
    expect(tooltip.querySelector(".label")!.textContent).toBe("Temperatur:");
  });

  it("is as wide as the date when that is wider than the rows", () => {
    const samples = { rows: [["Wind:", "188.8 km/h"] as const], headers: ["Mi., 88.88. — 88:88"] };
    expect(sideBarContentWidth(sideBar(), samples)).toBe([..."Mi., 88.88. — 88:88"].length * 8);
  });
});

describe("model name in the side bar on a phone (REQ-588)", () => {
  /** Room for so many letters. */
  const room = (letters: number) => (text: string) => [...text].length <= letters;

  it("is the full name when it fits on one line", () => {
    expect(sideBarModelName("AROME France HD", "AROME HD", room(15))).toBe("AROME France HD");
  });

  it("is the short name of the model catalogue when the full one does not fit", () => {
    expect(sideBarModelName("ECMWF IFS HRES 9km", "IFS HRES", room(17))).toBe("IFS HRES");
    expect(sideBarModelName("ECMWF IFS HRES 9km", "IFS HRES", room(8))).toBe("IFS HRES");
  });

  it("cuts the short name at the end with an ellipsis when it does not fit either", () => {
    expect(sideBarModelName("ECMWF IFS HRES 9km", "IFS HRES", room(7))).toBe("IFS HR…");
    // No space before the ellipsis.
    expect(sideBarModelName("ECMWF IFS HRES 9km", "IFS HRES", room(5))).toBe("IFS…");
    // At least the first letter.
    expect(sideBarModelName("ECMWF IFS HRES 9km", "IFS HRES", room(0))).toBe("I…");
  });

  it("cuts the full name without a short one", () => {
    expect(sideBarModelName("KNMI Harmonie AROME Netherlands", null, room(10))).toBe("KNMI Harm…");
    expect(sideBarModelName("KNMI Harmonie AROME Netherlands", "", room(10))).toBe("KNMI Harm…");
  });

  it("takes the short names from the chain, as the catalogue gives them", () => {
    const chain = ["ecmwf_ifs", "italia_meteo_arpae_icon_2i", "icon_d2"].map((id) => {
      const model = findCatalogueModel(id, catalogue)!;
      return { model: model.name, id, shortName: model.short_name ?? null, sliceEndHours: 24 };
    });
    expect(modelShortNames(chain)).toEqual(
      new Map([
        ["ECMWF IFS HRES 9km", "IFS HRES"],
        ["ItaliaMeteo ARPAE ICON-2i", "ICON-2I"],
      ]),
    );
  });
});

describe("font size of the side bar on a phone (REQ-576, REQ-584)", () => {
  it("scales the tooltip's own size so the content fills the height", () => {
    expect(sideBarFontSize(8, 200, 390)).toBe(15.6);
  });

  it("rounds down to 0.1 px, so the content does not outgrow the height", () => {
    // 7.45 * 390 / 190 = 15.29
    expect(sideBarFontSize(7.45, 190, 390)).toBe(15.2);
  });

  it("is at least the tooltip's own size and at most SIDE_BAR_MAX_SCALE times it", () => {
    expect(sideBarFontSize(8, 500, 390)).toBe(8);
    expect(sideBarFontSize(8, 50, 390)).toBe(8 * SIDE_BAR_MAX_SCALE);
  });

  it("keeps the own size when nothing could be measured", () => {
    expect(sideBarFontSize(8, 0, 390)).toBe(8);
    expect(sideBarFontSize(8, 200, 0)).toBe(8);
  });

  it("is only as large as the bar's largest width allows, rounded down to 0.1 px", () => {
    // The height allows 15.6 px.
    expect(sideBarFontSize(8, 200, 390, 12.38)).toBe(12.3);
    expect(sideBarFontSize(8, 200, 390, 20)).toBe(15.6);
    // Even below the tooltip's own size when the width needs it.
    expect(sideBarFontSize(8, 200, 390, 7.25)).toBe(7.2);
  });

  it("takes a quarter of the screen's width at most, with the padding at both sides and the border", () => {
    expect(SIDE_BAR_MAX_WIDTH).toBe(1 / 4);
    // 844 / 4 = 211 px; 1 px border; 10 em of content and 2 * 0.95 em of padding.
    expect(sideBarWidestFontSize(844, 10, 1)).toBeCloseTo(210 / 11.9, 6);
    // Twice the content, about half the size.
    expect(sideBarWidestFontSize(844, 20)).toBeCloseTo(211 / 21.9, 6);
  });
});

describe("font size of the side bar while the view is open (REQ-584)", () => {
  it("shrinks when a row more no longer fits the height", () => {
    // 16 * 390 / 420 = 14.86
    expect(shrunkSideBarFontSize(16, 420, 390)).toBe(14.8);
    // A tiny overflow still takes 0.1 px off.
    expect(shrunkSideBarFontSize(16, 390.1, 390)).toBe(15.9);
  });

  it("never grows again when rows go away", () => {
    expect(shrunkSideBarFontSize(14.8, 300, 390)).toBe(14.8);
    expect(shrunkSideBarFontSize(14.8, 390, 390)).toBe(14.8);
  });

  it("goes no further down than the smallest size it may take", () => {
    expect(shrunkSideBarFontSize(9, 800, 390, 8)).toBe(8);
    expect(shrunkSideBarFontSize(8, 800, 390, 8)).toBe(8);
  });

  it("keeps the size when nothing could be measured", () => {
    expect(shrunkSideBarFontSize(14, 0, 390)).toBe(14);
    expect(shrunkSideBarFontSize(14, 420, 0)).toBe(14);
  });
});
