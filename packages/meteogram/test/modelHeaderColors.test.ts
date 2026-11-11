// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/** Header colour per model (option `modelHeaderColors`, REQ-444) and the colour helpers behind it. */
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor, readableTextColor } from "../src/core/color";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import { renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { findAll, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

interface Header {
  model: string;
  fill: string;
  text: string;
}

function headers(options: MeteogramRenderOptions): Header[] {
  const root = renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, ...options }));
  return findAll(root, (node) => node.attrs["data-testid"] === "model-label-segment").map((group: VNode) => {
    const [shape] = findAll(group, (node) => node.attrs["data-testid"] === "model-header-shape");
    const [label] = findAll(group, (node) => node.attrs["data-testid"] === "model-header-label");
    return { model: String(group.attrs["data-model"]), fill: String(shape!.attrs.fill), text: String(label!.attrs.fill) };
  });
}

describe("colour helpers", () => {
  it("parses hex and rgb colours", () => {
    expect(parseColor("#fa0")).toEqual([255, 170, 0]);
    expect(parseColor("#FFAA00cc")).toEqual([255, 170, 0]);
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseColor("rgba(10 20 30 / 0.5)")).toEqual([10, 20, 30]);
    expect(parseColor("hsl(30 100% 50%)")).toBeNull();
    expect(parseColor("orange")).toBeNull();
  });

  it("computes the WCAG contrast ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("nope", "#ffffff")).toBeNull();
  });

  it("picks the candidate with the higher contrast", () => {
    expect(readableTextColor("#fdba74", ["#0f172a", "#ffffff"])).toBe("#0f172a");
    expect(readableTextColor("#4c1d95", ["#0f172a", "#ffffff"])).toBe("#ffffff");
    expect(readableTextColor("var(--x)", ["#0f172a", "#ffffff"])).toBe("#0f172a");
  });
});

describe("modelHeaderColors", () => {
  it("keeps the theme colour without the option", () => {
    for (const [theme, tokens] of [
      ["light", LIGHT_THEME],
      ["dark", DARK_THEME],
    ] as const) {
      const drawn = headers({ theme });
      expect(drawn.length).toBe(3); // ICON-D2 in two runs, ICON-EU
      for (const header of drawn) {
        expect(header.fill).toBe(tokens.modelHeader.background);
        expect(header.text).toBe(tokens.modelHeader.text);
      }
    }
  });

  it("draws each header in its model's colour, by id or by name", () => {
    const drawn = headers({ modelHeaderColors: { icon_d2: "#ea580c", "ICON-EU": "#fdba74" } });
    expect(drawn.map((header) => [header.model, header.fill])).toEqual([
      ["ICON-D2", "#ea580c"],
      ["ICON-D2", "#ea580c"],
      ["ICON-EU", "#fdba74"],
    ]);
  });

  it("prefers the id over the name and falls back to the theme for models without a colour", () => {
    const drawn = headers({ theme: "dark", modelHeaderColors: { icon_d2: "#c2410c", "ICON-D2": "#000000" } });
    expect(drawn[0]!.fill).toBe("#c2410c");
    expect(drawn[2]!.fill).toBe(DARK_THEME.modelHeader.background);
    expect(drawn[2]!.text).toBe(DARK_THEME.modelHeader.text);
  });

  it("chooses a readable text colour on the header colour", () => {
    const drawn = headers({ modelHeaderColors: { icon_d2: "#3b0764", icon_eu: "#fed7aa" } });
    expect(drawn[0]!.text).toBe(LIGHT_THEME.modelHeader.contrastText);
    expect(drawn[2]!.text).toBe(LIGHT_THEME.modelHeader.text);
    for (const header of drawn) expect(contrastRatio(header.fill, header.text)!).toBeGreaterThan(4.5);
  });

  it("uses the theme's text colours, also when overridden", () => {
    const drawn = headers({
      theme: { modelHeader: { text: "#111111", contrastText: "#eeeeee" } },
      modelHeaderColors: { icon_d2: "#222222", icon_eu: "#dddddd" },
    });
    expect(drawn[0]!.text).toBe("#eeeeee");
    expect(drawn[2]!.text).toBe("#111111");
  });
});
