// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Zoom, visible range and day range through `<Meteogram>` ("Full-Screen Meteogram Mode"
 * zoom cases, "Timeline Clamping and Zoom Line Clipping Regressions"),
 * `MeteogramChart.dayRange.test.tsx` and `MeteogramChartState.test.tsx`.
 * Changed by DEC-012: the wheel zooms only over the meteogram element, no
 * longer anywhere in the window; fullscreen and the day-range buttons stay
 * in the app (WEB), so their cases use the `dayRange` prop and the controller.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPoint, MeteogramController, TimeRange } from "@graupel/meteogram";
import { createRef } from "react";
import { Meteogram } from "../src";
import {
  DAY,
  HOUR,
  chartSvg,
  generateMockData,
  hoverAt,
  mockModelChain,
  mockRect,
  toInput,
  visibleRangeOf,
} from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const wheelEvent = (deltaY: number) =>
  new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });

describe("wheel zoom over the meteogram", () => {
  it.each(["chart", "label-row"])(
    "zooms left-anchored once per wheel over the %s and cleans up on unmount",
    (area) => {
      const input = toInput({
        data: generateMockData(120),
        modelChain: mockModelChain,
        timelineStart: "2026-09-11T00:00:00Z",
        timelineEnd: "2026-09-16T00:00:00Z",
      });
      const { container, unmount } = render(<Meteogram input={input} />);
      const svg = chartSvg(container);
      const [start, end] = visibleRangeOf(container);
      const target =
        area === "chart" ? svg : screen.getByTestId("meteogram-footer-row");
      const event = wheelEvent(-100);
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(true);
      const [zoomedStart, zoomedEnd] = visibleRangeOf(container);
      expect(zoomedStart).toBe(start);
      expect(zoomedEnd - start).toBeCloseTo((end - start) * 0.82, -1);

      // The listeners go with the component.
      const meteogram = screen.getByTestId("meteogram");
      unmount();
      expect(meteogram.isConnected).toBe(false);
      const after = wheelEvent(-100);
      fireEvent(meteogram, after);
      expect(after.defaultPrevented).toBe(false);
    },
  );

  it("leaves wheels elsewhere on the page alone (no window-wide zoom)", () => {
    const { container } = render(
      <div>
        <header data-testid="wheel-header" />
        <div className="fullscreen-map-picker" data-testid="wheel-map-picker" />
        <Meteogram input={toInput({ data: generateMockData(120), modelChain: mockModelChain })} />
      </div>,
    );
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });
    hoverAt(svg, 500);
    const before = visibleRangeOf(container);
    for (const target of [screen.getByTestId("wheel-map-picker"), screen.getByTestId("wheel-header")]) {
      const event = wheelEvent(-100);
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(false);
    }
    const onWindow = wheelEvent(-100);
    fireEvent(window, onWindow);
    expect(onWindow.defaultPrevented).toBe(false);
    expect(visibleRangeOf(container)).toEqual(before);
  });

  it("anchors the zoom at the hovered time", () => {
    const { container } = render(
      <Meteogram input={toInput({ data: generateMockData(120), modelChain: mockModelChain })} />,
    );
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });
    const [start, end] = visibleRangeOf(container);
    hoverAt(svg, 500);
    const hovered = Date.parse(screen.getByTestId("hover-cursor-line").getAttribute("data-timestamp")!);
    fireEvent(svg, wheelEvent(-100));
    const [zoomedStart, zoomedEnd] = visibleRangeOf(container);
    expect(zoomedStart).toBeGreaterThan(start);
    expect(zoomedEnd).toBeLessThan(end);
    expect(zoomedStart).toBeLessThan(hovered);
    expect(zoomedEnd).toBeGreaterThan(hovered);
  });

  it("does not zoom with zoom switched off", () => {
    const { container } = render(
      <Meteogram
        input={toInput({ data: generateMockData(120), modelChain: mockModelChain })}
        options={{ interaction: { zoom: false } }}
      />,
    );
    const before = visibleRangeOf(container);
    const event = wheelEvent(-100);
    fireEvent(chartSvg(container), event);
    expect(event.defaultPrevented).toBe(false);
    expect(visibleRangeOf(container)).toEqual(before);
  });

  it("keeps left-anchored zoom and persists clamping across model horizon changes", () => {
    const data = generateMockData(120);
    const props = (timelineEnd: string) =>
      toInput({ data, modelChain: mockModelChain, timelineStart: "2026-09-11T00:00:00Z", timelineEnd });
    const { container, rerender } = render(<Meteogram input={props("2026-09-16T00:00:00Z")} />);
    const svg = chartSvg(container);
    const initialStart = svg.getAttribute("data-visible-start-time");
    const initialEnd = svg.getAttribute("data-visible-end-time")!;

    fireEvent.wheel(svg, { deltaY: -100, deltaMode: 0 });
    expect(svg.getAttribute("data-visible-start-time")).toBe(initialStart);
    expect(svg.getAttribute("data-visible-end-time")! < initialEnd).toBe(true);

    rerender(<Meteogram input={props("2026-09-14T00:00:00Z")} />);
    expect(chartSvg(container).getAttribute("data-visible-end-time")).toBe("2026-09-14T00:00:00.000Z");

    rerender(<Meteogram input={props("2026-09-20T00:00:00Z")} />);
    expect(chartSvg(container).getAttribute("data-visible-end-time")).toBe("2026-09-14T00:00:00.000Z");
  });
});

