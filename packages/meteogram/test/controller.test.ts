// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/** `createMeteogram` against a real DOM (jsdom), with a fake ResizeObserver and measured boxes. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, canonicalTimestamp } from "../src/core/timeline";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import { DARK_THEME } from "../src/core/theme";
import { calculateDayRange } from "../src/core/zoom";
import {
  OPEN_METEO_ATTRIBUTION,
  createMeteogram,
  type MeteogramController,
  type MeteogramOptions,
} from "../src/interaction/controller";
import { normalInput, powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const POWER_START = Date.UTC(2026, 9, 15, 0);

// --- measured boxes ---------------------------------------------------------

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
let svgBox: Box = { left: 0, top: 0, width: 1000, height: 450 };
const rootBox: Box = { left: 0, top: 0, width: 1000, height: 480 };

function domRect({ left, top, width, height }: Box): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

// --- fake ResizeObserver ------------------------------------------------------

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
    this.observed = [];
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  svgBox = { left: 0, top: 0, width: 1000, height: 450 };
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.tagName.toLowerCase() === "svg") return domRect(svgBox);
    if ((this as HTMLElement).dataset?.testid === "meteogram") return domRect(rootBox);
    return domRect({ left: 0, top: 0, width: 0, height: 0 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// --- helpers --------------------------------------------------------------------

function setup(options: MeteogramOptions = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const meteogram = createMeteogram(host, powerInput, { ...powerOptions, ...options });
  const svg = () => host.querySelector("svg")!;
  return { host, meteogram, svg };
}

const overlayOf = (svg: Element) => svg.querySelector('[data-layer="overlay"]')!;
const staticOf = (svg: Element) => svg.querySelector('[data-layer="static"]')!;

function pointer(target: Element, type: string, init: { clientX?: number; screenX?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: type !== "pointerleave", cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function wheel(target: Element, deltaY: number, init: { clientX?: number; screenX?: number } = {}) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, ...init });
  target.dispatchEvent(event);
  return event;
}

function key(target: Element, keyName: string) {
  const event = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Client x of a time on the measured SVG. */
const clientXAt = (meteogram: MeteogramController, time: number) =>
  svgBox.left + (meteogram.getScene().getX(time) / meteogram.getScene().svgWidth) * svgBox.width;

function mutationsOf(root: Node, action: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  action();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

// --- tests ------------------------------------------------------------------------

describe("createMeteogram: mount", () => {
  it("puts the SVG with both layers and the label row into the element", () => {
    const { host, meteogram, svg } = setup();
    expect(meteogram.element.parentElement).toBe(host);
    expect(staticOf(svg())).not.toBeNull();
    expect(overlayOf(svg())).not.toBeNull();
    // Without hover the current-time line shows.
    expect(svg().querySelector('[data-testid="current-time-cursor-line"]')).not.toBeNull();
    const row = host.querySelector('[data-testid="meteogram-footer-row"]')!;
    expect(row.querySelector('[data-testid="meteogram-footer-location"]')!.textContent).toBe(
      meteogram.getScene().locationLabel,
    );
    const link = row.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(OPEN_METEO_ATTRIBUTION.href);
    expect(row.textContent).toContain("Weather data by Open-Meteo.com");
    // Bottom row: after the SVG.
    expect(svg().compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(meteogram.element.tabIndex).toBe(0);
  });

  it("places the row above the chart for a top label and drops a hidden attribution", () => {
    const layout = { ...BUILTIN_LAYOUTS.find((item) => item.id === "power-default")!, showLocationLabel: "top" as const };
    const { host, svg } = setup({ layout });
    const row = host.querySelector('[data-testid="meteogram-footer-row"]')!;
    expect(row.classList.contains("meteogram-footer-row--top")).toBe(true);
    expect(svg().compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    const custom = setup({ attribution: { text: "Data: ", linkText: "Example", href: "https://example.org/" } });
    expect(custom.meteogram.element.querySelector('[data-testid="meteogram-attribution"]')!.textContent).toBe(
      "Data: Example",
    );
    const hidden = setup({ attribution: null });
    expect(hidden.meteogram.element.querySelector('[data-testid="meteogram-attribution"]')).toBeNull();
  });

  it("puts a centre label between location label and attribution", () => {
    const { host } = setup({ centerLabel: " graupel.eu " });
    const row = host.querySelector<HTMLElement>('[data-testid="meteogram-footer-row"]')!;
    const parts = Array.from(row.children).map((child) => child.getAttribute("data-testid"));
    expect(parts).toEqual(["meteogram-footer-location", "meteogram-footer-center", "meteogram-attribution"]);
    const centre = row.querySelector<HTMLElement>('[data-testid="meteogram-footer-center"]')!;
    expect(centre.textContent).toBe("graupel.eu");
    expect(centre.dataset.exportAlign).toBe("center");
    // Both sides take equal shares of the row, so the centre label sits in its middle.
    expect(row.querySelector<HTMLElement>('[data-testid="meteogram-footer-location"]')!.style.flex).toBe("1 1 0%");
    expect(row.querySelector<HTMLElement>('[data-testid="meteogram-attribution"]')!.style.flex).toBe("1 0 0%");

    const withoutAttribution = setup({ centerLabel: "graupel.eu", attribution: null });
    const other = withoutAttribution.host.querySelector('[data-testid="meteogram-footer-row"]')!;
    expect(other.children).toHaveLength(3);
    expect(other.children[1]!.textContent).toBe("graupel.eu");

    const none = setup({ centerLabel: "  " });
    expect(none.host.querySelector('[data-testid="meteogram-footer-center"]')).toBeNull();
  });

  it("reports an invalid layout once through onLayoutWarning", () => {
    const onLayoutWarning = vi.fn();
    const { meteogram } = setup({ layout: { nonsense: true }, onLayoutWarning });
    expect(onLayoutWarning).toHaveBeenCalledTimes(1);
    expect(onLayoutWarning.mock.calls[0]![0]).toBe(meteogram.getScene().layoutWarning);
    meteogram.update(powerInput, { ...powerOptions, layout: { nonsense: true }, onLayoutWarning });
    expect(onLayoutWarning).toHaveBeenCalledTimes(1);
  });
});

describe("createMeteogram: hover", () => {
  it("swaps only the overlay layer and shows the tooltip", () => {
    const onHover = vi.fn();
    const { meteogram, svg } = setup({ onHover });
    const time = POWER_START + 13 * HOUR_MS + 20 * 60_000;
    const staticBefore = staticOf(svg());
    const overlayRoot = overlayOf(svg());
    const records = mutationsOf(svg(), () =>
      pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, time) }),
    );
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(overlayRoot.contains(record.target)).toBe(true);
    }
    expect(staticOf(svg())).toBe(staticBefore);

    const line = svg().querySelector('[data-testid="hover-cursor-line"]')!;
    expect(line.getAttribute("data-timestamp")).toBe(canonicalTimestamp(POWER_START + 13 * HOUR_MS));
    expect(svg().querySelector('[data-testid="current-time-cursor-line"]')).toBeNull();

    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0]![0].timestamp).toBe(POWER_START + 13 * HOUR_MS);
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(tooltip.style.display).toBe("block");
    expect(tooltip.textContent).toContain("ICON-D2");
    expect(tooltip.querySelector('[data-testid="accumulated-precip-row"]')).not.toBeNull();
    expect(meteogram.getHover()?.timestamp).toBe(POWER_START + 13 * HOUR_MS);
  });

  it("restores the current-time line and hides the tooltip on leave", () => {
    const onHover = vi.fn();
    const { meteogram, svg } = setup({ onHover });
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 20 * HOUR_MS) });
    pointer(svg(), "pointerleave");
    expect(svg().querySelector('[data-testid="hover-cursor-line"]')).toBeNull();
    expect(svg().querySelector('[data-testid="current-time-cursor-line"]')).not.toBeNull();
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(tooltip.style.display).toBe("none");
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(meteogram.getHover()).toBeNull();
  });

  it("ignores the padding, and hover or tooltip when switched off", () => {
    const { meteogram, svg } = setup();
    pointer(svg(), "pointermove", { clientX: 10 });
    expect(meteogram.getHover()).toBeNull();

    const off = setup({ interaction: { hover: false } });
    pointer(off.svg(), "pointermove", { clientX: clientXAt(off.meteogram, POWER_START + 20 * HOUR_MS) });
    expect(off.svg().querySelector('[data-testid="hover-cursor-line"]')).toBeNull();

    const noTooltip = setup({ interaction: { tooltip: false } });
    pointer(noTooltip.svg(), "pointermove", {
      clientX: clientXAt(noTooltip.meteogram, POWER_START + 20 * HOUR_MS),
    });
    expect(noTooltip.svg().querySelector('[data-testid="hover-cursor-line"]')).not.toBeNull();
    const tooltip = noTooltip.meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(tooltip.style.display).toBe("none");
  });

  it("fills the tooltip through renderTooltip", () => {
    const renderTooltip = vi.fn((info, container: HTMLElement) => {
      container.textContent = `custom ${info.timestamp}`;
    });
    const { meteogram, svg } = setup({ renderTooltip });
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 20 * HOUR_MS) });
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(tooltip.textContent).toBe(`custom ${POWER_START + 20 * HOUR_MS}`);
    expect(tooltip.style.display).toBe("block");
  });

  it("places the tooltip again on refreshTooltip, e.g. after late content", () => {
    const renderTooltip = vi.fn(() => true);
    const { meteogram, svg } = setup({ renderTooltip });
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    // Hidden tooltip: nothing to place.
    meteogram.refreshTooltip();
    expect(tooltip.style.left).toBe("");
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 10 * HOUR_MS) });
    const before = tooltip.style.left;
    // Content arrives later and makes the tooltip wider: it moves left of the right edge.
    Object.defineProperty(tooltip, "offsetWidth", { configurable: true, value: 400 });
    meteogram.refreshTooltip();
    expect(parseFloat(tooltip.style.left)).toBeLessThan(parseFloat(before));
    expect(renderTooltip).toHaveBeenCalledTimes(1);
  });

  it("follows a hover set by the host", () => {
    const { meteogram, svg } = setup();
    meteogram.setHover(POWER_START + 30 * HOUR_MS);
    expect(svg().querySelector('[data-testid="hover-cursor-line"]')).not.toBeNull();
    meteogram.setHover(null);
    expect(svg().querySelector('[data-testid="hover-cursor-line"]')).toBeNull();
  });
});

