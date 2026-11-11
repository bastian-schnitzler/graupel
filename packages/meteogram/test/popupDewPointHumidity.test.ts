// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/**
 * Dew point, dew point spread and relative humidity in the popup and the side bar (REQ-676): in the
 * temperature group after the apparent temperature, only while drawn (`dewPoint` on, auto with its condition in the
 * visible range; `relativeHumidity` on). The rows come from the layout's popup groups (REQ-665).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import { HOUR_MS } from "../src/core/timeline";
import type { DataPoint } from "../src/core/types";
import type { MeteogramInput } from "../src/core/input";
import { createMeteogram, type MeteogramOptions } from "../src/interaction/controller";
import { buildHoverInfo, hoverAtTime, type MeteogramHoverInfo } from "../src/interaction/hover";
import { DEFAULT_TOOLTIP_TEXTS, renderTooltipContent, type MeteogramTooltipTexts } from "../src/interaction/tooltip";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import { getLayoutQuantities } from "../src/layouts/quantities";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID, resolveChartLayout, validateChartLayout } from "../src/layouts/resolution";
import { DEFAULT_TOOLTIP_GROUPS, withoutTooltipRows } from "../src/layouts/tooltip";
import type { ChartLayout, LayoutArea } from "../src/layouts/types";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const START = Date.parse(powerInput.timeline!.start!);
const HOUR = HOUR_MS;

/** Spread 2 K at 15 UTC, 12 K at 3 UTC: the auto condition holds every afternoon. */
const dailySpread = (time: number) => 7 - 5 * Math.cos(((((time / HOUR) % 24) - 15) / 24) * 2 * Math.PI);

/** The power fixture with a dew point `spreadAt(time)` below the temperature and a relative humidity. */
function withDewPointAndHumidity(spreadAt: (time: number) => number = dailySpread): MeteogramInput {
  const temperatures = powerInput.series.filter((point) => point.variable === "temperature");
  const extra: DataPoint[] = temperatures.flatMap((point) => {
    const time = Date.parse(point.timestamp);
    return [
      {
        ...point,
        variable: "dew_point",
        value: point.value === null ? null : Math.round((point.value - spreadAt(time)) * 10) / 10,
      },
      { ...point, variable: "relative_humidity", unit: "%", value: 65.4 + 25 * Math.sin(time / (5 * HOUR)) },
    ];
  });
  return { ...powerInput, series: [...powerInput.series, ...extra] };
}

const input = withDewPointAndHumidity();
/** Spread 8 K everywhere, dew point far below 15 °C: auto draws nothing. */
const dry = withDewPointAndHumidity(() => 8);

const NEW_ROWS = ["tooltip-row-dew_point", "tooltip-row-dew_point_spread", "tooltip-row-relative_humidity"];

/** The popup at `hour` after the start. */
function popupAt(
  options: MeteogramRenderOptions,
  hour = 15,
  chartInput: MeteogramInput = input,
  texts?: Partial<MeteogramTooltipTexts>,
) {
  const scene = createMeteogramScene(chartInput, { ...powerOptions, ...options });
  const info = buildHoverInfo(scene, hoverAtTime(scene, START + hour * HOUR), chartInput);
  const container = document.createElement("div");
  expect(
    renderTooltipContent(container, info, { quantities: scene.quantities, theme: scene.theme, ...(texts ? { texts } : {}) }),
  ).toBe(true);
  return { container, info };
}

/** Test ids of the new rows the popup shows. */
const newRows = (container: Element) =>
  NEW_ROWS.filter((testId) => container.querySelector(`[data-testid="${testId}"]`) !== null);

/** Labels of the rows before the first divider: the temperature group. */
function temperatureGroup(container: Element): string[] {
  const labels: string[] = [];
  for (const element of container.querySelector(".tooltip-grid")!.children) {
    if (element.classList.contains("tooltip-group-divider")) break;
    labels.push(element.querySelector(".label")!.textContent!);
  }
  return labels;
}

const valueOf = (container: Element, testId: string) =>
  container.querySelector(`[data-testid="${testId}"] .val`)!.textContent;