describe("Timeline Clamping and Zoom Line Clipping Regressions", () => {
  const berlinLocation = { name: "Berlin", latitude: 52.52, longitude: 13.4, timezone: "Europe/Berlin" };

  /** Effective now Wed 2026-09-16 12:00 UTC; data from Mon 22:00 CEST (past-hours buffer). */
  const generateBerlinForecastData = () => {
    const data: DataPoint[] = [];
    const bufferStart = Date.parse("2026-09-14T20:00:00Z");
    for (let h = 0; h < 120; h++) {
      const timestamp = new Date(bufferStart + h * HOUR).toISOString();
      const add = (variable: string, value: number, unit: string) =>
        data.push({ timestamp, variable, value, unit, model: "ICON-D2" });
      add("temperature", 14 + (h % 10), "°C");
      add("apparent_temperature", 13 + (h % 10), "°C");
      add("wind_speed", 12 + (h % 8), "km/h");
      add("wind_gusts", 20 + (h % 12), "km/h");
      add("wind_direction", (h * 15) % 360, "°");
      add("precipitation", h % 5 === 0 ? 1.5 : 0, "mm");
      add("precipitation_probability", (h * 5) % 100, "%");
    }
    return data;
  };

  const renderBerlin = (extra: { timelineStart?: string; timelineEnd?: string } = {}) =>
    render(
      <Meteogram
        input={toInput({
          data: generateBerlinForecastData(),
          location: berlinLocation,
          forecastStartTime: "2026-09-16T12:00:00.000Z",
          modelChain: mockModelChain,
          ...extra,
        })}
      />,
    );

  const clipRectOf = (container: HTMLElement, testId: string) => {
    const area = container.querySelector(`[data-testid="${testId}"]`);
    const id = area?.getAttribute("clip-path")?.match(/#([^)]+)/)?.[1];
    return container.querySelector(`[id="${id}"] rect`);
  };

  it("1. Default zoom visibleStart equals yesterday at 00:00 local time", () => {
    const { container } = renderBerlin();
    expect(chartSvg(container).getAttribute("data-visible-start-time")).toBe("2026-09-14T22:00:00.000Z");
  });

  it("2. First day starts exactly at left chart boundary (outerLeftX)", () => {
    const { container } = renderBerlin();
    expect(Number(container.querySelector('[data-testid="day-label-cell"]')?.getAttribute("x"))).toBe(50);
  });

  it("3. No extra/empty day column exists before yesterday", () => {
    const { container } = renderBerlin();
    const dayBlocks = container.querySelectorAll(".day-group-block text");
    expect(dayBlocks.length).toBeGreaterThan(0);
    expect(dayBlocks[0]!.textContent).toContain("Tue 15.09");
    expect(dayBlocks[0]!.textContent).not.toContain("14.09");
  });

  it("4. Starting exactly at midnight does not generate a preceding partial day", () => {
    const { container } = render(
      <Meteogram
        input={toInput({
          data: generateMockData(72),
          modelChain: mockModelChain,
          timelineStart: "2026-09-11T00:00:00.000Z",
          timelineEnd: "2026-09-14T00:00:00.000Z",
        })}
      />,
    );
    const cells = container.querySelectorAll('[data-testid="day-label-cell"]');
    expect(Number(cells[0]!.getAttribute("x"))).toBe(50);
    expect(container.querySelectorAll(".day-group-block text")[0]!.textContent).toContain("Fri 11.09");
  });

  it("5. Starting deliberately at midday generates a valid partial first day without day separator line at 50px", () => {
    const { container } = renderBerlin({
      timelineStart: "2026-09-15T12:00:00.000Z",
      timelineEnd: "2026-09-18T00:00:00.000Z",
    });
    expect(Number(container.querySelector('[data-testid="day-label-cell"]')?.getAttribute("x"))).toBe(50);
    container.querySelectorAll('[data-testid="day-separator-line"]').forEach((separator) => {
      expect(Number(separator.getAttribute("x1"))).toBeGreaterThan(50);
    });
  });

  it("6. Plotted line series clipped at left boundary", () => {
    const { container } = renderBerlin();
    const clip = (testId: string) =>
      container.querySelector(`[data-testid="${testId}"]`)?.getAttribute("clip-path");
    expect(clip("temperature-plot-area")).toMatch(/^url\(#temperature-clip-/);
    expect(clip("temperature-path")).toMatch(/^url\(#temperature-clip-/);
    expect(clip("wind-plot-area")).toMatch(/^url\(#wind-clip-/);
    expect(clip("wind-speed-path")).toMatch(/^url\(#wind-clip-/);
    expect(clip("precip-probability-path")).toMatch(/^url\(#precipitation-probability-clip-/);
    expect(Number(clipRectOf(container, "temperature-plot-area")?.getAttribute("x"))).toBe(50);
  });

  it("7. Plotted line series clipped at right boundary", () => {
    const { container } = renderBerlin();
    const rect = clipRectOf(container, "temperature-plot-area");
    expect(Number(rect?.getAttribute("width"))).toBe(900);
    expect(Number(rect?.getAttribute("x")) + Number(rect?.getAttribute("width"))).toBe(950);
  });

  it("8. Zooming in cannot create visible line overflow", () => {
    const { container } = renderBerlin();
    fireEvent.wheel(chartSvg(container), { deltaY: -100, clientX: 300, clientY: 100 });
    const rect = clipRectOf(container, "temperature-plot-area");
    expect(Number(rect?.getAttribute("x"))).toBe(50);
    expect(Number(rect?.getAttribute("width"))).toBe(900);
  });

  it("9. Zooming back out restores complete underlying series", () => {
    const { container } = renderBerlin();
    const svg = chartSvg(container);
    const initialStart = svg.getAttribute("data-visible-start-time");
    fireEvent.wheel(svg, { deltaY: -200, clientX: 300, clientY: 100 });
    fireEvent.wheel(svg, { deltaY: 300, clientX: 300, clientY: 100 });
    expect(chartSvg(container).getAttribute("data-visible-start-time")).toBe(initialStart);
  });

  it("11. Clipping updates correctly after resizing window/chart", () => {
    let resize: (() => void) | null = null;
    class MockObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockObserver);
    const ref = createRef<MeteogramController | null>();
    const { container } = render(
      <Meteogram
        ref={ref}
        input={toInput({
          data: generateBerlinForecastData(),
          location: berlinLocation,
          forecastStartTime: "2026-09-16T12:00:00.000Z",
          modelChain: mockModelChain,
        })}
      />,
    );
    expect(ref.current!.getScene().pixelLayout.textScaleX).toBe(1);
    mockRect(chartSvg(container), { left: 0, top: 0, width: 500, height: 544 });
    act(() => resize?.());
    expect(container.querySelector('[data-testid="temperature-plot-area"]')?.getAttribute("clip-path")).toBeTruthy();
    expect(Number(clipRectOf(container, "temperature-plot-area")?.getAttribute("width"))).toBe(900);
    // The new size reached the scene: text keeps its proportions in a narrower chart.
    expect(ref.current!.getScene().pixelLayout.textScaleX).toBe(2);
  });

  it("12. All chart areas share identical visibleStart -> visibleEnd x-domain", () => {
    const { container } = renderBerlin();
    const svg = chartSvg(container);
    expect(svg.getAttribute("data-visible-start-time")).toBe("2026-09-14T22:00:00.000Z");
    expect(svg.getAttribute("data-visible-end-time")).toBeTruthy();
    container.querySelectorAll('[data-testid="chart-area-horizontal-border"]').forEach((border) => {
      expect(Number(border.getAttribute("x1"))).toBe(50);
      expect(Number(border.getAttribute("x2"))).toBe(950);
    });
  });

  it("13. Model boundaries and day boundaries remain aligned after zooming", () => {
    const { container } = renderBerlin();
    fireEvent.wheel(chartSvg(container), { deltaY: -100, clientX: 300, clientY: 100 });
    const boundaryLine = container.querySelector('[data-testid="model-boundary-line"]');
    if (boundaryLine) {
      expect(boundaryLine.getAttribute("data-timestamp")).toBeTruthy();
      expect(Number(boundaryLine.getAttribute("x1"))).toBeGreaterThanOrEqual(50);
      expect(Number(boundaryLine.getAttribute("x1"))).toBeLessThanOrEqual(950);
    }
  });
});

describe("visible range and day range (MeteogramChartState, dayRange)", () => {
  const START = Date.UTC(2026, 9, 19);

  function dayInput(days: number) {
    const data: DataPoint[] = [];
    for (let h = 0; h < days * 24; h++) {
      data.push({
        timestamp: new Date(START + h * HOUR).toISOString(),
        variable: "temperature",
        value: 10,
        unit: "°C",
        model: "ECMWF",
      });
    }
    return toInput({
      data,
      modelChain: [{ name: "ECMWF", max_forecast_horizon_hours: days * 24 }],
      timelineStart: new Date(START).toISOString(),
      timelineEnd: new Date(START + days * DAY).toISOString(),
      forecastStartTime: new Date(START + DAY + 6 * HOUR).toISOString(),
      userTimezone: "UTC",
    });
  }

  it("restores a persisted zoom range and reports range changes", () => {
    const start = Date.parse("2026-09-11T06:00:00Z");
    const persisted: TimeRange = { start, end: start + 12 * HOUR };
    const onRangeChange = vi.fn();
    const data: DataPoint[] = [];
    for (let h = 0; h < 48; h++) {
      const timestamp = new Date(Date.parse("2026-09-11T00:00:00Z") + h * HOUR).toISOString();
      data.push(
        { timestamp, variable: "temperature", value: 10, unit: "°C", model: "ICON-EU" },
        { timestamp, variable: "wind_speed", value: 12, unit: "km/h", model: "ICON-EU" },
      );
    }
    render(
      <Meteogram
        input={toInput({
          data,
          modelChain: [{ name: "ICON-EU", max_forecast_horizon_hours: 48 }],
          timelineStart: "2026-09-11T00:00:00Z",
          timelineEnd: "2026-09-13T00:00:00Z",
        })}
        visibleRange={persisted}
        onRangeChange={onRangeChange}
      />,
    );
    expect(onRangeChange).toHaveBeenLastCalledWith(persisted);
  });

  it("sets the visible range from the timeline start for each day range", () => {
    const ref = createRef<MeteogramController | null>();
    const onRangeChange = vi.fn();
    const { container, rerender } = render(
      <Meteogram input={dayInput(16)} ref={ref} onRangeChange={onRangeChange} />,
    );
    // Whole forecast at first: "All".
    expect(ref.current!.getActiveDayRange()).toBeNull();
    for (const days of [4, 7, 10, 14] as const) {
      rerender(<Meteogram input={dayInput(16)} ref={ref} dayRange={days} onRangeChange={onRangeChange} />);
      expect(visibleRangeOf(container)).toEqual([START, START + days * DAY]);
      expect(ref.current!.getActiveDayRange()).toBe(days);
      expect(onRangeChange).toHaveBeenLastCalledWith({ start: START, end: START + days * DAY });
    }
    rerender(<Meteogram input={dayInput(16)} ref={ref} dayRange={null} onRangeChange={onRangeChange} />);
    expect(visibleRangeOf(container)).toEqual([START, START + 16 * DAY]);
  });

  it("clamps when fewer days are available", () => {
    const ref = createRef<MeteogramController | null>();
    const { container } = render(<Meteogram input={dayInput(5)} ref={ref} />);
    act(() => ref.current!.setDayRange(7));
    expect(visibleRangeOf(container)).toEqual([START, START + 5 * DAY]);
    // 7d, 14d and All cover the same 5 days: the chosen one stays active.
    expect(ref.current!.getActiveDayRange()).toBe(7);
  });

  it("starts a new forecast with the remembered choice", () => {
    const { container } = render(<Meteogram input={dayInput(16)} dayRange={7} />);
    expect(visibleRangeOf(container)).toEqual([START, START + 7 * DAY]);
  });

  it("applies a changed visibleRange prop and ignores the range it reported itself", () => {
    const ref = createRef<MeteogramController | null>();
    const ranges: (TimeRange | null)[] = [];
    function Host({ range }: { range?: TimeRange | null }) {
      return (
        <Meteogram
          input={input}
          ref={ref}
          visibleRange={range}
          onRangeChange={(next) => ranges.push(next)}
        />
      );
    }
    const input = dayInput(16);
    const { container, rerender } = render(<Host />);
    expect(ranges).toHaveLength(1);
    const twoDays = { start: START + DAY, end: START + 3 * DAY };
    rerender(<Host range={twoDays} />);
    expect(visibleRangeOf(container)).toEqual([twoDays.start, twoDays.end]);
    expect(ranges.at(-1)).toEqual(twoDays);
    // Wheel zoom, then the host passes the reported range back: no new range.
    fireEvent.wheel(chartSvg(container), { deltaY: -100 });
    const zoomed = ranges.at(-1)!;
    const count = ranges.length;
    const update = vi.spyOn(ref.current!, "setVisibleRange");
    rerender(<Host range={{ ...zoomed! }} />);
    expect(update).not.toHaveBeenCalled();
    expect(ranges).toHaveLength(count);
    // null shows everything.
    rerender(<Host range={null} />);
    expect(visibleRangeOf(container)).toEqual([START, START + 16 * DAY]);
  });
});
