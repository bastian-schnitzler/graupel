// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Layout version 2, axis rules in the layout (REQ-663): `steps`, `step`, `padding`, `format`, `scope` and `guides`
 * replace what used to be fixed per quantity. Without them, and in every version 1 layout, the chart draws as before;
 * the built-in layouts name their rules with the quantities' own values and draw the same SVG as without them.
 */
import { describe, expect, it } from "vitest";
import type { TimeRange } from "../src/core/zoom";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import {
  getBuiltinLayout,
  guideShare,
  POWER_DEFAULT_LAYOUT_ID,
  resolveChartLayout,
  validateChartLayout,
} from "../src/layouts/resolution";
import {
  axisPresetFor,
  getAxisPreset,
  PRECIPITATION_AXIS_STEPS,
  steppedAutoRange,
  TEMPERATURE_AXIS_STEP,
  WIND_AXIS_STEPS,
} from "../src/layouts/seriesPresets";
import type { ChartLayout, LayoutAxis, ResolvedAxis } from "../src/layouts/types";
import { meteogramToSvgString, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, textContent } from "../src/render/vnode";
import { normalInput, normalOptions, powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const HOUR = 3_600_000;
const POWER_START = Date.UTC(2026, 9, 15, 0);
/** A calm part of the power fixture: no precipitation, gusts up to about 21 km/h. */
const CALM: TimeRange = { start: POWER_START + 24 * HOUR, end: POWER_START + 36 * HOUR };

const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

/** The power layout with the left axis of one area changed. */
const withLeftAxis = (areaId: string, axis: Partial<LayoutAxis>, layout: ChartLayout = POWER_LAYOUT): ChartLayout => ({
  ...layout,
  areas: layout.areas.map((entry) =>
    entry.id === areaId
      ? { ...entry, axes: { ...entry.axes, left: { ...(entry.axes?.left ?? {}), ...axis } } }
      : entry,
  ),
});

/** A built-in layout as version 1: without the axis rules of version 2. */
function asVersion1(layout: ChartLayout): ChartLayout {
  const RULES = ["steps", "step", "padding", "format", "scope", "guides"];
  const strip = (axis: LayoutAxis | null | undefined) =>
    axis ? (Object.fromEntries(Object.entries(axis).filter(([key]) => !RULES.includes(key))) as LayoutAxis) : axis;
  return {
    ...layout,
    version: 1,
    areas: layout.areas.map((area) => ({
      ...area,
      axes: area.axes ? { left: strip(area.axes.left), right: strip(area.axes.right) } : area.axes,
    })),
  };
}

function scaleOf(options: MeteogramRenderOptions, name: string) {
  const scene = createMeteogramScene(powerInput, { ...powerOptions, ...options });
  return scene.areaScales[scene.geometry.areas.findIndex((area) => area.name === name)]!.left!;
}

function windPanel(options: MeteogramRenderOptions) {
  const layer = renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, ...options }));
  return findAll(layer, (node) => node.attrs["data-area-id"] === "wind")[0]!;
}

const resolvedAxis = (axis: LayoutAxis): ResolvedAxis =>
  resolveChartLayout(withLeftAxis("wind", axis)).layout.areas.find((area) => area.id === "wind")!.axes.left!;

describe("built-in layouts (version 2)", () => {
  it("are version 2 and name the axis rules of MET-S10", () => {
    for (const layout of BUILTIN_LAYOUTS) {
      expect(layout.version).toBe(2);
      const axis = (id: string) => layout.areas.find((area) => area.id === id)!.axes!.left!;
      expect(axis("temp").step).toBe(TEMPERATURE_AXIS_STEP);
      expect(axis("precip").steps).toEqual(PRECIPITATION_AXIS_STEPS);
      expect(axis("precip").steps![0]).toBe(2);
      expect(axis("precip").scope).toBe("visible");
      expect(axis("wind").steps).toEqual(WIND_AXIS_STEPS);
      expect(axis("wind").scope).toBe("visible");
      expect(axis("wind").midLine).toBe(true);
    }
  });

  it("draw the same SVG as the same layouts without the rules (version 1)", () => {
    const zoomed = { visibleRange: CALM };
    for (const [layout, input, base] of [
      [BUILTIN_LAYOUTS[0]!, powerInput, powerOptions],
      [BUILTIN_LAYOUTS[1]!, normalInput, normalOptions],
    ] as const) {
      for (const extra of [{}, zoomed, { ...zoomed, scaleToVisibleRange: false }, { dewPoint: "on" as const }]) {
        const v2 = meteogramToSvgString(input, { ...base, ...extra, layout });
        const v1 = meteogramToSvgString(input, { ...base, ...extra, layout: asVersion1(layout) });
        expect(v2, `${layout.id} ${JSON.stringify(extra)}`).toBe(v1);
      }
    }
  });
});

