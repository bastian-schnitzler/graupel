// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/**
 * Popup from the layout (REQ-665): areas name the popup rows in groups; label and unit come from the registry. The
 * built-in layouts show the same popup as the same layouts without `tooltip` (the default rows) at every hour.
 */
import { describe, expect, it } from "vitest";
import { buildHoverInfo, hoverAtTime } from "../src/interaction/hover";
import { renderTooltipContent } from "../src/interaction/tooltip";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import { getLayoutQuantities } from "../src/layouts/quantities";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID, resolveChartLayout, validateChartLayout } from "../src/layouts/resolution";
import { DEFAULT_TOOLTIP_GROUPS, tooltipGroups } from "../src/layouts/tooltip";
import type { ChartLayout, LayoutArea } from "../src/layouts/types";
import { createQuantityRegistry, BUILTIN_QUANTITY_REGISTRY } from "../src/quantities/registry";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import { normalInput, normalOptions, powerInput, powerOptions } from "./fixtures/meteogramFixtures";
import type { MeteogramInput } from "../src/core/input";

const POWER_LAYOUT = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);

/** A layout without `tooltip` in its areas. */
function withoutTooltip(layout: ChartLayout): ChartLayout {
  return {
    ...layout,
    areas: layout.areas.map(
      (area) => Object.fromEntries(Object.entries(area).filter(([key]) => key !== "tooltip")) as unknown as LayoutArea,
    ),
  };
}

/** The power layout with `tooltip` of the wind area replaced. */
function windTooltip(tooltip: LayoutArea["tooltip"]): ChartLayout {
  return { ...POWER_LAYOUT, areas: POWER_LAYOUT.areas.map((area) => (area.id === "wind" ? { ...area, tooltip } : area)) };
}

/** Popup HTML of every hour of the chart. */
function popups(input: MeteogramInput, options: MeteogramRenderOptions): string[] {
  const scene = createMeteogramScene(input, options);
  return scene.timestamps.map((timestamp) => {
    const container = document.createElement("div");
    const info = buildHoverInfo(scene, hoverAtTime(scene, timestamp), input);
    renderTooltipContent(container, info, { quantities: scene.quantities });
    return container.innerHTML;
  });
}

function popupAt(options: MeteogramRenderOptions, hour: number) {
  const scene = createMeteogramScene(powerInput, { ...powerOptions, ...options });
  const container = document.createElement("div");
  renderTooltipContent(container, buildHoverInfo(scene, hoverAtTime(scene, scene.timestamps[hour]!), powerInput), {
    quantities: scene.quantities,
  });
  return container;
}

const dividers = (container: Element) =>
  Array.from(container.querySelectorAll(".tooltip-group-divider")).map((element) => (element as HTMLElement).dataset.testid);

describe("built-in layouts", () => {
  it("name the standard popup rows in their areas", () => {
    for (const layout of BUILTIN_LAYOUTS) {
      const { layout: resolved } = resolveChartLayout(layout);
      const groups = tooltipGroups(resolved, getLayoutQuantities(resolved));
      expect(groups.map((group) => group.group)).toEqual(
        layout.id === POWER_DEFAULT_LAYOUT_ID
          ? ["temperature", "wind", "precipitation", "snow", "convective"]
          : ["temperature", "wind", "precipitation", "snow"],
      );
      expect(validateChartLayout(layout)).toEqual([]);
      // Naming the rows adds no quantity to the layout, and the default has no extra rows for it.
      const plain = resolveChartLayout(withoutTooltip(layout)).layout;
      expect(getLayoutQuantities(resolved)).toEqual(getLayoutQuantities(plain));
      expect(tooltipGroups(plain, getLayoutQuantities(plain)).at(-1)).toEqual({ group: "extra", rows: [], order: null });
    }
  });

  it("show the same popup as without tooltip at every hour", () => {
    const cases: [MeteogramInput, MeteogramRenderOptions][] = [
      [powerInput, powerOptions],
      [normalInput, normalOptions],
      [powerInput, { ...powerOptions, relativeHumidity: "on", dewPoint: "on" }],
    ];
    for (const [input, options] of cases) {
      const layout = options === normalOptions ? BUILTIN_LAYOUTS[1]! : BUILTIN_LAYOUTS[0]!;
      const named = popups(input, { ...options, layout });
      // The hours cover the special rows: sums, snow group, LPI.
      if (input === powerInput) {
        for (const testId of ["snowfall-row", "snow-depth-row", "accumulated-snowfall-row", "accumulated-precip-row", "tooltip-lpi"]) {
          expect(named.some((html) => html.includes(`data-testid="${testId}"`)), testId).toBe(true);
        }
      }
      expect(named).toEqual(popups(input, { ...options, layout: withoutTooltip(layout) }));
    }
  });
});

