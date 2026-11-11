// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/** PNG export logic and the canvas composition with fakes. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMeteogram } from "../src/interaction/controller";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import { POWER_DEFAULT_LAYOUT_ID } from "../src/layouts/resolution";
import { meteogramToPng, renderMeteogramPng } from "../src/png/index";
import { normalInput, powerInput, powerOptions } from "./fixtures/meteogramFixtures";
import {
  buildExportSvg,
  exportLabelFontPx,
  rowFontScale,
  stackItems,
  textBaselineY,
  unionRect,
} from "../src/png/exportPng";

const SVG_NS = "http://www.w3.org/2000/svg";
const POWER_LAYOUT = BUILTIN_LAYOUTS.find((layout) => layout.id === POWER_DEFAULT_LAYOUT_ID)!;

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

// --- canvas composition (jsdom has no canvas: fake context, image and blob) ---

interface FakeContext {
  calls: [string, ...unknown[]][];
  fillStyle: string;
  font: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
}

function fakeCanvas() {
  const contexts: FakeContext[] = [];
  const canvases: HTMLCanvasElement[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvases.push(this);
    const calls: [string, ...unknown[]][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      };
    const context = {
      calls,
      fillStyle: "",
      font: "",
      textBaseline: "",
      imageSmoothingEnabled: true,
      scale: record("scale"),
      save: record("save"),
      restore: record("restore"),
      setTransform: record("setTransform"),
      fillRect: (...args: unknown[]) => calls.push(["fillRect", context.fillStyle, ...args]),
      drawImage: record("drawImage"),
      fillText: (...args: unknown[]) => calls.push(["fillText", context.font, ...args]),
      measureText: (text: string) => ({
        width: text.length * 6,
        fontBoundingBoxAscent: 9,
        fontBoundingBoxDescent: 3,
      }),
    };
    contexts.push(context);
    return context as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  const sources: string[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      sources.push(value);
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal("Image", FakeImage);
  return { contexts, canvases, sources };
}

function box(element: Element, rect: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("renderMeteogramPng", () => {
  it("draws the chart image and the label row text on a scaled canvas", async () => {
    const { contexts, canvases, sources } = fakeCanvas();
    const svg = makeChartSvg(true);
    box(svg, { left: 0, top: 0, width: 500, height: 225 });
    const row = document.body.appendChild(document.createElement("div"));
    row.style.fontSize = "11px";
    const label = row.appendChild(document.createElement("span"));
    label.textContent = "Testort";
    const skipped = row.appendChild(document.createElement("div"));
    skipped.setAttribute("data-export-skip", "true");
    skipped.textContent = "buttons";
    box(row, { left: 0, top: 225, width: 500, height: 19 });
    box(label, { left: 25, top: 227, width: 60, height: 14 });
    box(skipped, { left: 200, top: 227, width: 60, height: 14 });

    const blob = await renderMeteogramPng({
      svg,
      textRows: [row],
      timeLine: { x: 400, y1: 35, y2: 440, timestamp: "2026-10-15T06:17:00Z" },
      scale: 2,
      background: "#101010",
    });
    expect(blob.type).toBe("image/png");
    expect(canvases[0]!.width).toBe(1000);
    expect(canvases[0]!.height).toBe((225 + 19) * 2);
    const calls = contexts[0]!.calls;
    expect(calls).toContainEqual(["fillRect", "#101010", 0, 0, 500, 244]);
    const draw = calls.find(([name]) => name === "drawImage")!;
    expect(draw.slice(2)).toEqual([0, 0, 1000, 450]);
    const markup = decodeURIComponent(sources[0]!.split(",")[1]!);
    expect(markup).toContain('data-testid="export-time-line"');
    expect(markup).not.toContain("hover-crosshair-group");
    const texts = calls.filter(([name]) => name === "fillText").map((call) => call[2]);
    expect(texts).toEqual(["Testort"]);
  });
});

describe("renderMeteogramPng: centre label", () => {
  it("keeps a block marked as centred in the middle of its place", async () => {
    const { contexts } = fakeCanvas();
    const svg = makeChartSvg(true);
    box(svg, { left: 0, top: 0, width: 500, height: 225 });
    const row = document.body.appendChild(document.createElement("div"));
    row.style.fontSize = "11px";
    const label = row.appendChild(document.createElement("span"));
    label.textContent = "Ort";
    const centre = row.appendChild(document.createElement("span"));
    centre.textContent = "graupel.eu";
    centre.setAttribute("data-export-align", "center");
    const end = row.appendChild(document.createElement("span"));
    end.textContent = "Daten";
    box(row, { left: 0, top: 225, width: 500, height: 19 });
    box(label, { left: 25, top: 227, width: 150, height: 14 });
    box(centre, { left: 220, top: 227, width: 60, height: 14 });
    box(end, { left: 325, top: 227, width: 150, height: 14 });

    await renderMeteogramPng({ svg, textRows: [row], timeLine: null, scale: 1 });
    const texts = contexts[0]!.calls.filter(([name]) => name === "fillText");
    const xOf = (text: string) => texts.find((call) => call[2] === text)![3] as number;
    // measureText of the fake canvas: 6 px per character.
    expect(xOf("Ort")).toBe(25);
    expect(xOf("graupel.eu")).toBe(250 - 30);
    expect(xOf("Daten")).toBe(475 - 30);
  });
});

describe("meteogramToPng", () => {
  it("exports a mounted meteogram with its label row and generation-time line", async () => {
    const { contexts, sources } = fakeCanvas();
    const host = document.body.appendChild(document.createElement("div"));
    host.style.background = "rgb(1, 2, 3)";
    const meteogram = createMeteogram(host, powerInput, powerOptions);
    const svg = host.querySelector("svg")!;
    const row = host.querySelector('[data-testid="meteogram-footer-row"]')!;
    box(svg, { left: 0, top: 0, width: 800, height: 400 });
    box(row, { left: 0, top: 400, width: 800, height: 19 });
    for (const child of Array.from(row.children)) box(child, { left: 40, top: 402, width: 100, height: 14 });

    const sourcesOf = meteogram.getExportSources();
    expect(sourcesOf.svg).toBe(svg);
    expect(sourcesOf.textRows).toEqual([row]);
    const scene = meteogram.getScene();
    expect(sourcesOf.timeLine).toMatchObject({
      x: scene.getX(powerInput.generatedAt!),
      y1: scene.geometry.dayHeaderTop,
      y2: scene.geometry.plotBottom,
    });

    const blob = await meteogramToPng(meteogram, { scale: 1 });
    expect(blob.type).toBe("image/png");
    // The label row takes the weekday font size of the day header (11 px row font).
    const background = contexts[0]!.calls.find(([name]) => name === "fillRect")!;
    expect(background.slice(0, 5)).toEqual(["fillRect", "rgb(1, 2, 3)", 0, 0, 800]);
    expect(background[5]).toBeCloseTo(400 + (19 * exportLabelFontPx(svg)!) / 11);
    const markup = decodeURIComponent(sources[0]!.split(",")[1]!);
    expect(markup).toContain('data-testid="export-time-line"');
    expect(markup).not.toContain("current-time-crosshair-group");
    // Dashed lines keep their pieces with whole dash periods, so the picture shows the same dashes (REQ-579).
    const pieces = svg.querySelectorAll('path[pathLength][data-testid="apparent-temperature-path"]').length;
    expect(pieces).toBeGreaterThan(1);
    expect(markup.match(/pathLength="\d+"[^>]*data-testid="apparent-temperature-path"/g)).toHaveLength(pieces);
    meteogram.destroy();
  });

  /** Every SVG of the page measures `width` x `height` (the export picture is a second SVG in the page). */
  const measureSvgs = (width: number, height: number) =>
    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height, toJSON: () => ({}),
    } as DOMRect);
  const arrowsIn = (markup: string) => markup.match(/data-testid="wind-arrow"/g)?.length ?? 0;

  it("spaces the picture's wind arrows for wide days, the chart on screen keeps its own (REQ-538)", async () => {
    const { sources } = fakeCanvas();
    measureSvgs(150, 100);
    const host = document.body.appendChild(document.createElement("div"));
    const meteogram = createMeteogram(host, powerInput, powerOptions);
    const live = host.querySelector("svg")!;
    const onScreen = live.querySelectorAll('[data-testid="wind-arrow"]').length;
    expect(onScreen).toBeGreaterThan(0);

    // Days of 45 px on screen: a picture for days of at least 90 px has twice as many arrows.
    const picture = meteogram.getExportSources({ minDayWidthPx: 90 });
    expect(picture.svg).not.toBe(live);
    expect(picture.svg!.isConnected).toBe(true);
    expect(live.style.display).toBe("none");
    const glyph = picture.svg!.querySelector('[data-testid="wind-icon-glyph"]')!;
    expect(Number(glyph.getAttribute("data-rendered-width"))).toBeGreaterThan(150 * 1.9);
    expect(picture.svg!.querySelectorAll('[data-testid="wind-arrow"]').length).toBeGreaterThanOrEqual(2 * onScreen - 3);
    picture.release!();
    expect(picture.svg!.isConnected).toBe(false);
    expect(live.style.display).toBe("block");
    expect(meteogram.element.querySelectorAll(":scope > svg")).toHaveLength(1);

    // Wide enough days: the chart itself, nothing to put back.
    const same = meteogram.getExportSources({ minDayWidthPx: 20 });
    expect(same.svg).toBe(live);
    expect(same.release).toBeUndefined();

    // The PNG takes the default (three arrows a day) and puts the chart back right away.
    await meteogramToPng(meteogram, { scale: 1 });
    expect(arrowsIn(decodeURIComponent(sources[0]!.split(",")[1]!))).toBeGreaterThan(onScreen);
    expect(meteogram.element.querySelectorAll(":scope > svg")).toHaveLength(1);
    expect(live.style.display).toBe("block");
    expect(live.querySelectorAll('[data-testid="wind-arrow"]').length).toBe(onScreen);
    await meteogramToPng(meteogram, { scale: 1, minDayWidthPx: 0 });
    expect(arrowsIn(decodeURIComponent(sources[1]!.split(",")[1]!))).toBe(onScreen);
    meteogram.destroy();
  });

  it("draws the picture with its own render options, e.g. without model headers (REQ-539)", async () => {
    const { sources } = fakeCanvas();
    measureSvgs(800, 400);
    const host = document.body.appendChild(document.createElement("div"));
    const meteogram = createMeteogram(host, powerInput, powerOptions);
    const live = host.querySelector("svg")!;
    expect(live.querySelectorAll('[data-testid="model-header-label"]').length).toBeGreaterThan(0);

    const picture = meteogram.getExportSources({ render: { layout: { ...POWER_LAYOUT, showModelHeaders: false } } });
    expect(picture.svg).not.toBe(live);
    expect(picture.svg!.querySelector('[data-testid="model-header-label"]')).toBeNull();
    // The time line reaches the picture's own day header.
    expect(picture.timeLine!.y1).toBeLessThan(meteogram.getExportSources().timeLine!.y1);
    picture.release!();

    await meteogramToPng(meteogram, { scale: 1, render: { layout: { ...POWER_LAYOUT, showModelHeaders: false } } });
    expect(decodeURIComponent(sources[0]!.split(",")[1]!)).not.toContain("model-header-label");
    expect(live.querySelectorAll('[data-testid="model-header-label"]').length).toBeGreaterThan(0);
    expect(meteogram.element.querySelectorAll(":scope > svg")).toHaveLength(1);
    meteogram.destroy();
  });

  it("rejects without a chart", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const meteogram = createMeteogram(host, { ...normalInput, series: [], timeline: {} },
      { now: 0, onLayoutWarning: () => undefined },);
    await expect(meteogramToPng(meteogram)).rejects.toThrow("no chart");
    meteogram.destroy();
  });
});
