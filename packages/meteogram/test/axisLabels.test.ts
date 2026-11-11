// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Options `padding` and `axisLabels` of the scene: room beside the plot, the unit in a second line and the labels at
 * the chart's edges (narrow screens). Without the options the chart is drawn as before (snapshots in renderer.test).
 * Over the plot the left labels keep off the edge and the sunrise row (REQ-602), the right ones off the right edge
 * (REQ-622); the zero line has its own label (REQ-603).
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DIGIT_ASCENT, SUN_TIME_FONT_SIZE } from "../src/core/sunTimes";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import { createMeteogram } from "../src/interaction/controller";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID } from "../src/layouts/resolution";
import type { ChartLayout, LayoutArea, LayoutAxis } from "../src/layouts/types";
import {
  axisLabelBox,
  axisLabelLines,
  INSIDE_RIGHT_LABEL_INSET,
  zeroLabelCovers,
  ZERO_LABEL_MAX_OVERLAP,
} from "../src/render/axisLabels";
import { meteogramToSvgString, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, DEFAULT_PLOT_PADDING, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, textContent, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";
import { drawnNodeOf, haloOf } from "./fixtures/halo";

const staticLayer = (options: MeteogramRenderOptions = {}) =>
  renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, ...options }));

const byKey = (root: VNode, key: string) => findAll(root, (node) => node.tag === "text" && node.key === key);
const byTestIdPrefix = (root: VNode, prefix: string) =>
  findAll(root, (node) => String(node.attrs["data-testid"] ?? "").startsWith(prefix));
const lines = (node: VNode) =>
  node.children.some((child) => typeof child !== "string" && child.tag === "tspan")
    ? node.children.map(textContent)
    : [textContent(node)];

describe("axisLabelLines", () => {
  it("keeps value and unit in one line by default", () => {
    expect(axisLabelLines(11, "mm", false)).toEqual(["11 mm"]);
    expect(axisLabelLines(19, "°", false)).toEqual(["19°"]);
  });

  it("puts the unit below the value, except a degree sign or no unit", () => {
    expect(axisLabelLines(11, "mm", true)).toEqual(["11", "mm"]);
    expect(axisLabelLines("0.13", "mm", true)).toEqual(["0.13", "mm"]);
    expect(axisLabelLines(19, "°", true)).toEqual(["19°"]);
    expect(axisLabelLines(0, "", true)).toEqual(["0"]);
  });
});

describe("option padding", () => {
  it("defaults to 50 on each side; invalid values fall back to it", () => {
    for (const padding of [undefined, null, {}, { left: -1, right: Number.NaN }, { left: 500, right: 900 }]) {
      const scene = createMeteogramScene(powerInput, { ...powerOptions, padding });
      expect([scene.paddingLeft, scene.paddingRight]).toEqual([DEFAULT_PLOT_PADDING, DEFAULT_PLOT_PADDING]);
    }
  });

  it("moves the plot's edges and the time axis", () => {
    const scene = createMeteogramScene(powerInput, { ...powerOptions, padding: { left: 24, right: 16 } });
    expect(scene.paddingLeft).toBe(24);
    expect(scene.paddingRight).toBe(16);
    expect(scene.outerLeftX).toBe(24);
    expect(scene.outerRightX).toBe(984);
    expect(scene.graphWidth).toBe(960);
    expect(scene.timeline.timestampToX(scene.timeline.startMs)).toBeCloseTo(24);
    expect(scene.timeline.timestampToX(scene.timeline.endMs)).toBeCloseTo(984);
  });

  it("insets the label row like the plot", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const meteogram = createMeteogram(element, powerInput, { ...powerOptions, padding: { left: 25, right: 10 } });
    const row = element.querySelector<HTMLElement>('[data-testid="meteogram-footer-row"]')!;
    expect(row.style.paddingLeft).toBe("2.5%");
    expect(row.style.paddingRight).toBe("1%");
    meteogram.update(powerInput, powerOptions);
    const plain = element.querySelector<HTMLElement>('[data-testid="meteogram-footer-row"]')!;
    expect(plain.style.paddingLeft).toBe("5%");
    expect(plain.style.paddingRight).toBe("5%");
    meteogram.destroy();
    element.remove();
  });
});