describe("createMeteogram: zoom", () => {
  it("zooms with the wheel over the element, anchored at the hover time", () => {
    const onRangeChange = vi.fn();
    const { meteogram, svg } = setup({ onRangeChange });
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const full = meteogram.getVisibleRange()!;
    expect(full).toEqual(meteogram.getMaximumRange());
    const time = POWER_START + 40 * HOUR_MS;
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, time) });
    const hoverTime = meteogram.getHover()!.time;
    const event = wheel(svg(), -100);
    expect(event.defaultPrevented).toBe(true);
    const zoomed = meteogram.getVisibleRange()!;
    expect(zoomed.end - zoomed.start).toBeLessThan(full.end - full.start);
    expect(zoomed.start).toBeLessThan(hoverTime);
    expect(zoomed.end).toBeGreaterThan(hoverTime);
    expect(svg().getAttribute("data-visible-start-time")).toBe(
      canonicalTimestamp(zoomed.start),
    );
    expect(onRangeChange).toHaveBeenCalledTimes(2);
    expect(onRangeChange).toHaveBeenLastCalledWith(zoomed);
    // The hover stays at its time; the tooltip waits for the next real move.
    expect(meteogram.getHover()!.time).toBe(hoverTime);
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(tooltip.style.display).toBe("none");
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, time) });
    expect(tooltip.style.display).toBe("block");

    wheel(svg(), 100);
    wheel(svg(), 100);
    wheel(svg(), 100);
    expect(meteogram.getVisibleRange()).toEqual(full);
  });

  it("leaves wheels outside the element and with zoom off alone", () => {
    const { meteogram } = setup();
    const outside = document.body.appendChild(document.createElement("div"));
    const range = meteogram.getVisibleRange();
    expect(wheel(outside, -100).defaultPrevented).toBe(false);
    expect(meteogram.getVisibleRange()).toEqual(range);

    const off = setup({ interaction: { zoom: false } });
    const offRange = off.meteogram.getVisibleRange();
    expect(wheel(off.svg(), -100).defaultPrevented).toBe(false);
    expect(off.meteogram.getVisibleRange()).toEqual(offRange);
  });

  it("asks the host to warp the cursor and swallows the move it causes", () => {
    const warpCursor = vi.fn(() => true);
    const { meteogram, svg } = setup({ warpCursor });
    const time = POWER_START + 20 * HOUR_MS;
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, time), screenX: 500 });
    const hoverTime = meteogram.getHover()!.time;
    const before = meteogram.getScene();
    wheel(svg(), -100, { clientX: clientXAt(meteogram, time), screenX: 500 });
    expect(warpCursor).toHaveBeenCalledTimes(1);
    const [screenX] = warpCursor.mock.calls[0] as unknown as [number, number];
    const after = meteogram.getScene();
    const expectedShift =
      ((after.getX(hoverTime) - before.getX(hoverTime)) / before.svgWidth) * svgBox.width;
    expect(screenX).toBeCloseTo(500 + expectedShift);
    // The pointer event the warp causes keeps the hover where it is.
    pointer(svg(), "pointermove", { clientX: 1, screenX });
    expect(meteogram.getHover()!.time).toBe(hoverTime);
  });

  it("applies the day range at the start and on request", () => {
    const { meteogram } = setup({ interaction: { dayRange: 2 as never } });
    const scene = meteogram.getScene();
    expect(meteogram.getVisibleRange()).toEqual(
      calculateDayRange(scene.maximumRange!, 2 as never, scene.timezone),
    );
    meteogram.setDayRange(null);
    expect(meteogram.getVisibleRange()).toEqual(meteogram.getMaximumRange());
    expect(meteogram.getActiveDayRange()).toBeNull();
    meteogram.setDayRange(4);
    expect(meteogram.getActiveDayRange()).toBe(4);
  });

  it("starts with the initial range and keeps the clamped range on new data", () => {
    const start = POWER_START + 12 * HOUR_MS;
    const { meteogram } = setup({ interaction: { initialRange: { start, end: start + 24 * HOUR_MS } } });
    expect(meteogram.getVisibleRange()).toEqual({ start, end: start + 24 * HOUR_MS });
    meteogram.update(powerInput);
    expect(meteogram.getVisibleRange()).toEqual({ start, end: start + 24 * HOUR_MS });
    meteogram.setVisibleRange(null);
    expect(meteogram.getVisibleRange()).toEqual(meteogram.getMaximumRange());
  });
});

