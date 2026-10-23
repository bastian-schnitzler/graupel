import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeteogramChart } from "./MeteogramChart";
import type { DataPoint, DetailedCloudForecast, WeatherModel } from "../types";
import type { ChartLayout, LayoutArea } from "../layouts/types";
import {
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  getBuiltinLayout,
} from "../layouts/layoutResolution";
import {
  resetQuantityRegistry,
  setQuantityRegistry,
} from "../quantities/registry";

const HOUR = 3_600_000;
const start = Date.parse("2026-09-11T00:00:00Z");
const chain: WeatherModel[] = [
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

const renderChart = (props: Record<string, unknown> = {}) =>
  render(
    <MeteogramChart
      data={forecast()}
      modelChain={chain}
      forecastStartTime={new Date(start).toISOString()}
      timelineStart={new Date(start).toISOString()}
      timelineEnd={new Date(start + 48 * HOUR).toISOString()}
      userTimezone="UTC"
      location={{ name: "Innsbruck", latitude: 47.26, longitude: 11.39, elevation: 574 } as never}
      generatedAt="2026-09-11T03:00:00Z"
      {...props}
    />,
  );

const viewBoxHeight = (container: HTMLElement) =>
  Number(
    container
      .querySelector('svg[data-render-mode="embedded"]')!
      .getAttribute("viewBox")!
      .split(" ")[3],
  );
const panels = (container: HTMLElement) =>
  [...container.querySelectorAll("g.panel[data-area-id]")].map((panel) =>
    panel.getAttribute("data-area-id"),
  );
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
  const svg = container.querySelector('svg[data-render-mode="embedded"]')!;
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} }) as DOMRect;
  act(() => {
    fireEvent.mouseMove(svg, { clientX: 300, clientY: 100 });
  });
}

afterEach(() => resetQuantityRegistry());

