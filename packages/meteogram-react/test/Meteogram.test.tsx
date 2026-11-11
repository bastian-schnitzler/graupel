// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * The shell itself: one controller per mount, updates on new props,
 * destroy on unmount, ref, callbacks and the `renderTooltip` render prop.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@graupel/meteogram";
import type { MeteogramController, MeteogramHoverInfo } from "@graupel/meteogram";
import { StrictMode, createRef, useState } from "react";
import { Meteogram, sameValue } from "../src";
import {
  chartSvg,
  generateMockData,
  hoverAt,
  leave,
  mockModelChain,
  mockRect,
  toInput,
  tooltipElement,
  tooltipShown,
} from "./helpers";

vi.mock("@graupel/meteogram", { spy: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const input = toInput({ data: generateMockData(48), modelChain: mockModelChain });
const otherInput = toInput({ data: generateMockData(72), modelChain: mockModelChain });

describe("<Meteogram> lifecycle", () => {
  it("creates the controller once, updates it on new props and destroys it on unmount", () => {
    const ref = createRef<MeteogramController | null>();
    const { container, rerender, unmount } = render(
      <Meteogram input={input} options={{ theme: "light" }} ref={ref} className="chart" />,
    );
    expect(core.createMeteogram).toHaveBeenCalledTimes(1);
    const controller = ref.current!;
    expect(controller.element.parentElement).toBe(container.querySelector("div.chart"));
    const update = vi.spyOn(controller, "update");

    // Same input, equal inline options: nothing to redraw.
    rerender(<Meteogram input={input} options={{ theme: "light" }} ref={ref} className="chart" />);
    expect(update).not.toHaveBeenCalled();

    rerender(<Meteogram input={otherInput} options={{ theme: "light" }} ref={ref} className="chart" />);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe(otherInput);

    rerender(<Meteogram input={otherInput} options={{ theme: "dark" }} ref={ref} className="chart" />);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]![1]).toMatchObject({ theme: "dark" });
    expect(core.createMeteogram).toHaveBeenCalledTimes(1);

    const destroy = vi.spyOn(controller, "destroy");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
    expect(controller.element.isConnected).toBe(false);
  });

  it("leaves a single meteogram in StrictMode", () => {
    const { container } = render(
      <StrictMode>
        <Meteogram input={input} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('[data-testid="meteogram"]')).toHaveLength(1);
  });

  it("calls a callback ref with the controller and null", () => {
    const calls: (MeteogramController | null)[] = [];
    const { unmount } = render(<Meteogram input={input} ref={(value) => void calls.push(value)} />);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.getScene().available).toBe(true);
    unmount();
    expect(calls.at(-1)).toBeNull();
  });

  it("passes the latest callbacks without re-creating the options", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = createRef<MeteogramController | null>();
    const { rerender } = render(<Meteogram input={input} ref={ref} onHover={first} />);
    const update = vi.spyOn(ref.current!, "update");
    rerender(<Meteogram input={input} ref={ref} onHover={second} />);
    expect(update).not.toHaveBeenCalled();
    act(() => ref.current!.setHover(Date.parse("2026-09-11T10:00:00Z")));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ timestamp: Date.parse("2026-09-11T10:00:00Z") }));
  });
});