describe("option axisLabels", () => {
  it("draws the same SVG as without the option for its defaults", () => {
    const plain = meteogramToSvgString(powerInput, powerOptions);
    expect(meteogramToSvgString(powerInput, { ...powerOptions, axisLabels: {} })).toBe(plain);
    expect(
      meteogramToSvgString(powerInput, {
        ...powerOptions,
        axisLabels: { unit: "inline", align: "plot" },
        padding: { left: 50, right: 50 },
      }),
    ).toBe(plain);
  });

  it("unit below: value and unit in two lines, a degree sign stays with its value", () => {
    const layer = staticLayer({ axisLabels: { unit: "below" } });
    const maxima = byKey(layer, "axis-max").map(lines);
    // Temperature, precipitation, wind (power layout).
    expect(maxima[0]).toHaveLength(1);
    expect(maxima[0]![0]).toMatch(/^-?\d+°$/);
    expect(maxima[1]).toEqual([expect.stringMatching(/^\d+(\.\d+)?$/), "mm"]);
    expect(maxima[2]).toEqual([expect.stringMatching(/^\d+$/), "km/h"]);
    const minima = byKey(layer, "axis-min");
    expect(lines(minima[1]!)).toEqual(["0", "mm"]);
    // The min label stands in the lower corner (REQ-738): its unit line 1 px above the area's bottom edge, where the
    // one-line label stood `minLabelOffset` (2) above it; its first line one line higher.
    const plainMin = byKey(staticLayer(), "axis-min")[1]!;
    expect(minima[1]!.attrs.y).toBeCloseTo(Number(plainMin.attrs.y) + 2 - 1 - 9 * 1.1);
    const unit = minima[1]!.children[1] as VNode;
    expect(unit.attrs.dy).toBeCloseTo(9 * 1.1);
    // Next to the plot as before.
    expect(minima[1]!.attrs.x).toBe(42);
    expect(minima[1]!.attrs["text-anchor"]).toBe("end");
    // Cloud altitudes and the right axis maximum (convective area, J/kg).
    const altitudes = byTestIdPrefix(layer, "cloud-altitude-label-");
    expect(altitudes.length).toBeGreaterThan(0);
    for (const altitude of altitudes) expect(lines(altitude)[1]).toBe("km");
    expect(lines(byKey(layer, "right-max")[0]!)).toEqual(["30", "J/kg"]);
  });

  it("edge: left labels start at x 0, right labels and altitudes end at the right edge", () => {
    const layer = staticLayer({ axisLabels: { align: "edge" }, padding: { left: 24, right: 16 } });
    expect(byKey(layer, "axis-zero")).toHaveLength(1);
    for (const key of ["axis-max", "axis-min", "zero", "axis-zero"]) {
      for (const node of byKey(layer, key)) {
        expect(node.attrs.x).toBe(0);
        expect(node.attrs["text-anchor"]).toBe("start");
      }
    }
    const right = [...byKey(layer, "right-name"), ...byKey(layer, "right-max"), ...byKey(layer, "right-min")];
    expect(right).toHaveLength(3);
    for (const node of [...right, ...byTestIdPrefix(layer, "cloud-altitude-label-")]) {
      expect(node.attrs.x).toBe(1000);
      expect(node.attrs["text-anchor"]).toBe("end");
    }
    // One line each without `unit: "below"`.
    expect(lines(byKey(layer, "axis-min")[1]!)).toEqual(["0 mm"]);
    // No halo at the edge: the labels stand beside the plot.
    for (const node of byKey(layer, "axis-max")) expect(node.attrs.stroke).toBeUndefined();
  });

  it("inside: at the edges like edge (1 unit off them), over the plot after the data, with a halo", () => {
    const layer = staticLayer({ axisLabels: { unit: "below", align: "inside" }, padding: { left: 0, right: 0 } });
    const leftKeys = ["axis-max", "axis-min", "zero", "axis-zero"];
    const left = leftKeys.flatMap((key) => byKey(layer, key));
    const right = ["right-name", "right-max", "right-min"].flatMap((key) => byKey(layer, key));
    expect(left.length).toBeGreaterThanOrEqual(6);
    expect(right).toHaveLength(3);
    // REQ-602: the left labels start 1 unit right of the chart's left edge; REQ-622: the right ones end 1 unit left
    // of its right edge.
    for (const node of left) {
      expect(node.attrs.x).toBe(1);
      expect(node.attrs["text-anchor"]).toBe("start");
    }
    for (const node of [...right, ...byTestIdPrefix(layer, "cloud-altitude-label-")]) {
      expect(node.attrs.x).toBe(999);
      expect(node.attrs["text-anchor"]).toBe("end");
    }
    // REQ-747: the halo is its own element right before the text, the text itself has no stroke.
    for (const node of [...left, ...right, ...byTestIdPrefix(layer, "cloud-altitude-label-")]) {
      const halo = haloOf(layer, node)!;
      expect(halo.attrs.stroke).toEqual(expect.any(String));
      expect(halo.attrs.fill).toBe("none");
      expect(halo.attrs["paint-order"]).toBeUndefined();
      expect(node.attrs.stroke).toBeUndefined();
    }
    // In each panel the labels (text) follow the data (groups): no group after the first label.
    const panels = findAll(layer, (node) => String(node.attrs.class ?? "").startsWith("panel "));
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      const children = panel.children.filter((child): child is VNode => typeof child !== "string");
      const isLabel = (child: VNode) => child.tag === "text" || child.attrs.class === "label-halo";
      const firstLabel = children.findIndex(isLabel);
      if (firstLabel >= 0) expect(children.slice(firstLabel).every(isLabel)).toBe(true);
    }
  });
});

