import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useMeteogramHover } from "./useMeteogramHover";
import type { DataPoint } from "../../types";

describe("useMeteogramHover", () => {
  const container = document.createElement("div");
  const popup = document.createElement("div");
  const containerRef = { current: container };
  const popupRef = { current: popup };

  const timestamps = [1000, 2000, 3000];
  const timeMap = new Map<number, Record<string, DataPoint>>();
  timeMap.set(1000, {
    temperature: {
      variable: "temperature",
      value: 15,
      unit: "°C",
      timestamp: "2026-09-16T12:00:00Z",
      model: "ICON-D2",
    },
  });

  const timeline = {
    xToTimestamp: vi.fn((_x: number) => 1000),
    timestampToX: vi.fn((_t: number) => 100),
  };

  it("initializes with null hover state", () => {
    const { result } = renderHook(() =>
      useMeteogramHover({
        containerRef,
        popupRef,
        timeline,
        timestamps,
        timeMap,
        precipValues: [0, 1, 0],
        resolvedTimezone: "UTC",
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
        getX: (_t) => 100,
      }),
    );

    expect(result.current.hoverIndex).toBeNull();
    expect(result.current.hoverTimestamp).toBeNull();
    expect(result.current.hoverData).toBeNull();
  });

  it("resets hover on handleMouseLeave", () => {
    const { result } = renderHook(() =>
      useMeteogramHover({
        containerRef,
        popupRef,
        timeline,
        timestamps,
        timeMap,
        precipValues: [0, 1, 0],
        resolvedTimezone: "UTC",
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
        getX: (_t) => 100,
      }),
    );

    act(() => {
      result.current.handleMouseLeave();
    });

    expect(result.current.hoverIndex).toBeNull();
    expect(result.current.popupPos).toBeNull();
  });

  it("switches popup side based on cursor position relative to container midpoint and places it below date header", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      width: 1000,
      height: 500,
      right: 1100,
      bottom: 700,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    vi.spyOn(popup, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 150,
      right: 200,
      bottom: 150,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      width: 1000,
      height: 500,
      right: 1100,
      bottom: 700,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    const { result } = renderHook(() =>
      useMeteogramHover({
        containerRef,
        popupRef,
        timeline,
        timestamps,
        timeMap,
        precipValues: [0, 1, 0],
        resolvedTimezone: "UTC",
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
        getX: (_t) => 100,
        dayHeaderBottom: 44,
        totalSvgHeight: 500,
      }),
    );

    // Cursor in left half (clientX 300 < containerMidX 600) -> popup pinned to right border
    act(() => {
      result.current.handleMouseMove({
        clientX: 300,
        clientY: 350,
        currentTarget: svg,
      } as unknown as React.MouseEvent<SVGSVGElement>);
    });

    expect(result.current.popupPos).not.toBeNull();
    // Pinned to right: 1100 - 200 (width) - 12 (inset) = 888
    expect(result.current.popupPos?.left).toBe(888);
    // Pinned below date header: svgRect.top (200) + (44/500)*500 (44) + 4 (gap) = 248
    expect(result.current.popupPos?.top).toBe(248);

    // Cursor in right half (clientX 900 >= containerMidX 600) -> popup pinned to left border
    act(() => {
      result.current.handleMouseMove({
        clientX: 900,
        clientY: 350,
        currentTarget: svg,
      } as unknown as React.MouseEvent<SVGSVGElement>);
    });

    // Pinned to left: 100 + 12 (inset) = 112
    expect(result.current.popupPos?.left).toBe(112);
    expect(result.current.popupPos?.top).toBe(248);
  });

  it("hides popup immediately on zoom and suppresses hover updates until cursor moves", () => {
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      width: 1000,
      height: 500,
      right: 1100,
      bottom: 700,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      width: 1000,
      height: 500,
      right: 1100,
      bottom: 700,
      x: 100,
      y: 200,
      toJSON: () => {},
    });

    const { result, rerender } = renderHook(() =>
      useMeteogramHover({
        containerRef,
        popupRef,
        timeline,
        timestamps,
        timeMap,
        precipValues: [0, 1, 0],
        resolvedTimezone: "UTC",
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
        getX: (_t) => 100,
        dayHeaderBottom: 44,
        totalSvgHeight: 500,
      }),
    );

    // Hover to show popup
    act(() => {
      result.current.handleMouseMove({
        clientX: 300,
        clientY: 350,
        currentTarget: svg,
      } as unknown as React.MouseEvent<SVGSVGElement>);
    });
    expect(result.current.popupPos).not.toBeNull();

    // Trigger zoom start
    act(() => {
      result.current.hidePopupOnZoom();
    });
    expect(result.current.popupPos).toBeNull();

    // Rerender (such as zoom domain updating) keeps popup hidden
    act(() => {
      rerender();
    });
    expect(result.current.popupPos).toBeNull();

    // Genuine mouse move restores popup
    act(() => {
      result.current.handleMouseMove({
        clientX: 350,
        clientY: 350,
        currentTarget: svg,
      } as unknown as React.MouseEvent<SVGSVGElement>);
    });
    expect(result.current.popupPos).not.toBeNull();
  });
});