describe("<Meteogram> hover props", () => {
  it("reports hover through onHover and follows hoverTime", () => {
    const onHover = vi.fn();
    const time = Date.parse("2026-09-11T12:00:00Z");
    const { container, rerender } = render(<Meteogram input={input} onHover={onHover} hoverTime={time} />);
    expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ timestamp: time }));
    expect(chartSvg(container).querySelector('[data-testid="hover-cursor-line"]')).not.toBeNull();

    rerender(<Meteogram input={input} onHover={onHover} hoverTime={null} />);
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(chartSvg(container).querySelector('[data-testid="hover-cursor-line"]')).toBeNull();
  });

  it("renders React content into the tooltip through renderTooltip", () => {
    const renderTooltip = vi.fn((info: MeteogramHoverInfo) => (
      <strong data-testid="custom-tooltip">{new Date(info.timestamp!).toISOString()}</strong>
    ));
    const refresh = vi.fn();
    const ref = createRef<MeteogramController | null>();
    const { container } = render(<Meteogram input={input} renderTooltip={renderTooltip} ref={ref} />);
    const controller = ref.current!;
    const original = controller.refreshTooltip;
    controller.refreshTooltip = () => {
      refresh();
      original();
    };
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });

    hoverAt(svg, 300);
    expect(tooltipShown(container)).toBe(true);
    const content = screen.getByTestId("custom-tooltip");
    expect(tooltipElement(container).contains(content)).toBe(true);
    expect(content.textContent).toBe(new Date(controller.getHover()!.timestamp!).toISOString());
    // Placed again once React committed the content.
    expect(refresh).toHaveBeenCalled();
    // No standard rows.
    expect(tooltipElement(container).querySelector(".tooltip-row")).toBeNull();

    hoverAt(svg, 700);
    expect(screen.getByTestId("custom-tooltip").textContent).toBe(
      new Date(controller.getHover()!.timestamp!).toISOString(),
    );
    leave(svg);
    expect(tooltipShown(container)).toBe(false);
    expect(screen.queryByTestId("custom-tooltip")).toBeNull();
  });

  it("hides the tooltip when renderTooltip returns null and keeps state of the host", () => {
    function Host() {
      const [count, setCount] = useState(0);
      return (
        <>
          <span data-testid="count">{count}</span>
          <Meteogram
            input={input}
            onHover={(info) => info && setCount((value) => value + 1)}
            renderTooltip={(info) => (info.data?.temperature ? null : <span>no data</span>)}
          />
        </>
      );
    }
    const { container } = render(<Host />);
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });
    hoverAt(svg, 300);
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(tooltipShown(container)).toBe(false);
    expect(container.querySelector('[data-testid="hover-cursor-line"]')).not.toBeNull();
  });

  it("goes back to the standard tooltip when renderTooltip is removed", () => {
    const ref = createRef<MeteogramController | null>();
    const { container, rerender } = render(
      <Meteogram input={input} ref={ref} renderTooltip={() => <span data-testid="custom-tooltip" />} />,
    );
    rerender(<Meteogram input={input} ref={ref} />);
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });
    hoverAt(svg, 300);
    expect(screen.queryByTestId("custom-tooltip")).toBeNull();
    expect(tooltipElement(container).querySelector(".tooltip-row")).not.toBeNull();
  });
});

describe("<Meteogram> model header colours", () => {
  const fills = (container: HTMLElement) =>
    [...chartSvg(container).querySelectorAll('[data-testid="model-header-shape"]')].map((el) => el.getAttribute("fill"));

  it("passes options.modelHeaderColors to the core and redraws when they change", () => {
    const base = { theme: "light" as const, forceModelHeaders: true };
    const { container, rerender } = render(<Meteogram input={otherInput} options={base} />);
    const themeFill = core.LIGHT_THEME.modelHeader.background;
    expect(fills(container).length).toBeGreaterThan(1);
    expect(new Set(fills(container))).toEqual(new Set([themeFill]));

    rerender(<Meteogram input={otherInput} options={{ ...base, modelHeaderColors: { "ICON-D2": "#c2410c" } }} />);
    const [first, ...rest] = fills(container);
    expect(first).toBe("#c2410c");
    expect(new Set(rest)).toEqual(new Set([themeFill]));
  });
});

describe("<Meteogram> viewBox width", () => {
  const viewBox = (container: HTMLElement) => chartSvg(container).getAttribute("viewBox")!.split(" ").map(Number);

  it("passes options.viewBoxWidth to the core and redraws when it changes; the height stays", () => {
    const { container, rerender } = render(<Meteogram input={input} options={{ theme: "light" }} />);
    const [, , width, height] = viewBox(container);
    expect(width).toBe(core.METEOGRAM_VIEWBOX_WIDTH);

    rerender(<Meteogram input={input} options={{ theme: "light", viewBoxWidth: 400 }} />);
    expect(viewBox(container)).toEqual([0, 0, 400, height]);

    rerender(<Meteogram input={input} options={{ theme: "light", viewBoxWidth: null }} />);
    expect(viewBox(container)).toEqual([0, 0, core.METEOGRAM_VIEWBOX_WIDTH, height]);
  });
});

describe("<Meteogram> compact axis labels (REQ-696)", () => {
  const units = (container: HTMLElement) =>
    [...chartSvg(container).querySelectorAll('[data-testid="axis-unit"]')].map((el) => el.textContent);

  it("passes options.axisLabels.compact to the core (default off) and redraws when it changes", () => {
    const { container, rerender } = render(<Meteogram input={input} options={{ theme: "light" }} />);
    expect(units(container)).toEqual([]);

    rerender(<Meteogram input={input} options={{ theme: "light", axisLabels: { compact: true } }} />);
    expect(units(container)).toEqual(expect.arrayContaining(["mm", "km/h"]));

    rerender(<Meteogram input={input} options={{ theme: "light", axisLabels: { compact: false } }} />);
    expect(units(container)).toEqual([]);
  });
});