const colourOf = (container: Element, testId: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${testId}"] .val`)!.style.color;

describe("popup rows of dew point and relative humidity (REQ-676)", () => {
  it("follow the apparent temperature in the temperature group when both are drawn", () => {
    const { container } = popupAt({ dewPoint: "on", relativeHumidity: "on" });
    expect(temperatureGroup(container)).toEqual([
      "Temperature:",
      "Apparent Temp:",
      "Dew Point:",
      "Dew Point Spread:",
      "Rel. Humidity:",
    ]);
    // The wind group follows after its divider, as before.
    expect(container.querySelector(".tooltip-group-divider")!.getAttribute("data-testid")).toBe(
      "tooltip-divider-temperature",
    );
  });

  it.each([
    ["on", input, true],
    ["auto", input, true],
    ["auto", dry, false],
    ["off", input, false],
    [undefined, input, false],
  ] as const)("dew point %s: rows only while drawn (%#)", (dewPoint, chartInput, drawn) => {
    const options: MeteogramRenderOptions = dewPoint ? { dewPoint } : {};
    const scene = createMeteogramScene(chartInput, { ...powerOptions, ...options });
    // Drawn exactly when the chart has a dew point line.
    expect(meteogramMarkupHasDewPoint(chartInput, options)).toBe(drawn);
    for (const hour of [3, 15, 40]) {
      const { container, info } = popupAt(options, hour, chartInput);
      expect(info.data?.["dew_point"]?.value).toEqual(expect.any(Number));
      expect(newRows(container)).toEqual(drawn ? NEW_ROWS.slice(0, 2) : []);
    }
    expect(scene.tooltipGroups[0]!.rows).toEqual(
      drawn ? ["temperature", "apparent_temperature", "dew_point", "dew_point_spread"] : ["temperature", "apparent_temperature"],
    );
  });

  it("decides by the visible range when auto, like the line", () => {
    // Spread 2 K from +48 h to +54 h, 8 K elsewhere.
    const humid = withDewPointAndHumidity((time) => (time >= START + 48 * HOUR && time <= START + 54 * HOUR ? 2 : 8));
    const at = (from: number, to: number) => ({
      dewPoint: "auto" as const,
      visibleRange: { start: START + from * HOUR, end: START + to * HOUR },
    });
    expect(newRows(popupAt(at(12, 36), 20, humid).container)).toEqual([]);
    expect(meteogramMarkupHasDewPoint(humid, at(12, 36))).toBe(false);
    // Across the whole visible range, also at hours far from the humid ones.
    expect(newRows(popupAt(at(40, 64), 42, humid).container)).toEqual(NEW_ROWS.slice(0, 2));
    expect(meteogramMarkupHasDewPoint(humid, at(40, 64))).toBe(true);
  });

  it.each([
    ["on", true],
    ["off", false],
    [undefined, false],
  ] as const)("relative humidity %s: row only while drawn", (relativeHumidity, drawn) => {
    const options: MeteogramRenderOptions = relativeHumidity ? { relativeHumidity } : {};
    for (const hour of [3, 15, 40]) {
      const { container } = popupAt(options, hour);
      expect(newRows(container)).toEqual(drawn ? ["tooltip-row-relative_humidity"] : []);
    }
    if (drawn) expect(temperatureGroup(popupAt(options).container)).toEqual(["Temperature:", "Apparent Temp:", "Rel. Humidity:"]);
  });

  it("has no humidity row with the switch on but no values in the data (nothing drawn)", () => {
    const { container } = popupAt({ relativeHumidity: "on" }, 15, powerInput);
    expect(newRows(container)).toEqual([]);
  });

  it("shows the spread as temperature minus dew point with one decimal", () => {
    for (const hour of [3, 15, 27, 40, 60]) {
      const { container, info } = popupAt({ dewPoint: "on" }, hour);
      const temperature = info.data!["temperature"]!.value!;
      const dewPoint = info.data!["dew_point"]!.value!;
      expect(valueOf(container, "tooltip-row-dew_point")).toBe(`${dewPoint} °C`);
      const spread = valueOf(container, "tooltip-row-dew_point_spread")!;
      expect(spread).toMatch(/^-?\d+(\.\d)? °C$/);
      expect(parseFloat(spread)).toBeCloseTo(temperature - dewPoint, 5);
    }
  });

  it("rounds the spread to one decimal and the humidity to whole percent", () => {
    const { info } = popupAt({ dewPoint: "on", relativeHumidity: "on" });
    const at = (temperature: number, dewPoint: number, humidity: number): MeteogramHoverInfo => ({
      ...info,
      data: {
        ...info.data,
        temperature: { ...info.data!["temperature"]!, value: temperature },
        dew_point: { ...info.data!["dew_point"]!, value: dewPoint },
        relative_humidity: { ...info.data!["relative_humidity"]!, value: humidity },
      },
    });
    const render = (hover: MeteogramHoverInfo) => {
      const container = document.createElement("div");
      renderTooltipContent(container, hover, { quantities: createMeteogramScene(input, powerOptions).quantities });
      return container;
    };
    // 12.3 − 8.1 is 4.200000000000001 in floating point.
    const humid = render(at(12.3, 8.1, 87.6));
    expect(valueOf(humid, "tooltip-row-dew_point_spread")).toBe("4.2 °C");
    expect(valueOf(humid, "tooltip-row-relative_humidity")).toBe("88 %");
    const frost = render(at(-3.5, -4, 64.4));
    expect(valueOf(frost, "tooltip-row-dew_point")).toBe("-4 °C");
    expect(valueOf(frost, "tooltip-row-dew_point_spread")).toBe("0.5 °C");
    expect(valueOf(frost, "tooltip-row-relative_humidity")).toBe("64 %");
    expect(valueOf(render(at(5, 5, 100)), "tooltip-row-dew_point_spread")).toBe("0 °C");
  });

  it("leaves out an hour without a dew point (a gap in the line), the spread with it", () => {
    const { info } = popupAt({ dewPoint: "on" });
    const container = document.createElement("div");
    renderTooltipContent(
      container,
      { ...info, data: { ...info.data, dew_point: { ...info.data!["dew_point"]!, value: null } } },
      { quantities: createMeteogramScene(input, powerOptions).quantities },
    );
    expect(newRows(container)).toEqual([]);
    expect(temperatureGroup(container)).toEqual(["Temperature:", "Apparent Temp:"]);
  });

  it("colours dew point and humidity like their lines, in the chart's theme", () => {
    const light = popupAt({ dewPoint: "on", relativeHumidity: "on" }).container;
    expect(colourOf(light, "tooltip-row-dew_point")).toBe(`var(--graupel-tooltip-dew-point, ${LIGHT_THEME.series["dew_point"]})`);
    expect(colourOf(light, "tooltip-row-relative_humidity")).toBe(
      `var(--graupel-tooltip-relative-humidity, ${LIGHT_THEME.series["relative_humidity"]})`,
    );
    // The spread has the plain value colour.
    expect(colourOf(light, "tooltip-row-dew_point_spread")).toBe("var(--graupel-tooltip-text, #f8fafc)");
    const dark = popupAt({ dewPoint: "on", relativeHumidity: "on", theme: "dark" }).container;
    expect(colourOf(dark, "tooltip-row-dew_point")).toBe(`var(--graupel-tooltip-dew-point, ${DARK_THEME.series["dew_point"]})`);
    expect(colourOf(dark, "tooltip-row-relative_humidity")).toBe(
      `var(--graupel-tooltip-relative-humidity, ${DARK_THEME.series["relative_humidity"]})`,
    );
  });

  it("takes its labels from the tooltip texts, English by default", () => {
    expect(DEFAULT_TOOLTIP_TEXTS).toMatchObject({
      dewPoint: "Dew Point:",
      dewPointSpread: "Dew Point Spread:",
      relativeHumidity: "Rel. Humidity:",
    });
    const texts = { dewPoint: "Taupunkt:", dewPointSpread: "Taupunktdifferenz:", relativeHumidity: "Rel. Feuchte:" };
    const { container } = popupAt({ dewPoint: "on", relativeHumidity: "on" }, 15, input, texts);
    expect(temperatureGroup(container).slice(2)).toEqual(["Taupunkt:", "Taupunktdifferenz:", "Rel. Feuchte:"]);
  });
});

describe("rows from the layout's popup groups (REQ-665, REQ-676)", () => {
  const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);
  const withTemperatureTooltip = (rows: string[]): ChartLayout => ({
    ...POWER_LAYOUT,
    areas: POWER_LAYOUT.areas.map((area) =>
      area.id === "temp" ? { ...area, tooltip: [{ group: "temperature", order: 1, rows }] } : area,
    ),
  });

  it("are named in the temperature group of both built-in layouts and the default rows", () => {
    const rows = ["temperature", "apparent_temperature", "dew_point", "dew_point_spread", "relative_humidity"];
    for (const layout of BUILTIN_LAYOUTS) {
      const tooltip = layout.areas.find((area) => area.id === "temp")!.tooltip as Exclude<LayoutArea["tooltip"], string[]>;
      expect(tooltip?.[0]?.rows).toEqual(rows);
      expect(validateChartLayout(layout)).toEqual([]);
    }
    expect(DEFAULT_TOOLTIP_GROUPS[0]!.rows).toEqual(rows);
  });

  it("follow the layout: a layout without them shows none, even when drawn", () => {
    const layout = withTemperatureTooltip(["temperature", "apparent_temperature"]);
    expect(newRows(popupAt({ layout, dewPoint: "on", relativeHumidity: "on" }).container)).toEqual([]);
    // The spread alone, in its own place.
    const spreadFirst = withTemperatureTooltip(["dew_point_spread", "temperature"]);
    expect(validateChartLayout(spreadFirst)).toEqual([]);
    const { container } = popupAt({ layout: spreadFirst, dewPoint: "on" });
    expect(temperatureGroup(container)).toEqual(["Dew Point Spread:", "Temperature:"]);
    expect(newRows(popupAt({ layout: spreadFirst, dewPoint: "off" }).container)).toEqual([]);
  });

  it("count the spread as no quantity of the layout", () => {
    const { layout } = resolveChartLayout(withTemperatureTooltip(["temperature", "dew_point_spread"]));
    expect(getLayoutQuantities(layout).has("dew_point_spread")).toBe(false);
  });

  it("leave a hidden quantity out, the spread with its sources", () => {
    const groups = [{ group: "temperature", rows: ["temperature", "dew_point", "dew_point_spread", "relative_humidity"], order: 1 }];
    expect(withoutTooltipRows(groups, new Set(["dew_point"]))[0]!.rows).toEqual(["temperature", "relative_humidity"]);
    expect(withoutTooltipRows(groups, new Set(["relative_humidity"]))[0]!.rows).toEqual([
      "temperature",
      "dew_point",
      "dew_point_spread",
    ]);
    expect(withoutTooltipRows(groups, new Set())).toEqual(groups);
  });

  it("keep the relative humidity out of the layout's quantities while it is off", () => {
    expect(createMeteogramScene(input, powerOptions).layoutQuantities.has("relative_humidity")).toBe(false);
    expect(createMeteogramScene(input, { ...powerOptions, relativeHumidity: "on" }).layoutQuantities.has("relative_humidity")).toBe(true);
  });
});

