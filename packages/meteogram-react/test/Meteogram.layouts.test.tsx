// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Layout variants through `<Meteogram>`, with the label, attribution and
 * time-zone cases. The global registry (`setQuantityRegistry`) is the `quantities`
 * option, the visible layout warning is the app's (`onLayoutWarning`), and
 * fullscreen cases stay with the app (WEB).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  createQuantityRegistry,
  getBuiltinLayout,
  type ChartLayout,
  type DataPoint,
  type DetailedCloudForecast,
  type LayoutArea,
  type Location,
} from "@graupel/meteogram";
import { Meteogram, type MeteogramComponentOptions } from "../src";
import {
  HOUR,
  chartSvg,
  generateMockData,
  hoverAt,
  mockModelChain,
  mockRect,
  toInput,
  tooltipElement,
  type OldChartProps,
} from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const start = Date.parse("2026-09-11T00:00:00Z");
const chain = [
  { name: "ICON-D2", max_forecast_horizon_hours: 24 },
  { name: "ICON-EU", max_forecast_horizon_hours: 48 },
];

function forecast(hours = 48): DataPoint[] {
  const points: DataPoint[] = [];
  for (let h = 0; h < hours; h++) {
    const timestamp = new Date(start + h * HOUR).toISOString();
    const model = h < 24 ? "ICON-D2" : "ICON-EU";
    const add = (variable: string, value: number, unit = "") =>
      points.push({ timestamp, variable, value, unit, model });
    add("temperature", 10 + Math.sin(h / 4) * 5, "°C");
    add("apparent_temperature", 8 + Math.sin(h / 4) * 5, "°C");
    add("wind_speed", 15, "km/h");
    add("wind_gusts", 25, "km/h");
    add("wind_direction", 180, "°");
    add("precipitation", h % 4 === 0 ? 1 : 0, "mm");
    add("precipitation_probability", 40, "%");
    add("cloud_cover", 50, "%");
    add("cape", 200, "J/kg");
    add("convective_inhibition", -20, "J/kg");
  }
  return points;
}

const cloud = {
  profiles: Array.from({ length: 48 }, (_, h) => ({
    timestamp: new Date(start + h * HOUR).toISOString(),
    model: "ECMWF",
    levels: [{ pressure_hpa: 700, altitude_m_asl: 3000, cloud_cover_percent: 60 }],
  })),
} as unknown as DetailedCloudForecast;

const baseProps = (): OldChartProps => ({
  data: forecast(),
  modelChain: chain,
  forecastStartTime: new Date(start).toISOString(),
  timelineStart: new Date(start).toISOString(),
  timelineEnd: new Date(start + 48 * HOUR).toISOString(),
  userTimezone: "UTC",
  location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39, elevation: 574 } as Location,
  generatedAt: "2026-09-11T03:00:00Z",
});

const renderChart = (
  props: Partial<OldChartProps> = {},
  options: MeteogramComponentOptions = {},
  onLayoutWarning?: (warning: string) => void,
) =>
  render(
    <Meteogram
      input={toInput({ ...baseProps(), ...props })}
      options={options}
      {...(onLayoutWarning ? { onLayoutWarning } : {})}
    />,
  );

const viewBoxHeight = (container: HTMLElement) =>
  Number(chartSvg(container).getAttribute("viewBox")!.split(" ")[3]);
const panels = (container: HTMLElement) =>
  [...container.querySelectorAll("g.panel[data-area-id]")].map((panel) => panel.getAttribute("data-area-id"));
const custom = (areas: LayoutArea[], extra: Partial<ChartLayout> = {}) => ({
  id: "custom",
  name: "Custom",
  areas,
  ...extra,
});
const lineArea = (id: string, heightWeight = 1): LayoutArea => ({
  id,
  heightWeight,
  series: [{ quantity: "temperature", style: "line" }],
});

function hover(container: HTMLElement) {
  const svg = chartSvg(container);
  mockRect(svg, { left: 0, top: 0, width: 1000, height: 500 });
  hoverAt(svg, 300);
}

