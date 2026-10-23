import { describe, expect, it } from "vitest";
import {
  buildExportSvg,
  exportLabelFontPx,
  rowFontScale,
  stackItems,
  textBaselineY,
  unionRect,
} from "./exportPng.logic";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeChartSvg(withHover: boolean) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 450");
  svg.setAttribute("class", "meteogram-svg-integrated");
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("fill", "#fef08a");
  svg.appendChild(rect);
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute(
    "data-testid",
    withHover ? "hover-crosshair-group" : "current-time-crosshair-group",
  );
  group.appendChild(document.createElementNS(SVG_NS, "line"));
  svg.appendChild(group);
  document.body.appendChild(svg);
  return svg;
}

describe("exportPng.logic", () => {
  it.each([true, false])(
    "replaces the live cursor line (hover=%s) by the generation-time line",
    (withHover) => {
      const svg = makeChartSvg(withHover);
      const clone = buildExportSvg(svg, 1200, 540, {
        x: 512.5,
        y1: 35,
        y2: 440,
        timestamp: "2026-10-16T20:45:00Z",
      });

      expect(clone.querySelector('[data-testid="hover-crosshair-group"]')).toBeNull();
      expect(
        clone.querySelector('[data-testid="current-time-crosshair-group"]'),
      ).toBeNull();
      const line = clone.querySelector('[data-testid="export-time-line"]')!;
      expect(line.getAttribute("x1")).toBe("512.5");
      expect(line.getAttribute("x2")).toBe("512.5");
      expect(line.getAttribute("y1")).toBe("35");
      expect(line.getAttribute("y2")).toBe("440");
      expect(line.getAttribute("stroke")).toBe("#f43f5e");
      expect(line.getAttribute("data-timestamp")).toBe("2026-10-16T20:45:00Z");
      // The live chart is untouched.
      expect(svg.querySelectorAll("g").length).toBe(1);
      svg.remove();
    },
  );

  it("draws no time line when the generation time is outside the visible range", () => {
    const svg = makeChartSvg(false);
    const clone = buildExportSvg(svg, 1200, 540, { x: null, y1: 35, y2: 440 });
    expect(clone.querySelector('[data-testid="export-time-line"]')).toBeNull();
    svg.remove();
  });

  it("sizes the clone in pixels, keeps the viewBox and inlines computed styles", () => {
    const svg = makeChartSvg(false);
    const clone = buildExportSvg(svg, 1200, 540, null);
    expect(clone.getAttribute("width")).toBe("1200");
    expect(clone.getAttribute("height")).toBe("540");
    expect(clone.getAttribute("viewBox")).toBe("0 0 1000 450");
    expect(clone.getAttribute("xmlns")).toBe(SVG_NS);
    expect(clone.getAttribute("class")).toBeNull();
    expect((clone.querySelector("rect") as SVGRectElement).style.getPropertyValue("display")).toBeTruthy();
    svg.remove();
  });

  it("unites chart and label row rectangles", () => {
    expect(
      unionRect([
        { left: 10, top: 20, width: 1000, height: 450 },
        { left: 10, top: 470, width: 1000, height: 19 },
      ]),
    ).toEqual({ left: 10, top: 20, width: 1000, height: 469 });
  });

  it("centres the font box in the line box to find the baseline", () => {
    // 14px line, ascent 10 + descent 3 = 13px font box -> 0.5px above.
    expect(textBaselineY(100, 14, 10, 3)).toBe(110.5);
  });

  it("sizes the PNG label like the weekday labels of the day header", () => {
    const svg = makeChartSvg(false);
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900 }) as DOMRect;
    // 11 viewBox units of a 450-unit tall viewBox drawn 900 px tall.
    expect(exportLabelFontPx(svg)).toBeCloseTo(22);
  });

  it("stacks chart and grown label rows, keeping the gaps", () => {
    const tops = stackItems([
      { rect: { top: 100, height: 400 }, height: 400 },
      { rect: { top: 510, height: 20 }, height: 40 },
    ]);
    expect(tops).toEqual([0, 410]);
    const above = stackItems([
      { rect: { top: 130, height: 400 }, height: 400 },
      { rect: { top: 100, height: 20 }, height: 40 },
    ]);
    expect(above).toEqual([50, 0]);
  });

  it("shrinks a label row when its blocks would overlap", () => {
    expect(rowFontScale(2, [200, 150], 1000)).toBe(2);
    expect(rowFontScale(2, [400, 300], 1000)).toBeCloseTo((1000 - 16) / 700);
  });
});
