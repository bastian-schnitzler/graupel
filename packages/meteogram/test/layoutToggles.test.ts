// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Switches in the layout (REQ-664): `toggles` with values and default, `showWhen` on series and axes, `autoRule:
 * "spread"` for the dew point. The render option `toggles` sets values; `dewPoint`, `relativeHumidity` and
 * `scaleToVisibleRange` set the switch of the same name and win. The built-in layouts draw the same SVG as the same
 * layouts without switches for every value of the older options.
 */
import { describe, expect, it } from "vitest";
import type { DataPoint } from "../src";
import type { MeteogramInput } from "../src/core/input";
import { HOUR_MS } from "../src/core/timeline";
import type { TimeRange } from "../src/core/zoom";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID, resolveChartLayout, validateChartLayout } from "../src/layouts/resolution";
import { showWhenHolds, spreadModeOf, toggleValues, withToggles } from "../src/layouts/toggles";
import type { ChartLayout, LayoutArea, LayoutSeries } from "../src/layouts/types";
import { meteogramToSvgString } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { normalInput, normalOptions, powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const POWER_START = Date.UTC(2026, 9, 15, 0);
const CALM: TimeRange = { start: POWER_START + 24 * HOUR_MS, end: POWER_START + 36 * HOUR_MS };
const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

/** The fixture with a relative humidity at every temperature point. */
function withHumidity(base: MeteogramInput): MeteogramInput {
  const humidity: DataPoint[] = base.series
    .filter((point) => point.variable === "temperature")
    .map((point) => ({ ...point, variable: "relative_humidity", unit: "%", value: 60 }));
  return { ...base, series: [...base.series, ...humidity] };
}

/** A built-in layout without switches: no `toggles`, `showWhen` or `autoRule`. */
function withoutSwitches(layout: ChartLayout): ChartLayout {
  const { toggles: _toggles, ...rest } = layout;
  void _toggles;
  const plain = <T extends object>(entry: T): T =>
    Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "showWhen" && key !== "autoRule")) as T;
  return {
    ...rest,
    areas: layout.areas.map((area) => ({
      ...area,
      axes: area.axes
        ? {
            left: area.axes.left ? plain(area.axes.left) : area.axes.left,
            right: area.axes.right ? plain(area.axes.right) : area.axes.right,
          }
        : area.axes,
      series: (area.series ?? []).map(plain),
    })),
  };
}

/** The power layout with a switch `wind` and conditions on the wind area. */
function windSwitchLayout(series: Partial<LayoutSeries> = {}, area: Partial<LayoutArea> = {}): ChartLayout {
  return {
    ...POWER_LAYOUT,
    toggles: { ...POWER_LAYOUT.toggles, gusts: { values: ["hide", "show"], default: "show" } },
    areas: POWER_LAYOUT.areas.map((entry) =>
      entry.id === "wind"
        ? {
            ...entry,
            ...area,
            series: (entry.series ?? []).map((item) =>
              item.quantity === "wind_gusts" ? { ...item, showWhen: { gusts: "show" }, ...series } : item,
            ),
          }
        : entry,
    ),
  };
}

const svg = (options: MeteogramRenderOptions, input: MeteogramInput = powerInput) =>
  meteogramToSvgString(input, { ...powerOptions, ...options });

describe("built-in layouts", () => {
  it("name the switches of the older options with their defaults", () => {
    for (const layout of BUILTIN_LAYOUTS) {
      expect(layout.toggles).toEqual({
        dewPoint: { values: ["off", "on", "auto"], default: "off" },
        relativeHumidity: { values: ["off", "on"], default: "off" },
        scaleToVisibleRange: { values: ["off", "on"], default: "on" },
      });
      const temp = layout.areas.find((area) => area.id === "temp")!;
      expect(temp.series!.find((series) => series.quantity === "dew_point")).toMatchObject({
        showWhen: { dewPoint: ["on", "auto"] },
        autoRule: "spread",
      });
      expect(temp.series!.find((series) => series.quantity === "relative_humidity")!.showWhen).toEqual({
        relativeHumidity: "on",
      });
      expect(temp.axes!.right!.showWhen).toEqual({ relativeHumidity: "on" });
      expect(validateChartLayout(layout)).toEqual([]);
    }
  });

  it("draw the same SVG as without switches for every value of the older options", () => {
    const cases: MeteogramRenderOptions[] = [
      {},
      { dewPoint: "on" },
      { dewPoint: "auto" },
      { relativeHumidity: "on" },
      { relativeHumidity: "on", dewPoint: "on" },
      { visibleRange: CALM },
      { visibleRange: CALM, scaleToVisibleRange: false },
      { visibleRange: CALM, dewPoint: "auto" },
    ];
    for (const [layout, input, base] of [
      [BUILTIN_LAYOUTS[0]!, withHumidity(powerInput), powerOptions],
      [BUILTIN_LAYOUTS[1]!, withHumidity(normalInput), normalOptions],
    ] as const) {
      for (const extra of cases) {
        const switched = meteogramToSvgString(input, { ...base, ...extra, layout });
        const plain = meteogramToSvgString(input, { ...base, ...extra, layout: withoutSwitches(layout) });
        expect(switched, `${layout.id} ${JSON.stringify(extra)}`).toBe(plain);
      }
    }
  });
});

describe("render option toggles", () => {
  const humid = withHumidity(powerInput);

  it("sets the switches like the older options", () => {
    expect(svg({ toggles: { dewPoint: "on" } })).toBe(svg({ dewPoint: "on" }));
    expect(svg({ toggles: { dewPoint: "auto" } })).toBe(svg({ dewPoint: "auto" }));
    expect(svg({ toggles: { relativeHumidity: "on" } }, humid)).toBe(svg({ relativeHumidity: "on" }, humid));
    const zoomed = { visibleRange: CALM };
    expect(svg({ ...zoomed, toggles: { scaleToVisibleRange: "off" } })).toBe(
      svg({ ...zoomed, scaleToVisibleRange: false }),
    );
  });

  it("gives way to the older options and ignores unknown switches and values", () => {
    expect(svg({ toggles: { dewPoint: "on" }, dewPoint: "off" })).toBe(svg({}));
    expect(svg({ toggles: { dewPoint: "sometimes", nothing: "on" } })).toBe(svg({}));
    const scene = createMeteogramScene(powerInput, { ...powerOptions, toggles: { dewPoint: "auto" }, relativeHumidity: "on" });
    expect(scene.toggles).toEqual({ dewPoint: "auto", relativeHumidity: "on", scaleToVisibleRange: "on" });
    expect(scene.dewPoint).toBe("auto");
    expect(createMeteogramScene(powerInput, powerOptions).toggles).toEqual({
      dewPoint: "off",
      relativeHumidity: "off",
      scaleToVisibleRange: "on",
    });
  });

  it("leaves out series and axes whose showWhen does not hold", () => {
    const layout = windSwitchLayout();
    const gustsOf = (options: MeteogramRenderOptions) => {
      const scene = createMeteogramScene(powerInput, { ...powerOptions, layout, ...options });
      return scene.layout.areas.find((area) => area.id === "wind")!.series.some((s) => s.quantity === "wind_gusts");
    };
    expect(gustsOf({})).toBe(true);
    expect(gustsOf({ toggles: { gusts: "hide" } })).toBe(false);
    // Hidden, the chart is the one of a layout without the series.
    const without: ChartLayout = {
      ...layout,
      areas: layout.areas.map((area) =>
        area.id === "wind" ? { ...area, series: area.series!.filter((s) => s.quantity !== "wind_gusts") } : area,
      ),
    };
    expect(svg({ layout, toggles: { gusts: "hide" } })).toBe(svg({ layout: without }));
  });

  it("keeps a layout without switches as it is", () => {
    const { layout } = resolveChartLayout(withoutSwitches(POWER_LAYOUT));
    expect(layout.toggles).toEqual({});
    expect(withToggles(layout, {})).toBe(layout);
    // Without the switches the older options act as before.
    const plain = withoutSwitches(POWER_LAYOUT);
    expect(svg({ layout: plain, dewPoint: "on" })).toBe(svg({ dewPoint: "on" }));
  });
});

describe("helpers", () => {
  const { layout } = resolveChartLayout(POWER_LAYOUT);
  const dew = layout.areas[0]!.series.find((series) => series.quantity === "dew_point")!;

  it("toggleValues: defaults, then toggles, then the shorthands", () => {
    expect(toggleValues(layout)).toEqual({ dewPoint: "off", relativeHumidity: "off", scaleToVisibleRange: "on" });
    expect(toggleValues(layout, { dewPoint: "on" }, { dewPoint: "auto" }).dewPoint).toBe("auto");
    expect(toggleValues(layout, { dewPoint: "on" }, { dewPoint: undefined }).dewPoint).toBe("on");
    expect(toggleValues(layout, { dewPoint: 3 as unknown as string }).dewPoint).toBe("off");
  });

  it("showWhenHolds and spreadModeOf", () => {
    expect(showWhenHolds(null, {})).toBe(true);
    expect(showWhenHolds({ a: ["x", "y"] }, { a: "y" })).toBe(true);
    expect(showWhenHolds({ a: ["x"] }, { a: "y" })).toBe(false);
    expect(showWhenHolds({ a: ["x"] }, {})).toBe(false);
    expect(spreadModeOf(dew, { dewPoint: "off" })).toBe("off");
    expect(spreadModeOf(dew, { dewPoint: "on" })).toBe("on");
    expect(spreadModeOf(dew, { dewPoint: "auto" })).toBe("auto");
    expect(spreadModeOf(layout.areas[0]!.series.find((s) => s.quantity === "temperature")!, {})).toBeNull();
  });
});

describe("validation", () => {
  const withToggle = (toggles: unknown): ChartLayout =>
    ({ ...withoutSwitches(POWER_LAYOUT), toggles }) as unknown as ChartLayout;

  it.each([
    [withToggle([]), "toggles must be an object"],
    [withToggle({ a: { values: ["on"], default: "on" } }), "toggle a: values must be at least two different texts"],
    [withToggle({ a: { values: ["on", "on"], default: "on" } }), "toggle a: values must be at least two different texts"],
    [withToggle({ a: { values: ["on", "off"], default: "maybe" } }), "toggle a: default must be one of its values"],
    [windSwitchLayout({ showWhen: { nope: "x" } }), "showWhen names unknown toggle nope"],
    [windSwitchLayout({ showWhen: { gusts: "maybe" } }), "showWhen gusts needs values of the toggle (hide, show)"],
    [windSwitchLayout({ showWhen: { gusts: [] } }), "showWhen gusts needs values of the toggle"],
    [windSwitchLayout({ showWhen: [] as unknown as Record<string, string> }), "showWhen must be an object"],
    [windSwitchLayout({ autoRule: "spread" }), "autoRule spread needs fillTo"],
    [windSwitchLayout({ autoRule: "magic" as "spread" }), "unknown autoRule magic"],
  ])("rejects %#", (layout, message) => {
    expect(validateChartLayout(layout)).toEqual([expect.stringContaining(message)]);
  });

  it("checks showWhen on axes", () => {
    const layout: ChartLayout = {
      ...POWER_LAYOUT,
      areas: POWER_LAYOUT.areas.map((area) =>
        area.id === "wind" ? { ...area, axes: { left: { ...area.axes!.left!, showWhen: { unknown: "on" } } } } : area,
      ),
    };
    expect(validateChartLayout(layout)).toEqual([expect.stringContaining("left axis: showWhen names unknown toggle")]);
  });
});