describe("<Meteogram> relative humidity", () => {
  const humidInput = {
    ...otherInput,
    series: [
      ...otherInput.series,
      ...otherInput.series
        .filter((point) => point.variable === "temperature")
        .map((point, index) => ({ ...point, variable: "relative_humidity", unit: "%", value: 60 + (index % 30) })),
    ],
  };
  const lines = (container: HTMLElement) =>
    chartSvg(container).querySelectorAll('[data-testid="relative-humidity-path"]').length;
  const texts = (container: HTMLElement) => [...chartSvg(container).querySelectorAll("text")].map((el) => el.textContent);

  it("passes options.relativeHumidity to the core (default off) and redraws when it changes", () => {
    const { container, rerender } = render(<Meteogram input={humidInput} options={{ theme: "light" }} />);
    expect(lines(container)).toBe(0);
    expect(texts(container)).not.toContain("100 %");

    rerender(<Meteogram input={humidInput} options={{ theme: "light", relativeHumidity: "on" }} />);
    expect(lines(container)).toBe(1);
    expect(texts(container)).toEqual(expect.arrayContaining(["100 %", "0 %"]));

    rerender(<Meteogram input={humidInput} options={{ theme: "light", relativeHumidity: "off" }} />);
    expect(lines(container)).toBe(0);
    expect(texts(container)).not.toContain("100 %");
  });
});

describe("options.scaleToVisibleRange and axisRangeFrom (REQ-655)", () => {
  const start = Date.parse("2026-09-11T00:00:00Z");
  const hours = (from: number, to: number) => ({ start: start + from * 3_600_000, end: start + to * 3_600_000 });
  /** Gusts of the mock data are weakest around 9 h. */
  const calm = hours(7, 12);
  const windMax = (ref: { current: MeteogramController | null }) => {
    const scene = ref.current!.getScene();
    return scene.areaScales[scene.geometry.areas.findIndex((area) => area.name === "wind")]!.left!.max;
  };

  it("passes the option to the core (default on) and axisRangeFrom with it", () => {
    const ref = createRef<MeteogramController | null>();
    const { rerender } = render(<Meteogram ref={ref} input={otherInput} options={{ theme: "light" }} />);
    const whole = windMax(ref);
    expect(ref.current!.getScene().axisRange).toBeNull();

    rerender(<Meteogram ref={ref} input={otherInput} options={{ theme: "light" }} visibleRange={calm} />);
    expect(ref.current!.getScene().axisRange).toEqual(calm);
    const zoomed = windMax(ref);
    expect(zoomed).toBeLessThan(whole);

    rerender(
      <Meteogram
        ref={ref}
        input={otherInput}
        options={{ theme: "light", scaleToVisibleRange: false }}
        visibleRange={calm}
      />,
    );
    expect(ref.current!.getScene().axisRange).toBeNull();
    expect(windMax(ref)).toBe(whole);

    // Held at the calm range while the range moves to stronger wind; released, the axis follows again.
    rerender(
      <Meteogram
        ref={ref}
        input={otherInput}
        options={{ theme: "light", axisRangeFrom: calm }}
        visibleRange={hours(0, 5)}
      />,
    );
    expect(ref.current!.getScene().axisRange).toEqual(calm);
    expect(windMax(ref)).toBe(zoomed);
    rerender(<Meteogram ref={ref} input={otherInput} options={{ theme: "light" }} visibleRange={hours(0, 5)} />);
    expect(ref.current!.getScene().axisRange).toEqual(hours(0, 5));
    expect(windMax(ref)).toBeGreaterThan(zoomed);
  });
});

describe("sameValue", () => {
  it("compares plain objects and arrays by value, everything else by identity", () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue([1, 2], [1, 3])).toBe(false);
    expect(sameValue(undefined, {})).toBe(false);
    const fn = () => 1;
    expect(sameValue({ fn }, { fn })).toBe(true);
    expect(sameValue({ fn }, { fn: () => 1 })).toBe(false);
    expect(sameValue(new Map(), new Map())).toBe(false);
  });
});
