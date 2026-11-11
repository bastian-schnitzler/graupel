// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tablets (REQ-728, DEC-090): the device's class from its pointer and the short side of its screen (phone, tablet with
 * unfolded foldables, desktop), decided centrally; a tablet has the phone's design but is never a phone in landscape.
 * Its chart at the phone's scale, upright and in landscape over the page's whole width (REQ-750), and its full-screen
 * view: opened by a double tap, closed by its close button, Escape or the back button, as no turn closes it there.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  PORTRAIT_DAYS_ON_SCREEN,
  REFERENCE_PHONE_WIDTH,
  portraitChart,
  tabletDaysOnScreen,
} from "../src/regions/MeteogramPanel/layout.ts";
import { FULLSCREEN_HISTORY_KEY } from "../src/regions/MeteogramPanel/phoneFullscreen.ts";
import { isNarrowPage } from "../src/state/narrowPage.ts";
import {
  COARSE_POINTER_QUERY,
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LANDSCAPE_QUERY,
  LocationProvider,
  PHONE_LANDSCAPE_QUERY,
  TABLET_MIN_SHORT_SIDE,
  deviceClassOf,
  isPhone,
  isPhoneLandscape,
  isTablet,
  isTabletLandscape,
  readDeviceClass,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

describe("deviceClassOf (DEC-090)", () => {
  it("is a desktop without a coarse pointer, whatever the screen", () => {
    expect(deviceClassOf(false, 390)).toBe("desktop");
    expect(deviceClassOf(false, 1080)).toBe("desktop");
  });

  it("is a phone with a coarse pointer below 600 px, a tablet from there on", () => {
    expect(TABLET_MIN_SHORT_SIDE).toBe(600);
    // iPhone SE, iPhone 15 Pro Max, Pixel 7.
    for (const side of [375, 430, 412]) expect(deviceClassOf(true, side)).toBe("phone");
    expect(deviceClassOf(true, 599)).toBe("phone");
    expect(deviceClassOf(true, 600)).toBe("tablet");
    // iPad Mini, iPad Pro 11, Galaxy Tab S9.
    for (const side of [744, 834, 640]) expect(deviceClassOf(true, side)).toBe("tablet");
  });

  it("takes an unfolded foldable for a tablet and a folded one for a phone", () => {
    // Galaxy Z Fold 6: inner screen 928 × 1080 px, cover screen 484 × 1188 px.
    expect(deviceClassOf(true, 928)).toBe("tablet");
    expect(deviceClassOf(true, 484)).toBe("phone");
  });

  it("is a phone where the page is too small for a tablet: upright under 600 px wide, turned at most 500 px high", () => {
    expect(deviceClassOf(true, 834, { width: 834, height: 1100 })).toBe("tablet");
    expect(deviceClassOf(true, 640, { width: 1024, height: 520 })).toBe("tablet");
    // A page zoomed in a lot, or a screen size that does not belong to the page.
    expect(deviceClassOf(true, 1080, { width: 390, height: 844 })).toBe("phone");
    expect(deviceClassOf(true, 1080, { width: 844, height: 390 })).toBe("phone");
    expect(deviceClassOf(true, 600, { width: 600, height: 900 })).toBe("tablet");
  });

  it("can not tell without the screen's size: then a desktop, and the phone's query alone decides", () => {
    expect(deviceClassOf(true, null)).toBe("desktop");
  });
});

/** Lets the coarse pointer, the orientation and the phone's landscape query match as given, and sets the screen. */
function device(options: { coarse: boolean; screen: { width: number; height: number }; landscape?: boolean }) {
  const { coarse, landscape = false } = options;
  vi.stubGlobal("screen", options.screen);
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        media: query,
        matches:
          (query === COARSE_POINTER_QUERY && coarse) ||
          (query === LANDSCAPE_QUERY && landscape) ||
          // A tablet whose browser bars leave the page as low as a phone's in landscape.
          (query === PHONE_LANDSCAPE_QUERY && coarse && landscape),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

describe("central detection (REQ-728)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the class from the pointer's query and the screen's short side, upright or turned", () => {
    device({ coarse: true, screen: { width: 834, height: 1194 } });
    expect(readDeviceClass()).toBe("tablet");
    device({ coarse: true, screen: { width: 1194, height: 834 }, landscape: true });
    expect(readDeviceClass()).toBe("tablet");
    device({ coarse: true, screen: { width: 393, height: 852 } });
    expect(readDeviceClass()).toBe("phone");
    device({ coarse: false, screen: { width: 1920, height: 1080 } });
    expect(readDeviceClass()).toBe("desktop");
  });

  it("gives a tablet the phone's design and the narrow page's legend, at any width", () => {
    device({ coarse: true, screen: { width: 834, height: 1194 } });
    expect(isTablet()).toBe(true);
    expect(isPhone()).toBe(true);
    expect(isNarrowPage()).toBe(true);
    device({ coarse: false, screen: { width: 1920, height: 1080 } });
    expect(isPhone()).toBe(false);
    expect(isNarrowPage()).toBe(false);
  });

  it("gives a folded foldable the phone's design although wider than the phone's query (484 px)", () => {
    device({ coarse: true, screen: { width: 484, height: 1188 } });
    expect(isTablet()).toBe(false);
    expect(isPhone()).toBe(true);
  });

  it("never takes a turned tablet for a phone in landscape, also where the page is as low as a phone's", () => {
    device({ coarse: true, screen: { width: 1024, height: 600 }, landscape: true });
    expect(isTabletLandscape()).toBe(true);
    expect(isPhoneLandscape()).toBe(false);
    device({ coarse: true, screen: { width: 852, height: 393 }, landscape: true });
    expect(isTabletLandscape()).toBe(false);
    expect(isPhoneLandscape()).toBe(true);
  });
});