describe("validation and resolution", () => {
  it("accepts the rules and resolves them with defaults", () => {
    const rules: LayoutAxis = {
      steps: [5, 25, 60],
      step: 2,
      padding: { top: 4, bottom: 3 },
      format: { decimals: 1, below1Decimals: 2 },
      scope: "all",
      guides: [{ at: 40 }, { at: "25%", dashed: false, label: false }],
    };
    expect(validateChartLayout(withLeftAxis("wind", rules))).toEqual([]);
    const axis = resolvedAxis(rules);
    expect(axis).toMatchObject({
      steps: [5, 25, 60],
      step: 2,
      paddingTop: 4,
      paddingBottom: 3,
      format: { decimals: 1, below1Decimals: 2 },
      scope: "all",
    });
    // midLine (set in the built-in wind axis) comes first as the guide at 50 %.
    expect(axis.guides).toEqual([
      { at: "50%", dashed: true, label: true },
      { at: 40, dashed: true, label: true },
      { at: "25%", dashed: false, label: false },
    ]);
  });

  it("leaves every rule empty without them", () => {
    const axis = resolveChartLayout(asVersion1(POWER_LAYOUT)).layout.areas.find((area) => area.id === "temp")!.axes
      .left!;
    expect(axis).toMatchObject({
      steps: null,
      step: null,
      paddingTop: null,
      paddingBottom: null,
      format: null,
      scope: null,
      guides: [],
    });
  });

  it("does not add a second guide at 50 % for midLine", () => {
    expect(resolvedAxis({ guides: [{ at: "50%", label: false }] }).guides).toEqual([
      { at: "50%", dashed: true, label: false },
    ]);
  });

  it.each([
    [{ steps: [] }, "steps must be rising positive numbers"],
    [{ steps: [10, 5] }, "steps must be rising positive numbers"],
    [{ steps: [0, 5] }, "steps must be rising positive numbers"],
    [{ step: -1 }, "step must be a positive number"],
    [{ padding: { top: -2 } }, "padding.top must be a number of at least 0"],
    [{ padding: 3 }, "padding must be an object"],
    [{ format: { decimals: 1.5 } }, "format needs whole numbers of decimals"],
    [{ scope: "zoom" }, "unknown axis scope zoom"],
    [{ guides: {} }, "guides must be a list"],
    [{ guides: [{ at: "120%" }] }, 'guide 1 needs at as a number or a share from "0%" to "100%"'],
    [{ guides: [{ at: 10, dashed: "yes" }] }, "guide 1: dashed must be true or false"],
  ])("rejects %j", (rules, message) => {
    expect(validateChartLayout(withLeftAxis("wind", rules as unknown as LayoutAxis))).toEqual([
      expect.stringContaining(message),
    ]);
  });

  it("reads shares of the axis range", () => {
    expect(guideShare("50%")).toBe(0.5);
    expect(guideShare(" 12.5 % ")).toBe(0.125);
    expect(guideShare("0%")).toBe(0);
    expect(guideShare("100%")).toBe(1);
    expect(guideShare("101%")).toBeNull();
    expect(guideShare("50")).toBeNull();
    expect(guideShare(50)).toBeNull();
  });
});

