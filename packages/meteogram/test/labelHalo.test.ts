// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Halo behind labels as its own element (REQ-747): no text strokes itself with `paint-order`, which Safari
 * painted over the fill of stretched texts. Each halo is a stroked copy right before its filled text, with the same
 * place, stretch and text; test ids stay on the filled text.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import type { MeteogramInput } from "../src";
import { labelHalo, withHalo } from "../src/render/halo";
import { renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, h, textContent, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const INSIDE = { axisLabels: { align: "inside", unit: "below" }, padding: { left: 0, right: 0 } } as const;
const COMPACT_INSIDE = { axisLabels: { align: "inside", unit: "below", compact: true }, padding: { left: 0, right: 0 } } as const;

/** The fixture high up, so the terrain label is drawn (REQ-510). */
const highInput: MeteogramInput = { ...powerInput, location: { ...powerInput.location!, elevation: 3158 } };

/** Filled texts with test id or key `id` (halo copies have neither). */
const textsOf = (layer: VNode, id: string) =>
  findAll(layer, (node) => node.tag === "text" && (node.attrs["data-testid"] === id || node.key === id));

const layerOf = (options: MeteogramRenderOptions, input: MeteogramInput = highInput) =>
  renderStaticLayer(createMeteogramScene(input, { ...powerOptions, ...options }));

const CASES: [string, MeteogramRenderOptions][] = [
  ["beside the plot", {}],
  ["over the plot", INSIDE],
  ["over the plot, compact", COMPACT_INSIDE],
  ["over the plot, dark", { ...INSIDE, theme: { base: "dark" } }],
];

describe("halo behind labels (REQ-747)", () => {
  it.each(CASES)("%s: no element strokes with paint-order", (_, options) => {
    const layer = layerOf(options);
    expect(findAll(layer, (node) => node.attrs["paint-order"] !== undefined)).toEqual([]);
  });

  it.each(CASES)("%s: each halo is a stroked copy right before its filled text", (_, options) => {
    const layer = layerOf(options);
    const groups = findAll(layer, (node) => node.attrs.class === "label-halo");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const [halo, text, ...rest] = group.children as VNode[];
      expect(rest).toEqual([]);
      expect(halo!.attrs["data-halo"]).toBe("true");
      expect(halo!.attrs["aria-hidden"]).toBe("true");
      expect(halo!.attrs.fill).toBe("none");
      expect(halo!.attrs.stroke).toEqual(expect.any(String));
      expect(halo!.attrs["data-testid"]).toBeUndefined();
      expect(text!.attrs.stroke).toBeUndefined();
      expect(text!.attrs.fill).toEqual(expect.any(String));
      for (const attr of ["x", "y", "transform", "font-size", "font-weight", "text-anchor"]) {
        expect(halo!.attrs[attr], attr).toBe(text!.attrs[attr]);
      }
      expect(textContent(halo!)).toBe(textContent(text!));
    }
  });

  it("draws the halos of daily extremes, terrain label, axis labels and cloud altitudes over the plot", () => {
    const layer = layerOf(INSIDE);
    const haloed = new Set(
      findAll(layer, (node) => node.attrs.class === "label-halo").map((group) =>
        String((group.children[1] as VNode).attrs["data-testid"] ?? (group.children[1] as VNode).key),
      ),
    );
    for (const id of ["daily-max-temp", "daily-min-temp", "terrain-mask-label", "axis-max", "axis-min"]) {
      expect([...haloed].some((entry) => entry === id), id).toBe(true);
    }
    expect([...haloed].some((entry) => entry.startsWith("cloud-altitude-label-"))).toBe(true);
  });

  it("keeps the colours of the halos: background for labels, the extremes' halo colour for daily extremes", () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      const layer = layerOf({ ...INSIDE, theme: { base: theme === LIGHT_THEME ? "light" : "dark" } });
      const haloOf = (testId: string) =>
        textsOf(layer, testId)
          .map((text) => findAll(layer, (node) => node.attrs.class === "label-halo" && node.children.includes(text))[0])
          .map((group) => (group!.children[0] as VNode).attrs.stroke)[0];
      expect(haloOf("daily-max-temp")).toBe(theme.extremes.halo);
      expect(haloOf("terrain-mask-label")).toBe(theme.background);
      expect(haloOf("axis-max")).toBe(theme.background);
    }
  });

  it("leaves test ids and keys on the filled text", () => {
    const layer = layerOf(INSIDE);
    for (const id of ["daily-max-temp", "terrain-mask-label", "axis-max"]) {
      const nodes = textsOf(layer, id);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.attrs.stroke).toBeUndefined();
    }
  });

  it("withHalo: copies tspans without their own attributes, keys the parts, leaves a text without halo alone", () => {
    const text = h(
      "text",
      { key: "label", x: 1, y: 2, fill: "red", "data-testid": "label", "data-lines": 2 },
      h("tspan", { key: 0, x: 1 }, "5"),
      h("tspan", { key: 1, x: 1, dy: 9.9 }, "mm"),
    );
    expect(withHalo(text, null)).toBe(text);
    const group = withHalo(text, labelHalo("#fff"));
    expect(group.key).toBe("label-with-halo");
    const [halo, filled] = group.children as VNode[];
    expect(filled).toBe(text);
    expect(halo!.key).toBe("label-halo");
    expect(halo!.attrs).toEqual({
      x: 1,
      y: 2,
      fill: "none",
      stroke: "#fff",
      "stroke-width": "3",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      "data-halo": "true",
    });
    expect((halo!.children as VNode[]).map((tspan) => [tspan.attrs, textContent(tspan)])).toEqual([
      [{ x: 1 }, "5"],
      [{ x: 1, dy: 9.9 }, "mm"],
    ]);
  });
});