describe("createMeteogram: keyboard", () => {
  it("moves the hover with the arrow keys, zooms with + / - / 0 and ends with Escape", () => {
    const { meteogram } = setup();
    const root = meteogram.element;
    expect(key(root, "ArrowRight").defaultPrevented).toBe(true);
    const first = meteogram.getHover()!.timestamp!;
    key(root, "ArrowRight");
    expect(meteogram.getHover()!.timestamp).toBe(first + HOUR_MS);
    key(root, "ArrowLeft");
    expect(meteogram.getHover()!.timestamp).toBe(first);
    const full = meteogram.getVisibleRange()!;
    key(root, "+");
    const zoomed = meteogram.getVisibleRange()!;
    expect(zoomed.end - zoomed.start).toBeLessThan(full.end - full.start);
    key(root, "-");
    key(root, "0");
    expect(meteogram.getVisibleRange()).toEqual(full);
    key(root, "Escape");
    expect(meteogram.getHover()).toBeNull();
    expect(key(root, "x").defaultPrevented).toBe(false);
  });

  it("is not focusable with the keyboard switched off", () => {
    const { meteogram } = setup({ interaction: { keyboard: false } });
    expect(meteogram.element.hasAttribute("tabindex")).toBe(false);
    key(meteogram.element, "ArrowRight");
    expect(meteogram.getHover()).toBeNull();
  });
});

