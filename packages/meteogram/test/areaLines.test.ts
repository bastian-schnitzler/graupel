// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/** Top border of the first area and colour of the zero-degree line (REQ-594). */
import { describe, expect, it } from "vitest";
import { DARK_THEME, LIGHT_THEME } from "../src/core/theme";
import { meteogramToSvgString } from "../src/render/meteogram";
import { FIXTURES } from "./fixtures/meteogramFixtures";

const parse = (markup: string) => new DOMParser().parseFromString(markup, "image/svg+xml");

describe("top border of the first area (REQ-594)", () => {
  for (const [name, { input, options }] of Object.entries(FIXTURES)) {
    it(`closes the first area at its top in grey (fixture ${name})`, () => {
      const doc = parse(meteogramToSvgString(input, options));
      const borders = [...doc.querySelectorAll('[data-testid="chart-area-horizontal-border"]')];
      const top = borders.find((line) => line.getAttribute("data-edge") === "temperature-top");
      expect(top).toBeTruthy();
      expect(top!.getAttribute("stroke")).toBe(LIGHT_THEME.grid.line);
      const yOf = (edge: string) =>
        Number(borders.find((line) => line.getAttribute("data-edge") === edge)!.getAttribute("y1"));
      const y = Number(top!.getAttribute("y1"));
      expect(Number(top!.getAttribute("y2"))).toBe(y);
      expect(y).toBeGreaterThan(yOf("date-header-top"));
      expect(y).toBeLessThan(yOf("temperature-bottom"));
      // Every area now has a top and a bottom border, plus the top of the day header.
      const areaCount = new Set(borders.map((line) => line.getAttribute("data-edge")!.replace(/-(top|bottom)$/, ""))).size - 1;
      expect(borders).toHaveLength(areaCount * 2 + 1);
    });
  }
});

describe("zero-degree line (REQ-594)", () => {
  it("has its own theme colour, light and dark, apart from the grid", () => {
    expect(LIGHT_THEME.grid.freezingLine).toBe("#3b82f6");
    expect(DARK_THEME.grid.freezingLine).toBe("#60a5fa");
    expect(LIGHT_THEME.grid.freezingLine).not.toBe(LIGHT_THEME.grid.line);
    expect(DARK_THEME.grid.freezingLine).not.toBe(DARK_THEME.grid.line);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`is drawn in grid.freezingLine (${theme})`, () => {
      const { input, options } = FIXTURES.power;
      const doc = parse(meteogramToSvgString(input, { ...options, theme }));
      const line = doc.querySelector('[data-testid="freezing-line"]');
      expect(line).toBeTruthy();
      expect(line!.getAttribute("stroke")).toBe((theme === "dark" ? DARK_THEME : LIGHT_THEME).grid.freezingLine);
    });
  }

  it("takes a colour from the theme overrides", () => {
    const { input, options } = FIXTURES.power;
    const doc = parse(meteogramToSvgString(input, { ...options, theme: { grid: { freezingLine: "#ff00ff" } } }));
    expect(doc.querySelector('[data-testid="freezing-line"]')!.getAttribute("stroke")).toBe("#ff00ff");
  });
});