describe("tooltip of an area", () => {
  it("shows a quantity the layout names with label and unit from the registry", () => {
    const layout = windTooltip([{ group: "wind", order: 2, rows: ["wind_speed", "cloud_cover"] }]);
    const input: MeteogramInput = {
      ...powerInput,
      series: [
        ...powerInput.series,
        ...powerInput.series
          .filter((point) => point.variable === "temperature")
          .map((point) => ({ ...point, variable: "cloud_cover", unit: "%", value: 40 })),
      ],
    };
    const scene = createMeteogramScene(input, { ...powerOptions, layout });
    expect(scene.layoutQuantities.has("cloud_cover")).toBe(true);
    const container = document.createElement("div");
    renderTooltipContent(container, buildHoverInfo(scene, hoverAtTime(scene, scene.timestamps[5]!), input), {
      quantities: scene.quantities,
    });
    const row = container.querySelector('[data-testid="tooltip-row-cloud_cover"]')!;
    expect(row.textContent).toBe("Cloud cover:40 %");
    // Gusts and direction are not named: no rows.
    expect(container.textContent).not.toContain("Wind Gusts:");
    expect(container.textContent).not.toContain("Direction:");
  });

  it("takes the unit of a row from the given registry", () => {
    const registry = createQuantityRegistry(
      BUILTIN_QUANTITY_REGISTRY.quantities.map((quantity) =>
        quantity.id === "wind_speed" ? { ...quantity, unit: "kn" } : quantity,
      ),
    );
    const container = popupAt({ quantities: registry }, 5);
    expect(
      Array.from(container.querySelectorAll(".tooltip-row")).find((row) => row.textContent?.startsWith("Wind Speed:"))!
        .textContent,
    ).toMatch(/ kn$/);
  });

  it("orders groups by order, then in area order, and names a plain list after the area", () => {
    const plainList = popupAt({ layout: windTooltip(["wind_speed"]) }, 5);
    // The wind area without order follows the positioned groups.
    expect(dividers(plainList)).toEqual([
      "tooltip-divider-temperature",
      "tooltip-divider-precipitation",
      "tooltip-divider-convective",
    ]);
    const first = popupAt({ layout: windTooltip([{ group: "wind", order: 0, rows: ["wind_speed"] }]) }, 5);
    expect(dividers(first)[0]).toBe("tooltip-divider-wind");
  });

  it("keeps the default rows for a layout without tooltip", () => {
    const { layout } = resolveChartLayout(withoutTooltip(POWER_LAYOUT));
    expect(layout.areas.every((area) => area.tooltip === null)).toBe(true);
    expect(tooltipGroups(layout, new Set(["temperature", "cloud_cover"]))).toEqual([
      ...DEFAULT_TOOLTIP_GROUPS,
      { group: "extra", rows: ["cloud_cover"], order: null },
    ]);
    expect(tooltipGroups(null, undefined).at(-1)!.rows).toEqual([]);
  });
});

describe("validation", () => {
  it.each([
    [windTooltip("wind" as unknown as string[]), "tooltip must be a list"],
    [windTooltip(["nothing"]), "unknown tooltip row nothing"],
    [windTooltip([{ group: "", rows: [] }]), "needs a group name and a list of rows"],
    [windTooltip([{ group: "temperature", rows: ["wind_speed"] }]), "tooltip group names must be unique (temperature)"],
    [windTooltip([{ group: "w", rows: ["wind_speed"], order: Number.NaN }]), "order must be a number"],
  ])("rejects %#", (layout, message) => {
    expect(validateChartLayout(layout)).toEqual([expect.stringContaining(message)]);
  });

  it("accepts the sum rows and registry quantities", () => {
    expect(validateChartLayout(windTooltip(["precipitation_sum", "snowfall_sum", "cloud_cover"]))).toEqual([]);
  });
});
