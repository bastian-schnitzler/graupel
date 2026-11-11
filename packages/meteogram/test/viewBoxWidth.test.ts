// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Option `viewBoxWidth` of the scene: a narrower viewBox of the same height, so a chart showing a part of a longer span
 * keeps that span's height and drawing size. Without the option the chart is drawn as before.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { METEOGRAM_VIEWBOX_WIDTH } from "../src/core/viewLayout";
import { createMeteogram } from "../src/interaction/controller";
import { meteogramToSvgString, renderMeteogramSvg, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, DEFAULT_PLOT_PADDING, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const sceneWith = (options: MeteogramRenderOptions = {}) =>
  createMeteogramScene(powerInput, { ...powerOptions, ...options });

const fontSizes = (root: VNode) =>
  [...new Set(findAll(root, (node) => node.tag === "text").map((node) => String(node.attrs["font-size"])))].sort();

describe("option viewBoxWidth", () => {
  it("defaults to 1000; values that are not a positive number fall back to it", () => {
    const plain = meteogramToSvgString(powerInput, powerOptions);
    for (const viewBoxWidth of [undefined, null, 0, -400, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sceneWith({ viewBoxWidth }).svgWidth).toBe(METEOGRAM_VIEWBOX_WIDTH);
      expect(meteogramToSvgString(powerInput, { ...powerOptions, viewBoxWidth })).toBe(plain);
    }
    expect(meteogramToSvgString(powerInput, { ...powerOptions, viewBoxWidth: 1000 })).toBe(plain);
  });

  it("narrows the viewBox and the time axis; height and font sizes stay", () => {
    const wide = sceneWith();
    const narrow = sceneWith({ viewBoxWidth: 400 });
    expect(narrow.svgWidth).toBe(400);
    expect(narrow.geometry.totalHeight).toBe(wide.geometry.totalHeight);
    expect(renderMeteogramSvg(narrow).attrs.viewBox).toBe(`0 0 400 ${wide.geometry.totalHeight}`);
    expect(narrow.outerLeftX).toBe(DEFAULT_PLOT_PADDING);
    expect(narrow.outerRightX).toBe(400 - DEFAULT_PLOT_PADDING);
    expect(narrow.graphWidth).toBe(300);
    expect(narrow.timeline.timestampToX(narrow.timeline.startMs)).toBeCloseTo(50);
    expect(narrow.timeline.timestampToX(narrow.timeline.endMs)).toBeCloseTo(350);
    expect(fontSizes(renderStaticLayer(narrow))).toEqual(fontSizes(renderStaticLayer(wide)));
  });

  it("puts the right legend at its right edge, over the plot 1 unit off it (REQ-622)", () => {
    const layer = renderStaticLayer(
      sceneWith({ viewBoxWidth: 400, padding: { left: 0, right: 0 }, axisLabels: { align: "inside" } }),
    );
    const right = findAll(layer, (node) => node.tag === "text" && String(node.key ?? "").startsWith("right-"));
    expect(right.length).toBeGreaterThan(0);
    for (const node of right) expect(node.attrs.x).toBe(400 - 1);
  });

  it("keeps a padding below half its width", () => {
    const scene = sceneWith({ viewBoxWidth: 400, padding: { left: 150, right: 200 } });
    expect([scene.paddingLeft, scene.paddingRight]).toEqual([150, DEFAULT_PLOT_PADDING]);
  });

  it("draws text and icons at the scale of the rendered width per viewBox unit", () => {
    // 200 px for 400 units: the scale of 500 px for the default 1000 units, without stretching text.
    const height = sceneWith().geometry.totalHeight;
    const narrow = sceneWith({ viewBoxWidth: 400, size: { width: 200, height: height / 2 } });
    const wide = sceneWith({ size: { width: 500, height: height / 2 } });
    expect(narrow.pixelLayout.windIconScaleX).toBeCloseTo(2, 6);
    expect(narrow.pixelLayout.windIconScaleY).toBeCloseTo(2, 6);
    expect(narrow.pixelLayout.textScaleX).toBeCloseTo(1, 6);
    expect(narrow.pixelLayout.windIconFootprint).toBeCloseTo(wide.pixelLayout.windIconFootprint, 6);
  });

  it("insets the label row by the share of its width", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const meteogram = createMeteogram(element, powerInput, {
      ...powerOptions,
      viewBoxWidth: 400,
      padding: { left: 20, right: 10 },
    });
    const row = element.querySelector<HTMLElement>('[data-testid="meteogram-footer-row"]')!;
    expect(row.style.paddingLeft).toBe("5%");
    expect(row.style.paddingRight).toBe("2.5%");
    const svg = element.querySelector("svg.meteogram-svg-integrated")!;
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 400 /);
    meteogram.update(powerInput, powerOptions);
    expect(element.querySelector("svg.meteogram-svg-integrated")!.getAttribute("viewBox")).toMatch(/^0 0 1000 /);
    meteogram.destroy();
    element.remove();
  });
});