describe("createMeteogram: resize and update", () => {
  it("measures the SVG with a ResizeObserver and redraws on a new size", () => {
    const { meteogram, svg } = setup();
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed).toEqual([svg()]);
    const before = meteogram.getScene();
    svgBox = { left: 0, top: 0, width: 500, height: 450 };
    observer.fire();
    const after = meteogram.getScene();
    expect(after).not.toBe(before);
    expect(after.pixelLayout).not.toEqual(before.pixelLayout);
    // Same size again: no redraw.
    observer.fire();
    expect(meteogram.getScene()).toBe(after);
    svgBox = { left: 0, top: 0, width: 700, height: 450 };
    meteogram.resize();
    expect(meteogram.getScene()).not.toBe(after);
  });

  it("draws new data and replaces the options", () => {
    const { host, meteogram, svg } = setup();
    const node = svg();
    meteogram.update(normalInput, { now: Date.UTC(2026, 0, 10, 5), attribution: null });
    expect(svg()).toBe(node);
    expect(meteogram.getScene().timezone).toBe("UTC");
    expect(host.querySelector('[data-testid="meteogram-attribution"]')).toBeNull();
  });

  it("opens the attribution link through onOpenLink", () => {
    const onOpenLink = vi.fn();
    const { host } = setup({ onOpenLink });
    const link = host.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith(OPEN_METEO_ATTRIBUTION.href);
  });
});

