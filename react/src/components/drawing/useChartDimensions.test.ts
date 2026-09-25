import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useChartDimensions } from "./useChartDimensions";
import type { RefObject } from "react";

describe("useChartDimensions", () => {
  let mockObserve: any;
  let mockDisconnect: any;
  let originalResizeObserver: any;

  beforeEach(() => {
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();
    originalResizeObserver = globalThis.ResizeObserver;

    globalThis.ResizeObserver = class {
      observe = mockObserve;
      disconnect = mockDisconnect;
      unobserve = vi.fn();
    } as any;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("initializes with default width and height 0", () => {
    const dummyRef: RefObject<SVGSVGElement | null> = { current: null };
    const { result } = renderHook(() =>
      useChartDimensions(dummyRef, true, 800),
    );

    expect(result.current).toEqual({ width: 800, height: 0 });
  });

  it("measures rendered element dimensions and attaches ResizeObserver", () => {
    const element = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      width: 950,
      height: 450,
      top: 0,
      left: 0,
      right: 950,
      bottom: 450,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const ref: RefObject<SVGSVGElement | null> = { current: element };
    const { result, unmount } = renderHook(() =>
      useChartDimensions(ref, true, 1000),
    );

    expect(result.current).toEqual({ width: 950, height: 450 });
    expect(mockObserve).toHaveBeenCalledWith(element);

    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("does not observe or measure when active is false", () => {
    const element = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    const ref: RefObject<SVGSVGElement | null> = { current: element };
    const { result } = renderHook(() => useChartDimensions(ref, false, 1000));

    expect(result.current).toEqual({ width: 1000, height: 0 });
    expect(mockObserve).not.toHaveBeenCalled();
  });
});
