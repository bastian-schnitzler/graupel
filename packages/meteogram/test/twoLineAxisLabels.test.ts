// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Two-line axis labels (REQ-738): with `axisLabels.unit: "below"` and without `compact` the maximum hangs
 * 1 px below the area's top edge and the minimum's unit line stands 1 px above its bottom edge, as with compact labels
 * (REQ-696). The other labels (zero line, guide lines) keep clear of them; one-line labels stay as they were.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DIGIT_ASCENT } from "../src/core/sunTimes";
import { LIGHT_THEME } from "../src/core/theme";
import type { MeteogramInput } from "../src";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID } from "../src/layouts/resolution";
import type { ChartLayout } from "../src/layouts/types";
import { axisLabelLineHeight, type AxisLabelBox, MID_LABEL_GAP, verticalPixel } from "../src/render/axisLabels";
import { renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, textContent, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

/** The website's narrow chart (plot edge to edge, labels over it) with value and unit below each other (REQ-542). */
const INSIDE_TWO_LINES = { axisLabels: { align: "inside", unit: "below" }, padding: { left: 0, right: 0 } } as const;
/** The same next to the plot. */
const TWO_LINES = { axisLabels: { unit: "below" } } as const;

const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

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

/** Scene, static layer and every area of a chart with its panel and labels. */
function chart(options: MeteogramRenderOptions = {}, input: MeteogramInput = powerInput) {
  const scene = createMeteogramScene(input, { ...powerOptions, ...options });
  const layer = renderStaticLayer(scene);
  const area = (id: string) => {
    const geometry = scene.geometry.areas.find((entry) => entry.area.id === id)!;
    const panel = findAll(layer, (node) => node.attrs["data-area-id"] === id)[0]!;
    const one = (key: string) => byKey(panel, key)[0];
    return { panel, one, top: geometry.top, bottom: geometry.bottom };
  };
  return { area, px: verticalPixel(scene.pixelLayout.windIconScaleY) };
}

describe("two-line axis labels in the corners (REQ-738)", () => {
  it("hangs the maximum 1 px below the top edge and stands the minimum 1 px above the bottom edge", () => {
    for (const options of [INSIDE_TWO_LINES, TWO_LINES]) {
      const { area, px } = chart(options);
      for (const id of ["precip", "wind"]) {
        const { one, top, bottom } = area(id);
        const max = one("axis-max")!;
        const min = one("axis-min")!;
        expect(lines(max)).toHaveLength(2);
        expect(boxOf(max).top).toBeCloseTo(top + px, 2);
        expect(lines(min)).toHaveLength(2);
        expect(boxOf(min).bottom).toBeCloseTo(bottom - px, 2);
      }
    }
  });

  it("places the temperature's labels in the corners as well, the degree sign in one line", () => {
    const { area, px } = chart(INSIDE_TWO_LINES);
    const { one, top, bottom } = area("temp");
    const max = one("axis-max");
    const min = one("axis-min");
    // A sunrise time over the maximum moves right of its line (REQ-734), so the maximum keeps the corner.
    if (max) expect(boxOf(max).top).toBeCloseTo(top + px, 2);
    if (min) expect(boxOf(min).bottom).toBeCloseTo(bottom - px, 2);
    expect(max ?? min).toBeDefined();
  });

  it("keeps the labels of the zero and the guide lines clear of maximum and minimum, also in small areas", () => {
    for (const scale of [1, 0.6]) {
      const { area } = chart({ ...INSIDE_TWO_LINES, layout: scaledLayout(scale) });
      for (const id of ["temp", "precip", "wind"]) {
        const { panel, one } = area(id);
        const max = one("axis-max");
        const min = one("axis-min");
        if (max && min) expect(boxOf(max).bottom).toBeLessThan(boxOf(min).top);
        const guides = texts(panel).filter((node) => /^axis-(mid|guide)/.test(String(node.key)));
        for (const guide of guides) {
          if (max) expect(boxOf(guide).top - boxOf(max).bottom).toBeGreaterThanOrEqual(MID_LABEL_GAP - 0.01);
          if (min) expect(boxOf(min).top - boxOf(guide).bottom).toBeGreaterThanOrEqual(MID_LABEL_GAP - 0.01);
        }
      }
    }
  });

  it("puts the right axis' maximum with its unit in the upper corner, the name below, the minimum in the lower", () => {
    const { area, px } = chart(INSIDE_TWO_LINES);
    const { one, top, bottom } = area("convective");
    const max = one("right-max")!;
    const name = one("right-name")!;
    const min = one("right-min")!;
    expect(lines(max)).toEqual([expect.stringMatching(/^\d+$/), "J/kg"]);
    expect(boxOf(max).top).toBeCloseTo(top + px, 2);
    const fontSize = LIGHT_THEME.fontSizes.axisRight;
    expect(Number(name.attrs.y)).toBeCloseTo(Number(max.attrs.y) + 2 * axisLabelLineHeight(fontSize), 2);
    expect(Number(min.attrs.y)).toBeCloseTo(bottom - px, 2);
    expect(textContent(min)).toBe("0");
  });

  it("puts the half axes' maxima in the corners", () => {
    const { area, px } = chart(INSIDE_TWO_LINES);
    const { one, top, bottom } = area("convective");
    const upper = one("cape-max")!;
    const lower = one("convective_inhibition-max")!;
    expect(lines(upper)).toEqual([expect.stringMatching(/^\d+$/), "J/kg"]);
    expect(boxOf(upper).top).toBeCloseTo(top + px, 2);
    expect(lines(lower)).toEqual([expect.stringMatching(/^−\d+$/), "J/kg"]);
    expect(boxOf(lower).bottom).toBeCloseTo(bottom - px, 2);
  });

  it("leaves one-line labels where they were", () => {
    const { area } = chart({ axisLabels: { align: "inside" }, padding: { left: 0, right: 0 } });
    const { one, top } = area("precip");
    const max = one("axis-max")!;
    expect(lines(max)).toHaveLength(1);
    expect(Number(max.attrs.y)).toBeCloseTo(top + 14, 2);
  });
});