describe("Meteogram layouts", () => {
  it("draws the power default without a layout (today's chart)", () => {
    const onLayoutWarning = vi.fn();
    const { container } = renderChart({ verticalCloudForecast: cloud }, {}, onLayoutWarning);
    expect(panels(container)).toEqual(["temp", "precip", "wind", "convective"]);
    expect(viewBoxHeight(container)).toBe(574);
    expect(screen.getAllByTestId("model-label-segment").length).toBeGreaterThan(0);
    expect(screen.getByTestId("model-boundary-line")).toBeTruthy();
    expect(onLayoutWarning).not.toHaveBeenCalled();
  });

  it("draws the normal layout: three areas with cloud profile, no model headers, no CAPE/CIN", () => {
    const { container } = renderChart(
      { verticalCloudForecast: cloud },
      { fallbackLayoutId: NORMAL_LAYOUT_ID },
    );
    expect(panels(container)).toEqual(["temp", "precip", "wind"]);
    // The cloud profile background adds its 0.3 weight.
    expect(viewBoxHeight(container)).toBe(22 + 115 + 15 + 95 + 30 + 15 + 105 + 10);
    expect(screen.queryByTestId("model-label-segment")).toBeNull();
    expect(screen.queryByTestId("model-boundary-line")).toBeNull();
    expect(screen.getByTestId("cloud-profile-layer")).toBeTruthy();
    expect(screen.queryByTestId("panel-convective")).toBeNull();
    expect(screen.getByTestId("temperature-path")).toBeTruthy();
    expect(screen.getAllByTestId("precip-bar").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("wind-arrow-group").length).toBeGreaterThan(0);

    hover(container);
    const tooltip = tooltipElement(container);
    expect(tooltip.textContent).toContain("Temperature:");
    expect(tooltip.textContent).toContain("Wind Speed:");
    expect(tooltip.textContent).not.toContain("CAPE:");
    expect(tooltip.textContent).not.toContain("CIN:");
  });

  it("hides model headers and their boundaries when showModelHeaders is false", () => {
    const layout = { ...getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID), showModelHeaders: false };
    const { container } = renderChart(
      {
        verticalCloudForecast: cloud,
        verticalCloudTransitions: [
          { timestamp: new Date(start + 30 * HOUR).toISOString(), from_model: "A", to_model: "B" },
        ],
      },
      { layout, showCloudBoundaries: true },
    );
    expect(screen.queryByTestId("model-label-segment")).toBeNull();
    expect(screen.queryByTestId("model-boundary-line")).toBeNull();
    // The cloud chain markers are not model headers: they follow showCloudBoundaries alone (REQ-524).
    expect(screen.getByTestId("cloud-model-boundary-line")).toBeTruthy();
    // The model header row is not reserved.
    expect(viewBoxHeight(container)).toBe(574 - 22);
    expect(container.querySelector('[data-edge="date-header-top"]')!.getAttribute("y1")).toBe("0");
  });

  it("forces model headers in power mode whatever the layout says", () => {
    renderChart({}, { fallbackLayoutId: NORMAL_LAYOUT_ID, forceModelHeaders: true });
    expect(screen.getAllByTestId("model-label-segment").length).toBeGreaterThan(0);
  });

  it.each([1, 2, 4])("draws %i custom areas with heights by weight", (count) => {
    const areas = Array.from({ length: count }, (_, index) => lineArea(`area${index}`, index + 1));
    const { container } = renderChart({}, { layout: custom(areas) });
    expect(panels(container)).toEqual(areas.map((area) => area.id));
    const clipHeights = areas.map((area) =>
      Number(container.querySelector(`[id^="${area.id}-clip-"][id$="-embedded"] rect`)!.getAttribute("height")),
    );
    expect(clipHeights).toEqual(areas.map((_, index) => (index + 1) * 100));
    const total = clipHeights.reduce((sum, height) => sum + height, 0);
    expect(viewBoxHeight(container)).toBe(44 + total + (count - 1) * 15 + 10);
    const edges = [...container.querySelectorAll('[data-testid="chart-area-horizontal-border"]')].map((line) =>
      line.getAttribute("data-edge"),
    );
    expect(edges).toEqual([
      "date-header-top",
      // The first area is closed at the top as well (REQ-594).
      ...areas.flatMap((area) => [`${area.id}-top`, `${area.id}-bottom`]),
    ]);
  });

  it("falls back to the built-in layout with a warning for an invalid layout", () => {
    const onLayoutWarning = vi.fn();
    const { container } = renderChart(
      {},
      {
        layout: custom([{ id: "a", series: [{ quantity: "no_such_quantity", style: "line" }] }]),
        fallbackLayoutId: NORMAL_LAYOUT_ID,
      },
      onLayoutWarning,
    );
    expect(panels(container)).toEqual(["temp", "precip", "wind"]);
    expect(onLayoutWarning).toHaveBeenCalledTimes(1);
    expect(onLayoutWarning.mock.calls[0]![0]).toContain("unknown quantity: no_such_quantity");
  });

  it("warns on the console without an onLayoutWarning prop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderChart({}, { layout: { id: "broken" } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Invalid meteogram layout/));
  });

  it("renders without model metadata or a full quantity registry", () => {
    const onLayoutWarning = vi.fn();
    const quantities = createQuantityRegistry([
      {
        id: "temperature",
        label: "Temperature",
        unit: "°C",
        kind: "point",
        source: "hourly",
        api_name: "temperature_2m",
        aliases: [],
        optional: false,
        catalogued: true,
        always_fetch: false,
        unit_from_api: true,
        retry_without: false,
        ensemble: false,
        allowed_styles: ["line"],
        requires: [],
        downloadable: true,
        color: null,
      },
    ]);
    const { container } = renderChart(
      {},
      { layout: getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID), quantities },
      onLayoutWarning,
    );
    // The registry lacks most quantities: invalid, fallback drawn, no crash.
    expect(onLayoutWarning).toHaveBeenCalled();
    expect(panels(container)).toEqual(["temp", "precip", "wind", "convective"]);
    expect(screen.queryByTestId("lpi-layer")).toBeNull();
  });

  it("draws any registry quantity as a generic line with its own popup row", () => {
    const { container } = renderChart(
      {},
      {
        layout: custom([
          {
            id: "clouds",
            axes: { left: { quantity: "cloud_cover", label: "%", range: "fixed", min: 0, max: 100 } },
            series: [{ quantity: "cloud_cover", style: "line", color: "#123456" }],
          },
        ]),
      },
    );
    const path = screen.getByTestId("cloud-cover-path");
    expect(path.getAttribute("stroke")).toBe("#123456");
    // 50 % on a fixed 0–100 axis lies in the middle of the area.
    expect(path.getAttribute("d")).toContain(` ${44 + 50}`);
    expect(screen.getByText("100 %")).toBeTruthy();
    hover(container);
    expect(screen.getByTestId("tooltip-row-cloud_cover").textContent).toBe("Cloud cover:50 %");
    expect(tooltipElement(container).textContent).not.toContain("Wind Speed:");
  });

  it("applies the day header, daylight and location label options", () => {
    const sunPhases = [
      {
        day: "2026-09-11",
        sunrise: new Date(start + 6 * HOUR).toISOString(),
        sunset: new Date(start + 18 * HOUR).toISOString(),
      },
    ];
    const base = getBuiltinLayout(NORMAL_LAYOUT_ID);
    const input = toInput({ ...baseProps(), sunPhases });
    const { rerender } = render(<Meteogram input={input} options={{ layout: base }} />);
    expect(screen.getAllByTestId("daylight-stripe")).toHaveLength(3);
    expect(screen.getAllByTestId("day-label-cell").length).toBeGreaterThan(0);
    expect(screen.getByTestId("meteogram-footer-location").textContent).toMatch(/Innsbruck, 574 m \(.+\)/);

    rerender(
      <Meteogram
        input={input}
        options={{
          layout: {
            ...base,
            showDaylight: false,
            showDayHeader: false,
            showCreatedTimestamp: false,
            showLocationLabel: "top",
          },
        }}
      />,
    );
    expect(screen.queryByTestId("daylight-stripe")).toBeNull();
    expect(screen.queryByTestId("day-label-cell")).toBeNull();
    expect(screen.getByTestId("meteogram-footer-location").textContent).toBe("Innsbruck, 574 m");
    // The label row sits above the chart.
    expect(screen.getByTestId("meteogram").firstElementChild?.getAttribute("data-testid")).toBe(
      "meteogram-footer-row",
    );

    rerender(<Meteogram input={input} options={{ layout: { ...base, showLocationLabel: "none" } }} />);
    expect(screen.getByTestId("meteogram-footer-location").textContent).toBe("");
    // The Open-Meteo attribution (CC BY 4.0) stays.
    expect(screen.getByTestId("meteogram-attribution")).toBeTruthy();
  });

  it("shows the axis labels on their steps and white snow bars", () => {
    const data = forecast().concat(
      [0, 4].map((h) => ({
        timestamp: new Date(start + h * HOUR).toISOString(),
        variable: "snowfall",
        value: h === 0 ? 1.2 : 0,
        unit: "cm",
        model: "ICON-D2",
      })),
    );
    const { container } = renderChart({ data });
    const texts = [...chartSvg(container).querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toEqual(
      expect.arrayContaining(["0 mm", "2 mm", "30 km/h", "0 km/h", "CAPE", "CIN", "221 J/kg", "−22 J/kg", "0 J/kg"]),
    );
    expect(screen.getByTestId("convective-zero-line")).toBeTruthy();
    const [snow, rain] = [...container.querySelectorAll('[data-testid="precip-bar"]')];
    expect(snow!.getAttribute("fill")).toBe("#ffffff");
    expect(snow!.getAttribute("stroke")).toBe("#475569");
    expect(rain!.getAttribute("fill")).toBe("#2563eb");
  });

  it("stacks blue rain bars on snow bars on the snowfall cm axis", () => {
    const data = forecast().concat(
      [0, 4].map((h) => ({
        timestamp: new Date(start + h * HOUR).toISOString(),
        variable: "snowfall",
        value: h === 0 ? 0.7 : 0,
        unit: "cm",
        model: "ICON-D2",
      })),
    );
    data.find(
      (point) => point.variable === "precipitation" && point.timestamp === new Date(start).toISOString(),
    )!.value = 2;
    const { container } = renderChart(
      { data },
      {
        layout: custom([
          {
            id: "snow",
            axes: { left: { quantity: "snowfall_with_rain", label: "cm", range: "zero-based" } },
            series: [{ quantity: "snowfall_with_rain", style: "bars" }],
          },
        ]),
      },
    );
    const svg = chartSvg(container);
    const at = (testId: string, h: number) =>
      svg.querySelector(`[data-testid="${testId}"][data-timestamp="${new Date(start + h * HOUR).toISOString()}"]`);
    const snow = at("snowfall-bar", 0)!;
    const rain = at("snowfall-bar-rain", 0)!;
    expect(snow.getAttribute("fill")).toBe("#ffffff");
    expect(snow.getAttribute("stroke")).toBe("#475569");
    expect(rain.getAttribute("fill")).toBe("#2563eb");
    expect(Number(rain.getAttribute("height"))).toBeCloseTo(Number(snow.getAttribute("height")));
    expect(Number(rain.getAttribute("y")) + Number(rain.getAttribute("height"))).toBeCloseTo(
      Number(snow.getAttribute("y")),
    );
    expect(at("snowfall-bar", 4)).toBeNull();
    expect(at("snowfall-bar-rain", 4)).toBeTruthy();
    expect(at("snowfall-bar-rain", 8)).toBeNull();
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts.some((text) => /^1\.[78] cm$/.test(text ?? ""))).toBe(true);
  });

  it("draws snowfall bars and a snow depth line with popup rows", () => {
    const data = forecast().concat(
      Array.from({ length: 48 }, (_, h) => [
        {
          timestamp: new Date(start + h * HOUR).toISOString(),
          variable: "snowfall",
          value: h === 0 ? 1 : 0,
          unit: "cm",
          model: h < 24 ? "ICON-D2" : "ICON-EU",
        },
        {
          timestamp: new Date(start + h * HOUR).toISOString(),
          variable: "snow_depth",
          value: 0.3,
          unit: "m",
          model: h < 24 ? "ICON-D2" : "ICON-EU",
        },
      ]).flat(),
    );
    const { container } = renderChart(
      { data },
      {
        layout: custom([
          {
            id: "snow",
            axes: {
              left: { quantity: "snowfall", label: "cm", range: "zero-based" },
              right: { quantity: "snow_depth", label: "m", range: "zero-based" },
            },
            series: [
              { quantity: "snowfall", style: "bars" },
              { quantity: "snow_depth", style: "line", axis: "right" },
            ],
          },
        ]),
      },
    );
    const svg = chartSvg(container);
    const bars = svg.querySelectorAll('[data-testid="snowfall-bar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.getAttribute("stroke")).toBe("#475569");
    expect(svg.querySelector('[data-testid="snow-depth-path"]')).toBeTruthy();
    hover(container);
    // Snow depth shows in the popup even in an hour without snowfall.
    expect(screen.getByTestId("snow-depth-row").textContent).toContain("0.3 m");
  });
});