const INSIDE = { axisLabels: { align: "inside" }, padding: { left: 0, right: 0 } } as const;
const AXIS_FONT = LIGHT_THEME.fontSizes.axis;
/** Height of a one-line axis label: its digits above the baseline. */
const LABEL_HEIGHT = DIGIT_ASCENT * AXIS_FONT;

const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

/** The power layout with its temperature area (`temp`) changed: its left axis and other fields. */
const temperatureLayout = (axis: Partial<LayoutAxis>, area: Partial<LayoutArea> = {}): ChartLayout => ({
  ...POWER_LAYOUT,
  areas: POWER_LAYOUT.areas.map((entry) =>
    entry.id === "temp"
      ? { ...entry, ...area, axes: { ...entry.axes, left: { ...(entry.axes?.left ?? {}), ...axis } } }
      : entry,
  ),
});

/** Scene, static layer and temperature panel of the power fixture. */
function temperature(options: MeteogramRenderOptions = {}) {
  const scene = createMeteogramScene(powerInput, { ...powerOptions, ...options });
  const layer = renderStaticLayer(scene);
  const geometry = scene.geometry.areas.find((area) => area.name === "temperature")!;
  const panel = findAll(layer, (node) => node.attrs["data-testid"] === "panel-temperature")[0]!;
  const one = (key: string) => byKey(panel, key)[0];
  const freezing = findAll(panel, (node) => node.attrs["data-testid"] === "freezing-line")[0];
  return {
    scene,
    layer,
    panel,
    top: geometry.top,
    bottom: geometry.bottom,
    max: one("axis-max"),
    min: one("axis-min"),
    zero: one("axis-zero"),
    zeroLineY: freezing ? Number(freezing.attrs.y1) : null,
  };
}

describe("left labels 1 unit off the edge (REQ-602)", () => {
  it("start at x 1 over the plot, at x 0 at the edge and next to the plot as before", () => {
    const cases = [
      [{ ...INSIDE }, 1, "start"],
      [{ axisLabels: { align: "edge" } }, 0, "start"],
      [{ axisLabels: { align: "plot" } }, DEFAULT_PLOT_PADDING - 8, "end"],
    ] as const;
    for (const [options, x, anchor] of cases) {
      const layer = staticLayer(options);
      const left = ["axis-max", "axis-min", "axis-zero"].flatMap((key) => byKey(layer, key));
      expect(left.length).toBeGreaterThanOrEqual(7);
      for (const node of left) {
        expect(node.attrs.x).toBe(x);
        expect(node.attrs["text-anchor"]).toBe(anchor);
      }
    }
  });
});