describe("createMeteogram: design options", () => {
  it("takes theme and locale into the label row, tooltip and export", () => {
    const { meteogram, svg } = setup({ theme: "dark", locale: "de-DE" });
    const row = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-footer-row"]')!;
    expect(row.style.color).toContain(DARK_THEME.axis.label);
    const sources = meteogram.getExportSources();
    expect(sources.timeLine!.stroke).toBe(DARK_THEME.cursor);
    expect(sources.background).toBe(DARK_THEME.background);
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 13 * HOUR_MS) });
    const header = meteogram.element.querySelector(".tooltip-header")!;
    expect(header.textContent).toBe("Do., 15.10. — 15:00");
  });
});

describe("createMeteogram: tooltip font size (REQ-487)", () => {
  const tooltipOf = (meteogram: MeteogramController) =>
    meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
  /** Left axis labels on screen: their viewBox size times the vertical scale of the measured SVG. */
  const axisLabelPx = (meteogram: MeteogramController) => {
    const scene = meteogram.getScene();
    return (scene.theme.fontSizes.axis * svgBox.height) / scene.geometry.totalHeight;
  };
  const shownFontPx = (tooltip: HTMLElement) => {
    const value = tooltip.style.getPropertyValue("font-size");
    expect(value).toMatch(/^var\(--graupel-tooltip-font-size, [\d.]+px\)$/);
    return parseFloat(/, ([\d.]+)px/.exec(value)![1]!);
  };

  it("equals the left axis labels as rendered, embedded and full-screen", () => {
    // Embedded: the SVG keeps the viewBox ratio and scales with its width.
    svgBox = { left: 0, top: 0, width: 1200, height: 0 };
    const embedded = setup();
    svgBox = { ...svgBox, height: (embedded.meteogram.getScene().geometry.totalHeight * 1200) / 1000 };
    FakeResizeObserver.instances.at(-1)!.fire();
    pointer(embedded.svg(), "pointermove", { clientX: clientXAt(embedded.meteogram, POWER_START + 13 * HOUR_MS) });
    const embeddedPx = shownFontPx(tooltipOf(embedded.meteogram));
    expect(embeddedPx).toBeCloseTo(axisLabelPx(embedded.meteogram), 2);
    expect(embeddedPx).toBeCloseTo(DARK_THEME.fontSizes.axis * 1.2, 2);

    // Full-screen: wider and stretched in height; the labels grow with the height.
    svgBox = { left: 0, top: 0, width: 1270, height: 880 };
    const fullscreen = setup({ mode: "fullscreen" });
    pointer(fullscreen.svg(), "pointermove", { clientX: clientXAt(fullscreen.meteogram, POWER_START + 13 * HOUR_MS) });
    const fullscreenPx = shownFontPx(tooltipOf(fullscreen.meteogram));
    expect(fullscreenPx).toBeCloseTo(axisLabelPx(fullscreen.meteogram), 2);
    expect(fullscreenPx).toBeGreaterThan(embeddedPx);
  });

  it("follows a resize and the theme's axis font size", () => {
    const { meteogram, svg } = setup({ theme: { fontSizes: { ...DARK_THEME.fontSizes, axis: 12 } } });
    const at = () => pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 13 * HOUR_MS) });
    at();
    expect(shownFontPx(tooltipOf(meteogram))).toBeCloseTo(axisLabelPx(meteogram), 2);
    svgBox = { ...svgBox, width: 500, height: 225 };
    FakeResizeObserver.instances.at(-1)!.fire();
    at();
    expect(shownFontPx(tooltipOf(meteogram))).toBeCloseTo(
      (12 * 225) / meteogram.getScene().geometry.totalHeight,
      2,
    );
  });

  it("sizes every text of the box from the box's font size", () => {
    const { meteogram, svg } = setup();
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 13 * HOUR_MS) });
    const tooltip = tooltipOf(meteogram);
    for (const selector of [".tooltip-header", ".tooltip-section-title", ".tooltip-grid", ".tooltip-row", ".label", ".val"]) {
      for (const node of tooltip.querySelectorAll<HTMLElement>(selector)) {
        expect(node.style.getPropertyValue("font-size")).toBe("");
      }
    }
  });
});