describe("Meteogram state, label and time zone", () => {
  const makeData = (hours: number): DataPoint[] => {
    const points: DataPoint[] = [];
    for (let h = 0; h < hours; h++) {
      const timestamp = new Date(Date.parse("2026-09-11T00:00:00Z") + h * HOUR).toISOString();
      points.push(
        { timestamp, variable: "temperature", value: 10, unit: "°C", model: "ICON-EU" },
        { timestamp, variable: "wind_speed", value: 12, unit: "km/h", model: "ICON-EU" },
      );
    }
    return points;
  };
  const euChain = [{ name: "ICON-EU", max_forecast_horizon_hours: 48 }];

  it("switches between data and the empty state", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(<Meteogram input={toInput({ data: makeData(48), modelChain: euChain })} />);
    expect(container.querySelector("svg.meteogram-svg-integrated:not(.meteogram-empty-state)")).toBeTruthy();

    rerender(<Meteogram input={toInput({ data: [], modelChain: euChain })} />);
    expect(screen.getByText("No forecast data available for the selected parameters.")).toBeTruthy();

    rerender(<Meteogram input={toInput({ data: makeData(48), modelChain: euChain })} />);
    expect(container.querySelector("svg.meteogram-svg-integrated:not(.meteogram-empty-state)")).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
  });

  it("takes the empty-state text from the texts option", () => {
    render(
      <Meteogram
        input={toInput({ data: [], modelChain: euChain })}
        options={{ texts: { emptyState: "Keine Daten." } }}
      />,
    );
    expect(screen.getByText("Keine Daten.")).toBeTruthy();
  });

  it("renders the location label with generation time and elevation next to the attribution", () => {
    render(
      <Meteogram
        input={toInput({
          data: generateMockData(24),
          modelChain: mockModelChain,
          location: { name: "Zugspitze", latitude: 47.4211, longitude: 10.9853, elevation: 2962 },
          generatedAt: "2026-10-16T20:45:00Z",
          userTimezone: "Europe/Berlin",
        })}
      />,
    );
    const footerLabel = screen.getByTestId("meteogram-footer-location");
    expect(footerLabel.textContent).toMatch(/^Zugspitze, 2962 m \(.+\)$/);
    expect(footerLabel.textContent).toContain("16");
    expect(footerLabel.parentElement).toBe(screen.getByTestId("meteogram-footer-row"));
    // Label, then attribution (the day-range buttons are the app's).
    expect(footerLabel.nextElementSibling).toBe(screen.getByTestId("meteogram-attribution"));
  });

  it("labels a map-picked location with its GPS coordinates", () => {
    render(
      <Meteogram
        input={toInput({
          data: generateMockData(24),
          modelChain: mockModelChain,
          location: { name: "Custom location", latitude: 47.4211, longitude: 10.9853 },
        })}
      />,
    );
    expect(screen.getByTestId("meteogram-footer-location").textContent).toBe("47.4211° N · 10.9853° E");
  });

  it("renders the Open-Meteo attribution, or its own, or none", () => {
    const input = toInput({ data: generateMockData(24), modelChain: mockModelChain });
    const onOpenLink = vi.fn();
    const { rerender } = render(<Meteogram input={input} onOpenLink={onOpenLink} />);
    const attribution = screen.getByTestId("meteogram-attribution");
    expect(attribution.textContent).toBe("Weather data by Open-Meteo.com");
    const link = attribution.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://open-meteo.com/");
    link.click();
    expect(onOpenLink).toHaveBeenCalledWith("https://open-meteo.com/");

    rerender(<Meteogram input={input} options={{ attribution: "Own data" }} />);
    expect(screen.getByTestId("meteogram-attribution").textContent).toBe("Own data");
    rerender(<Meteogram input={input} options={{ attribution: null }} />);
    expect(screen.queryByTestId("meteogram-attribution")).toBeNull();
  });

  it("uses userTimezone to group days and render timeline when provided, overriding location timezone", () => {
    const data: DataPoint[] = [
      { timestamp: "2026-09-24T23:00:00.000Z", variable: "temperature", value: 15, unit: "°C", model: "ICON-D2" },
      { timestamp: "2026-09-25T01:00:00.000Z", variable: "temperature", value: 14, unit: "°C", model: "ICON-D2" },
    ];
    const { container } = render(
      <Meteogram
        input={toInput({
          data,
          location: { name: "New York", latitude: 40.71, longitude: -74.0, timezone: "America/New_York" },
          userTimezone: "Europe/Berlin",
          modelChain: mockModelChain,
          timelineStart: "2026-09-24T23:00:00.000Z",
          timelineEnd: "2026-09-25T02:00:00.000Z",
        })}
      />,
    );
    const dayBlocks = container.querySelectorAll(".day-group-block text");
    expect(dayBlocks.length).toBeGreaterThan(0);
    expect(dayBlocks[0]!.textContent).toContain("Fri 25.09");
  });

  it("falls back to location.timezone when userTimezone is not provided", () => {
    const { container } = render(
      <Meteogram
        input={toInput({
          data: [
            { timestamp: "2026-09-24T23:00:00.000Z", variable: "temperature", value: 15, unit: "°C", model: "ICON-D2" },
          ],
          location: { name: "New York", latitude: 40.71, longitude: -74.0, timezone: "America/New_York" },
          modelChain: mockModelChain,
          timelineStart: "2026-09-24T23:00:00.000Z",
          timelineEnd: "2026-09-25T02:00:00.000Z",
        })}
      />,
    );
    expect(container.querySelectorAll(".day-group-block text")[0]!.textContent).toContain("Thu 24.09");
  });

  it("follows the timezone option over the input's", () => {
    const { container } = render(
      <Meteogram
        input={toInput({
          data: [
            { timestamp: "2026-09-24T23:00:00.000Z", variable: "temperature", value: 15, unit: "°C", model: "ICON-D2" },
          ],
          modelChain: mockModelChain,
          userTimezone: "America/New_York",
          timelineStart: "2026-09-24T23:00:00.000Z",
          timelineEnd: "2026-09-25T02:00:00.000Z",
        })}
        options={{ timezone: "Europe/Berlin" }}
      />,
    );
    expect(container.querySelectorAll(".day-group-block text")[0]!.textContent).toContain("Fri 25.09");
  });
});