describe("MeteogramChart layouts", () => {
  it("draws the power default without a layout (today's chart)", () => {
    const { container } = renderChart({ verticalCloudForecast: cloud });
    expect(panels(container)).toEqual(["temp", "precip", "wind", "convective"]);
    expect(viewBoxHeight(container)).toBe(574);
    expect(screen.getAllByTestId("model-label-segment").length).toBeGreaterThan(0);
    expect(screen.getByTestId("model-boundary-line")).toBeTruthy();
    expect(screen.queryByTestId("meteogram-layout-warning")).toBeNull();
  });

  it("draws the normal layout: three areas with cloud profile, no model headers, no CAPE/CIN", () => {
    const { container } = renderChart({
      verticalCloudForecast: cloud,
      fallbackLayoutId: NORMAL_LAYOUT_ID,
    });
    expect(panels(container)).toEqual(["temp", "precip", "wind"]);
    // The cloud profile background adds its 0.3 weight (Q1, system.md §4.4).
    expect(viewBoxHeight(container)).toBe(
      22 + 115 + 15 + 95 + 30 + 15 + 105 + 10,
    );
    expect(screen.queryByTestId("model-label-segment")).toBeNull();
    expect(screen.queryByTestId("model-boundary-line")).toBeNull();
    expect(screen.getByTestId("cloud-profile-layer")).toBeTruthy();
    expect(screen.queryByTestId("panel-convective")).toBeNull();
    expect(screen.getByTestId("temperature-path")).toBeTruthy();
    expect(screen.getAllByTestId("precip-bar").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("wind-arrow-group").length).toBeGreaterThan(0);

    hover(container);
    const tooltip = document.querySelector(".hover-unified-tooltip")!;
    expect(tooltip.textContent).toContain("Temperature:");
    expect(tooltip.textContent).toContain("Wind Speed:");
    expect(tooltip.textContent).not.toContain("CAPE:");
    expect(tooltip.textContent).not.toContain("CIN:");
  });

  it("hides model headers and dashed boundaries when showModelHeaders is false", () => {
    const layout = {
      ...getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID),
      showModelHeaders: false,
    };
    const { container } = renderChart({
      chartLayout: layout,
      verticalCloudForecast: cloud,
      verticalCloudTransitions: [
        { timestamp: new Date(start + 30 * HOUR).toISOString(), from_model: "A", to_model: "B" },
      ],
    });
    expect(screen.queryByTestId("model-label-segment")).toBeNull();
    expect(screen.queryByTestId("model-boundary-line")).toBeNull();
    // The cloud chain markers are not model headers and stay.
    expect(screen.getByTestId("cloud-model-boundary-line")).toBeTruthy();
    // The model header row is not reserved.
    expect(viewBoxHeight(container)).toBe(574 - 22);
    expect(
      container.querySelector('[data-edge="date-header-top"]')!.getAttribute("y1"),
    ).toBe("0");
  });

  it.each([1, 2, 4])("draws %i custom areas with heights by weight", (count) => {
    const areas = Array.from({ length: count }, (_, index) =>
      lineArea(`area${index}`, index + 1),
    );
    const { container } = renderChart({ chartLayout: custom(areas) });
    expect(panels(container)).toEqual(areas.map((area) => area.id));
    const clipHeights = areas.map((area) =>
      Number(
        container
          .querySelector(`[id^="${area.id}-clip-"][id$="-embedded"] rect`)!
          .getAttribute("height"),
      ),
    );
    expect(clipHeights).toEqual(areas.map((_, index) => (index + 1) * 100));
    const total = clipHeights.reduce((sum, height) => sum + height, 0);
    expect(viewBoxHeight(container)).toBe(44 + total + (count - 1) * 15 + 10);
    // Grid borders follow the areas: no top border for the first area.
    const edges = [
      ...container.querySelectorAll('svg[data-render-mode="embedded"] [data-testid="chart-area-horizontal-border"]'),
    ].map((line) => line.getAttribute("data-edge"));
    expect(edges).toEqual([
      "date-header-top",
      "area0-bottom",
      ...areas.slice(1).flatMap((area) => [`${area.id}-top`, `${area.id}-bottom`]),
    ]);
  });

  it("falls back to the built-in layout with a warning for an invalid layout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderChart({
      chartLayout: custom([
        { id: "a", series: [{ quantity: "no_such_quantity", style: "line" }] },
      ]),
      fallbackLayoutId: NORMAL_LAYOUT_ID,
    });
    expect(panels(container)).toEqual(["temp", "precip", "wind"]);
    expect(screen.getByTestId("meteogram-layout-warning").textContent).toContain(
      "unknown quantity: no_such_quantity",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders without model metadata or a full quantity registry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setQuantityRegistry([
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
    const { container } = renderChart({
      chartLayout: getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID),
      availableModels: undefined,
    });
    // The registry lacks most quantities: invalid, fallback drawn, no crash.
    expect(screen.getByTestId("meteogram-layout-warning")).toBeTruthy();
    expect(panels(container)).toEqual(["temp", "precip", "wind", "convective"]);
    expect(screen.queryByTestId("lpi-layer")).toBeNull();
    warn.mockRestore();
  });

  it("draws any registry quantity as a generic line with its own popup row", () => {
    const { container } = renderChart({
      chartLayout: custom([
        {
          id: "clouds",
          axes: { left: { quantity: "cloud_cover", label: "%", range: "fixed", min: 0, max: 100 } },
          series: [{ quantity: "cloud_cover", style: "line", color: "#123456" }],
        },
      ]),
    });
    const path = screen.getByTestId("cloud-cover-path");
    expect(path.getAttribute("stroke")).toBe("#123456");
    // 50 % on a fixed 0–100 axis lies in the middle of the area.
    expect(path.getAttribute("d")).toContain(` ${44 + 50}`);
    expect(screen.getByText("100 %")).toBeTruthy();
    hover(container);
    const tooltip = document.querySelector(".hover-unified-tooltip")!;
    expect(screen.getByTestId("tooltip-row-cloud_cover").textContent).toBe(
      "Cloud cover:50 %",
    );
    expect(tooltip.textContent).not.toContain("Wind Speed:");
  });

  it("applies the day header, daylight and location label options", () => {
    const sunPhases = [
      { day: "2026-09-11", sunrise: new Date(start + 6 * HOUR).toISOString(), sunset: new Date(start + 18 * HOUR).toISOString() },
    ];
    const base = getBuiltinLayout(NORMAL_LAYOUT_ID);
    const { container, rerender } = renderChart({ sunPhases, chartLayout: base });
    expect(screen.getAllByTestId("daylight-stripe")).toHaveLength(3);
    expect(screen.getAllByTestId("day-label-cell").length).toBeGreaterThan(0);
    expect(screen.getByTestId("meteogram-footer-location").textContent).toMatch(/Innsbruck, 574 m \(.+\)/);

    const props = {
      data: forecast(),
      modelChain: chain,
      forecastStartTime: new Date(start).toISOString(),
      timelineStart: new Date(start).toISOString(),
      timelineEnd: new Date(start + 48 * HOUR).toISOString(),
      userTimezone: "UTC",
      location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39, elevation: 574 } as never,
      generatedAt: "2026-09-11T03:00:00Z",
      sunPhases,
    };
    rerender(
      <MeteogramChart
        {...props}
        chartLayout={{
          ...base,
          showDaylight: false,
          showDayHeader: false,
          showCreatedTimestamp: false,
          showLocationLabel: "top",
        }}
      />,
    );
    expect(screen.queryByTestId("daylight-stripe")).toBeNull();
    expect(screen.queryByTestId("day-label-cell")).toBeNull();
    expect(screen.getByTestId("meteogram-footer-location").textContent).toBe("Innsbruck, 574 m");
    const white = screen.getByTestId("meteogram-chart-white-bg");
    expect(white.firstElementChild?.getAttribute("data-testid")).toBe("meteogram-footer-row");

    rerender(
      <MeteogramChart {...props} chartLayout={{ ...base, showLocationLabel: "none" }} />,
    );
    expect(screen.getByTestId("meteogram-footer-location").textContent).toBe("");
    // The Open-Meteo attribution (CC BY 4.0) always stays.
    expect(screen.getByTestId("meteogram-footer-attribution")).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("keeps today's axis labels and white snow bars in both render modes", () => {
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
    const embedded = container.querySelector('svg[data-render-mode="embedded"]')!;
    const texts = [...embedded.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toEqual(
      expect.arrayContaining(["0 mm", "1.3 mm", "30 km/h", "0 km/h", "CAPE", "CIN", "221 J/kg", "−22 J/kg", "0 J/kg"]),
    );
    expect(screen.getByTestId("convective-zero-line")).toBeTruthy();
    act(() => {
      fireEvent.doubleClick(container.querySelector(".meteogram-redesign-container")!);
    });
    for (const mode of ["embedded", "fullscreen"]) {
      const bars = document.querySelectorAll(
        `svg[data-render-mode="${mode}"] [data-testid="precip-bar"]`,
      );
      const [snow, rain] = [...bars];
      expect(snow.getAttribute("fill")).toBe("#ffffff");
      expect(snow.getAttribute("stroke")).toBe("#475569");
      expect(rain.getAttribute("fill")).toBe("#2563eb");
    }
  });

  it("lists only the layout's quantities in the fullscreen footer", () => {
    const { container } = renderChart({ fallbackLayoutId: NORMAL_LAYOUT_ID });
    act(() => {
      fireEvent.doubleClick(container.querySelector(".meteogram-redesign-container")!);
    });
    expect(screen.queryByTestId("fullscreen-detail-cape")).toBeNull();
    expect(screen.queryByTestId("fullscreen-detail-cin")).toBeNull();
    expect(screen.getByTestId("fullscreen-detail-temp")).toBeTruthy();
    expect(screen.getByTestId("fullscreen-detail-gusts")).toBeTruthy();
    const row = screen.getByTestId("fullscreen-detail-row-1");
    expect(row.children).toHaveLength(5);
    expect(row.getAttribute("style")).toContain("repeat(5");
  });
  it("stacks blue rain bars on snow bars on the snowfall cm axis", () => {
    // Hour 0: 2 mm, 0.7 cm snow (1 mm water) -> 0.7 cm snow + 0.7 cm rain.
    // Hour 4: 1 mm, no snow -> rain only. Hour 8: snowfall missing -> gap.
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
      (point) =>
        point.variable === "precipitation" &&
        point.timestamp === new Date(start).toISOString(),
    )!.value = 2;
    const { container } = renderChart({
      data,
      chartLayout: custom([
        {
          id: "snow",
          axes: { left: { quantity: "snowfall_with_rain", label: "cm", range: "zero-based" } },
          series: [{ quantity: "snowfall_with_rain", style: "bars" }],
        },
      ]),
    });
    const embedded = container.querySelector('svg[data-render-mode="embedded"]')!;
    const at = (testId: string, h: number) =>
      embedded.querySelector(
        `[data-testid="${testId}"][data-timestamp="${new Date(start + h * HOUR).toISOString()}"]`,
      );
    const snow = at("snowfall-bar", 0)!;
    const rain = at("snowfall-bar-rain", 0)!;
    expect(snow.getAttribute("fill")).toBe("#ffffff");
    expect(snow.getAttribute("stroke")).toBe("#475569");
    expect(rain.getAttribute("fill")).toBe("#2563eb");
    // Same cm axis: equal parts get equal heights, rain sits on top of snow.
    expect(Number(rain.getAttribute("height"))).toBeCloseTo(
      Number(snow.getAttribute("height")),
    );
    expect(
      Number(rain.getAttribute("y")) + Number(rain.getAttribute("height")),
    ).toBeCloseTo(Number(snow.getAttribute("y")));
    expect(at("snowfall-bar", 4)).toBeNull();
    expect(at("snowfall-bar-rain", 4)).toBeTruthy();
    expect(at("snowfall-bar-rain", 8)).toBeNull();
    // Axis maximum from the stacked total (1.4 cm / 0.8 = 1.75 cm).
    const texts = [...embedded.querySelectorAll("text")].map((t) => t.textContent);
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
    const { container } = renderChart({
      data,
      chartLayout: custom([
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
    });
    const embedded = container.querySelector('svg[data-render-mode="embedded"]')!;
    const bars = embedded.querySelectorAll('[data-testid="snowfall-bar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute("stroke")).toBe("#475569");
    expect(embedded.querySelector('[data-testid="snow-depth-path"]')).toBeTruthy();
    hover(container);
    // Snow depth shows in the popup even in an hour without snowfall.
    expect(screen.getByTestId("snow-depth-row").textContent).toContain("0.3 m");
  });
});
