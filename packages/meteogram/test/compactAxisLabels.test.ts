// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Option `axisLabels.compact` (REQ-696): per axis the unit once below the drawing area, maximum and minimum
 * in the area's corners 1 px off its edges, the temperature's minimum included, the values without unit. Without the
 * option every SVG stays the same; the zero line, the guide lines and the cloud altitudes keep their rules (REQ-603,
 * REQ-653), the sunrise row its place above the maximum (REQ-602).
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DIGIT_ASCENT } from "../src/core/sunTimes";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import { HOUR_MS } from "../src/core/timeline";
import type { DataPoint, MeteogramInput } from "../src";
import { createMeteogram } from "../src/interaction/controller";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID } from "../src/layouts/resolution";
import type { ChartLayout, LayoutArea, LayoutAxis } from "../src/layouts/types";
import {
  axisLabelLineHeight,
  axisLabelLines,
  axisLabelWidth,
  type AxisLabelBox,
  compactAxisUnit,
  verticalPixel,
  ZERO_LABEL_MAX_OVERLAP,
} from "../src/render/axisLabels";
import { meteogramToSvgString, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, textContent, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const COMPACT = { axisLabels: { compact: true } } as const;
/** The website's narrow chart (plot edge to edge, labels over it) with compact labels. */
const COMPACT_INSIDE = {
  axisLabels: { compact: true, align: "inside", unit: "below" },
  padding: { left: 0, right: 0 },
} as const;
/** The same without compact labels: value and unit below each other over the plot (REQ-542). */
const INSIDE_NOT_COMPACT = { axisLabels: { align: "inside", unit: "below" }, padding: { left: 0, right: 0 } } as const;

const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

/** The power layout with one area (`id`) changed: its left axis and other fields. */
const areaLayout = (
  id: string,
  axis: Partial<LayoutAxis>,
  area: Partial<LayoutArea> = {},
  layout: ChartLayout = POWER_LAYOUT,
): ChartLayout => ({
  ...layout,
  areas: layout.areas.map((entry) =>
    entry.id === id
      ? { ...entry, ...area, axes: { ...entry.axes, left: { ...(entry.axes?.left ?? {}), ...axis } } }
      : entry,
  ),
});

/** `layout` with its areas `scale` times as high, as the website shrinks them for a small chart (DEC-053). */
const scaledLayout = (scale: number, layout: ChartLayout = POWER_LAYOUT): ChartLayout => ({
  ...layout,
  areas: layout.areas.map((area) => ({
    ...area,
    heightWeight: (area.heightWeight ?? 1) * scale,
    ...(area.background
      ? { background: { ...area.background, heightWeight: (area.background.heightWeight ?? 0) * scale } }
      : {}),
  })),
});

/** The fixture with a relative humidity at every temperature point (REQ-649). */
function withHumidity(base: MeteogramInput = powerInput): MeteogramInput {
  const humidity: DataPoint[] = base.series
    .filter((point) => point.variable === "temperature")
    .map((point) => ({
      ...point,
      variable: "relative_humidity",
      unit: "%",
      value: Math.round(65 + 25 * Math.sin(Date.parse(point.timestamp) / (5 * HOUR_MS))),
    }));
  return { ...base, series: [...base.series, ...humidity] };
}

const texts = (root: VNode) => findAll(root, (node) => node.tag === "text");
const byKey = (root: VNode, key: string) => texts(root).filter((node) => node.key === key);
const lines = (node: VNode) =>
  node.children.some((child) => typeof child !== "string" && child.tag === "tspan")
    ? node.children.map(textContent)
    : [textContent(node)];

/** Vertical extent of an axis label as drawn: its digits from the first line's top to the last line's baseline. */
function boxOf(node: VNode): AxisLabelBox {
  const fontSize = Number(node.attrs["font-size"]);
  const y = Number(node.attrs.y);
  const count = Number(node.attrs["data-lines"] ?? 1);
  return { top: y - DIGIT_ASCENT * fontSize, bottom: y + axisLabelLineHeight(fontSize) * (count - 1) };
}
const overlap = (a: AxisLabelBox, b: AxisLabelBox) =>
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Scene, static layer and every area of a chart with its panel and labels. */
function chart(options: MeteogramRenderOptions = {}, input: MeteogramInput = powerInput) {
  const scene = createMeteogramScene(input, { ...powerOptions, ...options });
  const layer = renderStaticLayer(scene);
  const areas = scene.geometry.areas.map((geometry) => {
    const panel = findAll(layer, (node) => node.attrs["data-area-id"] === geometry.area.id)[0]!;
    const one = (key: string) => byKey(panel, key)[0];
    return { geometry, panel, one, top: geometry.top, bottom: geometry.bottom };
  });
  const area = (id: string) => areas.find((entry) => entry.geometry.area.id === id)!;
  return { scene, layer, areas, area, px: verticalPixel(scene.pixelLayout.windIconScaleY) };
}

describe("compact axis labels: helpers (REQ-696)", () => {
  it("write the value without its unit, a degree sign stays with it", () => {
    expect(axisLabelLines(11, "mm", false, true)).toEqual(["11"]);
    expect(axisLabelLines(11, "mm", true, true)).toEqual(["11"]);
    expect(axisLabelLines(-35, "°", true, true)).toEqual(["-35°"]);
    expect(axisLabelLines(0, "", false, true)).toEqual(["0"]);
    // Without compact as before.
    expect(axisLabelLines(11, "mm", true)).toEqual(["11", "mm"]);
  });

  it("write the unit once below the area, none for a degree sign or without unit", () => {
    expect(compactAxisUnit("mm")).toBe("mm");
    expect(compactAxisUnit("km/h")).toBe("km/h");
    expect(compactAxisUnit("°")).toBeNull();
    expect(compactAxisUnit("°C")).toBeNull();
    expect(compactAxisUnit("")).toBeNull();
  });

  it("measure 1 px with the vertical scale of the rendered chart", () => {
    expect(verticalPixel(1)).toBe(1);
    expect(verticalPixel(2.5)).toBe(2.5);
    expect(verticalPixel(0)).toBe(1);
    expect(verticalPixel(Number.NaN)).toBe(1);
  });
});

describe("option axisLabels.compact (REQ-696)", () => {
  it("is off by default: every SVG stays the same without it or with false", () => {
    const cases: [MeteogramRenderOptions, MeteogramRenderOptions][] = [
      [{}, { axisLabels: { compact: false } }],
      [
        { axisLabels: { unit: "below", align: "inside" }, padding: { left: 0, right: 0 } },
        { axisLabels: { unit: "below", align: "inside", compact: false }, padding: { left: 0, right: 0 } },
      ],
    ];
    for (const [base, off] of cases) {
      const plain = meteogramToSvgString(powerInput, { ...powerOptions, ...base });
      expect(meteogramToSvgString(powerInput, { ...powerOptions, ...off })).toBe(plain);
    }
    expect(createMeteogramScene(powerInput, powerOptions).axisLabels.compact).toBe(false);
    expect(createMeteogramScene(powerInput, { ...powerOptions, ...COMPACT }).axisLabels.compact).toBe(true);
    // Only `true` switches it on.
    const truthy = { axisLabels: { compact: "yes" as unknown as boolean } };
    expect(createMeteogramScene(powerInput, { ...powerOptions, ...truthy }).axisLabels.compact).toBe(false);
  });

  for (const [name, options] of [
    ["beside the plot", COMPACT],
    ["over the plot", COMPACT_INSIDE],
    ["at the edge", { axisLabels: { compact: true, align: "edge" } }],
  ] as const) {
    it(`writes the unit of each left axis once, below its area, on the axis' side (${name})`, () => {
      const { area, areas, px } = chart(options);
      for (const [id, unit] of [
        ["precip", "mm"],
        ["wind", "km/h"],
      ] as const) {
        const { panel, one, bottom } = area(id);
        const units = byKey(panel, "axis-unit");
        expect(units, id).toHaveLength(1);
        const node = units[0]!;
        expect(textContent(node)).toBe(unit);
        // Top edge of its letters 1 px below the area's bottom edge, in the gap to the next area.
        expect(boxOf(node).top).toBeCloseTo(bottom + px, 2);
        // In the axis' colour, font size and alignment, without halo.
        const max = one("axis-max")!;
        for (const attr of ["x", "fill", "font-size", "text-anchor"]) expect(node.attrs[attr]).toBe(max.attrs[attr]);
        expect(node.attrs.stroke).toBeUndefined();
        // No value label carries the unit any more.
        for (const label of ["axis-max", "axis-min", "axis-mid", "axis-zero"].flatMap((key) => byKey(panel, key))) {
          expect(lines(label), `${id} ${label.key}`).toHaveLength(1);
          expect(textContent(label)).not.toContain(unit);
        }
      }
      // The temperature axis keeps its degree sign at the values and writes no unit below.
      const temperature = area("temp");
      expect(byKey(temperature.panel, "axis-unit")).toHaveLength(0);
      expect(textContent(temperature.one("axis-min")!)).toMatch(/^-?\d+°$/);
      expect(textContent(temperature.one("axis-max")!)).toMatch(/^-?\d+°$/);
      // One unit per axis in the whole chart: precipitation, wind, the half axes and the right axis (convective).
      const all = areas.flatMap(({ panel }) => texts(panel).filter((node) => /-unit$/.test(String(node.key))));
      expect(all.map((node) => node.key).sort()).toEqual(["axis-unit", "axis-unit", "half-unit", "right-unit"]);
    });
  }

  it("puts maximum and minimum in the corners, 1 px off the area's edges", () => {
    for (const options of [COMPACT, COMPACT_INSIDE]) {
      const { areas, px } = chart({ ...options, layout: areaLayout("temp", {}, { sunTimes: false }) });
      let checked = 0;
      for (const { one, top, bottom, geometry } of areas) {
        const max = one("axis-max");
        const min = one("axis-min");
        if (!max || !min) continue;
        expect(boxOf(max).top, geometry.name).toBeCloseTo(top + px, 2);
        expect(boxOf(min).bottom, geometry.name).toBeCloseTo(bottom - px, 2);
        checked++;
      }
      expect(checked).toBe(3);
    }
  });

  it("measures 1 px on screen: with a chart drawn at half its size 1 px is 2 viewBox units", () => {
    const geometry = createMeteogramScene(powerInput, powerOptions).geometry;
    const size = { width: 500, height: geometry.totalHeight / 2 };
    const { area, px, scene } = chart({ ...COMPACT, size });
    expect(scene.pixelLayout.windIconScaleY).toBeCloseTo(2);
    expect(px).toBeCloseTo(2);
    const { one, top, bottom, panel } = area("wind");
    expect(boxOf(one("axis-max")!).top).toBeCloseTo(top + 2, 2);
    expect(boxOf(one("axis-min")!).bottom).toBeCloseTo(bottom - 2, 2);
    expect(boxOf(byKey(panel, "axis-unit")[0]!).top).toBeCloseTo(bottom + 2, 2);
  });

  it("puts the temperature's minimum in the lower corner instead of 6 units above the bottom", () => {
    const plain = chart().area("temp");
    expect(Number(plain.one("axis-min")!.attrs.y)).toBe(plain.bottom - 6);
    for (const options of [COMPACT, COMPACT_INSIDE]) {
      const { area, px } = chart(options);
      const { one, bottom } = area("temp");
      const min = one("axis-min")!;
      expect(Number(min.attrs.y)).toBeCloseTo(bottom - px, 2);
      expect(textContent(min)).toMatch(/^-\d+°$/);
    }
  });

  it("moves a sunrise time over the maximum right of its line, the maximum stays in the corner (REQ-734, REQ-738)", () => {
    // No sunrise near the left edge in the fixture: the maximum hangs in the corner, the sunrise times centred.
    const free = chart(COMPACT_INSIDE).area("temp");
    expect(boxOf(free.one("axis-max")!).top).toBeCloseTo(free.top + 1, 2);
    for (const sunrise of findAll(free.panel, (node) => node.attrs["data-testid"] === "sunrise")) {
      expect(sunrise.attrs["text-anchor"]).toBe("middle");
    }
    // A sunrise just after midnight on a day starting at the chart's left edge: centred, its time would stand over
    // the maximum in the corner; it moves right of its line instead.
    const early: MeteogramInput = {
      ...powerInput,
      sunPhases: [16, 17].map((day) => ({
        day: `2026-10-${day}`,
        sunrise: new Date(Date.UTC(2026, 9, day - 1, 22, 10)).toISOString(),
        sunset: new Date(Date.UTC(2026, 9, day, 16, 0)).toISOString(),
      })),
    };
    const visibleRange = { start: Date.UTC(2026, 9, 15, 22), end: Date.UTC(2026, 9, 18, 0) };
    for (const options of [COMPACT_INSIDE, INSIDE_NOT_COMPACT]) {
      const { panel, one, top } = chart({ ...options, visibleRange }, early).area("temp");
      const sunrise = findAll(panel, (node) => node.attrs["data-testid"] === "sunrise")[0]!;
      expect(sunrise.attrs["text-anchor"]).toBe("start");
      const max = one("axis-max")!;
      const maxRight = Number(max.attrs.x) + axisLabelWidth(textContent(max), Number(max.attrs["font-size"]));
      expect(Number(sunrise.attrs.x)).toBeGreaterThanOrEqual(maxRight);
      expect(Number(sunrise.attrs.x)).toBeLessThan(60);
      // Compact (REQ-696) and in two lines (REQ-738) the maximum keeps its corner.
      expect(boxOf(max).top).toBeCloseTo(top + 1, 2);
    }
    // The sunset of that day stays centred.
    const { panel } = chart({ ...COMPACT_INSIDE, visibleRange }, early).area("temp");
    for (const sunset of findAll(panel, (node) => node.attrs["data-testid"] === "sunset")) {
      expect(sunset.attrs["text-anchor"]).toBe("middle");
    }
    // Beside the plot the labels cannot meet: the sunrise stays centred, the maximum in the corner.
    const beside = chart({ ...COMPACT, visibleRange }, early).area("temp");
    expect(boxOf(beside.one("axis-max")!).top).toBeCloseTo(beside.top + 1, 2);
    const besideSunrise = findAll(beside.panel, (node) => node.attrs["data-testid"] === "sunrise")[0]!;
    expect(besideSunrise.attrs["text-anchor"]).toBe("middle");
  });

  it("labels the right axis compactly: corners, name below the maximum, unit once below the area", () => {
    for (const [options, x, anchor] of [
      [COMPACT, 954, undefined],
      [COMPACT_INSIDE, 999, "end"],
    ] as const) {
      const { area, px } = chart(options);
      const { panel, top, bottom } = area("convective");
      const [max, name, min, unit] = ["right-max", "right-name", "right-min", "right-unit"].map(
        (key) => byKey(panel, key)[0]!,
      );
      expect(textContent(max!)).toMatch(/^\d+$/);
      expect(boxOf(max!).top).toBeCloseTo(top + px, 2);
      expect(Number(name!.attrs.y)).toBeGreaterThan(Number(max!.attrs.y));
      expect(textContent(min!)).toBe("0");
      expect(Number(min!.attrs.y)).toBeCloseTo(bottom - px, 2);
      expect(textContent(unit!)).toBe("J/kg");
      expect(boxOf(unit!).top).toBeCloseTo(bottom + px, 2);
      for (const node of [max, name, min, unit]) {
        expect(node!.attrs.x).toBe(x);
        expect(node!.attrs["text-anchor"]).toBe(anchor);
        expect(node!.attrs["font-size"]).toBe(LIGHT_THEME.fontSizes.axisRight);
      }
    }
  });

  it("labels the relative humidity on the right like a left axis: 100 and 0 in the corners, % below", () => {
    const { area, px } = chart({ ...COMPACT_INSIDE, relativeHumidity: "on" }, withHumidity());
    const { panel, top, bottom } = area("temp");
    const [max, min, unit] = ["right-max", "right-min", "right-unit"].map((key) => byKey(panel, key)[0]!);
    expect(textContent(max!)).toBe("100");
    expect(textContent(min!)).toBe("0");
    expect(textContent(unit!)).toBe("%");
    expect(boxOf(max!).top).toBeCloseTo(top + px, 2);
    expect(Number(min!.attrs.y)).toBeCloseTo(bottom - px, 2);
    expect(boxOf(unit!).top).toBeCloseTo(bottom + px, 2);
    for (const node of [max, min, unit]) {
      expect(node!.attrs.x).toBe(999);
      expect(node!.attrs["text-anchor"]).toBe("end");
      expect(node!.attrs.fill).toBe(max!.attrs.fill);
    }
  });

  it("puts the half axes' maxima in the corners and their unit once below the area", () => {
    const { area, px } = chart(COMPACT_INSIDE);
    const { panel, one, top, bottom } = area("convective");
    const upper = one("cape-max")!;
    const lower = one("convective_inhibition-max")!;
    expect(textContent(upper)).toMatch(/^\d+$/);
    expect(textContent(lower)).toMatch(/^−\d+$/);
    expect(boxOf(upper).top).toBeCloseTo(top + px, 2);
    expect(Number(lower.attrs.y)).toBeCloseTo(bottom - px, 2);
    expect(textContent(one("zero")!)).toBe("0");
    const units = byKey(panel, "half-unit");
    expect(units).toHaveLength(1);
    expect(textContent(units[0]!)).toBe("J/kg");
    expect(units[0]!.attrs["font-size"]).toBe(LIGHT_THEME.fontSizes.axisHalf);
  });

  it("keeps the rules of the zero line (REQ-603) and of the guide line (REQ-653)", () => {
    // The zero label stays centred on its line and replaces a maximum of 0.
    const { area } = chart(COMPACT);
    const temperature = area("temp");
    const zero = temperature.one("axis-zero")!;
    expect(textContent(zero)).toBe("0°");
    expect(zero.attrs.fill).toBe(LIGHT_THEME.grid.freezingLine);
    const line = findAll(temperature.panel, (node) => node.attrs["data-testid"] === "freezing-line")[0]!;
    const halfHeight = (DIGIT_ASCENT * LIGHT_THEME.fontSizes.axis) / 2;
    expect(Number(zero.attrs.y) - halfHeight).toBeCloseTo(Number(line.attrs.y1), 2);
    const top = chart({ ...COMPACT, layout: areaLayout("temp", { range: "fixed", min: -15, max: 0 }) }).area("temp");
    expect(top.one("axis-zero")).toBeDefined();
    expect(top.one("axis-max")).toBeUndefined();
    expect(textContent(top.one("axis-min")!)).toBe("-15°");
    // The guide line's label: its value without unit, in its fainter colour, between maximum and minimum.
    const wind = area("wind");
    const mid = wind.one("axis-mid")!;
    expect(textContent(mid)).toMatch(/^\d+$/);
    expect(mid.attrs.fill).toBe(LIGHT_THEME.axis.midLabel);
    expect(boxOf(mid).top).toBeGreaterThan(boxOf(wind.one("axis-max")!).bottom);
    expect(boxOf(mid).bottom).toBeLessThan(boxOf(wind.one("axis-min")!).top);
    // Cloud altitudes keep their unit.
    const altitudes = findAll(area("precip").panel, (node) =>
      String(node.attrs["data-testid"] ?? "").startsWith("cloud-altitude-label-"),
    );
    expect(altitudes.length).toBeGreaterThan(0);
    for (const altitude of altitudes) expect(textContent(altitude)).toContain("km");
  });

  for (const [name, theme] of [
    ["light", LIGHT_THEME],
    ["dark", DARK_THEME],
  ] as const) {
    it(`draws the unit in the axis colour of the theme (${name})`, () => {
      const { area } = chart({ ...COMPACT_INSIDE, theme: name });
      const unit = byKey(area("wind").panel, "axis-unit")[0]!;
      expect(unit.attrs.fill).toBe(theme.axisLabels.wind_speed ?? theme.axis.label);
    });
  }

  it("applies on screen (controller) and in the picture (SVG string)", () => {
    const markup = meteogramToSvgString(powerInput, { ...powerOptions, ...COMPACT_INSIDE });
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect([...doc.querySelectorAll('[data-testid="axis-unit"]')].map((node) => node.textContent)).toEqual([
      "mm",
      "km/h",
    ]);
    const element = document.createElement("div");
    document.body.append(element);
    const meteogram = createMeteogram(element, powerInput, { ...powerOptions, ...COMPACT_INSIDE });
    expect([...element.querySelectorAll('[data-testid="axis-unit"]')].map((node) => node.textContent)).toEqual([
      "mm",
      "km/h",
    ]);
    meteogram.update(powerInput, powerOptions);
    expect(element.querySelectorAll('[data-testid="axis-unit"]')).toHaveLength(0);
    meteogram.destroy();
    element.remove();
  });
});

describe("compact axis labels in small charts (REQ-696, REQ-694)", () => {
  const AXIS_FONT = LIGHT_THEME.fontSizes.axis;

  /**
   * Overlaps of the left labels of each area (maximum, minimum, guide and zero label): a pair other than the zero label
   * must not touch, the zero label may cover a label by up to 20 % of its height (REQ-603). The unit stands below the
   * area, clear of the next area.
   */
  function crowding(options: MeteogramRenderOptions) {
    const { areas } = chart(options);
    const problems: string[] = [];
    for (const [index, { panel, geometry }] of areas.entries()) {
      const labels = ["axis-max", "axis-min", "axis-mid", "axis-zero"].flatMap((key) => byKey(panel, key));
      for (const [i, a] of labels.entries()) {
        for (const b of labels.slice(i + 1)) {
          const covered = overlap(boxOf(a), boxOf(b));
          const zero = a.key === "axis-zero" || b.key === "axis-zero";
          const other = a.key === "axis-zero" ? b : a;
          const allowed = zero ? ZERO_LABEL_MAX_OVERLAP * (boxOf(other).bottom - boxOf(other).top) + 1e-6 : 0;
          if (covered > allowed) {
            problems.push(`${geometry.name}: ${lines(a).join("/")} ${a.key} × ${lines(b).join("/")} ${b.key}`);
          }
        }
      }
      for (const unit of byKey(panel, "axis-unit")) {
        // Its letters (descenders up to a quarter of the font size) end before the next area (or the chart) begins.
        const next = areas[index + 1]?.top ?? chart(options).scene.geometry.totalHeight;
        if (Number(unit.attrs.y) + 0.25 * AXIS_FONT > next) problems.push(`${geometry.name}: unit reaches below`);
      }
    }
    return problems;
  }

  // The device tests of the website: in low charts "10°", "0°" and the maximum crowd at the left edge. A temperature
  // axis with a guide line ("10°" at half the axis) around 0 °C, the areas shrunk.
  const temperatureCases = [
    { min: -10, max: 30 },
    { min: -10, max: 20 },
    { min: -5, max: 10 },
    { min: -20, max: 10 },
    { min: -35, max: 0 },
    { min: 0, max: 20 },
  ];
  const scales = [1, 0.6, 0.45, 0.35, 0.3];
  const temperatureGuideLayout = (scale: number, range: { min: number; max: number }) =>
    areaLayout("temp", { range: "fixed", midLine: true, ...range }, {}, scaledLayout(scale));

  it("have no overlapping labels at small heights", () => {
    for (const scale of scales) {
      for (const range of temperatureCases) {
        const layout = temperatureGuideLayout(scale, range);
        for (const options of [COMPACT, COMPACT_INSIDE]) {
          expect(crowding({ ...options, layout }), `${scale} ${JSON.stringify(range)}`).toEqual([]);
        }
      }
      expect(crowding({ ...COMPACT_INSIDE, layout: scaledLayout(scale) }), `${scale}`).toEqual([]);
    }
  });

  it("where the two-line labels of the narrow chart crowd at the same heights", () => {
    // The narrow chart's labels before (unit below each value): at the smallest heights labels touch.
    const narrow = { axisLabels: { unit: "below", align: "inside" }, padding: { left: 0, right: 0 } } as const;
    const crowded = scales.flatMap((scale) =>
      temperatureCases.flatMap((range) =>
        crowding({ ...narrow, layout: temperatureGuideLayout(scale, range) }),
      ),
    );
    expect(crowded.length).toBeGreaterThan(0);
  });

  it("keep the guide label only where it fits between maximum and minimum", () => {
    const layout = areaLayout("temp", { range: "fixed", min: -10, max: 10, midLine: true }, {}, scaledLayout(0.3));
    const { area } = chart({ ...COMPACT_INSIDE, layout });
    const temperature = area("temp");
    // At half the axis lies 0 °C: the zero line's label wins, the guide label is left out, its line stays.
    expect(temperature.one("axis-mid")).toBeUndefined();
    expect(temperature.one("axis-zero")).toBeDefined();
    expect(findAll(temperature.panel, (node) => node.attrs["data-testid"] === "temperature-mid-line")).toHaveLength(1);
  });
});

describe("SVG snapshots with compact axis labels (REQ-696)", () => {
  // The website's narrow chart in a small size (areas at 45 %), relative humidity on: left, right and half axes.
  for (const theme of ["light", "dark"] as const) {
    it(`fixture power, compact, theme ${theme}`, async () => {
      const file = theme === "light" ? "power.compact.svg" : "power.compact.dark.svg";
      await expect(
        meteogramToSvgString(withHumidity(), {
          ...powerOptions,
          ...COMPACT_INSIDE,
          layout: scaledLayout(0.45),
          relativeHumidity: "on",
          theme,
          background: true,
          xmlDeclaration: true,
        }),
      ).toMatchFileSnapshot(`./__snapshots__/${file}`);
    });
  }
});