/** Whether the chart draws a dew point line. */
function meteogramMarkupHasDewPoint(chartInput: MeteogramInput, options: MeteogramRenderOptions): boolean {
  const scene = createMeteogramScene(chartInput, { ...powerOptions, ...options });
  return scene.geometry.areas.some(({ area }) =>
    area.series.some((series) => series.quantity === "dew_point" && scene.areaContext.spreadStretchesOf(series).length > 0),
  );
}

// --- the side bar on a phone: the controller's tooltip with short texts (the website's narrow full-screen view) ---

describe("side bar on a phone (REQ-676)", () => {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const box = (width: number, height: number) =>
    ({ left: 0, top: 0, width, height, x: 0, y: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.tagName.toLowerCase() === "svg") return box(844, 390);
      if ((this as HTMLElement).dataset?.testid === "meteogram") return box(844, 390);
      return box(0, 0);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  const SHORT_TEXTS: Partial<MeteogramTooltipTexts> = {
    dewPoint: "Taupkt.:",
    dewPointSpread: "Differenz:",
    relativeHumidity: "Feuchte:",
  };

  function sideBar(options: MeteogramOptions, hour = 15) {
    const host = document.body.appendChild(document.createElement("div"));
    const meteogram = createMeteogram(host, input, {
      ...powerOptions,
      mode: "fullscreen",
      tooltipTexts: SHORT_TEXTS,
      ...options,
    });
    meteogram.setHover(START + hour * HOUR);
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(tooltip.style.display).not.toBe("none");
    meteogram.destroy();
    return tooltip;
  }

  it.each([
    [{ dewPoint: "on", relativeHumidity: "on" }, ["Taupkt.:", "Differenz:", "Feuchte:"]],
    [{ dewPoint: "auto", relativeHumidity: "off" }, ["Taupkt.:", "Differenz:"]],
    [{ dewPoint: "off", relativeHumidity: "on" }, ["Feuchte:"]],
    [{ dewPoint: "off", relativeHumidity: "off" }, []],
    [{}, []],
  ] as const)("shows the rows while drawn (%#)", (options, labels) => {
    const tooltip = sideBar(options);
    expect(temperatureGroup(tooltip).slice(2)).toEqual(labels);
  });

  it("has no dew point rows when auto and the condition holds nowhere", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const meteogram = createMeteogram(host, dry, { ...powerOptions, mode: "fullscreen", dewPoint: "auto", tooltipTexts: SHORT_TEXTS });
    meteogram.setHover(START + 15 * HOUR);
    const tooltip = meteogram.element.querySelector<HTMLElement>('[data-testid="meteogram-tooltip"]')!;
    expect(newRows(tooltip)).toEqual([]);
    meteogram.destroy();
  });

  it("takes the colours of the chart's theme", () => {
    const tooltip = sideBar({ dewPoint: "on", relativeHumidity: "on", theme: "dark" });
    expect(colourOf(tooltip, "tooltip-row-dew_point")).toContain(DARK_THEME.series["dew_point"]!);
    expect(colourOf(tooltip, "tooltip-row-relative_humidity")).toContain(DARK_THEME.series["relative_humidity"]!);
  });
});
