// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/** Relative humidity in the temperature area, option `relativeHumidity` on and off, default off (REQ-649). */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_LAYOUTS,
  BUILTIN_QUANTITY_REGISTRY,
  DARK_THEME,
  HOUR_MS,
  LIGHT_THEME,
  RELATIVE_HUMIDITY_MODES,
  buildHoverInfo,
  hoverAtTime,
  isRelativeHumidityMode,
  type DataPoint,
  type MeteogramInput,
  type MeteogramRenderOptions,
} from "../src";
import { renderTooltipContent } from "../src/interaction/tooltip";
import { meteogramToSvgString } from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { normalInput, normalOptions, powerInput, powerOptions } from "./fixtures/meteogramFixtures";

/** The fixture with a relative humidity at every temperature point, `valueAt(time)` (null: missing). */
function withHumidity(
  base: MeteogramInput = powerInput,
  valueAt: (time: number) => number | null = (time) => Math.round(65 + 25 * Math.sin(time / (5 * HOUR_MS))),
): MeteogramInput {
  const humidity: DataPoint[] = base.series
    .filter((point) => point.variable === "temperature")
    .map((point) => ({ ...point, variable: "relative_humidity", unit: "%", value: valueAt(Date.parse(point.timestamp)) }));
  return { ...base, series: [...base.series, ...humidity] };
}

const input = withHumidity();
const on = { ...powerOptions, relativeHumidity: "on" } as const;

const parse = (markup: string) => new DOMParser().parseFromString(markup, "image/svg+xml");
const testIds = (doc: Document, id: string) => [...doc.querySelectorAll(`[data-testid="${id}"]`)];
const temperatureArea = (doc: Document) => doc.querySelector('[data-area-id="temp"]')!;
/** Texts of the temperature area outside its plot (axis labels and the like). */
const labelsOf = (doc: Document, text: string) =>
  [...temperatureArea(doc).querySelectorAll("text")].filter(
    (element) => element.textContent === text && element.getAttribute("data-halo") === null,
  );
/** Halo drawn right before a label (REQ-747), or null without one. */
const haloElementOf = (label: Element) =>
  label.previousElementSibling?.getAttribute("data-halo") === "true" ? label.previousElementSibling : null;