describe("tablet chart at the phone's scale (REQ-742, REQ-744, REQ-750)", () => {
  const DAY = 86_400_000;
  const range = { start: 0, end: 17 * DAY };
  /** CSS px per viewBox unit of the chart `chartWidth` px wide on the screen. */
  const scale = (chartWidth: number, daysOnScreen?: number) => {
    const { widthFactor, viewBoxWidth } = portraitChart(range, daysOnScreen);
    return (chartWidth * widthFactor) / viewBoxWidth;
  };

  it("shows as many more days as the screen is wider than the iPhone 13's", () => {
    expect(tabletDaysOnScreen(REFERENCE_PHONE_WIDTH)).toBeCloseTo(PORTRAIT_DAYS_ON_SCREEN, 9);
    expect(tabletDaysOnScreen(2 * REFERENCE_PHONE_WIDTH)).toBeCloseTo(2 * PORTRAIT_DAYS_ON_SCREEN, 9);
    expect(tabletDaysOnScreen(null)).toBe(PORTRAIT_DAYS_ON_SCREEN);
    expect(tabletDaysOnScreen(0)).toBe(PORTRAIT_DAYS_ON_SCREEN);
  });

  it("keeps the iPhone 13's CSS px per viewBox unit upright and turned, over the page's whole width (REQ-750)", () => {
    const phone = scale(REFERENCE_PHONE_WIDTH);
    // iPad Mini (as the iPad Air 2) and iPad Pro 11, upright and in landscape.
    for (const width of [REFERENCE_PHONE_WIDTH, 768, 834, 1024, 1194]) {
      expect(scale(width, tabletDaysOnScreen(width))).toBeCloseTo(phone, 9);
    }
  });
});

describe("full-screen view on a tablet (REQ-728)", () => {
  beforeEach(() => {
    device({ coarse: true, screen: { width: 1194, height: 834 }, landscape: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function ready() {
    const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
    render(
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
    await screen.findByTestId("meteogram-attribution");
  }

  const fullscreen = () => screen.queryByRole("dialog", { name: "Meteogram (full screen)" });

  it("does not open by itself in landscape, nor on a single tap", async () => {
    await ready();
    expect(fullscreen()).toBeNull();
    fireEvent.click(screen.getByTestId("meteogram-scroll"), { detail: 1 });
    expect(fullscreen()).toBeNull();
  });

  it("opens on a double tap on the chart, and on a double click", async () => {
    await ready();
    const scroll = screen.getByTestId("meteogram-scroll");
    fireEvent.click(scroll, { detail: 1, clientX: 100, clientY: 100 });
    fireEvent.click(scroll, { detail: 1, clientX: 104, clientY: 102 });
    expect(fullscreen()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(fullscreen()).toBeNull();
    fireEvent.doubleClick(scroll);
    expect(fullscreen()).not.toBeNull();
  });

  it("is the phone's view with a close button, without copy and save; Escape closes it, no history entry holds it", async () => {
    const push = vi.spyOn(window.history, "pushState");
    await ready();
    fireEvent.doubleClick(screen.getByTestId("meteogram-scroll"));
    const view = fullscreen()!;
    expect(view.classList.contains("meteogram-fullscreen--no-controls")).toBe(true);
    expect(view.classList.contains("meteogram-fullscreen--closable")).toBe(true);
    const close = screen.getByRole("button", { name: "Close" });
    expect(view.querySelector('[data-testid="meteogram-save"]')).toBeNull();
    // The close button has no column of its own: it is laid over the chart and has the focus (REQ-750).
    expect(view.querySelector(".dialog__tools")).toBeNull();
    expect(screen.getByTestId("meteogram-fullscreen").contains(close)).toBe(true);
    expect(document.activeElement).toBe(close);
    // A double tap in the view zooms back out as on a phone (REQ-715) instead of closing it.
    fireEvent.doubleClick(screen.getByTestId("meteogram-fullscreen"));
    expect(fullscreen()).not.toBeNull();
    expect(push.mock.calls.some(([state]) => (state as Record<string, unknown>)?.[FULLSCREEN_HISTORY_KEY])).toBe(false);
    act(() => {
      fireEvent(view, new Event("cancel", { cancelable: true }));
    });
    expect(fullscreen()).toBeNull();
  });
});
