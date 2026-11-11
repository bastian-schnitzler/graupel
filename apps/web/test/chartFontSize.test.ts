// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Font sizes of the chart on screen: the smallest (REQ-552), for the phone's footer links, and that of the temperature
 * extremes (REQ-587), for the row below the chart in the phone's full-screen view.
 */
import type { MeteogramController } from "@graupel/meteogram";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chartFontPx,
  EXTREMES_FONT_SIZE_PROPERTY,
  extremesFontPx,
  smallestChartFontPx,
  useExtremesFontSize,
} from "../src/state/chartFontSize.ts";

const SVG = "http://www.w3.org/2000/svg";

function chart(height: number, texts: { size: number; group?: string }[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "meteogram-svg-integrated");
  svg.setAttribute("viewBox", "0 0 1000 400");
  for (const { size, group } of texts) {
    const text = document.createElementNS(SVG, "text");
    text.setAttribute("font-size", String(size));
    if (group) {
      const g = document.createElementNS(SVG, "g");
      g.setAttribute("class", group);
      g.append(text);
      svg.append(g);
    } else svg.append(text);
  }
  svg.getBoundingClientRect = () => ({ height, width: 375 }) as DOMRect;
  return svg;
}

describe("smallestChartFontPx (REQ-552)", () => {
  it("scales the smallest font size of the texts by the chart's height on screen", () => {
    expect(smallestChartFontPx(chart(256, [{ size: 9 }, { size: 8 }, { size: 9.5 }]))).toBe(5.12);
  });

  it("leaves out the place's elevation, which only shows in the mountains", () => {
    expect(smallestChartFontPx(chart(400, [{ size: 9 }, { size: 7.5, group: "terrain-mask-label-group" }]))).toBe(9);
  });

  it("is null before layout or without texts", () => {
    expect(smallestChartFontPx(chart(0, [{ size: 9 }]))).toBeNull();
    expect(smallestChartFontPx(chart(400, []))).toBeNull();
  });
});

describe("chartFontPx", () => {
  it("scales a font size in viewBox units by the chart's height on screen, to 0.01 px", () => {
    expect(chartFontPx(chart(256, []), 9.5)).toBe(6.08);
    expect(chartFontPx(chart(300, []), 9.5)).toBe(7.13);
  });

  it("is null before layout or without a size", () => {
    expect(chartFontPx(chart(0, []), 9.5)).toBeNull();
    expect(chartFontPx(chart(256, []), 0)).toBeNull();
  });
});

/** A mounted chart: its SVG in the controller's element, the extremes in the theme's size. */
function controller(svg: SVGSVGElement, extremes = 9.5): MeteogramController {
  const element = document.createElement("div");
  element.append(svg);
  return {
    element,
    getScene: () => ({ theme: { fontSizes: { extremes } } }),
  } as unknown as MeteogramController;
}

describe("extremesFontPx (REQ-587)", () => {
  it("is the theme's size of the temperature extremes, scaled like the chart", () => {
    expect(extremesFontPx(controller(chart(256, [{ size: 8 }])))).toBe(6.08);
    expect(extremesFontPx(controller(chart(400, []), 10))).toBe(10);
  });

  it("is null without a chart or before layout", () => {
    expect(extremesFontPx(controller(chart(0, [])))).toBeNull();
    expect(
      extremesFontPx({ element: document.createElement("div"), getScene: () => ({}) } as unknown as MeteogramController),
    ).toBeNull();
  });
});

describe("useExtremesFontSize (REQ-587)", () => {
  const property = () => document.documentElement.style.getPropertyValue(EXTREMES_FONT_SIZE_PROPERTY);
  let frames: FrameRequestCallback[] = [];
  const runFrames = () => frames.splice(0).forEach((callback) => callback(0));

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty(EXTREMES_FONT_SIZE_PROPERTY);
  });

  function setUp() {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  }

  it("sets the size on the root element in the next frame, follows a new viewBox and is removed with the chart", async () => {
    setUp();
    const svg = chart(256, []);
    const ref = { current: controller(svg) };
    const { unmount } = renderHook(() => useExtremesFontSize(ref, true, "chart"));
    expect(property()).toBe("");
    runFrames();
    expect(property()).toBe("6.08px");
    // A new layout: the chart's viewBox grows, its text shrinks.
    svg.setAttribute("viewBox", "0 0 1000 512");
    await Promise.resolve();
    expect(frames).toHaveLength(1);
    runFrames();
    expect(property()).toBe("4.75px");
    unmount();
    expect(property()).toBe("");
  });

  it("keeps the last size while the chart has no layout", async () => {
    setUp();
    const svg = chart(256, []);
    const ref = { current: controller(svg) };
    renderHook(() => useExtremesFontSize(ref, true, "chart"));
    runFrames();
    expect(property()).toBe("6.08px");
    svg.getBoundingClientRect = () => ({ height: 0, width: 0 }) as DOMRect;
    svg.setAttribute("viewBox", "0 0 1000 300");
    await Promise.resolve();
    runFrames();
    expect(property()).toBe("6.08px");
    svg.getBoundingClientRect = () => ({ height: 300, width: 375 }) as DOMRect;
    svg.setAttribute("viewBox", "0 0 1000 400");
    await Promise.resolve();
    runFrames();
    expect(property()).toBe("7.13px");
  });

  it("does nothing on the desktop's view, which keeps the row's own size", () => {
    setUp();
    const ref = { current: controller(chart(256, [])) };
    renderHook(() => useExtremesFontSize(ref, false, "chart"));
    runFrames();
    expect(frames).toHaveLength(0);
    expect(property()).toBe("");
  });
});