describe("relative humidity (REQ-649)", () => {
  it("is a quantity of the built-in registry after the dew point", () => {
    const definition = BUILTIN_QUANTITY_REGISTRY.get("relative_humidity");
    expect(definition).toMatchObject({
      label: "Relative humidity",
      unit: "%",
      kind: "point",
      source: "hourly",
      api_name: "relative_humidity_2m",
      aliases: ["relativehumidity_2m"],
      optional: true,
      catalogued: false,
      retry_without: true,
      allowed_styles: ["line", "tooltip"],
      downloadable: true,
      color: "#4f46e5",
    });
    const ids = BUILTIN_QUANTITY_REGISTRY.quantities.map((quantity) => quantity.id);
    expect(ids.indexOf("relative_humidity")).toBe(ids.indexOf("dew_point") + 1);
  });

  it("has a right axis from 0 to 100 and a line in the temperature area of both built-in layouts", () => {
    for (const layout of BUILTIN_LAYOUTS) {
      const area = layout.areas.find((entry) => entry.id === "temp")!;
      expect(area.axes?.right).toMatchObject({ quantity: "relative_humidity", range: "fixed", min: 0, max: 100 });
      expect(area.series?.find((series) => series.quantity === "relative_humidity")).toMatchObject({
        style: "line",
        axis: "right",
      });
    }
  });

  it("exports its modes and their check", () => {
    expect(RELATIVE_HUMIDITY_MODES).toEqual(["on", "off"]);
    expect(isRelativeHumidityMode("on")).toBe(true);
    expect(isRelativeHumidityMode("off")).toBe(true);
    expect(isRelativeHumidityMode("auto")).toBe(false);
    expect(isRelativeHumidityMode(null)).toBe(false);
  });

  it("draws the chart as before without the option (default off), and when off", () => {
    const plain = meteogramToSvgString(powerInput, powerOptions);
    const markup = meteogramToSvgString(input, powerOptions);
    expect(markup).toBe(plain);
    expect(meteogramToSvgString(input, { ...powerOptions, relativeHumidity: "off" })).toBe(plain);
    expect(meteogramToSvgString(input, { ...powerOptions, relativeHumidity: null })).toBe(plain);
    expect(meteogramToSvgString(withHumidity(normalInput), normalOptions)).toBe(
      meteogramToSvgString(normalInput, normalOptions),
    );
    const doc = parse(markup);
    expect(testIds(doc, "relative-humidity-path")).toHaveLength(0);
    expect(labelsOf(doc, "100 %")).toHaveLength(0);
    const scene = createMeteogramScene(input, powerOptions);
    expect(scene.relativeHumidity).toBe("off");
    expect(scene.areaScales[0]!.right).toBeNull();
    expect(scene.layout.areas[0]!.axes.right).toBeNull();
    expect(scene.layout.areas[0]!.series.some((series) => series.quantity === "relative_humidity")).toBe(false);
  });

  it("draws the chart as when off when the data has no relative humidity", () => {
    expect(meteogramToSvgString(powerInput, on)).toBe(meteogramToSvgString(powerInput, powerOptions));
    // Only missing values count as no data as well.
    expect(meteogramToSvgString(withHumidity(powerInput, () => null), on)).toBe(
      meteogramToSvgString(powerInput, powerOptions),
    );
    expect(createMeteogramScene(powerInput, on).areaScales[0]!.right).toBeNull();
  });

  it("draws a thin line in its colour on a fixed axis from 0 to 100 when on", () => {
    const doc = parse(meteogramToSvgString(input, on));
    const lines = testIds(doc, "relative-humidity-path");
    expect(lines).toHaveLength(1);
    expect(temperatureArea(doc).contains(lines[0]!)).toBe(true);
    expect(lines[0]!.getAttribute("stroke")).toBe(LIGHT_THEME.series.relative_humidity);
    expect(LIGHT_THEME.series.relative_humidity).toBe("#4f46e5");
    expect(lines[0]!.getAttribute("stroke-width")).toBe("1.5");
    const scene = createMeteogramScene(input, on);
    expect(scene.relativeHumidity).toBe("on");
    expect(scene.areaScales[0]!.right).toMatchObject({ min: 0, max: 100, quantity: "relative_humidity" });
  });

  it("labels the right side with 100 % and 0 % in the line colour, without the quantity name", () => {
    const doc = parse(meteogramToSvgString(input, on));
    const [max] = labelsOf(doc, "100 %");
    const [min] = labelsOf(doc, "0 %");
    expect(max).toBeDefined();
    expect(min).toBeDefined();
    for (const label of [max!, min!]) expect(label.getAttribute("fill")).toBe(LIGHT_THEME.series.relative_humidity);
    expect(Number(max!.getAttribute("y"))).toBeLessThan(Number(min!.getAttribute("y")));
    expect(labelsOf(doc, "Relative humidity")).toHaveLength(0);
    // Level with the temperature axis' maximum and minimum.
    const area = createMeteogramScene(input, on).geometry.areas[0]!;
    expect(Number(max!.getAttribute("y"))).toBe(area.top + 14);
    expect(Number(min!.getAttribute("y"))).toBe(area.bottom - 6);
  });

  it("puts the labels at the right in every alignment, over the plot 1 unit off the edge (REQ-622)", () => {
    const xOf = (align: "plot" | "edge" | "inside", padding?: MeteogramRenderOptions["padding"]) => {
      const options: MeteogramRenderOptions = { ...on, axisLabels: { align }, ...(padding ? { padding } : {}) };
      const scene = createMeteogramScene(input, options);
      const doc = parse(meteogramToSvgString(input, options));
      const labels = [...labelsOf(doc, "100 %"), ...labelsOf(doc, "0 %")];
      expect(labels).toHaveLength(2);
      return {
        scene,
        x: labels.map((label) => Number(label.getAttribute("x"))),
        anchors: labels.map((label) => label.getAttribute("text-anchor")),
        strokes: labels.map((label) => haloElementOf(label)?.getAttribute("stroke") ?? null),
      };
    };
    const plot = xOf("plot");
    expect(plot.x).toEqual([plot.scene.outerRightX + 4, plot.scene.outerRightX + 4]);
    expect(plot.anchors).toEqual([null, null]);
    const edge = xOf("edge");
    expect(edge.x).toEqual([edge.scene.svgWidth, edge.scene.svgWidth]);
    expect(edge.anchors).toEqual(["end", "end"]);
    const inside = xOf("inside", { left: 0, right: 0 });
    expect(inside.x).toEqual([inside.scene.svgWidth - 1, inside.scene.svgWidth - 1]);
    expect(inside.anchors).toEqual(["end", "end"]);
    expect(inside.strokes).toEqual([LIGHT_THEME.background, LIGHT_THEME.background]);
  });

  it("writes the unit below the value with axisLabels.unit below", () => {
    const doc = parse(meteogramToSvgString(input, { ...on, axisLabels: { unit: "below" } }));
    const multi = [...temperatureArea(doc).querySelectorAll("text[data-lines]")].map((element) =>
      [...element.querySelectorAll("tspan")].map((span) => span.textContent),
    );
    expect(multi).toContainEqual(["100", "%"]);
    expect(multi).toContainEqual(["0", "%"]);
  });

  it("leaves the temperature axis unchanged", () => {
    const left = (chartInput: MeteogramInput, options: MeteogramRenderOptions) => {
      const scale = createMeteogramScene(chartInput, options).areaScales[0]!.left!;
      return [scale.min, scale.max, scale.paddingTop, scale.paddingBottom];
    };
    expect(left(input, on)).toEqual(left(powerInput, powerOptions));
    const labels = (markup: string) =>
      [...temperatureArea(parse(markup)).querySelectorAll("text")]
        .filter((element) => /^-?\d+°$/.test(element.textContent ?? ""))
        .map((element) => element.outerHTML);
    expect(labels(meteogramToSvgString(powerInput, powerOptions)).length).toBeGreaterThan(0);
    expect(labels(meteogramToSvgString(input, on))).toEqual(labels(meteogramToSvgString(powerInput, powerOptions)));
  });

  it("leaves gaps where values are missing", () => {
    const start = Date.parse(powerInput.timeline!.start!);
    const gappy = withHumidity(powerInput, (time) =>
      time >= start + 20 * HOUR_MS && time < start + 24 * HOUR_MS ? null : 70,
    );
    const lines = testIds(parse(meteogramToSvgString(gappy, on)), "relative-humidity-path");
    expect(lines).toHaveLength(1);
    const d = lines[0]!.getAttribute("d")!;
    const xs = new Set([...d.matchAll(/[ML] ([\d.]+) /g)].map((match) => Number(match[1])));
    const { getX } = createMeteogramScene(gappy, on);
    expect(xs.has(getX(start + 19 * HOUR_MS))).toBe(true);
    for (const hour of [20, 21, 22, 23]) expect(xs.has(getX(start + hour * HOUR_MS))).toBe(false);
    expect(xs.has(getX(start + 24 * HOUR_MS))).toBe(true);
    // The line breaks there: a new subpath starts at +24 h.
    expect(d).toContain(`M ${getX(start + 24 * HOUR_MS)} `);
  });

  it("uses the dark theme colour", () => {
    const doc = parse(meteogramToSvgString(input, { ...on, theme: "dark" }));
    expect(testIds(doc, "relative-humidity-path")[0]!.getAttribute("stroke")).toBe(
      DARK_THEME.series.relative_humidity,
    );
    expect(labelsOf(doc, "100 %")[0]!.getAttribute("fill")).toBe(DARK_THEME.series.relative_humidity);
  });

  // Before REQ-676 the popup never showed it; now it does while it is drawn (see popupDewPointHumidity.test.ts).
  it("is shown in the popup only while drawn (REQ-676)", () => {
    const popupRow = (options: MeteogramRenderOptions) => {
      const scene = createMeteogramScene(input, options);
      const time = Date.parse(powerInput.timeline!.start!) + 15 * HOUR_MS;
      const info = buildHoverInfo(scene, hoverAtTime(scene, time), input);
      expect(info.data?.["relative_humidity"]?.value).toEqual(expect.any(Number));
      const container = document.createElement("div");
      expect(renderTooltipContent(container, info, { quantities: scene.quantities })).toBe(true);
      return container.querySelector('[data-testid="tooltip-row-relative_humidity"]');
    };
    expect(popupRow(on)?.textContent).toMatch(/^Rel\. Humidity:\d+ %$/);
    expect(popupRow(powerOptions)).toBeNull();
  });

  it("matches the SVG snapshot with relative humidity", async () => {
    await expect(meteogramToSvgString(input, { ...on, xmlDeclaration: true })).toMatchFileSnapshot(
      "./__snapshots__/power.relative-humidity.svg",
    );
  });
});
