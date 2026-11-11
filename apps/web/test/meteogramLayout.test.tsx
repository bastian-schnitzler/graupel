// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Layout of the website's meteogram (REQ-447): without the convection area, since CAPE, CIN and LPI left the registry.
 * On a narrow page the axis labels show the unit below the value and stand at the chart's edges (REQ-542).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_LAYOUTS, POWER_DEFAULT_LAYOUT_ID, validateChartLayout, type ChartLayout } from "@graupel/meteogram";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  compactAxisLabels,
  NARROW_CHART_OPTIONS,
  NARROW_LABELS_MIN_AREA_HEIGHT,
  narrowAxisLabels,
  scaleLayoutAreas,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
  layoutForQuantities,
} from "../src/regions/MeteogramPanel/layout.ts";
import { registry } from "../src/services/modelData.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  type ForecastLoader,
} from "../src/state/index.ts";
import { NARROW_PAGE_QUERY } from "../src/state/narrowPage.ts";
import { forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CONVECTIVE = ["cape", "convective_inhibition", "lightning_potential"];
const quantitiesOf = (layout: ChartLayout) =>
  layout.areas.flatMap((area) => [
    ...(area.series ?? []).map((series) => series.quantity),
    ...[area.axes?.left?.quantity, area.axes?.right?.quantity].filter((id): id is string => !!id),
  ]);

describe("layout of the website's meteogram", () => {
  it("has no convection quantities in the registry", () => {
    const ids = registry.quantities.map((quantity) => quantity.id);
    for (const id of CONVECTIVE) expect(ids).not.toContain(id);
  });

  it("is the power layout without the convection area", () => {
    const power = BUILTIN_LAYOUTS.find((layout) => layout.id === POWER_DEFAULT_LAYOUT_ID)!;
    expect(power.areas.map((area) => area.id)).toContain("convective");
    expect(WEB_LAYOUT.areas.map((area) => area.id)).toEqual(
      power.areas.map((area) => area.id).filter((id) => id !== "convective"),
    );
    // Series of quantities the website's registry does not know are dropped.
    const known = new Set(registry.quantities.map((quantity) => quantity.id));
    expect(WEB_LAYOUT.areas).toEqual(power.areas.filter((area) => area.id !== "convective").map((area) => ({
      ...area,
      series: (area.series ?? []).filter((series) => known.has(series.quantity)),
      axes: { left: area.axes?.left ?? null, right: area.axes?.right ?? null },
      background: area.background ?? null,
    })));
    for (const layout of [WEB_LAYOUT, WEB_LAYOUT_WITHOUT_HEADERS]) {
      expect(validateChartLayout(layout)).toEqual([]);
      for (const id of CONVECTIVE) expect(quantitiesOf(layout)).not.toContain(id);
    }
    expect(WEB_LAYOUT.showModelHeaders).toBe(true);
    expect(WEB_LAYOUT_WITHOUT_HEADERS.showModelHeaders).toBe(false);
  });

  it("keeps the dew point filled to the temperature, the registry knows it (REQ-593)", () => {
    expect(registry.quantities.find((quantity) => quantity.id === "dew_point")).toMatchObject({
      api_name: "dew_point_2m",
      downloadable: true,
    });
    for (const layout of [WEB_LAYOUT, WEB_LAYOUT_WITHOUT_HEADERS]) {
      const temperatureArea = layout.areas.find((area) => area.id === "temp")!;
      expect(temperatureArea.series).toContainEqual(
        expect.objectContaining({ quantity: "dew_point", fillTo: "temperature" }),
      );
    }
  });

  it("drops series, axes and backgrounds of unknown quantities, and areas left empty", () => {
    const layout: ChartLayout = {
      id: "x",
      name: "x",
      areas: [
        {
          id: "a",
          axes: { left: { quantity: "temperature" }, right: { quantity: "gone" } },
          series: [
            { quantity: "temperature", style: "line" },
            { quantity: "gone", style: "line" },
            { quantity: "precipitation", style: "bars", snowFrom: "gone" },
            { quantity: "precipitation", style: "line", fillTo: "gone" },
          ],
        },
        { id: "b", background: { kind: "vertical_cloud_profile" }, series: [{ quantity: "gone", style: "area" }] },
        { id: "c", axes: { left: { quantity: "gone" } }, series: [{ quantity: "gone", style: "area" }] },
      ],
    };
    const result = layoutForQuantities(layout, new Set(["temperature", "precipitation", "vertical_cloud_profile"]));
    expect(result.areas).toEqual([
      {
        id: "a",
        axes: { left: { quantity: "temperature" }, right: null },
        background: null,
        series: [{ quantity: "temperature", style: "line" }],
      },
      { id: "b", axes: { left: null, right: null }, background: { kind: "vertical_cloud_profile" }, series: [] },
    ]);
  });
});

function renderPanel(config: GraupelConfig) {
  const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <MeteogramPanel />
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

describe("Meteogram panel", () => {
  it.each([true, false])("draws temperature, precipitation and wind, no convection area (model headers: %s)", async (
    modelHeaders,
  ) => {
    const { container } = renderPanel({ ...DEFAULT_CONFIG, modelHeaders });
    await screen.findByTestId("meteogram-attribution");
    const areas = [...container.querySelectorAll("svg.meteogram-svg-integrated [data-area-id]")].map((area) =>
      area.getAttribute("data-area-id"),
    );
    expect(areas).toEqual(["temp", "precip", "wind"]);
    expect(container.querySelector('[data-testid="cape-bar"], [data-testid="cin-bar"], [data-testid="lpi-path"]'))
      .toBeNull();
  });
});

/** matchMedia stand-in: only the narrow-page query matches, while `narrow` is set. */
function stubNarrowPage(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: narrow && query === NARROW_PAGE_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

describe("narrow page (REQ-542, REQ-547)", () => {
  it("puts the units below the values and the legend over the edge-to-edge plot", async () => {
    expect(NARROW_PAGE_QUERY).toBe("(max-width: 40rem)");
    expect(NARROW_CHART_OPTIONS).toEqual({
      padding: { left: 0, right: 0 },
      axisLabels: { unit: "below", align: "inside" },
    });
    stubNarrowPage(true);
    const { container } = renderPanel(DEFAULT_CONFIG);
    await screen.findByTestId("meteogram-attribution");
    const svg = container.querySelector("svg.meteogram-svg-integrated")!;
    const twoLine = [...svg.querySelectorAll("text[data-lines]")].map((text) =>
      [...text.querySelectorAll("tspan")].map((span) => span.textContent),
    );
    expect(twoLine.filter((lines) => lines[1] === "mm")).toHaveLength(2);
    // Wind: maximum, minimum and the label of the guide line at half the axis (REQ-654, DEC-060), also two-line.
    const wind = twoLine.filter((lines) => lines[1] === "km/h");
    expect(wind).toHaveLength(3);
    const mid = svg.querySelector('text[data-testid="axis-mid"]')!;
    const midLines = [...mid.querySelectorAll("tspan")].map((span) => span.textContent);
    expect(midLines[1]).toBe("km/h");
    expect(Number(midLines[0])).toBe(Math.round(Math.max(...wind.map((lines) => Number(lines[0]))) / 2));
    expect(svg.querySelectorAll('text[x="1"][text-anchor="start"]').length).toBeGreaterThanOrEqual(6);
  });

  it("keeps the legend beside the plot on a wide page", async () => {
    stubNarrowPage(false);
    const { container } = renderPanel(DEFAULT_CONFIG);
    await screen.findByTestId("meteogram-attribution");
    const svg = container.querySelector("svg.meteogram-svg-integrated")!;
    expect(svg.querySelectorAll("text[data-lines]")).toHaveLength(0);
    expect(svg.querySelectorAll('text[x="0"]')).toHaveLength(0);
  });
});

describe("compact axis labels on a small chart (REQ-694)", () => {
  const drawnAs = { forceModelHeaders: true, backgroundHasData: true };

  it("needs about 56 viewBox units per area for the two-line labels", () => {
    // Maximum below the sunrise row (25.22), zero line with gaps (8.48), minimum with its offset (22.38).
    expect(NARROW_LABELS_MIN_AREA_HEIGHT).toBeCloseTo(56.08, 2);
  });

  it("keeps the labels where the areas have their full height", () => {
    expect(compactAxisLabels(WEB_LAYOUT, drawnAs)).toBe(false);
    expect(compactAxisLabels(WEB_LAYOUT_WITHOUT_HEADERS, { ...drawnAs, forceModelHeaders: false })).toBe(false);
    // The wind area, the lowest (105 units), still has room at 0.55 of its height.
    expect(compactAxisLabels(scaleLayoutAreas(WEB_LAYOUT, 0.55), drawnAs)).toBe(false);
  });

  it("turns compact once an area is lower than the two-line labels need", () => {
    expect(compactAxisLabels(scaleLayoutAreas(WEB_LAYOUT, 0.5), drawnAs)).toBe(true);
    expect(compactAxisLabels(scaleLayoutAreas(WEB_LAYOUT, 0.3), drawnAs)).toBe(true);
  });

  it("gives compact labels with the cloud altitudes in one line, else the narrow page's labels", () => {
    expect(narrowAxisLabels(false)).toEqual({ unit: "below", align: "inside" });
    expect(narrowAxisLabels(true)).toEqual({ unit: "inline", align: "inside", compact: true });
  });
});
