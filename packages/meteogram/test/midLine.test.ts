// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Guide line at half the wind axis (REQ-653, DEC-060): axis property `midLine` of a left axis, a thin dashed line in
 * the grid colour at `(min + max) / 2` behind the series and arrows, labelled on the left with its value rounded to a
 * whole number and the unit, a step fainter than the other labels; left out (the label only) where it would touch
 * the maximum or minimum.
 */
import { describe, expect, it } from "vitest";
import { valueToY } from "../src/core/chartGeometry";
import { DIGIT_ASCENT } from "../src/core/sunTimes";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import {
  getBuiltinLayout,
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  resolveChartLayout,
  validateChartLayout,
} from "../src/layouts/resolution";
import type { ChartLayout, LayoutArea, LayoutAxis } from "../src/layouts/types";
import { axisLabelBox, MID_LABEL_GAP, midLabelCrowds } from "../src/render/axisLabels";
import { MID_LINE_DASH_ARRAY } from "../src/render/chartArea";
import { renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, DEFAULT_PLOT_PADDING, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, textContent, type VNode } from "../src/render/vnode";
import { normalInput, normalOptions, powerInput, powerOptions } from "./fixtures/meteogramFixtures";
import { drawnNodeOf, haloOf } from "./fixtures/halo";

const AXIS_FONT = LIGHT_THEME.fontSizes.axis;
/** Height of a one-line axis label: its digits above the baseline. */
const LABEL_HEIGHT = DIGIT_ASCENT * AXIS_FONT;
const INSIDE = { axisLabels: { align: "inside" }, padding: { left: 0, right: 0 } } as const;

const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

/** The power layout with its wind area changed: its left axis and other fields. */
const windLayout = (axis: Partial<LayoutAxis>, area: Partial<LayoutArea> = {}): ChartLayout => ({
  ...POWER_LAYOUT,
  areas: POWER_LAYOUT.areas.map((entry) =>
    entry.id === "wind"
      ? { ...entry, ...area, axes: { ...entry.axes, left: { ...(entry.axes?.left ?? {}), ...axis } } }
      : entry,
  ),
});

const byTestId = (root: VNode, testId: string) => findAll(root, (node) => node.attrs["data-testid"] === testId);
const lines = (node: VNode) =>
  node.children.some((child) => typeof child !== "string" && child.tag === "tspan")
    ? node.children.map(textContent)
    : [textContent(node)];

/** Scene, wind panel, guide line and labels of a fixture (default power). */
function wind(options: MeteogramRenderOptions = {}, input = powerInput, base = powerOptions) {
  const scene = createMeteogramScene(input, { ...base, ...options });
  const layer = renderStaticLayer(scene);
  const index = scene.geometry.areas.findIndex((area) => area.name === "wind");
  const geometry = scene.geometry.areas[index]!;
  const scale = scene.areaScales[index]!.left!;
  const panel = findAll(layer, (node) => node.attrs["data-area-id"] === "wind")[0]!;
  const one = (key: string) => findAll(panel, (node) => node.tag === "text" && node.key === key)[0];
  return {
    scene,
    layer,
    panel,
    geometry,
    scale,
    line: byTestId(panel, "wind-mid-line")[0],
    label: one("axis-mid"),
    max: one("axis-max"),
    min: one("axis-min"),
  };
}

describe("layout property midLine", () => {
  it("is set on the left axis of the wind area of both built-in layouts, nowhere else", () => {
    for (const layout of BUILTIN_LAYOUTS) {
      for (const area of layout.areas) {
        expect(area.axes?.left?.midLine ?? false, `${layout.id} ${area.id}`).toBe(area.id === "wind");
        expect(area.axes?.right?.midLine).toBeUndefined();
      }
    }
    expect(BUILTIN_LAYOUTS.map((layout) => layout.id)).toEqual(
      expect.arrayContaining([POWER_DEFAULT_LAYOUT_ID, NORMAL_LAYOUT_ID]),
    );
  });

  it("defaults to false and must be a boolean", () => {
    const { layout } = resolveChartLayout(windLayout({ midLine: undefined }));
    expect(layout.areas.find((area) => area.id === "wind")!.axes.left!.midLine).toBe(false);
    expect(layout.areas.find((area) => area.id === "temp")!.axes.left!.midLine).toBe(false);
    expect(resolveChartLayout(POWER_LAYOUT).layout.areas.find((area) => area.id === "wind")!.axes.left!.midLine).toBe(
      true,
    );
    expect(validateChartLayout(windLayout({ midLine: true }))).toEqual([]);
    expect(validateChartLayout(windLayout({ midLine: "yes" as unknown as boolean }))).toEqual([
      expect.stringContaining("midLine must be true or false"),
    ]);
  });
});