describe("createMeteogram: destroy", () => {
  it("removes every listener, the observer, the timers and the DOM", () => {
    vi.useFakeTimers();
    const added: [EventTarget, string, unknown][] = [];
    const removed: [EventTarget, string, unknown][] = [];
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      added.push([this, type, listener]);
      return add.call(this, type, listener, options);
    });
    vi.spyOn(EventTarget.prototype, "removeEventListener").mockImplementation(function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      removed.push([this, type, listener]);
      return remove.call(this, type, listener, options);
    });

    const onHover = vi.fn();
    const onRangeChange = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    // Without a fixed `now` the controller refreshes the current time every minute.
    const meteogram = createMeteogram(host, powerInput, { onHover, onRangeChange });
    const root = meteogram.element;
    const svg = host.querySelector("svg")!;
    expect(added.map(([, type]) => type).sort()).toEqual(
      ["click", "keydown", "pointerleave", "pointermove", "wheel"].sort(),
    );
    expect(vi.getTimerCount()).toBe(1);
    const scene = meteogram.getScene();

    meteogram.destroy();

    for (const entry of added) {
      expect(removed).toContainEqual(entry);
    }
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.childNodes.length).toBe(0);

    // Events on the detached nodes reach nothing.
    onHover.mockClear();
    onRangeChange.mockClear();
    pointer(svg, "pointermove", { clientX: 500 });
    wheel(root, -100);
    key(root, "ArrowRight");
    vi.advanceTimersByTime(5 * 60_000);
    expect(onHover).not.toHaveBeenCalled();
    expect(onRangeChange).not.toHaveBeenCalled();
    expect(meteogram.getScene()).toBe(scene);
    // Later calls do nothing.
    meteogram.update(powerInput);
    meteogram.destroy();
    expect(host.childNodes.length).toBe(0);
  });

  it("clears a pending cursor-warp timer", () => {
    vi.useFakeTimers();
    const { meteogram, svg } = setup({ warpCursor: () => true });
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 20 * HOUR_MS) });
    wheel(svg(), -100);
    expect(vi.getTimerCount()).toBe(1);
    meteogram.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createMeteogram: axes following the visible range (REQ-655, DEC-061)", () => {
  const range = (from: number, to: number) => ({
    start: POWER_START + from * HOUR_MS,
    end: POWER_START + to * HOUR_MS,
  });
  /** Maxima of the precipitation and wind axes and the label of the wind guide line as drawn. */
  const axes = (meteogram: MeteogramController) => {
    const scene = meteogram.getScene();
    const left = (name: string) =>
      scene.areaScales[scene.geometry.areas.findIndex((area) => area.name === name)]!.left!.max;
    const mid = meteogram.element.querySelector('[data-area-id="wind"] [data-testid="axis-mid"]')?.textContent;
    return { precipitation: left("precipitation"), wind: left("wind"), mid };
  };

  it("adapts the axes after each wheel and key zoom step", () => {
    const { meteogram, svg } = setup();
    expect(axes(meteogram)).toEqual({ precipitation: 5, wind: 40, mid: "20 km/h" });
    // Zoom into the calm part around 30 h, step by step: each step works the axes out anew.
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 30 * HOUR_MS) });
    const steps: ReturnType<typeof axes>[] = [];
    for (let step = 0; step < 10; step++) {
      wheel(svg(), -100);
      const scene = meteogram.getScene();
      expect(scene.axisRange).toEqual(scene.visibleRange);
      steps.push(axes(meteogram));
    }
    const visible = meteogram.getVisibleRange()!;
    expect(visible.start).toBeGreaterThanOrEqual(POWER_START + 24 * HOUR_MS);
    expect(visible.end).toBeLessThanOrEqual(POWER_START + 36 * HOUR_MS);
    expect(steps[0]).toEqual({ precipitation: 5, wind: 40, mid: "20 km/h" });
    expect(steps.at(-1)).toEqual({ precipitation: 2, wind: 30, mid: "15 km/h" });
    // The precipitation axis shrinks before the wind axis, never growing on the way in.
    const firstWith = (match: (entry: ReturnType<typeof axes>) => boolean) => steps.findIndex(match);
    expect(firstWith((entry) => entry.precipitation === 2)).toBeLessThan(firstWith((entry) => entry.wind === 30));
    steps.slice(1).forEach((entry, index) => {
      expect(entry.precipitation).toBeLessThanOrEqual(steps[index]!.precipitation);
      expect(entry.wind).toBeLessThanOrEqual(steps[index]!.wind);
    });
    // Zooming out with the keys brings the axes over all data back.
    key(meteogram.element, "0");
    expect(meteogram.getScene().axisRange).toBeNull();
    expect(axes(meteogram)).toEqual({ precipitation: 5, wind: 40, mid: "20 km/h" });
    key(meteogram.element, "+");
    expect(meteogram.getScene().axisRange).toEqual(meteogram.getVisibleRange());
  });

  it("holds the axes while a host pans the range with axisRangeFrom and adapts them on release", () => {
    const { meteogram } = setup();
    meteogram.setVisibleRange(range(24, 36));
    expect(axes(meteogram)).toEqual({ precipitation: 2, wind: 30, mid: "15 km/h" });
    // Gesture start: the host holds the axes at the range shown, then moves the range into the first shower.
    meteogram.update(powerInput, { ...powerOptions, axisRangeFrom: meteogram.getVisibleRange() });
    for (const from of [20, 16, 12, 8]) {
      meteogram.setVisibleRange(range(from, from + 12));
      expect(meteogram.getVisibleRange()).toEqual(range(from, from + 12));
      expect(axes(meteogram)).toEqual({ precipitation: 2, wind: 30, mid: "15 km/h" });
    }
    // Release: without axisRangeFrom the axes follow the visible range again.
    meteogram.update(powerInput, powerOptions);
    expect(meteogram.getVisibleRange()).toEqual(range(8, 20));
    expect(axes(meteogram).precipitation).toBe(5);
    expect(meteogram.getScene().axisRange).toEqual(range(8, 20));
  });

  it("keeps the axes over all data with scaleToVisibleRange off", () => {
    const { meteogram, svg } = setup({ scaleToVisibleRange: false });
    pointer(svg(), "pointermove", { clientX: clientXAt(meteogram, POWER_START + 30 * HOUR_MS) });
    for (let step = 0; step < 6; step++) wheel(svg(), -100);
    expect(meteogram.getScene().axisRange).toBeNull();
    expect(axes(meteogram)).toEqual({ precipitation: 5, wind: 40, mid: "20 km/h" });
  });
});