describe("right labels 1 unit off the edge (REQ-622)", () => {
  /** Labels of the right axis and the cloud altitudes, the lines of a two-line altitude (`tspan`) included. */
  const rightLabels = (layer: VNode) => {
    const axis = ["right-name", "right-max", "right-min"].flatMap((key) => byKey(layer, key));
    const altitudes = byTestIdPrefix(layer, "cloud-altitude-label-");
    const altitudeLines = altitudes.flatMap((node) => findAll(node, (child) => child.tag === "tspan"));
    return { axis, altitudes, altitudeLines };
  };

  it("end at width − 1 over the plot, at the edge with edge and next to the plot with plot as before", () => {
    const width = createMeteogramScene(powerInput, powerOptions).svgWidth;
    expect(INSIDE_RIGHT_LABEL_INSET).toBe(1);
    const cases = [
      [{ ...INSIDE }, width - 1, width - 1, "end"],
      [{ ...INSIDE, axisLabels: { align: "inside", unit: "below" } }, width - 1, width - 1, "end"],
      [{ axisLabels: { align: "edge" } }, width, width, "end"],
      [{ axisLabels: { align: "edge", unit: "below" } }, width, width, "end"],
      [{ axisLabels: { align: "plot" } }, width - DEFAULT_PLOT_PADDING + 4, width - DEFAULT_PLOT_PADDING + 8, undefined],
    ] as const;
    for (const [options, axisX, altitudeX, anchor] of cases) {
      const { axis, altitudes, altitudeLines } = rightLabels(staticLayer(options));
      expect(axis).toHaveLength(3);
      expect(altitudes.length).toBeGreaterThan(0);
      for (const node of axis) {
        expect(node.attrs.x).toBe(axisX);
        expect(node.attrs["text-anchor"]).toBe(anchor);
      }
      for (const node of [...altitudes, ...altitudeLines]) expect(node.attrs.x).toBe(altitudeX);
      for (const node of altitudes) expect(node.attrs["text-anchor"]).toBe(anchor ?? "start");
    }
  });

  it("stay 1 unit off the edge with a padding over the plot", () => {
    const layer = staticLayer({ axisLabels: { align: "inside" }, padding: { left: 24, right: 16 } });
    const { axis, altitudes } = rightLabels(layer);
    expect(axis).toHaveLength(3);
    for (const node of [...axis, ...altitudes]) expect(node.attrs.x).toBe(999);
  });
});

describe("maximum below the sunrise row (REQ-602)", () => {
  it("over the plot hangs with the top of its digits 1 unit below the sunrise row", () => {
    const { panel, top, max } = temperature(INSIDE);
    const sunrises = findAll(panel, (node) => node.attrs["data-testid"] === "sunrise");
    expect(sunrises.length).toBeGreaterThan(0);
    const sunriseBottom = Number(sunrises[0]!.attrs.y);
    // The sunrise row: digits from 1 unit below the area's top edge down to their baseline.
    expect(sunriseBottom - DIGIT_ASCENT * SUN_TIME_FONT_SIZE).toBeCloseTo(top + 1);
    const maxTop = Number(max!.attrs.y) - LABEL_HEIGHT;
    expect(maxTop).toBeCloseTo(sunriseBottom + 1, 2);
    expect(max!.attrs["font-size"]).toBe(AXIS_FONT);
  });

  it("stays where it was without sun times, beside the plot and in areas without them", () => {
    const withSun = temperature(INSIDE);
    // With sun times it moved down from its place.
    expect(Number(withSun.max!.attrs.y)).toBeGreaterThan(withSun.top + 14);
    const withoutSun = temperature({ ...INSIDE, layout: temperatureLayout({}, { sunTimes: false }) });
    expect(withoutSun.max!.attrs.y).toBe(withoutSun.top + 14);
    expect(byKey(withoutSun.panel, "axis-max")).toHaveLength(1);
    for (const align of ["edge", "plot"] as const) {
      const beside = temperature({ axisLabels: { align } });
      expect(beside.max!.attrs.y).toBe(beside.top + 14);
    }
    // The other areas of the power layout draw no sun times: their maxima keep their place over the plot as well.
    const scene = createMeteogramScene(powerInput, { ...powerOptions, ...INSIDE });
    const layer = renderStaticLayer(scene);
    let others = 0;
    for (const area of scene.geometry.areas.filter((entry) => !entry.area.sunTimes)) {
      const panel = findAll(layer, (node) => node.attrs["data-area-id"] === area.area.id)[0]!;
      for (const node of byKey(panel, "axis-max")) {
        expect(node.attrs.y).toBe(area.top + 14);
        others++;
      }
    }
    expect(others).toBeGreaterThan(0);
  });
});