describe("guide line at half the wind axis (REQ-653)", () => {
  it("lies at half the axis maximum, halfway between the axis' 0 and maximum", () => {
    const { line, scale, scene } = wind();
    expect(line).toBeDefined();
    expect(scale.min).toBe(0);
    const y = Number(line!.attrs.y1);
    expect(line!.attrs.y2).toBe(line!.attrs.y1);
    expect(Number(line!.attrs["data-value"])).toBe(scale.max / 2);
    expect(y).toBeCloseTo(valueToY(scale, scale.max / 2), 2);
    // Halfway between the heights of 0 and the maximum: half the height the values are drawn in.
    expect(y).toBeCloseTo((valueToY(scale, 0) + valueToY(scale, scale.max)) / 2, 2);
    // Across the whole plot width.
    expect(line!.attrs.x1).toBe(scene.paddingLeft);
    expect(line!.attrs.x2).toBe(scene.svgWidth - scene.paddingRight);
  });

  it("is thin and dashed in the grid colour, clipped to the area", () => {
    const { line } = wind();
    expect(line!.tag).toBe("line");
    expect(line!.attrs["stroke-width"]).toBe(1);
    expect(line!.attrs["stroke-dasharray"]).toBe(MID_LINE_DASH_ARRAY);
    expect(line!.attrs.stroke).toBe(LIGHT_THEME.grid.line);
    expect(String(line!.attrs["clip-path"])).toMatch(/^url\(#wind-clip-/);
  });

  for (const [name, theme] of [
    ["light", LIGHT_THEME],
    ["dark", DARK_THEME],
  ] as const) {
    it(`takes grid.line and a fainter label colour axis.midLabel (${name})`, () => {
      const { line, label, max } = wind({ theme: name });
      expect(line!.attrs.stroke).toBe(theme.grid.line);
      expect(label!.attrs.fill).toBe(theme.axis.midLabel);
      expect(label!.attrs.fill).not.toBe(max!.attrs.fill);
      expect(label!.attrs["font-size"]).toBe(theme.fontSizes.axis);
    });
  }

  it("follows theme overrides", () => {
    const { line, label } = wind({ theme: { grid: { line: "#ff00ff" }, axis: { midLabel: "#00ff00" } } });
    expect(line!.attrs.stroke).toBe("#ff00ff");
    expect(label!.attrs.fill).toBe("#00ff00");
  });

  it("is drawn behind the curves and the wind arrows", () => {
    const { panel, line } = wind();
    const children = panel.children.filter((child): child is VNode => typeof child !== "string");
    const lineIndex = children.indexOf(line!);
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    const plot = children.findIndex((child) => child.attrs["data-testid"] === "wind-plot-area");
    const curves = children.findIndex((child) => byTestId(child, "wind-speed-path").length > 0);
    const arrows = children.findIndex((child) => byTestId(child, "wind-arrow-group").length > 0);
    expect(plot).toBeGreaterThan(lineIndex);
    expect(curves).toBeGreaterThan(lineIndex);
    expect(arrows).toBeGreaterThan(lineIndex);
  });

  it("is absent without midLine; only the wind area has one", () => {
    const off = wind({ layout: windLayout({ midLine: false }) });
    expect(off.line).toBeUndefined();
    expect(off.label).toBeUndefined();
    expect(off.max).toBeDefined();
    expect(off.min).toBeDefined();
    const all = wind();
    expect(findAll(all.layer, (node) => String(node.attrs["data-testid"] ?? "").endsWith("-mid-line"))).toHaveLength(1);
    expect(byTestId(all.layer, "axis-mid")).toHaveLength(1);
  });

  it("stays, without its label, when the axis labels are hidden", () => {
    const { line, label, max } = wind({ layout: windLayout({ showLabels: false }) });
    expect(line).toBeDefined();
    expect(label).toBeUndefined();
    expect(max).toBeUndefined();
  });
});

describe("label of the guide line (REQ-653, DEC-060)", () => {
  it("reads 38 km/h at a 75 km/h axis (line at 37.5 km/h)", () => {
    // The normal fixture's wind reaches the 75 km/h step.
    const { scale, line, label, max } = wind({}, normalInput, normalOptions);
    expect(scale.max).toBe(75);
    expect(textContent(max!)).toBe("75 km/h");
    expect(Number(line!.attrs["data-value"])).toBe(37.5);
    expect(textContent(label!)).toBe("38 km/h");
    expect(label!.attrs["data-testid"]).toBe("axis-mid");
  });

  it("is rounded to a whole number like the other labels", () => {
    for (const [max, text, value] of [
      [75, "38 km/h", 37.5],
      [30, "15 km/h", 15],
      [15, "8 km/h", 7.5],
      [40, "20 km/h", 20],
    ] as const) {
      const { line, label } = wind({ layout: windLayout({ range: "fixed", min: 0, max }) });
      expect(Number(line!.attrs["data-value"])).toBe(value);
      expect(textContent(label!), `${max}`).toBe(text);
    }
    // The power fixture's own axis.
    expect(textContent(wind().label!)).toBe("20 km/h");
  });

  it("is centred on the line", () => {
    for (const options of [{}, INSIDE, { axisLabels: { align: "edge" } }] as const) {
      const { line, label } = wind(options);
      expect(Number(label!.attrs.y) - LABEL_HEIGHT / 2).toBeCloseTo(Number(line!.attrs.y1), 1);
    }
  });

  it("stands where the other left labels stand in every align mode", () => {
    const cases = [
      [{}, DEFAULT_PLOT_PADDING - 8, "end"],
      [{ axisLabels: { align: "plot" } }, DEFAULT_PLOT_PADDING - 8, "end"],
      [{ axisLabels: { align: "edge" } }, 0, "start"],
      [{ axisLabels: { align: "edge" }, padding: { left: 24, right: 16 } }, 0, "start"],
      [INSIDE, 1, "start"],
    ] as const;
    for (const [options, x, anchor] of cases) {
      const { label, max, min } = wind(options);
      expect(label, JSON.stringify(options)).toBeDefined();
      expect(label!.attrs.x).toBe(x);
      expect(label!.attrs["text-anchor"]).toBe(anchor);
      for (const other of [max!, min!]) {
        expect([label!.attrs.x, label!.attrs["text-anchor"]]).toEqual([other.attrs.x, other.attrs["text-anchor"]]);
      }
    }
  });

  it("over the plot has the halo of the other labels and is drawn after the data", () => {
    const { label, max, panel } = wind(INSIDE);
    const halo = haloOf(panel, label!)!;
    expect(halo.attrs.stroke).toBe(LIGHT_THEME.background);
    for (const attr of ["stroke", "stroke-width", "stroke-linejoin"]) {
      expect(halo.attrs[attr]).toBe(haloOf(panel, max!)!.attrs[attr]);
    }
    const children = panel.children.filter((child): child is VNode => typeof child !== "string");
    expect(children.indexOf(drawnNodeOf(panel, label!))).toBeGreaterThan(
      children.findIndex((child) => child.attrs["data-testid"] === "wind-plot-area"),
    );
    // Beside the plot without a halo.
    const beside = wind();
    expect(beside.label!.attrs.stroke).toBeUndefined();
    expect(haloOf(beside.panel, beside.label!)).toBeUndefined();
  });

  it("puts the unit below the value with unit below, its box centred on the line", () => {
    for (const align of ["plot", "edge", "inside"] as const) {
      const padding = align === "inside" ? INSIDE.padding : undefined;
      const { label, line } = wind({ axisLabels: { unit: "below", align }, padding });
      expect(lines(label!)).toEqual(["20", "km/h"]);
      const box = axisLabelBox(Number(label!.attrs.y), 2, AXIS_FONT, "top");
      expect((box.top + box.bottom) / 2).toBeCloseTo(Number(line!.attrs.y1), 1);
    }
  });

  it("is left out in an area too short for three labels; the line stays", () => {
    const outcomes = { shown: 0, hidden: 0 };
    for (const heightWeight of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.7, 1.05]) {
      for (const unit of ["inline", "below"] as const) {
        const { line, label, max, min, scale, geometry } = wind({
          layout: windLayout({}, { heightWeight }),
          axisLabels: { unit },
        });
        expect(line).toBeDefined();
        expect(Number(line!.attrs.y1)).toBeCloseTo(valueToY(scale, scale.max / 2), 2);
        expect(max).toBeDefined();
        expect(min).toBeDefined();
        const lineCount = unit === "below" ? 2 : 1;
        const maxBox = axisLabelBox(Number(max!.attrs.y), lineCount, AXIS_FONT, "top");
        const minBox = axisLabelBox(Number(min!.attrs.y), lineCount, AXIS_FONT, "bottom");
        const height = axisLabelBox(0, lineCount, AXIS_FONT, "top");
        const centre = valueToY(scale, scale.max / 2);
        const midBox = { top: centre - (height.bottom - height.top) / 2, bottom: centre + (height.bottom - height.top) / 2 };
        const fits =
          midBox.top >= maxBox.bottom + MID_LABEL_GAP &&
          midBox.bottom <= minBox.top - MID_LABEL_GAP &&
          midBox.top >= geometry.top &&
          midBox.bottom <= geometry.bottom;
        if (fits) {
          expect(label, `${heightWeight} ${unit}`).toBeDefined();
          outcomes.shown++;
        } else {
          expect(label, `${heightWeight} ${unit}`).toBeUndefined();
          outcomes.hidden++;
        }
      }
    }
    // Both sides of the rule occur.
    expect(outcomes.shown).toBeGreaterThan(0);
    expect(outcomes.hidden).toBeGreaterThan(0);
  });

  it("crowds a label it overlaps or comes closer to than MID_LABEL_GAP (midLabelCrowds)", () => {
    const label = { top: 100, bottom: 106.48 };
    const below = (gap: number) => ({ top: label.bottom + gap, bottom: label.bottom + gap + 6.48 });
    const above = (gap: number) => ({ top: label.top - gap - 6.48, bottom: label.top - gap });
    expect(MID_LABEL_GAP).toBe(1);
    for (const at of [below, above]) {
      expect(midLabelCrowds(at(5), label)).toBe(false);
      expect(midLabelCrowds(at(1), label)).toBe(false);
      expect(midLabelCrowds(at(0.5), label)).toBe(true);
      expect(midLabelCrowds(at(-3), label)).toBe(true);
    }
  });
});
