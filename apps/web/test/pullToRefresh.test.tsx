// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pull to refresh on a phone in portrait (REQ-638): a pull of one finger clearly down at the top of the page moves the
 * meteogram card's chart and, released past the threshold, loads the forecast anew past the cache (as the refresh
 * button, REQ-637); a shorter pull, a sideways swipe and two fingers do nothing. Not on the desktop. The whole page can
 * be pulled at its top as well (REQ-750), except in open dialogs and menus, in what scrolls on its own and on what takes
 * every touch for itself.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider, translate } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  isPull,
  PULL_MAX_OFFSET,
  PULL_SETTLE_MS,
  PULL_THRESHOLD,
  pagePulls,
  pullOffset,
} from "../src/regions/MeteogramPanel/usePullToRefresh.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  PHONE_QUERY,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const original = window.matchMedia;

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.matchMedia = original;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** matchMedia stand-in: only the phone query matches, and only with `phone` (portrait: not the landscape one). */
function fakeDevice(phone: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: phone && query === PHONE_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

/** A loader whose reloads stay pending until the test settles them. */
function loaderWithPending() {
  const pending: ((result: ForecastResult) => void)[] = [];
  const loader = vi.fn<ForecastLoader>((request) =>
    request.refresh ? new Promise<ForecastResult>((resolve) => pending.push(resolve)) : Promise.resolve(forecastFixture()),
  );
  return { loader, pending };
}

function renderPanel(loader: ForecastLoader) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <DaySlider />
                <MeteogramPanel />
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

type Point = [x: number, y: number];
const touches = (points: readonly Point[]) =>
  points.map(([clientX, clientY], identifier) => ({ clientX, clientY, identifier }));

/** A gesture on `element`: down at the first points, then each further set of points, then up. */
function gesture(element: Element, ...steps: Point[][]) {
  const [first, ...moves] = steps;
  fireEvent.touchStart(element, { touches: touches(first!) });
  const prevented = moves.map((points) => !fireEvent.touchMove(element, { touches: touches(points), cancelable: true }));
  return {
    prevented,
    up: () => fireEvent.touchEnd(element, { touches: [] }),
  };
}

/** Straight down from (100, 100) by `distance` px, in steps of 10 px. */
const down = (distance: number): Point[][] =>
  Array.from({ length: Math.floor(distance / 10) + 1 }, (_, step) => [[100, 100 + Math.min(distance, step * 10)]]);

describe("pull to refresh: pure parts (REQ-638)", () => {
  it("moves the chart 60 % of the finger's way, at most 80 px", () => {
    expect(pullOffset(-20)).toBe(0);
    expect(pullOffset(50)).toBeCloseTo(30);
    expect(pullOffset(PULL_THRESHOLD)).toBeCloseTo(38.4);
    expect(pullOffset(500)).toBe(PULL_MAX_OFFSET);
  });

  it("tells a pull only once the finger moved clearly down", () => {
    expect(isPull(2, 5)).toBeNull();
    expect(isPull(0, 10)).toBe(true);
    expect(isPull(4, 10)).toBe(true);
    expect(isPull(6, 10)).toBe(false);
    expect(isPull(-20, 5)).toBe(false);
    expect(isPull(0, -10)).toBe(false);
  });
});

describe("pull to refresh on the meteogram (REQ-638)", () => {
  it("a pull past the threshold reloads past the cache; the day slider's box says so, the chart goes back at once", async () => {
    fakeDevice(true);
    const { loader, pending } = loaderWithPending();
    renderPanel(loader);
    const scroll = await screen.findByTestId("meteogram-scroll");
    const card = screen.getByTestId("meteogram-card");
    expect(card.classList.contains("meteogram-card--pull")).toBe(true);
    // No arrow over the chart: the day slider's box shows the symbol (REQ-737).
    expect(screen.queryByTestId("meteogram-pull")).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);

    const pull = gesture(scroll, ...down(100));
    // Every move is cancelled: neither page nor chart scrolls, nor does the browser pull to refresh.
    expect(pull.prevented.every(Boolean)).toBe(true);
    expect(card.dataset.pull).toBe("ready");
    expect(card.style.getPropertyValue("--meteogram-pull")).toBe("60px");
    // For the day slider's box above (REQ-737).
    const root = document.documentElement;
    expect(root.dataset.meteogramPull).toBe("ready");
    expect(root.style.getPropertyValue("--meteogram-pull-progress")).toBe("1");
    expect(document.documentElement.dataset.meteogramTouch).toBe("");
    act(() => {
      pull.up();
    });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].refresh).toBe(true);
    expect(card.dataset.pull).toBeUndefined();
    expect(card.style.getPropertyValue("--meteogram-pull")).toBe("");
    expect(root.dataset.meteogramPull).toBeUndefined();
    expect(root.style.getPropertyValue("--meteogram-pull-progress")).toBe("");
    // The chart goes back to its place at once, the day slider's box says that it loads (REQ-737).
    expect(card.hasAttribute("data-pull-settling")).toBe(true);
    expect(document.documentElement.dataset.meteogramTouch).toBeUndefined();
    const message = screen.getByTestId("forecast-loading");
    expect(message.textContent).toBe(translate("en", "forecast.loading"));
    expect(message.closest('[data-testid="day-slider-loading"]')?.hasAttribute("data-loading")).toBe(true);

    // No second pull while it loads.
    const again = gesture(scroll, ...down(100));
    expect(again.prevented.some(Boolean)).toBe(false);
    act(() => {
      again.up();
    });
    expect(loader).toHaveBeenCalledTimes(2);

    await act(() => new Promise((resolve) => setTimeout(resolve, PULL_SETTLE_MS + 20)));
    expect(card.hasAttribute("data-pull-settling")).toBe(false);
    await act(async () => pending[0]!(forecastFixture()));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
    expect(screen.getByTestId("day-slider-loading").hasAttribute("data-loading")).toBe(false);
  });

  it("a short pull, a pull back up, a sideways swipe and two fingers do nothing", async () => {
    fakeDevice(true);
    const { loader } = loaderWithPending();
    renderPanel(loader);
    const scroll = await screen.findByTestId("meteogram-scroll");
    const card = screen.getByTestId("meteogram-card");

    const short = gesture(scroll, ...down(PULL_THRESHOLD - 10));
    expect(card.dataset.pull).toBe("pulling");
    act(() => {
      short.up();
    });
    expect(card.dataset.pull).toBeUndefined();

    const back = gesture(scroll, ...down(100), [[100, 120]]);
    expect(card.dataset.pull).toBe("pulling");
    act(() => {
      back.up();
    });

    const sideways = gesture(scroll, [[200, 100]], [[190, 102]], [[150, 110]], [[100, 120]]);
    expect(sideways.prevented.some(Boolean)).toBe(false);
    expect(card.dataset.pull).toBeUndefined();
    act(() => {
      sideways.up();
    });

    const two = gesture(
      scroll,
      [
        [100, 100],
        [160, 100],
      ],
      [
        [100, 150],
        [160, 150],
      ],
      [
        [100, 200],
        [160, 200],
      ],
    );
    expect(two.prevented.some(Boolean)).toBe(false);
    expect(card.dataset.pull).toBeUndefined();
    act(() => {
      two.up();
    });

    // A cancelled touch does nothing either, however far it pulled.
    gesture(scroll, ...down(100));
    act(() => {
      fireEvent.touchCancel(scroll, { touches: [] });
    });
    expect(card.dataset.pull).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does nothing below the top of the page", async () => {
    fakeDevice(true);
    const { loader } = loaderWithPending();
    renderPanel(loader);
    const scroll = await screen.findByTestId("meteogram-scroll");
    vi.spyOn(window, "scrollY", "get").mockReturnValue(30);
    const pull = gesture(scroll, ...down(100));
    expect(pull.prevented.some(Boolean)).toBe(false);
    act(() => {
      pull.up();
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("is not there on the desktop", async () => {
    fakeDevice(false);
    const { loader } = loaderWithPending();
    renderPanel(loader);
    const scroll = await screen.findByTestId("meteogram-scroll");
    expect(screen.queryByTestId("meteogram-pull")).toBeNull();
    const pull = gesture(scroll, ...down(100));
    expect(pull.prevented.some(Boolean)).toBe(false);
    act(() => {
      pull.up();
    });
    expect(screen.getByTestId("meteogram-card").dataset.pull).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

/** An element of the page outside the meteogram, e.g. the header, with `html` inside; appended to the body. */
function pageElement(html = "") {
  const element = document.createElement("header");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

describe("pull to refresh on the whole page: which touches take part (REQ-750)", () => {
  it("the page outside dialogs, menus, scrolled boxes and what takes every touch itself", () => {
    const header = pageElement(
      '<button id="plain">Menu</button><div id="grip" style="touch-action: none"><span id="inner"></span></div>' +
        '<div id="list" style="overflow-y: auto"><p id="item">Item</p></div>',
    );
    expect(pagePulls(header)).toBe(true);
    expect(pagePulls(document.getElementById("plain"))).toBe(true);
    expect(pagePulls(document.documentElement)).toBe(true);
    expect(pagePulls(null)).toBe(false);
    // Grips and maps (`touch-action: none`), also from inside them.
    expect(pagePulls(document.getElementById("grip"))).toBe(false);
    expect(pagePulls(document.getElementById("inner"))).toBe(false);
    // A list that scrolls on its own scrolls back up first.
    const list = document.getElementById("list")!;
    expect(pagePulls(document.getElementById("item"))).toBe(true);
    list.scrollTop = 40;
    expect(pagePulls(document.getElementById("item"))).toBe(false);
    list.scrollTop = 0;
    // An open menu or dialog: neither its panel nor the page behind it.
    const button = document.getElementById("plain")!;
    button.setAttribute("aria-expanded", "true");
    expect(pagePulls(header)).toBe(false);
    button.setAttribute("aria-expanded", "false");
    expect(pagePulls(header)).toBe(true);
    const dialog = pageElement('<dialog open><p id="text">Settings</p></dialog>');
    expect(pagePulls(document.getElementById("text"))).toBe(false);
    expect(pagePulls(header)).toBe(false);
    dialog.remove();
    const map = pageElement('<div role="dialog" aria-modal="true"><div id="map"></div></div>');
    expect(pagePulls(document.getElementById("map"))).toBe(false);
    map.remove();
    expect(pagePulls(header)).toBe(true);
  });
});

describe("pull to refresh on the whole page (REQ-750)", () => {
  it("a pull at the top of the page, over the header or the day slider, reloads as on the chart", async () => {
    fakeDevice(true);
    const { loader, pending } = loaderWithPending();
    renderPanel(loader);
    await screen.findByTestId("meteogram-scroll");
    const card = screen.getByTestId("meteogram-card");
    const header = pageElement("<button>Menu</button>");

    const pull = gesture(header.firstElementChild!, ...down(100));
    expect(pull.prevented.every(Boolean)).toBe(true);
    expect(card.dataset.pull).toBe("ready");
    expect(document.documentElement.dataset.meteogramPull).toBe("ready");
    expect(document.documentElement.dataset.meteogramTouch).toBe("");
    act(() => {
      pull.up();
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].refresh).toBe(true);
    expect(screen.getByTestId("forecast-loading").textContent).toBe(translate("en", "forecast.loading"));
    await act(async () => pending[0]!(forecastFixture()));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();

    // Over the day slider's strip of days.
    const day = document.querySelector(".day-card")!;
    expect(day).not.toBeNull();
    const again = gesture(day, ...down(100));
    expect(card.dataset.pull).toBe("ready");
    act(() => {
      again.up();
    });
    expect(loader).toHaveBeenCalledTimes(3);
    await act(async () => pending[1]!(forecastFixture()));
  });

  it("one pull on the chart reloads once; a short pull of the page does nothing", async () => {
    fakeDevice(true);
    const { loader } = loaderWithPending();
    renderPanel(loader);
    const scroll = await screen.findByTestId("meteogram-scroll");
    const header = pageElement();

    const short = gesture(header, ...down(30));
    expect(screen.getByTestId("meteogram-card").dataset.pull).toBe("pulling");
    act(() => {
      short.up();
    });
    expect(loader).toHaveBeenCalledTimes(1);

    const pull = gesture(scroll, ...down(100));
    act(() => {
      pull.up();
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("not with a menu or a dialog open, not on a grip, not below the top and not on the desktop", async () => {
    fakeDevice(true);
    const { loader } = loaderWithPending();
    const view = renderPanel(loader);
    await screen.findByTestId("meteogram-scroll");
    const card = screen.getByTestId("meteogram-card");
    const header = pageElement('<button aria-expanded="true">Menu</button><div style="touch-action: none"></div>');
    const ignored = (element: Element) => {
      const pull = gesture(element, ...down(100));
      expect(pull.prevented.some(Boolean)).toBe(false);
      expect(card.dataset.pull).toBeUndefined();
      act(() => {
        pull.up();
      });
    };
    ignored(header);
    header.firstElementChild!.setAttribute("aria-expanded", "false");
    ignored(header.lastElementChild!);
    const dialog = pageElement("<dialog open><p>Settings</p></dialog>");
    ignored(dialog.querySelector("p")!);
    ignored(header);
    dialog.remove();
    const spy = vi.spyOn(window, "scrollY", "get").mockReturnValue(30);
    ignored(header);
    spy.mockRestore();
    expect(loader).toHaveBeenCalledTimes(1);

    view.unmount();
    fakeDevice(false);
    renderPanel(loader);
    await screen.findByTestId("meteogram-scroll");
    const pull = gesture(header, ...down(100));
    expect(pull.prevented.some(Boolean)).toBe(false);
    act(() => {
      pull.up();
    });
    // Only the desktop's first load, no reload.
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls.some(([request]) => request.refresh)).toBe(false);
  });
});