describe("label of the zero line (REQ-603)", () => {
  for (const [name, theme] of [
    ["light", LIGHT_THEME],
    ["dark", DARK_THEME],
  ] as const) {
    it(`reads 0 with the unit in grid.freezingLine and the axis font size, centred on the line (${name})`, () => {
      const { zero, zeroLineY, max, min } = temperature({ theme: name });
      expect(zero).toBeDefined();
      expect(textContent(zero!)).toBe("0°");
      expect(zero!.attrs.fill).toBe(theme.grid.freezingLine);
      expect(zero!.attrs["font-size"]).toBe(theme.fontSizes.axis);
      expect(zero!.attrs["data-testid"]).toBe("axis-zero");
      // Centre of its digits on the zero line.
      expect(Number(zero!.attrs.y) - LABEL_HEIGHT / 2).toBeCloseTo(zeroLineY!, 2);
      // Beside the plot without a halo, like the maximum and minimum it stands with.
      expect(zero!.attrs.stroke).toBeUndefined();
      expect([zero!.attrs.x, zero!.attrs["text-anchor"]]).toEqual([max!.attrs.x, max!.attrs["text-anchor"]]);
      expect([zero!.attrs.x, zero!.attrs["text-anchor"]]).toEqual([min!.attrs.x, min!.attrs["text-anchor"]]);
    });
  }

  it("follows the axis font size and the unit option like the other labels", () => {
    const { zero } = temperature({
      theme: { fontSizes: { ...LIGHT_THEME.fontSizes, axis: 11 } },
      axisLabels: { unit: "below" },
    });
    expect(zero!.attrs["font-size"]).toBe(11);
    // A degree sign stays with the value.
    expect(lines(zero!)).toEqual(["0°"]);
  });

  it("over the plot has the halo of the other labels and is drawn after the data", () => {
    const { zero, max, panel } = temperature(INSIDE);
    const halo = haloOf(panel, zero!)!;
    expect(halo.attrs.stroke).toBe(LIGHT_THEME.background);
    for (const attr of ["stroke-width", "stroke-linejoin"]) {
      expect(halo.attrs[attr]).toBe(haloOf(panel, max!)!.attrs[attr]);
    }
    const children = panel.children.filter((child): child is VNode => typeof child !== "string");
    expect(children.indexOf(drawnNodeOf(panel, zero!))).toBeGreaterThan(
      children.findIndex((child) => child.attrs["data-testid"] === "temperature-plot-area"),
    );
  });

  it("is kept inside the area when the zero line lies at its edge", () => {
    // An axis without paddings (preset of `cape`) puts 0 exactly on the area's top or bottom edge.
    for (const [range, edge] of [
      [{ min: -10, max: 0 }, "top"],
      [{ min: 0, max: 10 }, "bottom"],
    ] as const) {
      for (const options of [{}, INSIDE, { axisLabels: { align: "edge" } }] as const) {
        const layout = temperatureLayout({ quantity: "cape", range: "fixed", ...range }, { sunTimes: false });
        const { zero, zeroLineY, top, bottom } = temperature({ ...options, layout });
        expect(zeroLineY).toBeCloseTo(edge === "top" ? top : bottom);
        const y = Number(zero!.attrs.y);
        expect(y - LABEL_HEIGHT).toBeGreaterThanOrEqual(top - 1e-6);
        expect(y).toBeLessThanOrEqual(bottom + 1e-6);
        expect(edge === "top" ? y - LABEL_HEIGHT : y).toBeCloseTo(edge === "top" ? top : bottom, 2);
      }
    }
  });

  it("over the plot of an area with sun times stays below the sunrise row, where the maximum would hang", () => {
    const layout = temperatureLayout({ quantity: "cape", range: "fixed", min: -10, max: 0 });
    const { zero, panel } = temperature({ ...INSIDE, layout });
    const plain = temperature(INSIDE);
    expect(byKey(panel, "axis-max")).toHaveLength(0);
    expect(zero!.attrs.y).toBe(plain.max!.attrs.y);
  });

  it("replaces a maximum or minimum of 0 (0 °C at the top or bottom of the axis)", () => {
    const top = temperature({ layout: temperatureLayout({ range: "fixed", min: -15, max: 0 }) });
    expect(top.zero).toBeDefined();
    expect(top.max).toBeUndefined();
    expect(textContent(top.min!)).toBe("-15°");
    const bottom = temperature({ layout: temperatureLayout({ range: "fixed", min: 0, max: 15 }) });
    expect(bottom.zero).toBeDefined();
    expect(bottom.min).toBeUndefined();
    expect(textContent(bottom.max!)).toBe("15°");
  });

  it("leaves out a maximum or minimum it covers by more than 20 % of its height; up to 20 % both stay", () => {
    const outcomes = { hidden: 0, partlyCovered: 0 };
    // 0 °C moves from just above the bottom to just below the top of the area.
    const ranges = [
      ...[8, 12, 15, 17, 18, 21, 30, 60].map((max) => ({ min: -1, max })),
      ...[8, 12, 15, 17, 18, 21, 30, 60].map((min) => ({ min: -min, max: 1 })),
    ];
    // Axes without paddings (`cape`) reach the maximum's place as well.
    for (const quantity of ["temperature", "cape"]) {
      for (const range of ranges) {
        const layout = temperatureLayout({ quantity, range: "fixed", ...range }, { sunTimes: false });
        const { zero, max, min, top, bottom, scene } = temperature({ layout });
        const scale = scene.areaScales[0]!.left!;
        const zeroBox = { top: Number(zero!.attrs.y) - LABEL_HEIGHT, bottom: Number(zero!.attrs.y) };
        const maxBox = { top: top + 14 - LABEL_HEIGHT, bottom: top + 14 };
        const minY = bottom - scale.preset.minLabelOffset;
        const minBox = { top: minY - LABEL_HEIGHT, bottom: minY };
        for (const [label, box] of [
          [max, maxBox],
          [min, minBox],
        ] as const) {
          const overlap = Math.max(0, Math.min(zeroBox.bottom, box.bottom) - Math.max(zeroBox.top, box.top));
          const share = overlap / LABEL_HEIGHT;
          if (share > ZERO_LABEL_MAX_OVERLAP + 1e-6) {
            expect(label, `${quantity} ${JSON.stringify(range)}: ${share}`).toBeUndefined();
            outcomes.hidden++;
          } else if (share < ZERO_LABEL_MAX_OVERLAP - 1e-6) {
            expect(label, `${quantity} ${JSON.stringify(range)}: ${share}`).toBeDefined();
            if (share > 0) outcomes.partlyCovered++;
          }
        }
      }
    }
    // Both sides of the rule occur.
    expect(outcomes.hidden).toBeGreaterThan(0);
    expect(outcomes.partlyCovered).toBeGreaterThan(0);
  });

  it("covers a label by more than 20 % only above that share (zeroLabelCovers)", () => {
    const label = axisLabelBox(100, 1, AXIS_FONT, "bottom");
    const height = label.bottom - label.top;
    const zeroAt = (overlap: number) => ({ top: label.bottom - overlap, bottom: label.bottom - overlap + height });
    expect(zeroLabelCovers(zeroAt(0), label)).toBe(false);
    expect(zeroLabelCovers(zeroAt(0.1 * height), label)).toBe(false);
    expect(zeroLabelCovers(zeroAt(0.2 * height), label)).toBe(false);
    expect(zeroLabelCovers(zeroAt(0.21 * height), label)).toBe(true);
    expect(zeroLabelCovers(zeroAt(height), label)).toBe(true);
    // Two-line labels count their whole height.
    const twoLines = axisLabelBox(100, 2, AXIS_FONT, "top");
    expect(twoLines.bottom - twoLines.top).toBeCloseTo(LABEL_HEIGHT + AXIS_FONT * 1.1);
  });

  it("is absent without 0 in the axis range and on axes without zeroLine", () => {
    const warm = temperature({ layout: temperatureLayout({ range: "fixed", min: 5, max: 25 }) });
    expect(warm.zeroLineY).toBeNull();
    expect(warm.zero).toBeUndefined();
    expect(warm.max).toBeDefined();
    expect(warm.min).toBeDefined();
    const cold = temperature({ layout: temperatureLayout({ range: "fixed", min: -25, max: -5 }) });
    expect(cold.zero).toBeUndefined();
    const noLine = temperature({ layout: temperatureLayout({ zeroLine: false }) });
    expect(noLine.zero).toBeUndefined();
    expect(noLine.max).toBeDefined();
    expect(noLine.min).toBeDefined();
    // Only the temperature axis of the power layout has a zero line: one zero label in the whole chart.
    expect(byKey(staticLayer(), "axis-zero")).toHaveLength(1);
    // Hidden axis labels hide it as well.
    expect(temperature({ layout: temperatureLayout({ showLabels: false }) }).zero).toBeUndefined();
  });
});