describe("axisPresetFor", () => {
  const empty = resolveChartLayout(asVersion1(POWER_LAYOUT)).layout.areas[0]!.axes.left!;

  it("is the quantity's own preset without rules", () => {
    expect(axisPresetFor("wind_speed", null)).toBe(getAxisPreset("wind_speed"));
    expect(axisPresetFor("temperature", empty)).toBe(getAxisPreset("temperature"));
  });

  it("takes steps for the zero-based maximum and keeps the quantity's value without data", () => {
    const preset = axisPresetFor("wind_speed", { ...empty, steps: [5, 25, 60] });
    expect(preset.zeroBasedMax!(3)).toBe(5);
    expect(preset.zeroBasedMax!(24)).toBe(25);
    expect(preset.zeroBasedMax!(61)).toBe(100);
    expect(preset.zeroBasedMax!(null)).toBe(getAxisPreset("wind_speed").zeroBasedMax!(null));
    // A quantity without steps of its own starts at the first step.
    expect(axisPresetFor("snow_depth", { ...empty, steps: [1, 2] }).zeroBasedMax!(null)).toBe(1);
  });

  it("puts an auto range on multiples of step, keeping the temperature's rules around 0", () => {
    const temperature = axisPresetFor("temperature", { ...empty, step: 2 });
    expect(temperature.auto!(3.1, 9.2)).toEqual([0, 10]);
    expect(temperature.auto!(17.5, 21)).toEqual([16, 22]);
    expect(temperature.spreadFloor!(13.2, null)).toBe(12);
    expect(axisPresetFor("snow_depth", { ...empty, step: 0.5 }).auto!(0.3, 1.1)).toEqual([0, 1.5]);
    expect(steppedAutoRange(null, null, 4)).toEqual([0, 4]);
    expect(steppedAutoRange(-3, -3, 2)).toEqual([-4, -2]);
  });

  it("sets padding, format and scope", () => {
    const preset = axisPresetFor("snow_depth", {
      ...empty,
      paddingTop: 3,
      paddingBottom: 1,
      format: { decimals: 0, below1Decimals: 1 },
      scope: "visible",
    });
    expect([preset.paddingTop, preset.paddingBottom]).toEqual([3, 1]);
    expect(preset.formatMax!(12.4)).toBe("12");
    expect(preset.formatMax!(0.44)).toBe("0.4");
    expect(preset.scope).toBe("visible");
    expect(getAxisPreset("wind_speed").scope).toBe("visible");
    expect(getAxisPreset("snowfall").scope).toBe("all");
    expect(getAxisPreset("temperature").scope).toBeUndefined();
  });
});

describe("rules in the drawn chart", () => {
  it("steps change the wind axis maximum", () => {
    expect(scaleOf({}, "wind").max).toBe(40);
    expect(scaleOf({ layout: withLeftAxis("wind", { steps: [45, 90] }) }, "wind").max).toBe(45);
  });

  it("scope all keeps the axis on all data while zoomed, visible makes it follow", () => {
    const zoomed = { visibleRange: CALM };
    const full = scaleOf({}, "wind").max;
    expect(scaleOf(zoomed, "wind").max).toBeLessThan(full);
    expect(scaleOf({ ...zoomed, layout: withLeftAxis("wind", { scope: "all" }) }, "wind").max).toBe(full);
    // The option still switches it off for every axis.
    expect(scaleOf({ ...zoomed, scaleToVisibleRange: false }, "wind").max).toBe(full);
  });

  it("padding moves the extremes of the axis", () => {
    const base = scaleOf({}, "wind");
    const moved = scaleOf({ layout: withLeftAxis("wind", { padding: { top: 5, bottom: 7 } }) }, "wind");
    expect([base.paddingTop, base.paddingBottom]).toEqual([25, 0]);
    expect([moved.paddingTop, moved.paddingBottom]).toEqual([5, 7]);
  });

  it("format sets the maximum label", () => {
    const panel = windPanel({ layout: withLeftAxis("wind", { format: { decimals: 1 } }) });
    const max = findAll(panel, (node) => node.tag === "text" && node.key === "axis-max")[0]!;
    expect(textContent(max)).toBe("40.0 km/h");
  });

  it("draws further guides at a value or share, solid or without label, and leaves out those outside the axis", () => {
    const panel = windPanel({
      layout: withLeftAxis("wind", {
        guides: [{ at: 10 }, { at: "90%", dashed: false, label: false }, { at: 80 }],
      }),
    });
    const lineOf = (testId: string) => findAll(panel, (node) => node.attrs["data-testid"] === testId)[0];
    expect(Number(lineOf("wind-mid-line")!.attrs["data-value"])).toBe(20);
    expect(Number(lineOf("wind-guide-2-line")!.attrs["data-value"])).toBe(10);
    const solid = lineOf("wind-guide-3-line")!;
    expect(Number(solid.attrs["data-value"])).toBe(36);
    expect(solid.attrs["stroke-dasharray"]).toBeUndefined();
    expect(lineOf("wind-guide-4-line")).toBeUndefined();
    expect(lineOf("axis-guide-3")).toBeUndefined();
    expect(textContent(lineOf("axis-guide-2")!)).toBe("10 km/h");
  });
});
