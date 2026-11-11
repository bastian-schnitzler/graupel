// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/** Standard tooltip content and size observation. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS } from "../src/core/timeline";
import { observeSize } from "../src/interaction/dimensions";
import { buildHoverInfo, hoverAtTime } from "../src/interaction/hover";
import { renderTooltipContent } from "../src/interaction/tooltip";
import { createMeteogramScene } from "../src/render/scene";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const POWER_START = Date.UTC(2026, 9, 15, 0);
const scene = createMeteogramScene(powerInput, powerOptions);
const infoAt = (hour: number) =>
  buildHoverInfo(scene, hoverAtTime(scene, POWER_START + hour * HOUR_MS), powerInput);

function tooltipFor(hour: number, texts = {}) {
  const container = document.createElement("div");
  const shown = renderTooltipContent(container, infoAt(hour), { quantities: scene.quantities, texts });
  return { container, shown };
}

const rowValue = (container: Element, label: string) =>
  Array.from(container.querySelectorAll(".tooltip-row"))
    .find((row) => row.querySelector(".label")?.textContent === label)
    ?.querySelector(".val")?.textContent;

const LABEL_OF: Record<string, string> = {
  temp: "Temperature:",
  "apparent-temp": "Apparent Temp:",
  wind: "Wind Speed:",
  gust: "Wind Gusts:",
};
/** Inline colour of a row's value, the row found by its label. */
const valueStyle = (container: Element, row: string) => {
  const value = Array.from(container.querySelectorAll(".tooltip-row"))
    .find((element) => element.querySelector(".label")?.textContent === LABEL_OF[row])
    ?.querySelector<HTMLElement>(".val");
  expect(value, row).toBeDefined();
  return value!.style.color;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("renderTooltipContent", () => {
  it("colours apparent temperature and gusts like temperature and wind (REQ-442)", () => {
    const { container } = tooltipFor(15);
    const colourOf = (cls: string) => valueStyle(container, cls);
    expect(colourOf("temp")).toBe("var(--graupel-tooltip-temperature, #f43f5e)");
    expect(colourOf("wind")).toBe("var(--graupel-tooltip-wind, #0ea5e9)");
    // Own variable first, then the partner's variable and default.
    expect(colourOf("apparent-temp")).toBe(
      "var(--graupel-tooltip-apparent-temperature, var(--graupel-tooltip-temperature, #f43f5e))",
    );
    expect(colourOf("gust")).toBe("var(--graupel-tooltip-gust, var(--graupel-tooltip-wind, #0ea5e9))");
  });

  it("resolves apparent temperature and gusts to the partner colour unless overridden", () => {
    // Resolves var() fallbacks like the browser does, against custom properties.
    const resolve = (value: string, props: Record<string, string>): string => {
      const match = /^var\((--[\w-]+), (.*)\)$/.exec(value);
      if (!match) return value;
      return props[match[1]!] ?? resolve(match[2]!, props);
    };
    const { container } = tooltipFor(15);
    const colourOf = (cls: string, props: Record<string, string> = {}) =>
      resolve(valueStyle(container, cls), props);
    expect(colourOf("apparent-temp")).toBe(colourOf("temp"));
    expect(colourOf("gust")).toBe(colourOf("wind"));
    const partner = { "--graupel-tooltip-temperature": "#111111", "--graupel-tooltip-wind": "#222222" };
    expect(colourOf("apparent-temp", partner)).toBe("#111111");
    expect(colourOf("gust", partner)).toBe("#222222");
    const own = { "--graupel-tooltip-apparent-temperature": "#333333", "--graupel-tooltip-gust": "#444444" };
    expect(colourOf("apparent-temp", own)).toBe("#333333");
    expect(colourOf("gust", own)).toBe("#444444");
  });

  it("shows the local time, model, run and grouped values of the hovered hour", () => {
    const { container, shown } = tooltipFor(13);
    expect(shown).toBe(true);
    // 13Z = 15:00 in Berlin.
    expect(container.querySelector(".tooltip-header")!.textContent).toBe("Thu, 10/15 — 15:00");
    expect(container.querySelector(".tooltip-section-title")!.textContent).toContain("ICON-D2");
    expect(container.querySelector('[data-testid="tooltip-run-info"]')!.textContent).toBe(
      "Run 15.10. 02:00 + 48h",
    );
    const data = infoAt(13).data!;
    expect(rowValue(container, "Temperature:")).toBe(`${data["temperature"]!.value} °C`);
    expect(rowValue(container, "Direction:")).toMatch(/^\d+° [NESW]+$/);
    expect(container.querySelector('[data-testid="accumulated-precip-val"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tooltip-lpi"]')!.textContent).toContain("4 J/kg");
    expect(container.querySelector('[data-testid="tooltip-val-cape"]')!.textContent).toBe("300 J/kg");
    for (const group of ["temperature", "wind", "precipitation"]) {
      expect(container.querySelector(`[data-testid="tooltip-divider-${group}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="snowfall-row"]')).toBeNull();
  });

  it("adds the snow group in snowy hours and shows CIN as a negative value", () => {
    const { container } = tooltipFor(47);
    expect(container.querySelector('[data-testid="snowfall-row"]')!.textContent).toContain("0.6 cm");
    expect(container.querySelector('[data-testid="snow-depth-row"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="accumulated-snowfall-val"]')!.textContent).toBe(
      "1.8 cm",
    );
    const cin = tooltipFor(42).container.querySelector('[data-testid="tooltip-val-convective_inhibition"]');
    expect(cin!.textContent).toBe("-60 J/kg");
  });

  // REQ-495: dividers only between visible groups, never after the last one.
  const gridChildren = (container: Element) =>
    Array.from(container.querySelector(".tooltip-grid")!.children) as HTMLElement[];
  const isDivider = (element: Element) => element.classList.contains("tooltip-group-divider");

  it("puts a divider between groups but none after the last visible group", () => {
    for (const hour of [13, 42, 47]) {
      const children = gridChildren(tooltipFor(hour).container);
      expect(isDivider(children[0]!)).toBe(false);
      expect(isDivider(children[children.length - 1]!)).toBe(false);
      // Never two dividers in a row (no empty group between them).
      children.forEach((child, index) => {
        if (index > 0 && isDivider(child)) expect(isDivider(children[index - 1]!)).toBe(false);
      });
    }
  });

  it("drops the divider before a hidden last group (snow without snowfall)", () => {
    const base = infoAt(47);
    const withoutConvective = new Set([...base.quantities].filter((q) => q !== "cape" && q !== "convective_inhibition"));
    const snowy = { ...base, quantities: withoutConvective, lpiValue: null };
    const container = document.createElement("div");
    renderTooltipContent(container, snowy, { quantities: scene.quantities });
    let children = gridChildren(container);
    // Snow is the last group: divider after precipitation, none after snow.
    expect(container.querySelector('[data-testid="tooltip-divider-precipitation"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tooltip-divider-snow"]')).toBeNull();
    expect(children[children.length - 1]!.textContent).toContain("Accumulated Snowfall:");

    // Same hour without snow data: the snow group is hidden and precipitation is last.
    const data = { ...base.data!, snowfall: { ...base.data!["snowfall"]!, value: 0 }, snow_depth: { ...base.data!["snow_depth"]!, value: 0 } };
    renderTooltipContent(container, { ...snowy, data }, { quantities: scene.quantities });
    children = gridChildren(container);
    expect(container.querySelector('[data-testid="snowfall-row"]')).toBeNull();
    expect(container.querySelector('[data-testid="tooltip-divider-precipitation"]')).toBeNull();
    expect(isDivider(children[children.length - 1]!)).toBe(false);
    expect(container.querySelectorAll(".tooltip-group-divider")).toHaveLength(2);
  });

  it("takes overridden texts and shows nothing without data", () => {
    const { container } = tooltipFor(13, { temperature: "Temperatur:" });
    expect(rowValue(container, "Temperatur:")).toBeDefined();
    const empty = document.createElement("div");
    const info = { ...infoAt(13), data: null };
    expect(renderTooltipContent(empty, info, { quantities: scene.quantities })).toBe(false);
    expect(empty.childNodes.length).toBe(0);
  });
});

describe("observeSize", () => {
  it("reports the measured size once per change and stops on disconnect", () => {
    let callback: (() => void) | null = null;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const element = document.createElement("div");
    let size = { width: 0, height: 0 };
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(
      () => ({ ...size, left: 0, top: 0, right: size.width, bottom: size.height }) as DOMRect,
    );
    const onChange = vi.fn();
    const observer = observeSize(element, onChange);
    // Not laid out yet: nothing reported.
    expect(onChange).not.toHaveBeenCalled();
    size = { width: 640, height: 300 };
    callback!();
    callback!();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ width: 640, height: 300 });
    size = { width: 800, height: 300 };
    observer.measure();
    expect(onChange).toHaveBeenLastCalledWith({ width: 800, height: 300 });
    observer.disconnect();
    expect(disconnect).toHaveBeenCalled();
  });

  it("measures once without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ width: 500, height: 200 } as DOMRect);
    const onChange = vi.fn();
    observeSize(element, onChange).disconnect();
    expect(onChange).toHaveBeenCalledWith({ width: 500, height: 200 });
  });
});
