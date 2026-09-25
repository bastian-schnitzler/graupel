import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useMeteogramZoom } from "./useMeteogramZoom";

describe("useMeteogramZoom", () => {
  const embeddedSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const fullscreenSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const embeddedSvgRef = { current: embeddedSvg };
  const fullscreenSvgRef = { current: fullscreenSvg };

  const maximumRange = { start: 1000, end: 5000 };
  const timeline = {
    startMs: 1000,
    endMs: 5000,
    timestampToX: vi.fn(() => 500),
  };

  it("initializes visibleRange as null", () => {
    const { result } = renderHook(() =>
      useMeteogramZoom({
        maximumRange,
        timeline,
        hoverTime: null,
        isFullscreen: false,
        embeddedSvgRef,
        fullscreenSvgRef,
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
      }),
    );

    expect(result.current.visibleRange).toBeNull();
  });

  it("updates visibleRange via setVisibleRange", () => {
    const { result } = renderHook(() =>
      useMeteogramZoom({
        maximumRange,
        timeline,
        hoverTime: null,
        isFullscreen: false,
        embeddedSvgRef,
        fullscreenSvgRef,
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
      }),
    );

    act(() => {
      result.current.setVisibleRange({ start: 2000, end: 4000 });
    });

    expect(result.current.visibleRange).toEqual({ start: 2000, end: 4000 });
  });

  it("attaches and cleans up window wheel listener", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useMeteogramZoom({
        maximumRange,
        timeline,
        hoverTime: null,
        isFullscreen: false,
        embeddedSvgRef,
        fullscreenSvgRef,
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
      }),
    );

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "wheel",
      expect.any(Function),
      {
        capture: true,
        passive: false,
      },
    );

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "wheel",
      expect.any(Function),
      {
        capture: true,
      },
    );
  });
});

describe("wheel routing when the page scrolls", () => {
  it("uses white-container geometry and leaves outside wheels uncancelled", () => {
    const container = document.createElement("div");
    container.className = "meteogram-redesign-container";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    container.append(svg);
    document.body.append(container);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      right: 600,
      bottom: 600,
      width: 500,
      height: 400,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    const height = vi
      .spyOn(document.documentElement, "clientHeight", "get")
      .mockReturnValue(700);
    const scroll = vi
      .spyOn(document.documentElement, "scrollHeight", "get")
      .mockReturnValue(1000);
    const { result, unmount } = renderHook(() =>
      useMeteogramZoom({
        maximumRange: { start: 1000, end: 1000000000 },
        timeline: { startMs: 1000, endMs: 1000000000, timestampToX: () => 500 },
        isFullscreen: false,
        embeddedSvgRef: { current: svg },
        fullscreenSvgRef: { current: null },
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
      }),
    );
    try {
      for (const [x, y] of [
        [50, 300],
        [150, 100],
        [600, 300],
        [150, 600],
      ]) {
        const event = new WheelEvent("wheel", {
          deltaY: -100,
          clientX: x,
          clientY: y,
          cancelable: true,
        });
        act(() => result.current.handleWheel(event));
        expect(event.defaultPrevented).toBe(false);
        expect(result.current.visibleRange).toBeNull();
      }
      const inside = new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 110,
        clientY: 210,
        cancelable: true,
      });
      act(() => result.current.handleWheel(inside));
      expect(inside.defaultPrevented).toBe(true);
      expect(result.current.visibleRange).not.toBeNull();
    } finally {
      unmount();
      container.remove();
      height.mockRestore();
      scroll.mockRestore();
    }
  });

  it("leaves wheel events originating inside autocomplete dropdown uncancelled", () => {
    const container = document.createElement("div");
    container.className = "meteogram-redesign-container";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    container.append(svg);
    const dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown";
    const item = document.createElement("div");
    item.className = "suggestion-item";
    dropdown.append(item);
    document.body.append(container, dropdown);

    const { result, unmount } = renderHook(() =>
      useMeteogramZoom({
        maximumRange: { start: 1000, end: 1000000000 },
        timeline: { startMs: 1000, endMs: 1000000000, timestampToX: () => 500 },
        isFullscreen: false,
        embeddedSvgRef: { current: svg },
        fullscreenSvgRef: { current: null },
        svgWidth: 1000,
        paddingLeft: 50,
        paddingRight: 50,
      }),
    );

    try {
      const event = new WheelEvent("wheel", {
        deltaY: -100,
        cancelable: true,
      });
      Object.defineProperty(event, "target", { value: item });
      act(() => result.current.handleWheel(event));
      expect(event.defaultPrevented).toBe(false);
      expect(result.current.visibleRange).toBeNull();
    } finally {
      unmount();
      container.remove();
      dropdown.remove();
    }
  });
});
