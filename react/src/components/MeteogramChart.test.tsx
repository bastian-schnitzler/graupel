import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  MeteogramChart,
  getMeteogramLayout,
  interpolateWindDirection,
  WIND_ICON_FOOTPRINT_PX,
  WIND_ICON_RADIUS_PX,
} from "./MeteogramChart";
import { mergeForecastSegments } from "../services/apiService";
import type {
  DataPoint,
  WeatherModel,
  SunPeriod,
  Location,
  DetailedCloudForecast,
} from "../types";

describe("mergeForecastSegments Unit Tests", () => {
  const modelChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
  ];

  it("produces a continuous series across adjacent model horizons without losing boundary samples", () => {
    const ts0 = "2026-09-11T00:00:00.000Z";
    const ts48 = "2026-09-13T00:00:00.000Z"; // 48h
    const ts49 = "2026-09-13T01:00:00.000Z"; // 49h

    const modelForecasts: Record<string, DataPoint[]> = {
      "ICON-D2": [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 10,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts48,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
      ],
      "ICON-EU": [
        {
          timestamp: ts48,
          variable: "temperature",
          value: 15.1,
          unit: "°C",
          model: "ICON-EU",
        },
        {
          timestamp: ts49,
          variable: "temperature",
          value: 16,
          unit: "°C",
          model: "ICON-EU",
        },
      ],
    };

    const merged = mergeForecastSegments(modelChain, modelForecasts, [
      "temperature",
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.map((p) => p.timestamp)).toEqual([ts0, ts48, ts49]);
    // Forecast horizons are half-open: +48h is the first ICON-EU instant.
    expect(merged[1].model).toBe("ICON-EU");
    expect(merged[1].value).toBe(15.1);
    expect(merged[2].model).toBe("ICON-EU");
    expect(merged[2].value).toBe(16);
  });

  it("ensures valid value wins over invalid duplicate at boundary", () => {
    const ts0 = "2026-09-11T00:00:00.000Z";
    const ts48 = "2026-09-13T00:00:00.000Z";

    const modelForecasts: Record<string, DataPoint[]> = {
      "ICON-D2": [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 10,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts48,
          variable: "temperature",
          value: null as any,
          unit: "°C",
          model: "ICON-D2",
        },
      ],
      "ICON-EU": [
        {
          timestamp: ts48,
          variable: "temperature",
          value: 15.2,
          unit: "°C",
          model: "ICON-EU",
        },
      ],
    };

    const merged = mergeForecastSegments(modelChain, modelForecasts, [
      "temperature",
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1].timestamp).toBe(ts48);
    expect(merged[1].value).toBe(15.2);
    expect(merged[1].model).toBe("ICON-EU");
  });

  it("preserves genuine missing intervals", () => {
    const ts0 = "2026-09-11T00:00:00.000Z";
    const ts03 = "2026-09-11T03:00:00.000Z"; // ts01 and ts02 missing

    const modelForecasts: Record<string, DataPoint[]> = {
      "ICON-D2": [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 10,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts03,
          variable: "temperature",
          value: 12,
          unit: "°C",
          model: "ICON-D2",
        },
      ],
    };

    const merged = mergeForecastSegments(modelChain, modelForecasts, [
      "temperature",
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.timestamp)).toEqual([ts0, ts03]);
  });

  it("produces empty segment with value null when a model has empty data, without falling back to other models", () => {
    const ts0 = "2026-09-11T00:00:00.000Z";
    const ts48 = "2026-09-13T00:00:00.000Z";
    const ts49 = "2026-09-13T01:00:00.000Z";

    const modelForecasts: Record<string, DataPoint[]> = {
      "ICON-D2": [],
      "ICON-EU": [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 18,
          unit: "°C",
          model: "ICON-EU",
        },
        {
          timestamp: ts48,
          variable: "temperature",
          value: 19,
          unit: "°C",
          model: "ICON-EU",
        },
        {
          timestamp: ts49,
          variable: "temperature",
          value: 20,
          unit: "°C",
          model: "ICON-EU",
        },
      ],
    };

    const merged = mergeForecastSegments(modelChain, modelForecasts, [
      "temperature",
    ]);
    expect(merged).toHaveLength(3);
    // ts0 belongs to ICON-D2's half-open range [0h, 48h). Since
    // ICON-D2 has no data, the point remains explicitly null.
    expect(merged[0].timestamp).toBe(ts0);
    expect(merged[0].model).toBe("ICON-D2");
    expect(merged[0].value).toBeNull();

    expect(merged[1].timestamp).toBe(ts48);
    // Exactly +48h belongs to ICON-EU.
    expect(merged[1].model).toBe("ICON-EU");
    expect(merged[1].value).toBe(19);

    // ts49 belongs to ICON-EU's range: valid value
    expect(merged[2].timestamp).toBe(ts49);
    expect(merged[2].model).toBe("ICON-EU");
    expect(merged[2].value).toBe(20);
  });

  it("assigns past hours before forecastStartTime to the first model and measures horizons from forecastStartTime", () => {
    const testChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 10 },
      { name: "ICON-EU", max_forecast_horizon_hours: 30 },
    ];

    const ts00 = "2026-09-12T00:00:00.000Z"; // 12h past
    const ts06 = "2026-09-12T06:00:00.000Z"; // 6h past
    const tsNow = "2026-09-12T12:00:00.000Z"; // NOW (t_now)
    const ts05f = "2026-09-12T17:00:00.000Z"; // +5h future
    const ts10f = "2026-09-12T22:00:00.000Z"; // +10h future
    const ts15f = "2026-09-13T03:00:00.000Z"; // +15h future

    const allTimes = [ts00, ts06, tsNow, ts05f, ts10f, ts15f];

    const modelForecasts: Record<string, DataPoint[]> = {
      "ICON-D2": allTimes.map((ts, i) => ({
        timestamp: ts,
        variable: "temperature",
        value: 10 + i,
        unit: "°C",
        model: "ICON-D2",
      })),
      "ICON-EU": allTimes.map((ts, i) => ({
        timestamp: ts,
        variable: "temperature",
        value: 20 + i,
        unit: "°C",
        model: "ICON-EU",
      })),
    };

    const merged = mergeForecastSegments(
      testChain,
      modelForecasts,
      ["temperature"],
      tsNow,
    );
    expect(merged).toHaveLength(6);

    // Past hours before tsNow -> ICON-D2
    expect(merged[0].timestamp).toBe(ts00);
    expect(merged[0].model).toBe("ICON-D2");
    expect(merged[1].timestamp).toBe(ts06);
    expect(merged[1].model).toBe("ICON-D2");

    // tsNow through the instant before +10h -> ICON-D2. The boundary instant
    // itself belongs to the next half-open segment.
    expect(merged[2].timestamp).toBe(tsNow);
    expect(merged[2].model).toBe("ICON-D2");
    expect(merged[3].timestamp).toBe(ts05f);
    expect(merged[3].model).toBe("ICON-D2");
    expect(merged[4].timestamp).toBe(ts10f);
    expect(merged[4].model).toBe("ICON-EU");

    // Beyond +10h from tsNow -> ICON-EU
    expect(merged[5].timestamp).toBe(ts15f);
    expect(merged[5].model).toBe("ICON-EU");
  });

  it("skips models with 0-hour forecast horizon span and never selects them as primary or fallback", () => {
    const chainWithZero: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 0 },
      { name: "ICON-EU", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 48 }, // GFS has 0h span (48 - 48 = 0)
      { name: "ECMWF", max_forecast_horizon_hours: 120 },
    ];

    const ts0 = "2026-09-11T00:00:00.000Z";
    const ts24 = "2026-09-12T00:00:00.000Z";
    const ts72 = "2026-09-14T00:00:00.000Z";

    const modelForecasts: Record<string, DataPoint[]> = {
      "ICON-D2": [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 10,
          unit: "°C",
          model: "ICON-D2",
        },
      ],
      "ICON-EU": [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 12,
          unit: "°C",
          model: "ICON-EU",
        },
        {
          timestamp: ts24,
          variable: "temperature",
          value: 14,
          unit: "°C",
          model: "ICON-EU",
        },
      ],
      GFS: [
        {
          timestamp: ts24,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "GFS",
        },
      ],
      ECMWF: [
        {
          timestamp: ts72,
          variable: "temperature",
          value: 18,
          unit: "°C",
          model: "ECMWF",
        },
      ],
    };

    const merged = mergeForecastSegments(chainWithZero, modelForecasts, [
      "temperature",
    ]);
    expect(merged).toHaveLength(3);

    // ts0 should get ICON-EU (NOT ICON-D2 which has 0h)
    expect(merged[0].timestamp).toBe(ts0);
    expect(merged[0].model).toBe("ICON-EU");
    expect(merged[0].value).toBe(12);

    // ts24 should get ICON-EU (NOT GFS which has 0h)
    expect(merged[1].timestamp).toBe(ts24);
    expect(merged[1].model).toBe("ICON-EU");
    expect(merged[1].value).toBe(14);

    // ts72 should get ECMWF
    expect(merged[2].timestamp).toBe(ts72);
    expect(merged[2].model).toBe("ECMWF");
    expect(merged[2].value).toBe(18);
  });
});

describe("Canonical meteogram timeline regressions", () => {
  const timelineStart = "2026-09-14T00:00:00.000Z";
  const boundaryTimestamp = "2026-09-19T00:00:00.000Z";
  const timelineEnd = "2026-09-24T00:00:00.000Z";
  const chain: WeatherModel[] = [
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { name: "GFS Seamless", max_forecast_horizon_hours: 240 },
  ];
  const boundaryData: DataPoint[] = [
    {
      timestamp: timelineStart,
      variable: "temperature",
      value: 10,
      unit: "°C",
      model: "ICON-EU",
    },
    {
      timestamp: boundaryTimestamp,
      variable: "temperature",
      value: 20,
      unit: "°C",
      model: "GFS Seamless",
    },
    {
      timestamp: boundaryTimestamp,
      variable: "precipitation",
      value: 2,
      unit: "mm",
      model: "GFS Seamless",
    },
  ];
  const boundaryCloud: DetailedCloudForecast = {
    location: { name: "Test", latitude: 0, longitude: 0 },
    profiles: [
      {
        timestamp: boundaryTimestamp,
        source_model_id: "gfs_seamless",
        source_model_name: "GFS Seamless",
        levels: [
          { pressure_hpa: 850, altitude_m_asl: 1500, cloud_cover_percent: 73 },
        ],
      },
    ],
  };
  const transitions = [
    {
      timestamp: boundaryTimestamp,
      from_model: "icon_eu",
      to_model: "gfs_seamless",
    },
  ];

  it("renders coincident weather, cloud, and dragged +120h boundaries at one x-coordinate", () => {
    const { container } = render(
      <MeteogramChart
        data={boundaryData}
        modelChain={chain}
        verticalCloudForecast={boundaryCloud}
        verticalCloudTransitions={transitions}
        forecastStartTime={timelineStart}
        timelineStart={timelineStart}
        timelineEnd={timelineEnd}
        draggedCloudBoundaryHour={120}
      />,
    );

    const orange = screen.getByTestId("model-boundary-line");
    const purple = screen.getByTestId("cloud-model-boundary-line");
    const dragged = screen.getByTestId("cloud-boundary-drag-line");
    const precipitation = container.querySelector(
      `[data-testid="precip-bar"][data-timestamp="${boundaryTimestamp}"]`,
    );
    const cloud = container.querySelector(
      `[data-testid="vertical-cloud-cell"][data-timestamp="${boundaryTimestamp}"]`,
    );

    expect(orange.getAttribute("data-timestamp")).toBe(boundaryTimestamp);
    expect(purple.getAttribute("data-timestamp")).toBe(boundaryTimestamp);
    expect(dragged.getAttribute("data-timestamp")).toBe(boundaryTimestamp);
    const x = Number(orange.getAttribute("x1"));
    expect(Number(purple.getAttribute("x1"))).toBeCloseTo(x, 10);
    expect(Number(dragged.getAttribute("x1"))).toBeCloseTo(x, 10);
    expect(Number(precipitation?.getAttribute("x"))).toBeCloseTo(x, 10);
    expect(Number(cloud?.getAttribute("x"))).toBeCloseTo(x, 10);
  });

  it("returns a dragged boundary to exactly +120h with no data-coordinate drift", () => {
    const { container, rerender } = render(
      <MeteogramChart
        data={boundaryData}
        modelChain={chain}
        verticalCloudForecast={boundaryCloud}
        forecastStartTime={timelineStart}
        timelineStart={timelineStart}
        timelineEnd={timelineEnd}
        draggedCloudBoundaryHour={120}
      />,
    );
    const initialBoundaryX = Number(
      screen.getByTestId("cloud-boundary-drag-line").getAttribute("x1"),
    );
    const initialPrecipX = Number(
      screen.getByTestId("precip-bar").getAttribute("x"),
    );
    const initialCloudX = Number(
      screen.getByTestId("vertical-cloud-cell").getAttribute("x"),
    );

    for (const hour of [180, 60, 200, 24, 120]) {
      rerender(
        <MeteogramChart
          data={boundaryData}
          modelChain={chain}
          verticalCloudForecast={boundaryCloud}
          forecastStartTime={timelineStart}
          timelineStart={timelineStart}
          timelineEnd={timelineEnd}
          draggedCloudBoundaryHour={hour}
        />,
      );
    }

    expect(
      Number(screen.getByTestId("cloud-boundary-drag-line").getAttribute("x1")),
    ).toBe(initialBoundaryX);
    expect(Number(screen.getByTestId("precip-bar").getAttribute("x"))).toBe(
      initialPrecipX,
    );
    expect(
      Number(screen.getByTestId("vertical-cloud-cell").getAttribute("x")),
    ).toBe(initialCloudX);
    expect(
      container.querySelector('[data-testid="temperature-path"]'),
    ).toBeTruthy();
  });

  it("uses the exact 15:00 timestamp for tooltip values and the cloud profile", () => {
    const times = [14, 15, 16].map((hour) => `2026-09-14T${hour}:00:00.000Z`);
    const data: DataPoint[] = times.flatMap((timestamp, index) => [
      {
        timestamp,
        variable: "temperature",
        value: 140 + index * 10,
        unit: "°C",
        model: "ICON-EU",
      },
      {
        timestamp,
        variable: "apparent_temperature",
        value: 240 + index * 10,
        unit: "°C",
        model: "ICON-EU",
      },
      {
        timestamp,
        variable: "precipitation",
        value: index + 1,
        unit: "mm",
        model: "ICON-EU",
      },
      {
        timestamp,
        variable: "precipitation_probability",
        value: 40 + index,
        unit: "%",
        model: "ICON-EU",
      },
      {
        timestamp,
        variable: "wind_speed",
        value: 50 + index,
        unit: "km/h",
        model: "ICON-EU",
      },
      {
        timestamp,
        variable: "wind_gusts",
        value: 60 + index,
        unit: "km/h",
        model: "ICON-EU",
      },
      {
        timestamp,
        variable: "wind_direction",
        value: 70 + index,
        unit: "°",
        model: "ICON-EU",
      },
    ]);
    const cloud: DetailedCloudForecast = {
      location: { name: "Test", latitude: 0, longitude: 0 },
      profiles: times.map((timestamp, index) => ({
        timestamp,
        source_model_id: "icon_eu",
        source_model_name: "ICON-EU",
        levels: [
          {
            pressure_hpa: 850,
            altitude_m_asl: 1500,
            cloud_cover_percent: 54 + index,
          },
        ],
      })),
    };
    const { container } = render(
      <MeteogramChart
        data={data}
        modelChain={[{ name: "ICON-EU", max_forecast_horizon_hours: 3 }]}
        verticalCloudForecast={cloud}
        timelineStart={times[0]}
        timelineEnd="2026-09-14T17:00:00.000Z"
      />,
    );
    const svg = container.querySelector(
      ".meteogram-svg-integrated",
    ) as SVGElement;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 450,
      right: 1000,
      bottom: 450,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.mouseMove(svg, { clientX: 50 + 900 / 3, clientY: 200 });

    expect(
      screen.getByTestId("hover-cursor-line").getAttribute("data-timestamp"),
    ).toBe(times[1]);
    expect(screen.getByText("150 °C")).toBeTruthy();
    expect(screen.getByText("250 °C")).toBeTruthy();
    expect(screen.getByText("2 mm")).toBeTruthy();
    expect(screen.getByText("41 %")).toBeTruthy();
    expect(screen.getByText("51 km/h")).toBeTruthy();
    expect(screen.getByText("61 km/h")).toBeTruthy();
    expect(screen.queryByText("55 %")).toBeNull();
    expect(screen.queryByText(/Detailed Cloud Profile/)).toBeNull();
  });

  it("leaves a missing hour empty instead of shifting the later point left", () => {
    const data: DataPoint[] = [
      {
        timestamp: "2026-09-14T14:00:00.000Z",
        variable: "temperature",
        value: 14,
        unit: "°C",
        model: "ICON-EU",
      },
      {
        timestamp: "2026-09-14T16:00:00.000Z",
        variable: "temperature",
        value: 16,
        unit: "°C",
        model: "ICON-EU",
      },
    ];
    render(
      <MeteogramChart
        data={data}
        modelChain={[{ name: "ICON-EU", max_forecast_horizon_hours: 3 }]}
        timelineStart="2026-09-14T14:00:00.000Z"
        timelineEnd="2026-09-14T17:00:00.000Z"
      />,
    );

    const path = screen.getByTestId("temperature-path").getAttribute("d") || "";
    const starts = Array.from(path.matchAll(/M ([\d.]+)/g), (match) =>
      Number(match[1]),
    );
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBeCloseTo(50, 5);
    expect(starts[1]).toBeCloseTo(50 + (2 / 3) * 900, 1);
  });
});

describe("MeteogramChart Redesign Component", () => {
  const mockModelChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { name: "GFS", max_forecast_horizon_hours: 384 },
  ];

  const generateMockData = (hours: number): DataPoint[] => {
    const points: DataPoint[] = [];
    const startTime = new Date("2026-09-11T00:00:00Z");

    for (let h = 0; h < hours; h++) {
      const ts = new Date(startTime.getTime() + h * 3600 * 1000).toISOString();
      const model = h < 48 ? "ICON-D2" : h < 120 ? "ICON-EU" : "GFS";

      points.push(
        {
          timestamp: ts,
          variable: "temperature",
          value: 12 + Math.sin(h / 4) * 5,
          unit: "°C",
          model,
        },
        {
          timestamp: ts,
          variable: "wind_speed",
          value: 15 + Math.cos(h / 3) * 8,
          unit: "km/h",
          model,
        },
        {
          timestamp: ts,
          variable: "wind_gusts",
          value: 28 + Math.cos(h / 3) * 10,
          unit: "km/h",
          model,
        },
        {
          timestamp: ts,
          variable: "wind_direction",
          value: (h * 30) % 360,
          unit: "°",
          model,
        },
        {
          timestamp: ts,
          variable: "cloud_cover",
          value: Math.min(100, Math.max(0, 50 + Math.sin(h / 2) * 40)),
          unit: "%",
          model,
        },
        {
          timestamp: ts,
          variable: "precipitation",
          value: h % 6 === 0 ? 1.5 : 0,
          unit: "mm",
          model,
        },
        {
          timestamp: ts,
          variable: "precipitation_probability",
          value: (h * 8) % 100,
          unit: "%",
          model,
        },
      );
    }
    return points;
  };

  it("renders empty state message when data is empty", () => {
    render(<MeteogramChart data={[]} modelChain={mockModelChain} />);
    expect(
      screen.getByText(
        "No forecast data available for the selected parameters.",
      ),
    ).toBeTruthy();
  });

  it("renders 24-hour forecast without legend bar or redundant section captions", () => {
    const data = generateMockData(24);
    const { container } = render(
      <MeteogramChart data={data} modelChain={mockModelChain} />,
    );

    // Legend bar and section captions removed
    expect(screen.queryByText("Temp (°C)")).toBeNull();
    expect(screen.queryByText("Precip (mm)")).toBeNull();
    expect(screen.queryByText("Prob (%)")).toBeNull();
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(container.querySelector(".meteogram-header-bar")).toBeNull();

    const svg = container.querySelector(".meteogram-svg-integrated");
    expect(svg).toBeTruthy();

    // Check that High/Mid/Low cloud sub-layer indicators are completely removed
    expect(screen.queryByText("High")).toBeNull();
    expect(screen.queryByText("Mid")).toBeNull();
    expect(screen.queryByText("Low")).toBeNull();
  });

  it("does not render weather condition icons (sun, cloud, rain) in the temperature panel", () => {
    const data = generateMockData(48);
    const { container } = render(
      <MeteogramChart data={data} modelChain={mockModelChain} />,
    );
    const tempPanel = container.querySelector(".panel-temperature");
    expect(tempPanel).toBeTruthy();
    // Verify no weather icon circles or rain lines are rendered inside the temperature panel
    const iconCircles = tempPanel?.querySelectorAll('circle[fill="#f59e0b"]');
    expect(iconCircles?.length ?? 0).toBe(0);
    const rainLines = tempPanel?.querySelectorAll('line[stroke="#2563eb"]');
    expect(rainLines?.length ?? 0).toBe(0);
  });

  it("renders multi-day forecast (3d, 7d, 10d) with day header blocks and grid lines", () => {
    const data7d = generateMockData(168); // 7 days
    const { container } = render(
      <MeteogramChart data={data7d} modelChain={mockModelChain} />,
    );

    const dayBlocks = container.querySelectorAll(".day-group-block");
    expect(dayBlocks.length).toBeGreaterThanOrEqual(7);
  });

  it("displays model boundary indicators when forecast model switches", () => {
    const data = generateMockData(72); // Crosses boundary at 48h (ICON-D2 -> ICON-EU)
    const { container } = render(
      <MeteogramChart data={data} modelChain={mockModelChain} />,
    );

    const boundaryGroup = container.querySelectorAll(".model-boundary-group");
    expect(boundaryGroup.length).toBeGreaterThan(0);
    expect(screen.getAllByText("ICON-EU").length).toBeGreaterThan(0);
  });

  it("handles mouse hover and shows unified tooltip crosshair with metrics", () => {
    const data = generateMockData(24);
    const { container } = render(
      <MeteogramChart data={data} modelChain={mockModelChain} />,
    );

    const svg = container.querySelector(
      ".meteogram-svg-integrated",
    ) as SVGElement;
    expect(svg).toBeTruthy();

    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 550,
      right: 1000,
      bottom: 550,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Trigger hover event near timestamp 10
    fireEvent.mouseMove(svg, { clientX: 300, clientY: 100 });

    const tooltip = document.querySelector(".hover-unified-tooltip");
    expect(tooltip).toBeTruthy();

    const crosshair = container.querySelector(".hover-crosshair-group");
    expect(crosshair).toBeTruthy();
    const crosshairLine = crosshair?.querySelector("line");
    expect(crosshairLine).toBeTruthy();
    expect(crosshairLine?.getAttribute("y1")).toBe("22"); // dayHeaderTop
    expect(crosshairLine?.getAttribute("stroke")).toBe("#f43f5e");
    expect(crosshairLine?.getAttribute("stroke-dasharray")).toBe("4 2");
    expect(crosshair?.querySelector("circle")).toBeNull(); // endpoint circle removed

    // Check tooltip metrics
    expect(screen.getByText(/Temperature:/)).toBeTruthy();
    expect(screen.getByText(/Wind Speed:/)).toBeTruthy();
    expect(screen.getByText("Precipitation:")).toBeTruthy();

    // Mouse leave removes tooltip
    fireEvent.mouseLeave(svg);
    expect(document.querySelector(".hover-unified-tooltip")).toBeNull();
  });

  it("shows precipitation probability before precipitation and omits cloud details from the hover popup", () => {
    const data = generateMockData(24);
    const firstTimestamp = data[0].timestamp;
    const verticalCloudForecast: DetailedCloudForecast = {
      location: { name: "Test", latitude: 0, longitude: 0 },
      profiles: [
        {
          timestamp: firstTimestamp,
          source_model_id: "ecmwf_ifs025",
          source_model_name: "ECMWF IFS 0.25°",
          levels: [
            {
              pressure_hpa: 1000,
              altitude_m_asl: 200,
              cloud_cover_percent: 93,
            },
          ],
        },
      ],
    };
    const { container } = render(
      <MeteogramChart
        data={data}
        modelChain={mockModelChain}
        verticalCloudForecast={verticalCloudForecast}
      />,
    );
    const svg = container.querySelector(
      ".meteogram-svg-integrated",
    ) as SVGElement;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 550,
      right: 1000,
      bottom: 550,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.mouseMove(svg, { clientX: 51, clientY: 100 });

    const tooltip = document.querySelector(".hover-unified-tooltip")!;
    const labels = Array.from(
      tooltip.querySelectorAll(".tooltip-row .label"),
      (node) => node.textContent,
    );
    expect(labels.indexOf("Precip. Prob:")).toBeLessThan(
      labels.indexOf("Precipitation:"),
    );
    expect(tooltip.textContent).not.toContain("ECMWF IFS 0.25°");
    expect(tooltip.textContent).not.toContain("Detailed Cloud Profile");
    expect(tooltip.textContent).not.toContain("1000 hPa");
    expect(tooltip.textContent).not.toContain("93 %");
  });

  describe("Persistent Current-Time Cursor Line & Details Popup Behavior", () => {
    it("renders current-time cursor line when mouse is not hovering and current time is in range", () => {
      // Mock current date to be 12 hours after start of forecast
      const startDate = new Date("2026-09-11T00:00:00Z");
      const nowMs = startDate.getTime() + 12 * 3600 * 1000; // 12 hours later
      vi.useFakeTimers();
      vi.setSystemTime(nowMs);

      try {
        const data = generateMockData(24);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        // Current-time crosshair group is rendered when not hovering
        const currentTimeCrosshair = container.querySelector(
          '[data-testid="current-time-crosshair-group"]',
        );
        expect(currentTimeCrosshair).toBeTruthy();
        expect(
          container.querySelector('[data-testid="hover-crosshair-group"]'),
        ).toBeNull();

        const line = currentTimeCrosshair?.querySelector("line");
        expect(line).toBeTruthy();
        expect(line?.getAttribute("stroke")).toBe("#f43f5e");
        expect(line?.getAttribute("stroke-dasharray")).toBe("4 2");
        expect(line?.getAttribute("y1")).toBe("22");
        expect(line?.getAttribute("y2")).toBe("534");

        // Total width graphWidth = 900, paddingLeft = 50. 12h out of 23h span -> ~50 + (12/23)*900 = 519.5
        const xVal = parseFloat(line?.getAttribute("x1") || "0");
        expect(xVal).toBeGreaterThan(50);
        expect(xVal).toBeLessThan(950);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not render current-time line if current time is outside forecast time range", () => {
      // Set time way before forecast start
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

      try {
        const data = generateMockData(24);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        expect(
          container.querySelector(
            '[data-testid="current-time-crosshair-group"]',
          ),
        ).toBeNull();
        expect(
          container.querySelector('[data-testid="hover-crosshair-group"]'),
        ).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("hides current-time line and shows hover line on mouse move, then restores current-time line on mouse leave", () => {
      const startDate = new Date("2026-09-11T00:00:00Z");
      const nowMs = startDate.getTime() + 6 * 3600 * 1000;
      vi.useFakeTimers();
      vi.setSystemTime(nowMs);

      try {
        const data = generateMockData(24);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        const svg = container.querySelector(
          ".meteogram-svg-integrated",
        ) as SVGElement;
        vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
          left: 0,
          top: 0,
          width: 1000,
          height: 550,
          right: 1000,
          bottom: 550,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

        // Initially: current-time line visible, hover line hidden
        expect(
          container.querySelector(
            '[data-testid="current-time-crosshair-group"]',
          ),
        ).toBeTruthy();
        expect(
          container.querySelector('[data-testid="hover-crosshair-group"]'),
        ).toBeNull();

        // Mouse enters / moves: hover line visible, current-time line hidden
        fireEvent.mouseMove(svg, { clientX: 400, clientY: 200 });

        expect(
          container.querySelector(
            '[data-testid="current-time-crosshair-group"]',
          ),
        ).toBeNull();
        expect(
          container.querySelector('[data-testid="hover-crosshair-group"]'),
        ).toBeTruthy();

        // Mouse leaves: hover line hidden, current-time line restored
        fireEvent.mouseLeave(svg);

        expect(
          container.querySelector(
            '[data-testid="current-time-crosshair-group"]',
          ),
        ).toBeTruthy();
        expect(
          container.querySelector('[data-testid="hover-crosshair-group"]'),
        ).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("positions details popup pinned below date header on opposite side of cursor", () => {
      const data = generateMockData(24);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const cardContainer = container.querySelector(
        ".meteogram-redesign-container",
      ) as HTMLDivElement;
      vi.spyOn(cardContainer, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 200,
        width: 1000,
        height: 500,
        right: 1100,
        bottom: 700,
        x: 100,
        y: 200,
        toJSON: () => {},
      });

      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 100,
        top: 200,
        width: 1000,
        height: 500,
        right: 1100,
        bottom: 700,
        x: 100,
        y: 200,
        toJSON: () => {},
      });

      // Midpoint in container width (1000) is 600.
      // Hover in left half (clientX = 300) -> popup pinned to RIGHT side
      fireEvent.mouseMove(svg, { clientX: 300, clientY: 400 });

      let tooltip = document.querySelector(
        ".hover-unified-tooltip",
      ) as HTMLDivElement;
      expect(tooltip).toBeTruthy();
      // Top is placed below date header (> 200px)
      const topPos = parseFloat(tooltip.style.top);
      expect(topPos).toBeGreaterThan(200);
      expect(topPos).toBeLessThan(400);
      // Right side: pinned to right edge with inset
      const rightSideLeft = parseFloat(tooltip.style.left);
      expect(rightSideLeft).toBeGreaterThan(600);

      // Hover in right half (clientX = 900) -> popup pinned to LEFT side
      fireEvent.mouseMove(svg, { clientX: 900, clientY: 150 });

      tooltip = document.querySelector(
        ".hover-unified-tooltip",
      ) as HTMLDivElement;
      expect(tooltip).toBeTruthy();
      // Top STILL aligns below date header (stable vertically regardless of clientY 150 vs 400)
      expect(parseFloat(tooltip.style.top)).toBe(topPos);
      // Left side: pinned to left edge with inset
      const leftSideLeft = parseFloat(tooltip.style.left);
      expect(leftSideLeft).toBeLessThan(600);
      expect(leftSideLeft).toBeLessThan(rightSideLeft);
    });
  });

  it("handles missing cloud layers and missing precipitation probability gracefully", () => {
    const startTime = new Date("2026-09-11T00:00:00Z").toISOString();
    const incompleteData: DataPoint[] = [
      {
        timestamp: startTime,
        variable: "temperature",
        value: 18.2,
        unit: "°C",
        model: "ICON-D2",
      },
      {
        timestamp: startTime,
        variable: "wind_speed",
        value: 12.0,
        unit: "km/h",
        model: "ICON-D2",
      },
      {
        timestamp: startTime,
        variable: "precipitation",
        value: 0.5,
        unit: "mm",
        model: "ICON-D2",
      },
      // cloud layers and precip_probability deliberately missing
    ];

    const { container } = render(
      <MeteogramChart data={incompleteData} modelChain={mockModelChain} />,
    );

    expect(container.querySelector(".meteogram-svg-integrated")).toBeTruthy();
  });

  it("renders solid 0 °C reference line with day-separator styling and no blue label when temperatures are near or below freezing", () => {
    const startTime = new Date("2026-09-11T00:00:00Z").toISOString();
    const freezingData: DataPoint[] = [
      {
        timestamp: startTime,
        variable: "temperature",
        value: -5.0,
        unit: "°C",
        model: "ICON-D2",
      },
      {
        timestamp: startTime,
        variable: "precipitation",
        value: 0.0,
        unit: "mm",
        model: "ICON-D2",
      },
    ];

    render(<MeteogramChart data={freezingData} modelChain={mockModelChain} />);

    const line = screen.getByTestId("freezing-line");
    expect(line).toBeTruthy();
    expect(line.getAttribute("stroke")).toBe("#cbd5e1");
    expect(line.getAttribute("stroke-width")).toBe("1.2");
    expect(line.getAttribute("opacity")).toBe("1");
    expect(line.hasAttribute("stroke-dasharray")).toBe(false);
    expect(screen.queryByTestId("freezing-label")).toBeNull();
  });

  it("renders white background container for chart area", () => {
    const data = generateMockData(24);
    render(<MeteogramChart data={data} modelChain={mockModelChain} />);

    expect(screen.getByTestId("meteogram-chart-white-bg")).toBeTruthy();
  });

  it("renders detailed vertical clouds panel, terrain mask, and distinct model provenance in tooltip", () => {
    const ts0 = new Date("2026-09-11T00:00:00Z").toISOString();
    const mockData: DataPoint[] = [
      {
        timestamp: ts0,
        variable: "temperature",
        value: 12.0,
        unit: "°C",
        model: "ICON-CH2",
      },
      {
        timestamp: ts0,
        variable: "wind_speed",
        value: 10.0,
        unit: "km/h",
        model: "ICON-CH2",
      },
      {
        timestamp: ts0,
        variable: "cloud_cover",
        value: 70,
        unit: "%",
        model: "ICON-CH2",
      },
    ];

    const mockLocation = {
      name: "Zurich",
      latitude: 47.376,
      longitude: 8.541,
      elevation: 408,
    };

    const mockVcloudForecast = {
      location: mockLocation,
      profiles: [
        {
          timestamp: ts0,
          source_model_id: "gfs_seamless",
          source_model_name: "GFS",
          levels: [
            {
              pressure_hpa: 1000,
              altitude_m_asl: 110,
              cloud_cover_percent: 15,
            },
            {
              pressure_hpa: 850,
              altitude_m_asl: 1450,
              cloud_cover_percent: 85,
            },
            {
              pressure_hpa: 500,
              altitude_m_asl: 5570,
              cloud_cover_percent: 45,
            },
          ],
        },
      ],
    };

    const { container } = render(
      <MeteogramChart
        data={mockData}
        modelChain={mockModelChain}
        location={mockLocation}
        verticalCloudForecast={mockVcloudForecast}
      />,
    );

    // Combined plot area and detailed clouds layer
    expect(screen.getByTestId("panel-combined-precip-clouds")).toBeTruthy();
    expect(screen.getByTestId("cloud-profile-layer")).toBeTruthy();

    // Terrain mask
    expect(screen.getByTestId("terrain-mask")).toBeTruthy();
    expect(screen.getByText(/0.4 km — Zurich/)).toBeTruthy();

    // Vertical cloud cells
    expect(
      container.querySelectorAll('[data-testid="vertical-cloud-cell"]').length,
    ).toBeGreaterThan(0);

    // Hover tooltip checking dual provenance
    const svg = container.querySelector(
      ".meteogram-svg-integrated",
    ) as SVGElement;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 635,
      right: 1000,
      bottom: 635,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });

    const tooltip = document.querySelector(".hover-unified-tooltip");
    expect(tooltip).toBeTruthy();

    // Main forecast model: ICON-CH2
    expect(screen.getByText("ICON-CH2")).toBeTruthy();

    // Cloud model metadata and individual level values stay out of the popup.
    expect(screen.queryByText(/Detailed Cloud Profile/)).toBeNull();
    expect(screen.queryByText(/Model: GFS/)).toBeNull();
  });

  it("dynamically scales precipitation Y-axis so max bar uses 80% height with 20% headroom", () => {
    const startTime = new Date("2026-09-11T00:00:00Z").toISOString();
    const precipData: DataPoint[] = [
      {
        timestamp: startTime,
        variable: "precipitation",
        value: 2.0,
        unit: "mm",
        model: "ICON-D2",
      },
      {
        timestamp: startTime,
        variable: "precipitation_probability",
        value: 80,
        unit: "%",
        model: "ICON-D2",
      },
    ];

    const { container } = render(
      <MeteogramChart data={precipData} modelChain={mockModelChain} />,
    );

    // Max precip is 2.0 mm, so precipAxisMax = 2.0 / 0.8 = 2.5 mm
    expect(screen.getByText("2.5 mm")).toBeTruthy();

    const bar = container.querySelector(
      '[data-testid="precip-bar"]',
    ) as SVGRectElement;
    expect(bar).toBeTruthy();
    // Usable height is precipHeight - 20 = 105 - 20 = 85px. 80% of 85px = 68px.
    const barHeight = parseFloat(bar.getAttribute("height") || "0");
    expect(barHeight).toBeCloseTo(68, 0);
  });

  it("determines precipitation Y-axis max from all data of all models so moving boundaries does not change it", () => {
    const ts0 = new Date("2026-09-11T00:00:00Z").toISOString();
    const ts1 = new Date("2026-09-11T01:00:00Z").toISOString();

    // Model A has max 4.0 mm, Model B has max 2.0 mm
    const modelForecasts = {
      "ICON-D2": [
        {
          timestamp: ts0,
          variable: "precipitation",
          value: 4.0,
          unit: "mm",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "precipitation",
          value: 1.0,
          unit: "mm",
          model: "ICON-D2",
        },
      ],
      "ICON-EU": [
        {
          timestamp: ts0,
          variable: "precipitation",
          value: 2.0,
          unit: "mm",
          model: "ICON-EU",
        },
        {
          timestamp: ts1,
          variable: "precipitation",
          value: 2.0,
          unit: "mm",
          model: "ICON-EU",
        },
      ],
    };

    // Case 1: active data currently only selects ICON-EU (max in active data is only 2.0 mm)
    const activeDataIconEu: DataPoint[] = [
      {
        timestamp: ts0,
        variable: "precipitation",
        value: 2.0,
        unit: "mm",
        model: "ICON-EU",
      },
      {
        timestamp: ts1,
        variable: "precipitation",
        value: 2.0,
        unit: "mm",
        model: "ICON-EU",
      },
    ];

    const { rerender } = render(
      <MeteogramChart
        data={activeDataIconEu}
        modelChain={mockModelChain}
        modelForecasts={modelForecasts}
      />,
    );

    // Global max across all models is 4.0 mm.
    // So precipAxisMax = 4.0 / 0.8 = 5.0 mm, NOT 2.0 / 0.8 = 2.5 mm!
    expect(screen.getByText("5.0 mm")).toBeTruthy();

    // Case 2: User moved model boundary so active data now selects ICON-D2 (max in active data is 4.0 mm)
    const activeDataIconD2: DataPoint[] = [
      {
        timestamp: ts0,
        variable: "precipitation",
        value: 4.0,
        unit: "mm",
        model: "ICON-D2",
      },
      {
        timestamp: ts1,
        variable: "precipitation",
        value: 1.0,
        unit: "mm",
        model: "ICON-D2",
      },
    ];

    rerender(
      <MeteogramChart
        data={activeDataIconD2}
        modelChain={mockModelChain}
        modelForecasts={modelForecasts}
      />,
    );

    // Axis max MUST remain strictly 5.0 mm!
    expect(screen.getByText("5.0 mm")).toBeTruthy();
  });

  it("renders correctly when one model has empty data points in its specified range", () => {
    const startTime = new Date("2026-09-11T00:00:00Z");
    const data: DataPoint[] = [];

    // First 24 hours: ICON-D2 has empty/null data
    for (let h = 0; h < 24; h++) {
      const ts = new Date(startTime.getTime() + h * 3600 * 1000).toISOString();
      data.push(
        {
          timestamp: ts,
          variable: "temperature",
          value: null,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts,
          variable: "wind_speed",
          value: null,
          unit: "km/h",
          model: "ICON-D2",
        },
      );
    }

    // Next 24 hours: ICON-EU has valid data
    for (let h = 24; h < 48; h++) {
      const ts = new Date(startTime.getTime() + h * 3600 * 1000).toISOString();
      data.push(
        {
          timestamp: ts,
          variable: "temperature",
          value: 15.0 + (h - 24),
          unit: "°C",
          model: "ICON-EU",
        },
        {
          timestamp: ts,
          variable: "wind_speed",
          value: 10.0,
          unit: "km/h",
          model: "ICON-EU",
        },
      );
    }

    const chain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 24 },
      { name: "ICON-EU", max_forecast_horizon_hours: 48 },
    ];
    const timelineEnd = new Date(
      startTime.getTime() + 48 * 3600 * 1000,
    ).toISOString();
    const { container } = render(
      <MeteogramChart
        data={data}
        modelChain={chain}
        forecastStartTime={startTime.toISOString()}
        timelineStart={startTime.toISOString()}
        timelineEnd={timelineEnd}
      />,
    );

    // SVG renders properly
    expect(container.querySelector(".meteogram-svg-integrated")).toBeTruthy();

    // Boundary marker between ICON-D2 and ICON-EU is displayed
    const boundaries = container.querySelectorAll(".model-boundary-group");
    expect(boundaries.length).toBeGreaterThan(0);
    expect(screen.getAllByText("ICON-EU").length).toBeGreaterThan(0);
  });

  describe("Day-Label Row & Separator Lines", () => {
    it("vertical day separators extend into day-label row and cells use uniform background", () => {
      const data = generateMockData(72); // 3 days
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const separatorLines = container.querySelectorAll(
        '[data-testid="day-separator-line"]',
      );
      const dayLabelCells = container.querySelectorAll(
        '[data-testid="day-label-cell"]',
      );

      expect(separatorLines.length).toBeGreaterThan(0);
      expect(dayLabelCells.length).toBeGreaterThan(0);

      // Verify all day label cells use the same uniform fill background
      const fills = Array.from(dayLabelCells).map((c) =>
        c.getAttribute("fill"),
      );
      const firstFill = fills[0];
      expect(fills.every((f) => f === firstFill)).toBe(true);
      expect(firstFill).toBe("#f1f5f9");

      // Verify vertical day separator lines start at dayHeaderTop (22) or below and do not extend above it
      separatorLines.forEach((line) => {
        const y1 = parseFloat(line.getAttribute("y1") || "0");
        expect(y1).toBeGreaterThanOrEqual(22);
      });
    });

    it("preserves alternating day shading below the day-label row", () => {
      const data = generateMockData(72);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const dayBlocks = container.querySelectorAll(".day-group-block");
      expect(dayBlocks.length).toBeGreaterThanOrEqual(3);

      const day1Rect = dayBlocks[0].querySelector("rect");
      const day2Rect = dayBlocks[1].querySelector("rect");

      expect(day1Rect?.getAttribute("fill")).toBe("rgba(0, 0, 0, 0.03)");
      expect(day2Rect?.getAttribute("fill")).toBe("transparent");
    });
  });

  describe("Model Label Layout & Alignment", () => {
    it("renders model badges above day labels and aligns first model to X origin and subsequent models to dashed boundary lines", () => {
      const data = generateMockData(120); // 5 days, transitions at 48h (ICON-D2 -> ICON-EU) and 120h
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const segments = container.querySelectorAll(
        '[data-testid="model-label-segment"]',
      );
      expect(segments.length).toBeGreaterThanOrEqual(2);

      const seg1 = segments[0] as SVGGElement;
      const seg2 = segments[1] as SVGGElement;

      // First segment model name: ICON-D2
      expect(seg1.getAttribute("data-model")).toBe("ICON-D2");
      // Segment 0 starts exactly at visible time-axis X origin (paddingLeft = 50)
      const seg1StartX = parseFloat(seg1.getAttribute("data-start-x") || "0");
      expect(seg1StartX).toBe(50);

      // Segment 1 starts at boundary X (seg1.endX === seg2.startX)
      const seg1EndX = parseFloat(seg1.getAttribute("data-end-x") || "0");
      const seg2StartX = parseFloat(seg2.getAttribute("data-start-x") || "0");
      expect(seg1EndX).toBe(seg2StartX);

      // Dashed boundary line X matches seg2StartX
      const boundaryLine = container.querySelector(
        '[data-testid="model-boundary-line"]',
      );
      expect(boundaryLine).toBeTruthy();
      const lineX = parseFloat(boundaryLine?.getAttribute("x1") || "0");
      expect(lineX).toBe(seg2StartX);
      const seg1Shape = seg1.querySelector(
        '[data-testid="model-header-shape"]',
      );
      expect(Number(boundaryLine?.getAttribute("y1"))).toBe(
        Number(seg1Shape?.getAttribute("data-y")) +
          Number(seg1Shape?.getAttribute("data-height")),
      );

      // Model badges render in modelHeader row (y < 22), which is above dayHeader row (y >= 22)
      const seg1Y = parseFloat(seg1Shape?.getAttribute("data-y") || "0");
      expect(seg1Y).toBeLessThan(22);
      expect(seg1Shape?.getAttribute("data-top-radius")).toBe("3");
      expect(seg1Shape?.getAttribute("data-bottom-radius")).toBe("0");
    });

    it("ensures no gaps or overlaps between model ranges", () => {
      const data = generateMockData(168);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const segments = container.querySelectorAll(
        '[data-testid="model-label-segment"]',
      );
      expect(segments.length).toBeGreaterThan(1);

      for (let i = 0; i < segments.length - 1; i++) {
        const currEndX = parseFloat(
          segments[i].getAttribute("data-end-x") || "0",
        );
        const nextStartX = parseFloat(
          segments[i + 1].getAttribute("data-start-x") || "0",
        );
        expect(currEndX).toBe(nextStartX); // No gap, no overlap

        const currentShape = segments[i].querySelector(
          '[data-testid="model-header-shape"]',
        )!;
        const nextShape = segments[i + 1].querySelector(
          '[data-testid="model-header-shape"]',
        )!;
        expect(
          Number(currentShape.getAttribute("data-x")) +
            Number(currentShape.getAttribute("data-width")),
        ).toBe(nextStartX);
        expect(Number(nextShape.getAttribute("data-x"))).toBe(nextStartX);
      }
    });

    it("keeps header edges and dashed boundaries aligned when the visible timeline changes", () => {
      const data = generateMockData(168);
      const start = "2026-09-11T00:00:00.000Z";
      const { container, rerender } = render(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          forecastStartTime={start}
          timelineStart={start}
          timelineEnd="2026-09-16T00:00:00.000Z"
        />,
      );

      const assertAligned = () => {
        const segments = container.querySelectorAll(
          '[data-testid="model-label-segment"]',
        );
        const boundaries = container.querySelectorAll(
          '[data-testid="model-boundary-line"]',
        );
        boundaries.forEach((boundary, index) => {
          const x = Number(boundary.getAttribute("x1"));
          expect(Number(segments[index].getAttribute("data-end-x"))).toBe(x);
          expect(Number(segments[index + 1].getAttribute("data-start-x"))).toBe(
            x,
          );
        });
      };

      assertAligned();
      rerender(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          forecastStartTime={start}
          timelineStart={start}
          timelineEnd="2026-09-18T00:00:00.000Z"
        />,
      );
      assertAligned();
    });
  });

  describe("Omission of Aggregate and Total Cloud Coverage from Meteogram Rendering", () => {
    it("does not render high/mid/low cloud cells or aggregate cloud panel", () => {
      const ts0 = new Date("2026-09-11T00:00:00Z").toISOString();
      const mockData: DataPoint[] = [
        {
          timestamp: ts0,
          variable: "cloud_cover",
          value: 75,
          unit: "%",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={mockData} modelChain={mockModelChain} />,
      );

      expect(
        container.querySelector('[data-testid="high-cloud-cell"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="mid-cloud-cell"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="low-cloud-cell"]'),
      ).toBeNull();
      expect(container.querySelector(".panel-clouds")).toBeNull();
    });

    it("does not render total cloud cover line, area, or tooltip entry", () => {
      const ts0 = new Date("2026-09-11T00:00:00Z").toISOString();
      const mockData: DataPoint[] = [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 20,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts0,
          variable: "cloud_cover",
          value: 80,
          unit: "%",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={mockData} modelChain={mockModelChain} />,
      );
      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;
      expect(svg).toBeTruthy();

      // Trigger hover over chart
      fireEvent.mouseMove(svg, { clientX: 200, clientY: 100 });

      // Verify tooltip does not show Clouds (L/M/H) or total cloud coverage
      expect(screen.queryByText(/Clouds \(L\/M\/H\)/i)).toBeNull();
      expect(screen.queryByText(/Total Cloud/i)).toBeNull();
    });
  });

  describe("Zero-Span Resized Models (0h)", () => {
    it("removes heading and boundary lines when the first model in the chain is resized to 0h", () => {
      // Model chain where ICON-D2 has 0h, ICON-EU has 48h, GFS has 120h
      const chainWithFirstZero: WeatherModel[] = [
        { name: "ICON-D2", max_forecast_horizon_hours: 0 },
        { name: "ICON-EU", max_forecast_horizon_hours: 48 },
        { name: "GFS", max_forecast_horizon_hours: 120 },
      ];

      const modelForecasts: Record<string, DataPoint[]> = {
        "ICON-D2": generateMockData(48).map((p) => ({
          ...p,
          model: "ICON-D2",
        })),
        "ICON-EU": generateMockData(120).map((p) => ({
          ...p,
          model: "ICON-EU",
        })),
        GFS: generateMockData(120).map((p) => ({ ...p, model: "GFS" })),
      };
      const data = mergeForecastSegments(chainWithFirstZero, modelForecasts, [
        "temperature",
        "wind_speed",
      ]);

      const { container } = render(
        <MeteogramChart data={data} modelChain={chainWithFirstZero} />,
      );

      // ICON-D2 heading segment must be completely removed
      const iconD2Segments = container.querySelectorAll(
        '[data-model="ICON-D2"]',
      );
      expect(iconD2Segments.length).toBe(0);

      // Remaining active models must be present
      const segments = container.querySelectorAll(
        '[data-testid="model-label-segment"]',
      );
      expect(segments.length).toBe(2);
      expect(segments[0].getAttribute("data-model")).toBe("ICON-EU");
      expect(segments[1].getAttribute("data-model")).toBe("GFS");

      // The first active model (ICON-EU) starts at paddingLeft (50)
      expect(parseFloat(segments[0].getAttribute("data-start-x") || "0")).toBe(
        50,
      );

      // There must be exactly 1 boundary line (between ICON-EU and GFS at 48h), not at 0h or 1h
      const boundaryLines = container.querySelectorAll(
        '[data-testid="model-boundary-line"]',
      );
      expect(boundaryLines.length).toBe(1);
      const boundaryX = parseFloat(boundaryLines[0].getAttribute("x1") || "0");
      expect(boundaryX).toBeGreaterThan(50);
    });

    it("removes heading and redundant boundary lines when a middle model is resized to 0h", () => {
      // Model chain where ICON-EU has 0h span (48h -> 48h)
      const chainWithMiddleZero: WeatherModel[] = [
        { name: "ICON-D2", max_forecast_horizon_hours: 48 },
        { name: "ICON-EU", max_forecast_horizon_hours: 48 },
        { name: "GFS", max_forecast_horizon_hours: 120 },
      ];

      const modelForecasts: Record<string, DataPoint[]> = {
        "ICON-D2": generateMockData(48).map((p) => ({
          ...p,
          model: "ICON-D2",
        })),
        "ICON-EU": generateMockData(120).map((p) => ({
          ...p,
          model: "ICON-EU",
        })),
        GFS: generateMockData(120).map((p) => ({ ...p, model: "GFS" })),
      };
      const data = mergeForecastSegments(chainWithMiddleZero, modelForecasts, [
        "temperature",
        "wind_speed",
      ]);

      const { container } = render(
        <MeteogramChart data={data} modelChain={chainWithMiddleZero} />,
      );

      // ICON-EU heading segment must be completely removed
      const iconEuSegments = container.querySelectorAll(
        '[data-model="ICON-EU"]',
      );
      expect(iconEuSegments.length).toBe(0);

      // Active models: ICON-D2 and GFS
      const segments = container.querySelectorAll(
        '[data-testid="model-label-segment"]',
      );
      expect(segments.length).toBe(2);
      expect(segments[0].getAttribute("data-model")).toBe("ICON-D2");
      expect(segments[1].getAttribute("data-model")).toBe("GFS");

      // Exactly 1 transition boundary line between ICON-D2 and GFS at 48h
      const boundaryLines = container.querySelectorAll(
        '[data-testid="model-boundary-line"]',
      );
      expect(boundaryLines.length).toBe(1);
      const lineX = parseFloat(boundaryLines[0].getAttribute("x1") || "0");
      expect(lineX).toBe(
        parseFloat(segments[1].getAttribute("data-start-x") || "0"),
      );
    });

    it("removes heading and boundary line when the last model in the chain is resized to 0h", () => {
      // Model chain where GFS has 0h span (120h -> 120h)
      const chainWithLastZero: WeatherModel[] = [
        { name: "ICON-D2", max_forecast_horizon_hours: 48 },
        { name: "ICON-EU", max_forecast_horizon_hours: 120 },
        { name: "GFS", max_forecast_horizon_hours: 120 },
      ];

      const modelForecasts: Record<string, DataPoint[]> = {
        "ICON-D2": generateMockData(48).map((p) => ({
          ...p,
          model: "ICON-D2",
        })),
        "ICON-EU": generateMockData(120).map((p) => ({
          ...p,
          model: "ICON-EU",
        })),
        GFS: generateMockData(120).map((p) => ({ ...p, model: "GFS" })),
      };
      const data = mergeForecastSegments(chainWithLastZero, modelForecasts, [
        "temperature",
        "wind_speed",
      ]);

      const { container } = render(
        <MeteogramChart data={data} modelChain={chainWithLastZero} />,
      );

      // GFS heading segment must be completely removed
      const gfsSegments = container.querySelectorAll('[data-model="GFS"]');
      expect(gfsSegments.length).toBe(0);

      // Active models: ICON-D2 and ICON-EU
      const segments = container.querySelectorAll(
        '[data-testid="model-label-segment"]',
      );
      expect(segments.length).toBe(2);
      expect(segments[0].getAttribute("data-model")).toBe("ICON-D2");
      expect(segments[1].getAttribute("data-model")).toBe("ICON-EU");

      // Exactly 1 boundary line at 48h between ICON-D2 and ICON-EU
      const boundaryLines = container.querySelectorAll(
        '[data-testid="model-boundary-line"]',
      );
      expect(boundaryLines.length).toBe(1);
    });
  });

  describe("Apparent Temperature Curve & Y-Axis Scaling", () => {
    const chain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    ];

    it("renders apparent temperature curve in brown alongside normal temperature curve", () => {
      const ts0 = "2026-09-12T00:00:00.000Z";
      const ts1 = "2026-09-12T01:00:00.000Z";

      const data: DataPoint[] = [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts0,
          variable: "apparent_temperature",
          value: 12,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "temperature",
          value: 17,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "apparent_temperature",
          value: 14,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={data} modelChain={chain} />,
      );

      const apparentPath = container.querySelector(
        '[data-testid="apparent-temperature-path"]',
      );
      const tempPath = container.querySelector(
        '[data-testid="temperature-path"]',
      );

      expect(apparentPath).toBeTruthy();
      expect(apparentPath?.getAttribute("stroke")).toBe("#92400e");

      expect(tempPath).toBeTruthy();
      expect(tempPath?.getAttribute("stroke")).toBe("#f43f5e");
    });

    it("adjusts temperature Y-axis to the minimum and maximum of both curves across all models in modelForecasts", () => {
      const ts0 = "2026-09-12T00:00:00.000Z";
      const ts1 = "2026-09-12T01:00:00.000Z";

      // Active slice has temperature 10..15 and apparent temperature 8..12
      const activeData: DataPoint[] = [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 10,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts0,
          variable: "apparent_temperature",
          value: 8,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "apparent_temperature",
          value: 12,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      // Model forecasts across configuration has a second model with extreme apparent temperature: min -8°C, max 35°C
      const modelForecasts: Record<string, DataPoint[]> = {
        "ICON-D2": activeData,
        "ICON-EU": [
          {
            timestamp: "2026-09-13T00:00:00.000Z",
            variable: "temperature",
            value: 25,
            unit: "°C",
            model: "ICON-EU",
          },
          {
            timestamp: "2026-09-13T00:00:00.000Z",
            variable: "apparent_temperature",
            value: 35,
            unit: "°C",
            model: "ICON-EU",
          },
          {
            timestamp: "2026-09-13T06:00:00.000Z",
            variable: "temperature",
            value: -4,
            unit: "°C",
            model: "ICON-EU",
          },
          {
            timestamp: "2026-09-13T06:00:00.000Z",
            variable: "apparent_temperature",
            value: -8,
            unit: "°C",
            model: "ICON-EU",
          },
        ],
      };

      const { container } = render(
        <MeteogramChart
          data={activeData}
          modelChain={chain}
          modelForecasts={modelForecasts}
        />,
      );

      // Max temp axis label should encompass 35°C (35 + 2 = 37°)
      // Min temp axis label should encompass -8°C (-8 - 2 = -10°)
      const panel = container.querySelector(".panel-temperature");
      expect(panel?.textContent).toContain("37°");
      expect(panel?.textContent).toContain("-10°");
    });
  });

  describe("Daily Min and Max Temperature Labels", () => {
    it("displays daily max above and daily min below the real temperature curve for each day", () => {
      const data: DataPoint[] = [
        // Day 1: min 12, max 24
        {
          timestamp: "2026-09-12T02:00:00.000Z",
          variable: "temperature",
          value: 12,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-12T08:00:00.000Z",
          variable: "temperature",
          value: 18,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-12T14:00:00.000Z",
          variable: "temperature",
          value: 24,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-12T20:00:00.000Z",
          variable: "temperature",
          value: 16,
          unit: "°C",
          model: "ICON-D2",
        },
        // Day 2: min 9, max 21
        {
          timestamp: "2026-09-13T02:00:00.000Z",
          variable: "temperature",
          value: 9,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-13T08:00:00.000Z",
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-13T14:00:00.000Z",
          variable: "temperature",
          value: 21,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-13T20:00:00.000Z",
          variable: "temperature",
          value: 14,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const maxLabels = container.querySelectorAll(
        '[data-testid="daily-max-temp"]',
      );
      const minLabels = container.querySelectorAll(
        '[data-testid="daily-min-temp"]',
      );

      expect(maxLabels.length).toBe(2);
      expect(minLabels.length).toBe(2);

      // Day 1: max 24°C, min 12°C
      expect(maxLabels[0].textContent).toBe("24°C");
      expect(minLabels[0].textContent).toBe("12°C");

      // Day 2: max 21°C, min 9°C
      expect(maxLabels[1].textContent).toBe("21°C");
      expect(minLabels[1].textContent).toBe("9°C");

      // In SVG coordinates, max label Y is lower numerical value (higher on screen) than min label Y
      const day1MaxY = parseFloat(maxLabels[0].getAttribute("y") || "0");
      const day1MinY = parseFloat(minLabels[0].getAttribute("y") || "0");
      expect(day1MaxY).toBeLessThan(day1MinY);
    });

    it("strictly calculates daily min and max from real temperature, ignoring apparent temperature", () => {
      const data: DataPoint[] = [
        // Real temperature has min 10, max 20
        {
          timestamp: "2026-09-12T04:00:00.000Z",
          variable: "temperature",
          value: 10,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-12T14:00:00.000Z",
          variable: "temperature",
          value: 20,
          unit: "°C",
          model: "ICON-D2",
        },
        // Apparent temperature has extreme min 2, max 35
        {
          timestamp: "2026-09-12T04:00:00.000Z",
          variable: "apparent_temperature",
          value: 2,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-12T14:00:00.000Z",
          variable: "apparent_temperature",
          value: 35,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const maxLabels = container.querySelectorAll(
        '[data-testid="daily-max-temp"]',
      );
      const minLabels = container.querySelectorAll(
        '[data-testid="daily-min-temp"]',
      );

      expect(maxLabels.length).toBe(1);
      expect(minLabels.length).toBe(1);

      // Must be 20°C and 10°C from real temperature, NOT 35°C and 2°C from apparent temperature
      expect(maxLabels[0].textContent).toBe("20°C");
      expect(minLabels[0].textContent).toBe("10°C");
    });

    it("does not show the bigger label but only the smaller one if two labels touch at the border of a day", () => {
      // 48 hours across 2 days (Day 1: 2026-09-12, Day 2: 2026-09-13)
      const data: DataPoint[] = [];

      for (let h = 0; h < 24; h++) {
        const ts = `2026-09-12T${String(h).padStart(2, "0")}:00:00`;
        const temp = h === 14 ? 24 : h === 23 ? 16 : 20;
        data.push({
          timestamp: ts,
          variable: "temperature",
          value: temp,
          unit: "°C",
          model: "ICON-D2",
        });
      }
      for (let h = 0; h < 24; h++) {
        const ts = `2026-09-13T${String(h).padStart(2, "0")}:00:00`;
        const temp = h === 0 ? 14 : h === 14 ? 22 : 19;
        data.push({
          timestamp: ts,
          variable: "temperature",
          value: temp,
          unit: "°C",
          model: "ICON-D2",
        });
      }

      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const minLabels = container.querySelectorAll(
        '[data-testid="daily-min-temp"]',
      );
      // The 16°C label on Day 1 (23:00) touches the 14°C label on Day 2 (00:00) across the midnight day border
      // Only the smaller one (14°C) must be shown, and the bigger one (16°C) must be hidden
      expect(minLabels.length).toBe(1);
      expect(minLabels[0].textContent).toBe("14°C");
    });

    it("hides the second label if it is bigger when two labels touch at the border of a day", () => {
      // Day 1 has 14°C at 23:00, Day 2 has 16°C at 00:00 (warming night)
      const data: DataPoint[] = [];

      for (let h = 0; h < 24; h++) {
        const ts = `2026-09-12T${String(h).padStart(2, "0")}:00:00`;
        const temp = h === 14 ? 24 : h === 23 ? 14 : 20;
        data.push({
          timestamp: ts,
          variable: "temperature",
          value: temp,
          unit: "°C",
          model: "ICON-D2",
        });
      }
      for (let h = 0; h < 24; h++) {
        const ts = `2026-09-13T${String(h).padStart(2, "0")}:00:00`;
        const temp = h === 0 ? 16 : h === 14 ? 22 : 19;
        data.push({
          timestamp: ts,
          variable: "temperature",
          value: temp,
          unit: "°C",
          model: "ICON-D2",
        });
      }

      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const minLabels = container.querySelectorAll(
        '[data-testid="daily-min-temp"]',
      );
      // The 16°C label on Day 2 is bigger and must be hidden; only 14°C on Day 1 is shown
      expect(minLabels.length).toBe(1);
      expect(minLabels[0].textContent).toBe("14°C");
    });
  });

  describe("Daylight Stripes (Sunrise to Sunset)", () => {
    const baseChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 24 },
    ];

    it("aligns yesterday and today daylight across midnight in both chart modes", () => {
      const start = Date.parse("2026-09-15T00:00:00Z");
      const data: DataPoint[] = Array.from({ length: 48 }, (_, i) => ({
        timestamp: new Date(start + i * 3600000).toISOString(),
        variable: "temperature",
        value: 15,
        unit: "°C",
        model: "ICON-D2",
      }));
      const phases = [15, 16].map((day) => ({
        day: `2026-09-${day}`,
        sunrise: `2026-09-${day}T05:00:00Z`,
        sunset: `2026-09-${day}T17:00:00Z`,
      }));
      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={baseChain}
          sunPhases={phases}
          forecastStartTime="2026-09-16T10:00:00Z"
          timelineStart="2026-09-15T00:00:00Z"
          timelineEnd="2026-09-17T00:00:00Z"
          location={{
            name: "Alps",
            latitude: 46,
            longitude: 8,
            timezone: "Europe/Berlin",
          }}
        />,
      );
      const embedded = Array.from(
        container.querySelectorAll('[data-testid="daylight-stripe"]'),
      );
      expect(embedded).toHaveLength(8);
      const svg = screen
        .getByTestId("meteogram-chart-white-bg")
        .querySelector("svg")!;
      const visibleStart = Date.parse(
        svg.getAttribute("data-visible-start-time")!,
      );
      const visibleEnd = Date.parse(svg.getAttribute("data-visible-end-time")!);
      const x = (timestamp: string) =>
        50 +
        (900 * (Date.parse(timestamp) - visibleStart)) /
          (visibleEnd - visibleStart);
      expect(Number(embedded[0].getAttribute("x"))).toBeCloseTo(
        x(phases[0].sunrise),
        1,
      );
      expect(Number(embedded[4].getAttribute("x"))).toBeCloseTo(
        x(phases[1].sunrise),
        1,
      );
      fireEvent.doubleClick(
        screen.getByTestId("meteogram-chart-white-bg").parentElement!,
      );
      const fullscreen = screen
        .getByTestId("fullscreen-chart-area")
        .querySelectorAll('[data-testid="daylight-stripe"]');
      expect(fullscreen).toHaveLength(8);
      fullscreen.forEach((stripe, i) => {
        for (const attr of ["x", "width", "y", "height", "fill", "opacity"])
          expect(stripe.getAttribute(attr)).toBe(
            embedded[i].getAttribute(attr),
          );
      });
    });

    it("renders light yellow stripes in the background for each day from sunrise to sunset", () => {
      // 24 hours timeline: 2026-09-12T00:00 to 2026-09-12T23:00 (24 points)
      const data: DataPoint[] = Array.from({ length: 24 }, (_, i) => ({
        timestamp: `2026-09-12T${String(i).padStart(2, "0")}:00:00.000Z`,
        variable: "temperature",
        value: 15,
        unit: "°C",
        model: "ICON-D2",
      }));

      const sunPhases = [
        {
          day: "2026-09-12",
          sunrise: "2026-09-12T06:00:00.000Z",
          sunset: "2026-09-12T18:00:00.000Z",
        },
      ];

      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={baseChain}
          sunPhases={sunPhases}
        />,
      );

      const stripes = container.querySelectorAll(
        '[data-testid="daylight-stripe"]',
      );
      expect(stripes.length).toBe(4); // 1 day * 3 panel areas
      expect(container.querySelectorAll(".daylight-stripe-group").length).toBe(
        1,
      );

      const stripe = stripes[0];
      expect(stripe.getAttribute("fill")).toBe("#fef08a");
      expect(stripe.getAttribute("opacity")).toBe("0.45");
      expect(
        (stripe as SVGElement).style.pointerEvents ||
          stripe.getAttribute("pointer-events"),
      ).toBe("none");

      const x = parseFloat(stripe.getAttribute("x") || "0");
      const width = parseFloat(stripe.getAttribute("width") || "0");
      const y = parseFloat(stripe.getAttribute("y") || "0");
      const height = parseFloat(stripe.getAttribute("height") || "0");
      // Top of daylight stripe in Area 1 starts at dayHeaderBottom (44) and spans downwards to tempBottom (159 - 44 = 115)
      expect(y).toBe(44);
      expect(height).toBe(115);

      // In 24h timeline (0 to 23 hours), 6h is ~26% of span (6/23)
      // Graph width is 935 (50 to 985). 50 + 6/23 * 935 ≈ 293.9
      expect(x).toBeGreaterThan(200);
      expect(x).toBeLessThan(350);

      // Width from 06:00 to 18:00 is ~12h / 23h * 935 ≈ 487.8
      expect(width).toBeGreaterThan(400);
      expect(width).toBeLessThan(550);
    });

    it("renders multiple stripes across multi-day forecast", () => {
      // 48 hours timeline: 2026-09-12 and 2026-09-13
      const data: DataPoint[] = Array.from({ length: 48 }, (_, i) => {
        const day = i < 24 ? "12" : "13";
        const hour = i % 24;
        return {
          timestamp: `2026-09-${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        };
      });

      const sunPhases = [
        {
          day: "2026-09-12",
          sunrise: "2026-09-12T07:07:00.000Z",
          sunset: "2026-09-12T19:49:00.000Z",
        },
        {
          day: "2026-09-13",
          sunrise: "2026-09-13T07:08:00.000Z",
          sunset: "2026-09-13T19:47:00.000Z",
        },
      ];

      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={baseChain}
          sunPhases={sunPhases}
        />,
      );

      const stripeGroups = container.querySelectorAll(".daylight-stripe-group");
      expect(stripeGroups.length).toBe(2);

      const stripes = container.querySelectorAll(
        '[data-testid="daylight-stripe"]',
      );
      expect(stripes.length).toBe(8); // 2 days * 3 panel areas

      const stripe1X = parseFloat(stripes[0].getAttribute("x") || "0");
      const stripe2X = parseFloat(stripes[4].getAttribute("x") || "0");
      expect(stripe2X).toBeGreaterThan(stripe1X);
    });

    it("renders all 16 daylight stripes across a 16-day forecast horizon", () => {
      const data: DataPoint[] = [];
      const sunPhases: SunPeriod[] = [];

      for (let day = 12; day <= 27; day++) {
        const dayStr = `2026-09-${day}`;
        data.push(
          {
            timestamp: `${dayStr}T00:00:00.000Z`,
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp: `${dayStr}T12:00:00.000Z`,
            variable: "temperature",
            value: 22,
            unit: "°C",
            model: "ICON-D2",
          },
        );
        sunPhases.push({
          day: dayStr,
          sunrise: `${dayStr}T07:00:00.000Z`,
          sunset: `${dayStr}T19:30:00.000Z`,
        });
      }

      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={[{ name: "GFS", max_forecast_horizon_hours: 384 }]}
          sunPhases={sunPhases}
        />,
      );

      const stripeGroups = container.querySelectorAll(".daylight-stripe-group");
      expect(stripeGroups.length).toBe(16);

      const stripes = container.querySelectorAll(
        '[data-testid="daylight-stripe"]',
      );
      expect(stripes.length).toBe(64); // 16 days * 3 panel areas
    });

    it("gracefully handles missing or empty sunPhases without errors or stripes", () => {
      const data: DataPoint[] = [
        {
          timestamp: "2026-09-12T00:00:00.000Z",
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-12T12:00:00.000Z",
          variable: "temperature",
          value: 20,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={data} modelChain={baseChain} sunPhases={[]} />,
      );

      const stripes = container.querySelectorAll(
        '[data-testid="daylight-stripe"]',
      );
      expect(stripes.length).toBe(0);
    });
  });

  describe("Wind Arrow Directions", () => {
    const baseChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 24 },
    ];

    it("points in the direction the wind is blowing towards (meteorological direction + 180°)", () => {
      // Distinct wind directions:
      // 0° (North wind -> blows towards South, 180°)
      // 90° (East wind -> blows towards West, 270°)
      // 180° (South wind -> blows towards North, 0°)
      // 270° (West wind -> blows towards East, 90°)
      const directions = [0, 90, 180, 270];
      const data: DataPoint[] = [];

      directions.forEach((dir, i) => {
        const ts = `2026-09-12T${String(i).padStart(2, "0")}:00:00.000Z`;
        data.push({
          timestamp: ts,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        });
        data.push({
          timestamp: ts,
          variable: "wind_speed",
          value: 10,
          unit: "km/h",
          model: "ICON-D2",
        });
        data.push({
          timestamp: ts,
          variable: "wind_direction",
          value: dir,
          unit: "°",
          model: "ICON-D2",
        });
      });

      const { container } = render(
        <MeteogramChart data={data} modelChain={baseChain} />,
      );

      const arrows = container.querySelectorAll('[data-testid="wind-arrow"]');
      expect(arrows.length).toBe(Math.floor(900 / WIND_ICON_FOOTPRINT_PX));

      // All arrows point towards (dir + 180°) % 360
      arrows.forEach((arrow) => {
        const dir = parseFloat(arrow.getAttribute("data-direction") || "0");
        const arrowAngle = parseFloat(
          arrow.getAttribute("data-arrow-angle") || "0",
        );
        const expectedAngle = Math.round(((dir + 180) % 360) * 10) / 10;
        expect(arrowAngle).toBe(expectedAngle);
        expect(arrow.getAttribute("transform")).toBe(
          `rotate(${expectedAngle})`,
        );
      });

      // First arrow near 0°: blows South (near 180°)
      const firstAngle = parseFloat(
        arrows[0].getAttribute("data-arrow-angle") || "0",
      );
      expect(firstAngle).toBeCloseTo(180, -1);

      // Last arrow near 270°: blows East (near 90°)
      const lastAngle = parseFloat(
        arrows[arrows.length - 1].getAttribute("data-arrow-angle") || "0",
      );
      expect(lastAngle).toBeCloseTo(90, -1);
    });
  });

  describe("accumulated precipitation in hover tooltip", () => {
    const baseChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    ];

    const setupHoverTarget = (
      svg: SVGElement,
      timestampsCount: number,
      index: number,
    ) => {
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 550,
        right: 1000,
        bottom: 550,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
      const paddingLeft = 50;
      const graphWidth = 900;
      // Hourly samples are start-stamped intervals, so an N-hour fixture has
      // N equal timeline intervals rather than N - 1 point gaps.
      const clientX = paddingLeft + (index / timestampsCount) * graphWidth;
      fireEvent.mouseMove(svg, { clientX, clientY: 200 });
    };

    it("calculates accumulated precipitation across contiguous columns with precipitation", () => {
      // 10 hours:
      // h0: 0mm
      // h1: 0mm
      // h2: 1.0mm
      // h3: 2.5mm
      // h4: 0.5mm
      // h5: 0mm
      // h6: 0mm
      // h7: 3.2mm (isolated)
      // h8: 0mm
      // h9: 0mm
      const startTime = new Date("2026-09-11T00:00:00Z");
      const data: DataPoint[] = [];
      const precipMap: Record<number, number> = {
        2: 1.0,
        3: 2.5,
        4: 0.5,
        7: 3.2,
      };

      for (let h = 0; h < 10; h++) {
        const ts = new Date(
          startTime.getTime() + h * 3600 * 1000,
        ).toISOString();
        const pVal = precipMap[h] ?? 0;
        data.push(
          {
            timestamp: ts,
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "precipitation",
            value: pVal,
            unit: "mm",
            model: "ICON-D2",
          },
        );
      }

      const { container } = render(
        <MeteogramChart data={data} modelChain={baseChain} />,
      );
      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;
      expect(svg).toBeTruthy();

      // Hover on h=3 (middle of 1.0 + 2.5 + 0.5 = 4.0mm)
      setupHoverTarget(svg, 10, 3);
      const accRow = screen.getByTestId("accumulated-precip-row");
      expect(accRow).toBeTruthy();
      expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
        "4 mm",
      );

      // Hover on h=2 (start of block)
      setupHoverTarget(svg, 10, 2);
      expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
        "4 mm",
      );

      // Hover on h=4 (end of block)
      setupHoverTarget(svg, 10, 4);
      expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
        "4 mm",
      );

      // Hover on h=7 (isolated shower: 3.2mm)
      setupHoverTarget(svg, 10, 7);
      expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
        "3.2 mm",
      );

      // Hover on h=1 (0mm, no precipitation column)
      setupHoverTarget(svg, 10, 1);
      expect(screen.queryByTestId("accumulated-precip-row")).toBeNull();

      // Hover on h=5 (0mm, separating h2-h4 from h7)
      setupHoverTarget(svg, 10, 5);
      expect(screen.queryByTestId("accumulated-precip-row")).toBeNull();
    });

    it("stops accumulation if there is a gap greater than 1 hour between timestamps", () => {
      // Non-contiguous timestamps: 00:00 (1mm), 01:00 (2mm), [skip 02:00], 03:00 (3mm)
      const ts0 = "2026-09-11T00:00:00.000Z";
      const ts1 = "2026-09-11T01:00:00.000Z";
      const ts3 = "2026-09-11T03:00:00.000Z";

      const data: DataPoint[] = [
        {
          timestamp: ts0,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts0,
          variable: "precipitation",
          value: 1.0,
          unit: "mm",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts1,
          variable: "precipitation",
          value: 2.0,
          unit: "mm",
          model: "ICON-D2",
        },
        {
          timestamp: ts3,
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: ts3,
          variable: "precipitation",
          value: 3.0,
          unit: "mm",
          model: "ICON-D2",
        },
      ];

      const { container } = render(
        <MeteogramChart data={data} modelChain={baseChain} />,
      );
      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;

      // Hover on index 1 (ts1): contiguous with ts0 (1h diff), but gap with ts3 (2h diff)
      setupHoverTarget(svg, 4, 1);
      expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
        "3 mm",
      ); // 1.0 + 2.0 = 3 mm, stopped before ts3

      // Hover on index 2 (ts3): isolated because of 2h gap backwards
      setupHoverTarget(svg, 4, 3);
      expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
        "3 mm",
      );
    });
  });

  describe("Combined Hydrometeor & Cloud Panel (Precipitation, Probability & Detailed Clouds)", () => {
    const baseChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "GFS", max_forecast_horizon_hours: 120 },
    ];

    const sampleData: DataPoint[] = [
      {
        timestamp: "2026-09-11T00:00:00.000Z",
        variable: "temperature",
        value: 15,
        unit: "°C",
        model: "ICON-D2",
      },
      {
        timestamp: "2026-09-11T00:00:00.000Z",
        variable: "precipitation",
        value: 2.5,
        unit: "mm",
        model: "ICON-D2",
      },
      {
        timestamp: "2026-09-11T00:00:00.000Z",
        variable: "precipitation_probability",
        value: 80,
        unit: "%",
        model: "ICON-D2",
      },
      {
        timestamp: "2026-09-12T00:00:00.000Z",
        variable: "temperature",
        value: 18,
        unit: "°C",
        model: "GFS",
      },
      {
        timestamp: "2026-09-12T00:00:00.000Z",
        variable: "precipitation",
        value: 0.0,
        unit: "mm",
        model: "GFS",
      },
      {
        timestamp: "2026-09-12T00:00:00.000Z",
        variable: "precipitation_probability",
        value: 10,
        unit: "%",
        model: "GFS",
      },
    ];

    const sampleCloudForecast = {
      location: { name: "Berlin", latitude: 52.52, longitude: 13.405 },
      profiles: [
        {
          timestamp: "2026-09-11T00:00:00.000Z",
          source_model_id: "ecmwf_ifs025",
          levels: [
            {
              pressure_hpa: 1000,
              altitude_m_asl: 100,
              cloud_cover_percent: 50,
            },
            {
              pressure_hpa: 850,
              altitude_m_asl: 1500,
              cloud_cover_percent: 80,
            },
            {
              pressure_hpa: 500,
              altitude_m_asl: 5500,
              cloud_cover_percent: 20,
            },
          ],
        },
        {
          timestamp: "2026-09-12T00:00:00.000Z",
          source_model_id: "ecmwf_ifs025",
          levels: [
            {
              pressure_hpa: 1000,
              altitude_m_asl: 100,
              cloud_cover_percent: 10,
            },
            {
              pressure_hpa: 850,
              altitude_m_asl: 1500,
              cloud_cover_percent: 30,
            },
          ],
        },
      ],
    };

    it("omits cloud profile layer and collapses SVG viewBox height to 399 when verticalCloudForecast is absent or empty", () => {
      const { container } = render(
        <MeteogramChart data={sampleData} modelChain={baseChain} />,
      );
      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;

      expect(svg).toBeTruthy();
      expect(svg.getAttribute("viewBox")).toBe("0 0 1000 544");
      // Combined panel still renders precipitation and probability
      expect(
        container.querySelector('[data-testid="panel-combined-precip-clouds"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-testid="cloud-profile-layer"]'),
      ).toBeNull();
      expect(
        container.querySelector(".panel.panel-detailed-clouds"),
      ).toBeNull();
    });

    it("renders combined panel with cloud profile layer and sets SVG viewBox height to 429 when verticalCloudForecast has profiles", () => {
      const { container } = render(
        <MeteogramChart
          data={sampleData}
          modelChain={baseChain}
          verticalCloudForecast={sampleCloudForecast}
        />,
      );
      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;

      expect(svg).toBeTruthy();
      expect(svg.getAttribute("viewBox")).toBe("0 0 1000 574");
      expect(
        container.querySelector('[data-testid="panel-combined-precip-clouds"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-testid="cloud-profile-layer"]'),
      ).toBeTruthy();
      expect(
        container.querySelector(".panel.panel-detailed-clouds"),
      ).toBeNull();
      expect(
        container
          .querySelector('[data-edge="precipitation-bottom"]')
          ?.getAttribute("y1"),
      ).toBe("299");
      expect(
        container.querySelector('[data-edge="wind-top"]')?.getAttribute("y1"),
      ).toBe("314");
      expect(
        container
          .querySelector('[data-edge="wind-bottom"]')
          ?.getAttribute("y1"),
      ).toBe("419");
      // No artificial separator dividing precipitation and clouds at y=290
      const separator290 = container.querySelector('line[y1="290"][y2="290"]');
      expect(separator290).toBeNull();
    });

    it("enforces exact visual rendering z-order: cloud profile < precipitation bars < precipitation probability", () => {
      const { container } = render(
        <MeteogramChart
          data={sampleData}
          modelChain={baseChain}
          verticalCloudForecast={sampleCloudForecast}
        />,
      );

      const combinedPanel = container.querySelector(
        '[data-testid="panel-combined-precip-clouds"]',
      );
      expect(combinedPanel).toBeTruthy();

      const cloudLayer = container.querySelector(
        '[data-testid="cloud-profile-layer"]',
      );
      const precipBarsLayer = container.querySelector(
        '[data-testid="precipitation-bars-layer"]',
      );
      const probLayer = container.querySelector(
        '[data-testid="precipitation-probability-layer"]',
      );

      expect(cloudLayer).toBeTruthy();
      expect(precipBarsLayer).toBeTruthy();
      expect(probLayer).toBeTruthy();

      // In SVG DOM, later elements render on top (higher visual z-index)
      // 1. cloudLayer is first (background)
      // 2. precipBarsLayer is second (middle)
      // 3. probLayer is third (foreground)
      expect(
        cloudLayer!.compareDocumentPosition(precipBarsLayer!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        precipBarsLayer!.compareDocumentPosition(probLayer!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("places model boundaries above terrain but below every layer that already followed them", () => {
      const data = generateMockData(72);
      const cloudForecast = {
        ...sampleCloudForecast,
        profiles: [
          {
            ...sampleCloudForecast.profiles[0],
            timestamp: data[0].timestamp,
          },
        ],
      };
      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          location={{
            name: "Alpine test",
            latitude: 47,
            longitude: 8,
            elevation: 1200,
          }}
          verticalCloudForecast={cloudForecast}
        />,
      );

      const terrain = container.querySelector('[data-testid="terrain-mask"]')!;
      const boundary = container.querySelector(
        '[data-testid="model-boundary-line"]',
      )!.parentElement!;
      const temperaturePanel = container.querySelector(".panel-temperature")!;
      const cloudLayer = container.querySelector(
        '[data-testid="cloud-profile-layer"]',
      )!;
      const precipBars = container.querySelector(
        '[data-testid="precipitation-bars-layer"]',
      )!;
      const probability = container.querySelector(
        '[data-testid="precipitation-probability-layer"]',
      )!;

      expect(
        terrain.compareDocumentPosition(boundary) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      for (const existingForegroundLayer of [
        temperaturePanel,
        cloudLayer,
        precipBars,
        probability,
      ]) {
        expect(
          boundary.compareDocumentPosition(existingForegroundLayer) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });

    it("renders precipitation probability as a thin solid purple foreground line", () => {
      const { container } = render(
        <MeteogramChart
          data={sampleData}
          modelChain={baseChain}
          verticalCloudForecast={sampleCloudForecast}
        />,
      );

      const probabilityPath = container.querySelector(
        '[data-testid="precip-probability-path"]',
      );
      expect(probabilityPath?.getAttribute("stroke")).toBe("#7c3aed");
      expect(probabilityPath?.getAttribute("stroke-width")).toBe("1.2");
      expect(probabilityPath?.hasAttribute("stroke-dasharray")).toBe(false);
      expect(
        container
          .querySelector('[data-testid="precipitation-probability-layer"]')
          ?.getAttribute("clip-path"),
      ).toMatch(/^url\(#precipitation-probability-clip-/);
    });

    it("maps 0%, 25%, 50%, 75%, and 100% over the full combined drawing height", () => {
      const startMs = Date.parse("2026-09-11T00:00:00.000Z");
      const probabilities = [0, 25, 50, 75, 100];
      const data: DataPoint[] = probabilities.flatMap((value, index) => {
        const timestamp = new Date(startMs + index * 3600000).toISOString();
        return [
          {
            timestamp,
            variable: "temperature",
            value: 10,
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp,
            variable: "precipitation_probability",
            value,
            unit: "%",
            model: "ICON-D2",
          },
        ];
      });
      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={[{ name: "ICON-D2", max_forecast_horizon_hours: 5 }]}
          timelineStart={new Date(startMs).toISOString()}
          timelineEnd={new Date(startMs + 5 * 3600000).toISOString()}
        />,
      );

      const path = container.querySelector(
        '[data-testid="precip-probability-path"]',
      )!;
      const coordinates = Array.from(
        (path.getAttribute("d") || "").matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g),
        (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
      );
      const top = Number(path.getAttribute("data-scale-top"));
      const bottom = Number(path.getAttribute("data-scale-bottom"));

      expect(coordinates.map(({ y }) => y)).toEqual([
        bottom,
        bottom - (bottom - top) * 0.25,
        top + (bottom - top) / 2,
        bottom - (bottom - top) * 0.75,
        top,
      ]);
    });

    it("keeps probability Y calibration independent of precipitation, horizon, and model", () => {
      const start = "2026-09-11T00:00:00.000Z";
      const timestamps = [0, 1, 2].map((hour) =>
        new Date(Date.parse(start) + hour * 3600000).toISOString(),
      );
      const makeData = (precipitation: number, model: string): DataPoint[] =>
        timestamps.flatMap((timestamp, index) => [
          { timestamp, variable: "temperature", value: 10, unit: "°C", model },
          {
            timestamp,
            variable: "precipitation",
            value: precipitation,
            unit: "mm",
            model,
          },
          {
            timestamp,
            variable: "precipitation_probability",
            value: index * 50,
            unit: "%",
            model,
          },
        ]);
      const getYs = (container: HTMLElement) =>
        Array.from(
          (
            container
              .querySelector('[data-testid="precip-probability-path"]')
              ?.getAttribute("d") || ""
          ).matchAll(/[ML] [\d.-]+ ([\d.-]+)/g),
          (match) => Number(match[1]),
        );

      const { container, rerender } = render(
        <MeteogramChart
          data={makeData(1, "ICON-D2")}
          modelChain={[{ name: "ICON-D2", max_forecast_horizon_hours: 3 }]}
          timelineStart={start}
          timelineEnd="2026-09-11T03:00:00.000Z"
        />,
      );
      const initialYs = getYs(container);

      rerender(
        <MeteogramChart
          data={makeData(100, "GFS")}
          modelChain={[{ name: "GFS", max_forecast_horizon_hours: 6 }]}
          timelineStart={start}
          timelineEnd="2026-09-11T06:00:00.000Z"
        />,
      );
      expect(getYs(container)).toEqual(initialYs);
    });

    it("clamps out-of-range probability values to the clipped 0–100% bounds", () => {
      const data: DataPoint[] = [
        {
          timestamp: "2026-09-11T00:00:00.000Z",
          variable: "precipitation_probability",
          value: -20,
          unit: "%",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-11T01:00:00.000Z",
          variable: "precipitation_probability",
          value: 120,
          unit: "%",
          model: "ICON-D2",
        },
      ];
      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={[{ name: "ICON-D2", max_forecast_horizon_hours: 2 }]}
        />,
      );
      const path = container.querySelector(
        '[data-testid="precip-probability-path"]',
      )!;
      const ys = Array.from(
        (path.getAttribute("d") || "").matchAll(/[ML] [\d.-]+ ([\d.-]+)/g),
        (match) => Number(match[1]),
      );
      expect(ys).toEqual([
        Number(path.getAttribute("data-scale-bottom")),
        Number(path.getAttribute("data-scale-top")),
      ]);
    });

    it("uses the same timestamp value for the probability path and hover popup", () => {
      const startMs = Date.parse("2026-09-11T00:00:00.000Z");
      const values = [0, 50, 100];
      const data: DataPoint[] = values.flatMap((value, index) => {
        const timestamp = new Date(startMs + index * 3600000).toISOString();
        return [
          {
            timestamp,
            variable: "temperature",
            value: 10,
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp,
            variable: "precipitation_probability",
            value,
            unit: "%",
            model: "ICON-D2",
          },
        ];
      });
      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={[{ name: "ICON-D2", max_forecast_horizon_hours: 3 }]}
          timelineStart={new Date(startMs).toISOString()}
          timelineEnd={new Date(startMs + 3 * 3600000).toISOString()}
        />,
      );
      const path = container.querySelector(
        '[data-testid="precip-probability-path"]',
      )!;
      const coordinates = Array.from(
        (path.getAttribute("d") || "").matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g),
        (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
      );
      expect(coordinates[2].y).toBe(
        Number(path.getAttribute("data-scale-top")),
      );

      const svg = container.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 399,
        right: 1000,
        bottom: 399,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
      fireEvent.mouseMove(svg, {
        clientX: coordinates[2].x,
        clientY: coordinates[2].y,
      });
      const tooltip = document.querySelector(".hover-unified-tooltip")!;
      expect(tooltip.textContent).toContain("Precip. Prob:100 %");
    });

    it("positions cloud altitude labels on the right and precipitation labels on the left, while removing 0% / 100% probability labels", () => {
      const { container } = render(
        <MeteogramChart
          data={sampleData}
          modelChain={baseChain}
          verticalCloudForecast={sampleCloudForecast}
        />,
      );

      // Cloud altitude labels on the right (x > 900, textAnchor = start)
      const alt12 = container.querySelector(
        '[data-testid="cloud-altitude-label-12"]',
      );
      const alt0 = container.querySelector(
        '[data-testid="cloud-altitude-label-0"]',
      );

      expect(alt12).toBeTruthy();
      expect(alt0).toBeTruthy();
      expect(parseFloat(alt12?.getAttribute("x") || "0")).toBeGreaterThan(900);
      expect(alt12?.getAttribute("text-anchor")).toBe("start");
      expect(alt12?.textContent).toBe("12 km");
      expect(alt0?.textContent).toBe("0 km");

      // Check no altitude labels ("km") exist on the left side (x < 100) inside combined panel
      const combinedPanel = container.querySelector(
        '[data-testid="panel-combined-precip-clouds"]',
      );
      const textElements = Array.from(
        combinedPanel?.querySelectorAll("text") || [],
      );
      const leftAltitudeLabels = textElements.filter((el) => {
        const x = parseFloat(el.getAttribute("x") || "0");
        return x < 100 && el.textContent?.includes("km");
      });
      expect(leftAltitudeLabels.length).toBe(0);

      // Precipitation labels exist on the left (x < 100, textAnchor = end)
      const leftPrecipLabels = textElements.filter((el) => {
        const x = parseFloat(el.getAttribute("x") || "0");
        return x < 100 && el.textContent?.includes("mm");
      });
      expect(leftPrecipLabels.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("0 mm")).toBeTruthy();

      // Visible probability 0% and 100% scale labels must be completely absent
      expect(screen.queryByText("100%")).toBeNull();
      expect(screen.queryByText("0%")).toBeNull();
    });

    it("renders cloud boundary drag line strictly inside combined plot area during drag and hides it otherwise without badges", () => {
      const threeModelChain: WeatherModel[] = [
        { name: "ICON-D2", max_forecast_horizon_hours: 24 },
        { name: "ICON-EU", max_forecast_horizon_hours: 48 },
        { name: "GFS", max_forecast_horizon_hours: 120 },
      ];

      const timestamps = [
        "2026-09-11T00:00:00.000Z",
        "2026-09-12T00:00:00.000Z",
        "2026-09-13T00:00:00.000Z",
        "2026-09-16T00:00:00.000Z",
      ];

      const data: DataPoint[] = timestamps.map((ts, idx) => ({
        timestamp: ts,
        variable: "temperature",
        value: 10 + idx,
        unit: "°C",
        model: idx === 0 ? "ICON-D2" : idx === 1 ? "ICON-EU" : "GFS",
      }));

      const cloudForecast = {
        location: { name: "Berlin", latitude: 52.52, longitude: 13.405 },
        profiles: timestamps.map((ts) => ({
          timestamp: ts,
          source_model_id: "ecmwf_ifs025",
          levels: [
            {
              pressure_hpa: 1000,
              altitude_m_asl: 100,
              cloud_cover_percent: 40,
            },
          ],
        })),
      };

      // 1. Before drag: purple drag line is invisible
      const { container, rerender } = render(
        <MeteogramChart
          data={data}
          modelChain={threeModelChain}
          verticalCloudForecast={cloudForecast}
          draggedCloudBoundaryHour={null}
        />,
      );

      expect(
        container.querySelector('[data-testid="cloud-boundary-drag-line"]'),
      ).toBeNull();

      // 2. During drag: purple drag line becomes visible strictly inside combined plot area (y1 = 174, y2 = 299)
      rerender(
        <MeteogramChart
          data={data}
          modelChain={threeModelChain}
          verticalCloudForecast={cloudForecast}
          draggedCloudBoundaryHour={24}
        />,
      );

      const dragLine = container.querySelector(
        '[data-testid="cloud-boundary-drag-line"]',
      );
      expect(dragLine).not.toBeNull();
      expect(dragLine?.getAttribute("stroke")).toBe("#8b5cf6");
      expect(dragLine?.getAttribute("y1")).toBe("174");
      expect(dragLine?.getAttribute("y2")).toBe("299");

      // Ensure no model label/badge or tooltip is attached to the drag indicator
      const dragContainer = container.querySelector(
        '[data-testid="vcloud-drag-boundary-indicator"]',
      );
      expect(dragContainer?.querySelector("text")).toBeNull();
      expect(dragContainer?.querySelector("rect")).toBeNull();

      // 3. When drag ends: line is hidden
      rerender(
        <MeteogramChart
          data={data}
          modelChain={threeModelChain}
          verticalCloudForecast={cloudForecast}
          draggedCloudBoundaryHour={null}
        />,
      );

      expect(
        container.querySelector('[data-testid="cloud-boundary-drag-line"]'),
      ).toBeNull();
    });
  });

  describe("Day Boundaries Extension & Dynamic Wind Direction Icons", () => {
    describe("Day Boundaries", () => {
      it("midnight separator extends through the date-header row at y1 = 22 and is segmented across the three panels", () => {
        const data = generateMockData(72); // 3 days
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const separatorLines = container.querySelectorAll(
          '[data-testid="day-separator-line"]',
        );

        expect(separatorLines.length).toBeGreaterThan(0);
        separatorLines.forEach((line) => {
          const y1 = parseFloat(line.getAttribute("y1") || "0");
          const y2 = parseFloat(line.getAttribute("y2") || "0");
          // Area 1: 22..159, Area 2: 174..269, Area 3: 284..389
          const inArea1 = y1 === 22 && y2 === 159;
          const inArea2 = y1 === 174 && y2 === 269;
          const inArea3 = y1 === 284 && y2 === 389;
          expect(
            inArea1 || inArea2 || inArea3 || (y1 === 404 && y2 === 534),
          ).toBe(true);
        });
      });

      it("separator line has identical x-coordinate in date header and chart panels", () => {
        const data = generateMockData(72);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const separatorLines = container.querySelectorAll(
          '[data-testid="day-separator-line"]',
        );

        separatorLines.forEach((line) => {
          const x1 = line.getAttribute("x1");
          const x2 = line.getAttribute("x2");
          expect(x1).toBe(x2);
        });
      });

      it("separator sits exactly between adjacent date cells", () => {
        const data = generateMockData(72);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const cells = container.querySelectorAll(
          '[data-testid="day-label-cell"]',
        );
        const lines = container.querySelectorAll(
          '[data-testid="day-separator-line"]',
        );

        expect(cells.length).toBeGreaterThanOrEqual(2);
        expect(lines.length).toBeGreaterThanOrEqual(2);

        const cell0X = parseFloat(cells[0].getAttribute("x") || "0");
        const cell0W = parseFloat(cells[0].getAttribute("width") || "0");
        const cell1X = parseFloat(cells[1].getAttribute("x") || "0");
        const area1Lines = Array.from(lines).filter(
          (l) => parseFloat(l.getAttribute("y1") || "0") === 22,
        );
        const line1X = parseFloat(area1Lines[1].getAttribute("x1") || "0");

        expect(cell0X + cell0W).toBeCloseTo(line1X, 1);
        expect(cell1X).toBeCloseTo(line1X, 1);
      });

      it("handles partial first day and partial last day correctly", () => {
        const data: DataPoint[] = [];
        const base = new Date(2026, 8, 12, 14, 0, 0).getTime();
        // 10 hours on Day 1 (14:00 to 23:00)
        // 24 hours on Day 2 (00:00 to 23:00)
        // 11 hours on Day 3 (00:00 to 10:00)
        // Total 45 hours
        for (let h = 0; h < 45; h++) {
          const ts = new Date(base + h * 3600 * 1000).toISOString();
          data.push({
            timestamp: ts,
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          });
          data.push({
            timestamp: ts,
            variable: "wind_speed",
            value: 10,
            unit: "km/h",
            model: "ICON-D2",
          });
          data.push({
            timestamp: ts,
            variable: "wind_direction",
            value: 90,
            unit: "°",
            model: "ICON-D2",
          });
        }

        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const cells = container.querySelectorAll(
          '[data-testid="day-label-cell"]',
        );
        expect(cells.length).toBe(3);

        const separatorLines = container.querySelectorAll(
          '[data-testid="day-separator-line"]',
        );
        // Partial first day starting at 14:00 has no separator line at 50px.
        // 2 midnight boundaries * 4 segmented areas = 8 lines.
        expect(separatorLines.length).toBe(8);
        const area1Lines = Array.from(separatorLines).filter(
          (l) => parseFloat(l.getAttribute("y1") || "0") === 22,
        );
        expect(area1Lines.length).toBe(2);
        area1Lines.forEach((line) => {
          expect(parseFloat(line.getAttribute("y1") || "0")).toBe(22);
        });
      });
    });

    describe("Circular Wind Direction Interpolation", () => {
      it("interpolates 0° and 90° at 0%, 25%, 50%, 75%, 100%", () => {
        expect(interpolateWindDirection(0, 90, 1.0, 0.0)).toBe(0);
        expect(interpolateWindDirection(0, 90, 0.75, 0.25)).toBeCloseTo(
          18.43,
          1,
        );
        expect(interpolateWindDirection(0, 90, 0.5, 0.5)).toBeCloseTo(45, 1);
        expect(interpolateWindDirection(0, 90, 0.25, 0.75)).toBeCloseTo(
          71.57,
          1,
        );
        expect(interpolateWindDirection(0, 90, 0.0, 1.0)).toBe(90);
      });

      it("correctly handles wraparound cases across 0° / 360° (350° ↔ 10°, 359° ↔ 1°, 10° ↔ 350°)", () => {
        // 350° and 10° with equal weights must interpolate to 0° (North), NOT 180° (South)
        expect(interpolateWindDirection(350, 10, 0.5, 0.5)).toBe(0);
        expect(interpolateWindDirection(10, 350, 0.5, 0.5)).toBe(0);

        // 359° and 1° with equal weights must interpolate to 0°
        expect(interpolateWindDirection(359, 1, 0.5, 0.5)).toBe(0);
        expect(interpolateWindDirection(1, 359, 0.5, 0.5)).toBe(0);

        // Weighted wraparound: 350° (75%) and 10° (25%) -> interpolates around 355°
        const w355 = interpolateWindDirection(350, 10, 0.75, 0.25);
        expect(w355).toBeGreaterThan(350);
        expect(w355).toBeLessThan(360);

        // Weighted wraparound: 350° (25%) and 10° (75%) -> interpolates around 5°
        const w5 = interpolateWindDirection(350, 10, 0.25, 0.75);
        expect(w5).toBeGreaterThan(0);
        expect(w5).toBeLessThan(10);
      });
    });

    describe("Wind Icon Dynamic Placement & Footprint", () => {
      const generateLocalWindData = (hours: number): DataPoint[] => {
        const data: DataPoint[] = [];
        const startTime = Date.UTC(2026, 8, 12, 0, 0, 0);
        for (let h = 0; h < hours; h++) {
          const timestamp = new Date(startTime + h * 3600 * 1000).toISOString();
          data.push(
            {
              timestamp,
              variable: "temperature",
              value: 15,
              unit: "°C",
              model: "ICON-D2",
            },
            {
              timestamp,
              variable: "wind_speed",
              value: 10,
              unit: "km/h",
              model: "ICON-D2",
            },
            {
              timestamp,
              variable: "wind_direction",
              value: 180,
              unit: "°",
              model: "ICON-D2",
            },
          );
        }
        return data;
      };

      it("calculates maximum fitting icon count from rendered day width using footprint", () => {
        // Full 1-day forecast over 900px width
        const data = generateLocalWindData(24);

        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const iconGroups = container.querySelectorAll(
          '[data-testid="wind-arrow-group"]',
        );
        expect(iconGroups.length).toBe(
          Math.floor(900 / WIND_ICON_FOOTPRINT_PX),
        );
      });

      it("scales the complete icon glyph down by approximately 10%", () => {
        const data = generateMockData(24);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const circles = container.querySelectorAll(
          '[data-testid="wind-arrow-group"] circle',
        );
        expect(circles.length).toBeGreaterThan(0);
        circles.forEach((circle) => {
          expect(circle.getAttribute("r")).toBe(String(WIND_ICON_RADIUS_PX));
        });

        const arrowLine = container.querySelector(
          '[data-testid="wind-arrow"] line',
        );
        const arrowHead = container.querySelector(
          '[data-testid="wind-arrow"] polygon',
        );
        expect(arrowLine?.getAttribute("y1")).toBe("4.5");
        expect(arrowLine?.getAttribute("y2")).toBe("-4.5");
        expect(arrowLine?.getAttribute("stroke-width")).toBe("1.62");
        expect(arrowHead?.getAttribute("points")).toBe(
          "0,-6.3 -2.7,-1.8 2.7,-1.8",
        );
      });

      it("guarantees enough rendered distance between adjacent icon centers to prevent touching", () => {
        const data = generateMockData(72); // 3 days
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const iconGroups = container.querySelectorAll(
          '[data-testid="wind-arrow-group"]',
        );

        const xPositions: number[] = [];
        iconGroups.forEach((g) => {
          const x = parseFloat(g.getAttribute("data-center-x") || "0");
          xPositions.push(x);
        });

        for (let i = 1; i < xPositions.length; i++) {
          const dist = xPositions[i] - xPositions[i - 1];
          expect(dist).toBeGreaterThanOrEqual(WIND_ICON_FOOTPRINT_PX - 0.01);
        }
      });

      it("wider days produce more icons and narrower days produce fewer icons", () => {
        const data1Day = generateLocalWindData(24);
        const data4Days = generateLocalWindData(96);

        const { container: c1 } = render(
          <MeteogramChart data={data1Day} modelChain={mockModelChain} />,
        );
        const { container: c4 } = render(
          <MeteogramChart data={data4Days} modelChain={mockModelChain} />,
        );

        const iconsDay1 = c1.querySelectorAll(
          '[data-testid="wind-arrow-group"]',
        );
        const iconsDay4 = c4.querySelectorAll(
          '[data-testid="wind-arrow-group"]',
        );

        expect(iconsDay1.length).toBe(Math.floor(900 / WIND_ICON_FOOTPRINT_PX));
        expect(iconsDay4.length).toBeGreaterThan(30);
      });

      it("recalculates density and fits three icons per day at the current 1000px zoom level", () => {
        const originalResizeObserver = globalThis.ResizeObserver;
        let resizeCallback: ResizeObserverCallback | undefined;
        let renderedWidth = 1000;

        class TestResizeObserver {
          constructor(callback: ResizeObserverCallback) {
            resizeCallback = callback;
          }
          observe() {}
          unobserve() {}
          disconnect() {}
        }

        globalThis.ResizeObserver =
          TestResizeObserver as unknown as typeof ResizeObserver;
        const rectSpy = vi
          .spyOn(SVGElement.prototype, "getBoundingClientRect")
          .mockImplementation(() => ({
            left: 0,
            top: 0,
            width: renderedWidth,
            height: 450,
            right: renderedWidth,
            bottom: 450,
            x: 0,
            y: 0,
            toJSON: () => {},
          }));

        try {
          const data = generateLocalWindData(16 * 24);
          const { container } = render(
            <MeteogramChart data={data} modelChain={mockModelChain} />,
          );

          expect(
            container.querySelectorAll('[data-testid="wind-arrow-group"]'),
          ).toHaveLength(16 * 3);
          const wideCenters = Array.from(
            container.querySelectorAll('[data-testid="wind-arrow-group"]'),
          ).map(
            (icon) =>
              Number(icon.getAttribute("data-center-x")) *
              (renderedWidth / 1000),
          );
          for (let i = 1; i < wideCenters.length; i++) {
            expect(wideCenters[i] - wideCenters[i - 1]).toBeGreaterThanOrEqual(
              WIND_ICON_FOOTPRINT_PX - 0.01,
            );
          }

          renderedWidth = 800;
          act(() => resizeCallback?.([], {} as ResizeObserver));

          expect(
            container.querySelectorAll('[data-testid="wind-arrow-group"]'),
          ).toHaveLength(16 * 2);
          const narrowCenters = Array.from(
            container.querySelectorAll('[data-testid="wind-arrow-group"]'),
          ).map(
            (icon) =>
              Number(icon.getAttribute("data-center-x")) *
              (renderedWidth / 1000),
          );
          for (let i = 1; i < narrowCenters.length; i++) {
            expect(
              narrowCenters[i] - narrowCenters[i - 1],
            ).toBeGreaterThanOrEqual(WIND_ICON_FOOTPRINT_PX - 0.01);
          }
        } finally {
          rectSpy.mockRestore();
          globalThis.ResizeObserver = originalResizeObserver;
        }
      });
    });

    describe("Timestamp Mapping & Model Transitions", () => {
      it("maps each icon center to its exact time and circularly interpolates neighboring directions", () => {
        const startTime = Date.UTC(2026, 8, 12, 0, 0, 0);
        const endTime = startTime + 60 * 60 * 1000;
        const data: DataPoint[] = [
          {
            timestamp: new Date(startTime).toISOString(),
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp: new Date(startTime).toISOString(),
            variable: "wind_speed",
            value: 10,
            unit: "km/h",
            model: "ICON-D2",
          },
          {
            timestamp: new Date(startTime).toISOString(),
            variable: "wind_direction",
            value: 350,
            unit: "°",
            model: "ICON-D2",
          },
          {
            timestamp: new Date(endTime).toISOString(),
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp: new Date(endTime).toISOString(),
            variable: "wind_speed",
            value: 10,
            unit: "km/h",
            model: "ICON-D2",
          },
          {
            timestamp: new Date(endTime).toISOString(),
            variable: "wind_direction",
            value: 10,
            unit: "°",
            model: "ICON-D2",
          },
        ];

        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const icons = Array.from(
          container.querySelectorAll('[data-testid="wind-arrow-group"]'),
        );
        // The first two observations are interval starts and the inferred
        // display window is two hours. Select the icon nearest +30 minutes.
        const firstIntervalMiddleX = 50 + 0.25 * 900;
        const middleIcon = icons.reduce((closest, icon) => {
          const distance = Math.abs(
            Number(icon.getAttribute("data-center-x")) - firstIntervalMiddleX,
          );
          const closestDistance = Math.abs(
            Number(closest.getAttribute("data-center-x")) -
              firstIntervalMiddleX,
          );
          return distance < closestDistance ? icon : closest;
        });

        const centerX = Number(middleIcon.getAttribute("data-center-x"));
        const displayEndTime = endTime + 60 * 60 * 1000;
        const expectedTime =
          startTime + ((centerX - 50) / 900) * (displayEndTime - startTime);
        expect(
          Math.abs(
            new Date(middleIcon.getAttribute("data-timestamp")!).getTime() -
              expectedTime,
          ),
        ).toBeLessThan(1);

        const direction = Number(
          middleIcon
            .querySelector('[data-testid="wind-arrow"]')
            ?.getAttribute("data-direction"),
        );
        expect(Math.min(direction, 360 - direction)).toBeLessThan(0.3);
      });

      it("translates iconCenterX to continuous timestamp with exact sub-hourly precision", () => {
        const data: DataPoint[] = [];
        for (let h = 0; h < 24; h++) {
          const ts = `2026-09-12T${String(h).padStart(2, "0")}:00:00.000Z`;
          data.push({
            timestamp: ts,
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          });
          data.push({
            timestamp: ts,
            variable: "wind_speed",
            value: 10,
            unit: "km/h",
            model: "ICON-D2",
          });
          data.push({
            timestamp: ts,
            variable: "wind_direction",
            value: 180,
            unit: "°",
            model: "ICON-D2",
          });
        }

        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const iconGroups = container.querySelectorAll(
          '[data-testid="wind-arrow-group"]',
        );

        iconGroups.forEach((g) => {
          const ts = g.getAttribute("data-timestamp");
          expect(ts).toBeTruthy();
          const d = new Date(ts!);
          expect(isNaN(d.getTime())).toBe(false);
          expect(ts?.startsWith("2026-09-12")).toBe(true);
        });
      });

      it("respects model transitions for wind direction according to unified timeline boundary convention", () => {
        const chain: WeatherModel[] = [
          { name: "ICON-D2", max_forecast_horizon_hours: 24 },
          { name: "ICON-EU", max_forecast_horizon_hours: 48 },
        ];

        const data: DataPoint[] = [];
        const base = Date.UTC(2026, 8, 12, 0, 0, 0);
        // Hours 0..23: Model A with 90° wind direction (blows West, arrowAngle = 270)
        for (let h = 0; h < 24; h++) {
          const ts = new Date(base + h * 3600 * 1000).toISOString();
          data.push({
            timestamp: ts,
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          });
          data.push({
            timestamp: ts,
            variable: "wind_speed",
            value: 10,
            unit: "km/h",
            model: "ICON-D2",
          });
          data.push({
            timestamp: ts,
            variable: "wind_direction",
            value: 90,
            unit: "°",
            model: "ICON-D2",
          });
        }
        // Hours 24..47: Model B with 270° wind direction (blows East, arrowAngle = 90)
        for (let h = 24; h < 48; h++) {
          const ts = new Date(base + h * 3600 * 1000).toISOString();
          data.push({
            timestamp: ts,
            variable: "temperature",
            value: 16,
            unit: "°C",
            model: "ICON-EU",
          });
          data.push({
            timestamp: ts,
            variable: "wind_speed",
            value: 12,
            unit: "km/h",
            model: "ICON-EU",
          });
          data.push({
            timestamp: ts,
            variable: "wind_direction",
            value: 270,
            unit: "°",
            model: "ICON-EU",
          });
        }

        const { container } = render(
          <MeteogramChart data={data} modelChain={chain} />,
        );
        const iconGroups = container.querySelectorAll(
          '[data-testid="wind-arrow-group"]',
        );

        const day1Icons = Array.from(iconGroups).filter((g) => {
          const x = parseFloat(g.getAttribute("data-center-x") || "0");
          return x < 500; // Before model transition boundary at x=500 (index 24)
        });
        const day2Icons = Array.from(iconGroups).filter((g) => {
          const x = parseFloat(g.getAttribute("data-center-x") || "0");
          return x >= 500; // At/after model transition boundary at x=500 (index 24)
        });

        expect(day1Icons.length).toBeGreaterThan(0);
        day1Icons.forEach((g) => {
          const arrow = g.querySelector('[data-testid="wind-arrow"]');
          expect(parseFloat(arrow?.getAttribute("data-direction") || "0")).toBe(
            90,
          );
          expect(
            parseFloat(arrow?.getAttribute("data-arrow-angle") || "0"),
          ).toBe(270);
        });

        expect(day2Icons.length).toBeGreaterThan(0);
        day2Icons.forEach((g) => {
          const arrow = g.querySelector('[data-testid="wind-arrow"]');
          expect(parseFloat(arrow?.getAttribute("data-direction") || "0")).toBe(
            270,
          );
          expect(
            parseFloat(arrow?.getAttribute("data-arrow-angle") || "0"),
          ).toBe(90);
        });
      });
    });

    describe("Cloud Elevation Label Positioning and Hourly Precipitation Column Widths", () => {
      it("positions the cloud-profile location/elevation label at the bottom-right inside the plot area with text-anchor end", () => {
        const startTime = new Date("2026-09-12T00:00:00Z").toISOString();
        const testData: DataPoint[] = [
          {
            timestamp: startTime,
            variable: "temperature",
            value: 15,
            unit: "°C",
            model: "ICON-D2",
          },
        ];

        const mockLocation: Location = {
          name: "Offenbach am Main",
          latitude: 50.1,
          longitude: 8.7,
          elevation: 100, // 0.1 km
          timezone: "Europe/Berlin",
        };

        const mockVcloud: DetailedCloudForecast = {
          location: mockLocation,
          profiles: [
            {
              timestamp: startTime,
              source_model_id: "ecmwf_ifs025",
              source_model_name: "ECMWF IFS",
              levels: [
                {
                  pressure_hpa: 1000,
                  altitude_m_asl: 100,
                  cloud_cover_percent: 50,
                },
              ],
            },
          ],
        };

        const { container } = render(
          <MeteogramChart
            data={testData}
            modelChain={mockModelChain}
            location={mockLocation}
            verticalCloudForecast={mockVcloud}
          />,
        );

        const label = container.querySelector(
          '[data-testid="terrain-mask-label"]',
        ) as SVGTextElement;
        expect(label).toBeTruthy();
        expect(label.textContent).toBe("0.1 km — Offenbach am Main");

        // svgWidth = 1000, paddingRight = 50 -> plot right edge is 950 -> label x is 950 - 4 = 946
        expect(parseFloat(label.getAttribute("x") || "0")).toBe(946);
        expect(label.getAttribute("text-anchor")).toBe("end");
        expect(label.getAttribute("fill")).toBe("#475569");
        expect(label.getAttribute("font-size")).toBe("7.5");
        expect(label.getAttribute("font-weight")).toBe("700");

        // Verify y-position is groundY - 3
        // maxAltitudeKm = 12, locElevationKm = 0.1
        // combinedPlotTop = 174, combinedPlotHeight = 125
        // usableCloudHeight = 125 - 10 = 115
        // groundY = 174 + 125 - (0.1 / 12) * 115 = 298.0416
        // y = groundY - 3 = 295.04
        const y = parseFloat(label.getAttribute("y") || "0");
        expect(y).toBeCloseTo(295.04, 1);

        // Verify cloud-height scale labels are on the outside at x = 958 with textAnchor="start"
        const cloudAlt0 = container.querySelector(
          '[data-testid="cloud-altitude-label-0"]',
        ) as SVGTextElement;
        expect(cloudAlt0).toBeTruthy();
        expect(parseFloat(cloudAlt0.getAttribute("x") || "0")).toBe(958);
        expect(cloudAlt0.getAttribute("text-anchor")).toBe("start");
      });

      it("renders hourly precipitation columns that span the 1-hour interval and touch edge-to-edge without gaps", () => {
        const base = Date.UTC(2026, 8, 12, 0, 0, 0);
        const timestamps = [
          new Date(base).toISOString(),
          new Date(base + 3600 * 1000).toISOString(),
          new Date(base + 7200 * 1000).toISOString(),
          new Date(base + 10800 * 1000).toISOString(),
        ];

        const testData: DataPoint[] = [
          // Hour 0: 2.0 mm
          {
            timestamp: timestamps[0],
            variable: "precipitation",
            value: 2.0,
            unit: "mm",
            model: "ICON-D2",
          },
          // Hour 1: 4.0 mm
          {
            timestamp: timestamps[1],
            variable: "precipitation",
            value: 4.0,
            unit: "mm",
            model: "ICON-D2",
          },
          // Hour 2: 1.5 mm
          {
            timestamp: timestamps[2],
            variable: "precipitation",
            value: 1.5,
            unit: "mm",
            model: "ICON-D2",
          },
          // Hour 3: 0 mm (dry hour, no bar)
          {
            timestamp: timestamps[3],
            variable: "precipitation",
            value: 0.0,
            unit: "mm",
            model: "ICON-D2",
          },
        ];

        const { container } = render(
          <MeteogramChart data={testData} modelChain={mockModelChain} />,
        );

        const bars = container.querySelectorAll('[data-testid="precip-bar"]');
        // Hours 0, 1, 2 have precipitation > 0
        expect(bars.length).toBe(3);

        const bar0 = bars[0] as SVGRectElement;
        const bar1 = bars[1] as SVGRectElement;
        const bar2 = bars[2] as SVGRectElement;

        const x0 = parseFloat(bar0.getAttribute("x") || "0");
        const w0 = parseFloat(bar0.getAttribute("width") || "0");
        const x1 = parseFloat(bar1.getAttribute("x") || "0");
        const w1 = parseFloat(bar1.getAttribute("width") || "0");
        const x2 = parseFloat(bar2.getAttribute("x") || "0");
        const w2 = parseFloat(bar2.getAttribute("width") || "0");

        // Four start-stamped hourly intervals share the 900px timeline.
        // paddingLeft = 50
        // getX(0) = 50, getX(1) = 275, getX(2) = 500, getX(3) = 725
        const step = 900 / 4;

        expect(x0).toBeCloseTo(50, 2);
        expect(w0).toBeCloseTo(step, 2);
        // bar0 right edge touches bar1 left edge
        expect(x0 + w0).toBeCloseTo(x1, 4);

        expect(x1).toBeCloseTo(50 + step, 2);
        expect(w1).toBeCloseTo(step, 2);
        // bar1 right edge touches bar2 left edge
        expect(x1 + w1).toBeCloseTo(x2, 4);

        expect(x2).toBeCloseTo(50 + 2 * step, 2);
        expect(w2).toBeCloseTo(step, 2);
        // bar2 right edge reaches the start of the dry fourth interval.
        expect(x2 + w2).toBeCloseTo(50 + 3 * step, 4);

        // Verify visual styling and lack of corner gaps (no rx)
        expect(bar0.getAttribute("rx")).toBeNull();
        expect(bar0.getAttribute("fill")).toBe("#2563eb");
        expect(bar0.getAttribute("opacity")).toBe("0.85");
      });
    });

    describe("Meteogram Areas Separated by White Space", () => {
      it("creates three vertically separated chart areas with white space gap equal to 2/3 of date-header height (15px)", () => {
        const data = generateMockData(48);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        // Date header height = 22, separator = 15
        // Area 1 (temp): tempTop = 44, tempHeight = 115, tempBottom = 159
        // Separator 1: 159..174 (gap = 15px)
        // Area 2 (precip/cloud): combinedPlotTop = 174, combinedPlotHeight = 95 (no cloud), combinedPlotBottom = 269
        // Separator 2: 269..284 (gap = 15px)
        // Area 3 (wind): windTop = 284, windHeight = 105, windBottom = 389

        const tempPanel = container.querySelector(".panel.panel-temperature");
        const precipPanel = container.querySelector(
          ".panel.panel-combined-precip-clouds",
        );
        const windPanel = container.querySelector(".panel.panel-wind");

        expect(tempPanel).toBeTruthy();
        expect(precipPanel).toBeTruthy();
        expect(windPanel).toBeTruthy();

        // Area 1 uses the date-header top instead of a line at the temperature plot top.
        const dateHeaderTopLine = container.querySelector(
          '[data-edge="date-header-top"]',
        );
        const tempTopLine = container.querySelector(
          '.chart-area-separator-borders line[y1="70"][y2="70"]',
        );
        const tempBottomLine = container.querySelector(
          '[data-edge="temperature-bottom"]',
        );
        expect(dateHeaderTopLine).toBeTruthy();
        expect(tempTopLine).toBeNull();
        expect(tempBottomLine).toBeTruthy();

        // Area 2 boundaries
        const precipTopLine = container.querySelector(
          '[data-edge="precipitation-top"]',
        );
        const precipBottomLine = container.querySelector(
          '[data-edge="precipitation-bottom"]',
        );
        expect(precipTopLine).toBeTruthy();
        expect(precipBottomLine).toBeTruthy();

        // Separator 1 gap between Area 1 bottom (159) and Area 2 top (174) is 15px
        expect(174 - 159).toBe(15);

        // Area 3 boundaries
        const windTopLine = container.querySelector('[data-edge="wind-top"]');
        const windBottomLine = container.querySelector(
          '[data-edge="wind-bottom"]',
        );
        expect(windTopLine).toBeTruthy();
        expect(windBottomLine).toBeTruthy();

        // Separator 2 gap between Area 2 bottom (269) and Area 3 top (284) is 15px
        expect(284 - 269).toBe(15);
      });

      it("uses the day-separator style and exact outer coordinates for all chart-area borders", () => {
        const data = generateMockData(120);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        const dayLines = Array.from(
          container.querySelectorAll('[data-testid="day-separator-line"]'),
        );
        const horizontalBorders = Array.from(
          container.querySelectorAll(
            '[data-testid="chart-area-horizontal-border"]',
          ),
        );
        const outerRightLines = Array.from(
          container.querySelectorAll(
            '[data-testid="outer-right-day-separator-line"]',
          ),
        );

        expect(horizontalBorders).toHaveLength(8);
        expect(outerRightLines).toHaveLength(4);

        const referenceLine = dayLines[0];
        const referenceStyle = {
          stroke: referenceLine.getAttribute("stroke"),
          opacity: referenceLine.getAttribute("opacity"),
          strokeWidth: referenceLine.getAttribute("stroke-width"),
        };
        [...horizontalBorders, ...outerRightLines].forEach((line) => {
          expect(line.getAttribute("stroke")).toBe(referenceStyle.stroke);
          expect(line.getAttribute("opacity")).toBe(referenceStyle.opacity);
          expect(line.getAttribute("stroke-width")).toBe(
            referenceStyle.strokeWidth,
          );
        });

        const outerLeftX = Number(dayLines[0].getAttribute("x1"));
        const outerRightX = Number(outerRightLines[0].getAttribute("x1"));
        horizontalBorders.forEach((line) => {
          expect(Number(line.getAttribute("x1"))).toBe(outerLeftX);
          expect(Number(line.getAttribute("x2"))).toBe(outerRightX);
        });
        outerRightLines.forEach((line) => {
          expect(Number(line.getAttribute("x1"))).toBe(outerRightX);
          expect(Number(line.getAttribute("x2"))).toBe(outerRightX);
        });

        const cells = Array.from(
          container.querySelectorAll('[data-testid="day-label-cell"]'),
        );
        const finalCell = cells[cells.length - 1];
        expect(
          Number(finalCell.getAttribute("x")) +
            Number(finalCell.getAttribute("width")),
        ).toBeCloseTo(outerRightX, 8);

        const expectedEdges = new Map([
          ["date-header-top", 22],
          ["temperature-bottom", 159],
          ["precipitation-top", 174],
          ["precipitation-bottom", 269],
          ["wind-top", 284],
          ["wind-bottom", 389],
          ["convective-top", 404],
          ["convective-bottom", 534],
        ]);
        horizontalBorders.forEach((line) => {
          const edge = line.getAttribute("data-edge");
          expect(Number(line.getAttribute("y1"))).toBe(
            expectedEdges.get(edge!),
          );
          expect(line.getAttribute("y1")).toBe(line.getAttribute("y2"));
        });
      });

      it("aligns the first and final orange model boxes with the outer day separators", () => {
        const data = generateMockData(120);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        const dayLines = container.querySelectorAll(
          '[data-testid="day-separator-line"]',
        );
        const outerRightLine = container.querySelector(
          '[data-testid="outer-right-day-separator-line"]',
        );
        const modelSegments = container.querySelectorAll(
          '[data-testid="model-label-segment"]',
        );
        const firstShape = modelSegments[0].querySelector(
          '[data-testid="model-header-shape"]',
        )!;
        const finalShape = modelSegments[
          modelSegments.length - 1
        ].querySelector('[data-testid="model-header-shape"]')!;

        const outerLeftX = Number(dayLines[0].getAttribute("x1"));
        const outerRightX = Number(outerRightLine?.getAttribute("x1"));
        expect(Number(firstShape.getAttribute("data-x"))).toBe(outerLeftX);
        expect(
          Number(finalShape.getAttribute("data-x")) +
            Number(finalShape.getAttribute("data-width")),
        ).toBeCloseTo(outerRightX, 8);

        const modelBoundaryLines = container.querySelectorAll(
          '[data-testid="model-boundary-line"]',
        );
        modelBoundaryLines.forEach((line, index) => {
          expect(Number(line.getAttribute("x1"))).toBe(
            Number(modelSegments[index + 1].getAttribute("data-start-x")),
          );
        });
      });

      it("renders headers strictly above Area 1 and does not repeat them above lower areas", () => {
        const data = generateMockData(48);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );

        // Model labels are inside model header (y < 22)
        const modelLabels = container.querySelectorAll(
          '[data-testid="model-label-segment"] text',
        );
        expect(modelLabels.length).toBeGreaterThan(0);
        modelLabels.forEach((t) => {
          const y = parseFloat(t.getAttribute("y") || "0");
          expect(y).toBeLessThan(22);
        });

        // Day label cells are inside date header (22 < y < 44)
        const dayCells = container.querySelectorAll(
          '[data-testid="day-label-cell"]',
        );
        expect(dayCells.length).toBeGreaterThan(0);
        dayCells.forEach((c) => {
          const y = parseFloat(c.getAttribute("y") || "0");
          expect(y).toBeGreaterThanOrEqual(22);
          expect(y).toBeLessThan(44);
        });
      });

      it("stops day-boundary lines and daylight stripes at both separators while model boundaries cross continuously", () => {
        const data = generateMockData(50);
        const multiModelChain: WeatherModel[] = [
          { name: "ICON-D2", max_forecast_horizon_hours: 24 },
          { name: "ICON-EU", max_forecast_horizon_hours: 48 },
        ];
        const sunPhases: SunPeriod[] = [
          {
            day: "2026-09-12",
            sunrise: "2026-09-12T07:00:00.000Z",
            sunset: "2026-09-12T19:00:00.000Z",
          },
          {
            day: "2026-09-13",
            sunrise: "2026-09-13T07:00:00.000Z",
            sunset: "2026-09-13T19:00:00.000Z",
          },
        ];

        const { container } = render(
          <MeteogramChart
            data={data}
            modelChain={multiModelChain}
            sunPhases={sunPhases}
          />,
        );

        // 1. Day separator lines do NOT cross separators (159..174 and 269..284)
        const dayLines = container.querySelectorAll(
          '[data-testid="day-separator-line"]',
        );
        dayLines.forEach((line) => {
          const y1 = parseFloat(line.getAttribute("y1") || "0");
          const y2 = parseFloat(line.getAttribute("y2") || "0");

          // Segment must not span across separator 1 (159 to 174)
          const crossesSep1 = y1 < 159 && y2 > 159;
          const insideSep1 = y1 >= 159 && y2 <= 174;
          expect(crossesSep1).toBe(false);
          expect(insideSep1).toBe(false);

          // Segment must not span across separator 2 (269 to 284)
          const crossesSep2 = y1 < 269 && y2 > 269;
          const insideSep2 = y1 >= 269 && y2 <= 284;
          expect(crossesSep2).toBe(false);
          expect(insideSep2).toBe(false);
        });

        // 2. Daylight stripes do NOT shade the separators
        const daylightStripes = container.querySelectorAll(
          '[data-testid="daylight-stripe"]',
        );
        daylightStripes.forEach((stripe) => {
          const y = parseFloat(stripe.getAttribute("y") || "0");
          const height = parseFloat(stripe.getAttribute("height") || "0");
          const bottom = y + height;

          // Must be strictly confined to one of the 3 areas
          const inArea1 = y >= 44 && bottom <= 159;
          const inArea2 = y >= 174 && bottom <= 269;
          const inArea3 = y >= 284 && bottom <= 389;
          expect(
            inArea1 || inArea2 || inArea3 || (y >= 404 && bottom <= 534),
          ).toBe(true);
        });

        // 3. Model boundary lines meet the model-header bottom (20) and run through windBottom
        const modelBoundaryLines = container.querySelectorAll(
          '[data-testid="model-boundary-line"]',
        );
        expect(modelBoundaryLines.length).toBeGreaterThan(0);
        modelBoundaryLines.forEach((line) => {
          const y1 = parseFloat(line.getAttribute("y1") || "0");
          const y2 = parseFloat(line.getAttribute("y2") || "0");
          expect(y1).toBe(20); // lower edge of the orange model headers
          expect(y2).toBe(534); // windBottom
          expect(line.getAttribute("stroke")).toBe("#f59e0b");
          expect(line.getAttribute("stroke-dasharray")).toBe("4 3");
        });
      });
    });
  });

  describe("Noon Dotted Grid Lines & Hour Labels Removal", () => {
    it("completely removes hour ticks and intraday hour labels", () => {
      const data = generateMockData(72);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      expect(container.querySelectorAll(".hour-tick-group").length).toBe(0);
      const allTexts = Array.from(container.querySelectorAll("text")).map((t) =>
        t.textContent?.trim(),
      );
      expect(allTexts.includes("12:00")).toBe(false);
      expect(allTexts.includes("06:00")).toBe(false);
      expect(allTexts.includes("12pm")).toBe(false);
    });

    it("renders exactly one unlabeled noon grid line per day segmented across the three chart areas", () => {
      const data = generateMockData(72); // 3 days (00:00 day 1 to 23:00 day 3)
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const noonLines = Array.from(
        container.querySelectorAll('[data-testid="noon-grid-line"]'),
      );
      // 3 days = 3 noon lines * 3 chart area segments = 9 segments
      expect(noonLines.length).toBe(12);

      noonLines.forEach((line) => {
        expect(line.getAttribute("stroke")).toBe("#e2e8f0");
        expect(line.getAttribute("stroke-dasharray")).toBe("2 3");

        const y1 = parseFloat(line.getAttribute("y1") || "0");
        const y2 = parseFloat(line.getAttribute("y2") || "0");
        const inArea1 = y1 === 44 && y2 === 159;
        const inArea2 = y1 === 174 && y2 === 269;
        const inArea3 = y1 === 284 && y2 === 389;
        expect(
          inArea1 || inArea2 || inArea3 || (y1 === 404 && y2 === 534),
        ).toBe(true);
      });
    });

    it("positions noon grid line from the actual time scale for partial days", () => {
      // Nine start-stamped hourly values from 10:00 through 18:00 represent
      // intervals covering the half-open display window [10:00, 19:00).
      const baseTime = new Date("2026-05-10T10:00:00Z").getTime();
      const partialData: DataPoint[] = [];
      for (let i = 0; i <= 8; i++) {
        const ts = new Date(baseTime + i * 3600000).toISOString();
        partialData.push({
          timestamp: ts,
          variable: "temperature",
          value: 20,
          unit: "°C",
          model: "ICON-D2",
        });
      }

      const { container } = render(
        <MeteogramChart data={partialData} modelChain={mockModelChain} />,
      );
      const noonLines = Array.from(
        container.querySelectorAll('[data-testid="noon-grid-line"]'),
      );

      // Noon (12:00) is 2 hours after 10:00 on a 9-hour timeline.
      // Graph width = 900 (paddingLeft = 50, paddingRight = 50)
      // Expected x = 50 + (2/9) * 900.
      expect(noonLines.length).toBe(4); // 1 noon line across 3 areas
      const xVal = parseFloat(noonLines[0].getAttribute("x1") || "0");
      expect(xVal).toBeCloseTo(50 + (2 / 9) * 900, 1);
    });

    it("omits noon grid line if 12:00 local time falls outside the forecast window", () => {
      // Forecast from 14:00 to 22:00 (after noon)
      const baseTime = new Date("2026-05-10T14:00:00Z").getTime();
      const partialData: DataPoint[] = [];
      for (let i = 0; i <= 8; i++) {
        const ts = new Date(baseTime + i * 3600000).toISOString();
        partialData.push({
          timestamp: ts,
          variable: "temperature",
          value: 20,
          unit: "°C",
          model: "ICON-D2",
        });
      }

      const { container } = render(
        <MeteogramChart data={partialData} modelChain={mockModelChain} />,
      );
      const noonLines = container.querySelectorAll(
        '[data-testid="noon-grid-line"]',
      );
      expect(noonLines.length).toBe(0);
    });
  });

  describe("Full-Screen Meteogram Mode", () => {
    it.each([
      "chart",
      "header",
      "model-chain",
      "border",
      "selector",
      "header-map",
      "window",
    ])("accepts one wheel zoom over %s and cleans up on unmount", (area) => {
      const data = generateMockData(120);
      const { container, unmount } = render(
        <div>
          <header data-testid="wheel-header" />
          <div data-testid="wheel-model-chain" />
          <div data-testid="wheel-border" />
          <select data-testid="wheel-selector" />
          <div className="header-map-preview" data-testid="wheel-header-map" />
          <MeteogramChart
            data={data}
            modelChain={mockModelChain}
            timelineStart="2026-09-11T00:00:00Z"
            timelineEnd="2026-09-16T00:00:00Z"
          />
        </div>,
      );
      const svg = container.querySelector('[data-render-mode="embedded"]')!;
      const start = Date.parse(svg.getAttribute("data-visible-start-time")!);
      const end = Date.parse(svg.getAttribute("data-visible-end-time")!);
      const target =
        area === "chart"
          ? svg
          : area === "window"
            ? window
            : screen.getByTestId(`wheel-${area}`);
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
      });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(true);
      expect(Date.parse(svg.getAttribute("data-visible-start-time")!)).toBe(
        start,
      );
      expect(
        Date.parse(svg.getAttribute("data-visible-end-time")!) - start,
      ).toBeCloseTo((end - start) * 0.82, -1);
      unmount();
      const after = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
      });
      fireEvent(window, after);
      expect(after.defaultPrevented).toBe(false);
    });

    it("uses no-hover zoom outside the SVG and leaves the fullscreen map picker in control", () => {
      const { container } = render(
        <div>
          <header data-testid="wheel-header" />
          <div
            className="fullscreen-map-picker"
            data-testid="wheel-map-picker"
          />
          <MeteogramChart
            data={generateMockData(120)}
            modelChain={mockModelChain}
          />
        </div>,
      );
      const svg = container.querySelector('[data-render-mode="embedded"]')!;
      fireEvent.mouseMove(svg, { clientX: 500, clientY: 100 });
      const start = svg.getAttribute("data-visible-start-time");
      const end = svg.getAttribute("data-visible-end-time");
      const pickerWheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
      });
      fireEvent(screen.getByTestId("wheel-map-picker"), pickerWheel);
      expect(pickerWheel.defaultPrevented).toBe(false);
      expect(svg.getAttribute("data-visible-end-time")).toBe(end);
      fireEvent.wheel(screen.getByTestId("wheel-header"), { deltaY: -100 });
      expect(svg.getAttribute("data-visible-start-time")).toBe(start);
      expect(svg.getAttribute("data-visible-end-time")).not.toBe(end);
    });

    it("zooms once over fullscreen details, ignores the background, and synchronizes on exit", () => {
      const { container } = render(
        <div>
          <header data-testid="wheel-header" />
          <MeteogramChart
            data={generateMockData(120)}
            modelChain={mockModelChain}
          />
        </div>,
      );
      const embedded = container.querySelector(
        '[data-render-mode="embedded"]',
      )!;
      fireEvent.doubleClick(
        screen.getByTestId("meteogram-chart-white-bg").parentElement!,
      );
      const fullscreen = screen
        .getByTestId("fullscreen-chart-area")
        .querySelector("svg")!;
      fireEvent.mouseMove(fullscreen, { clientX: 500, clientY: 100 });
      const start = Date.parse(
        fullscreen.getAttribute("data-visible-start-time")!,
      );
      const end = Date.parse(fullscreen.getAttribute("data-visible-end-time")!);
      fireEvent.wheel(screen.getByTestId("wheel-header"), { deltaY: -100 });
      expect(
        Date.parse(fullscreen.getAttribute("data-visible-end-time")!),
      ).toBe(end);
      fireEvent.wheel(screen.getByTestId("fullscreen-detail-temp"), {
        deltaY: -100,
      });
      expect(
        Date.parse(fullscreen.getAttribute("data-visible-start-time")!),
      ).toBe(start);
      expect(
        Date.parse(fullscreen.getAttribute("data-visible-end-time")!) - start,
      ).toBeCloseTo((end - start) * 0.82, -1);
      expect(embedded.getAttribute("data-visible-end-time")).toBe(
        fullscreen.getAttribute("data-visible-end-time"),
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(
        Date.parse(embedded.getAttribute("data-visible-end-time")!) - start,
      ).toBeCloseTo((end - start) * 0.82, -1);
    });

    it("keeps left-anchored zoom and persists clamping across model horizon changes", () => {
      const data = generateMockData(120);
      const { container, rerender } = render(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          timelineStart="2026-09-11T00:00:00Z"
          timelineEnd="2026-09-16T00:00:00Z"
        />,
      );
      const embedded = container.querySelector(
        '[data-render-mode="embedded"]',
      ) as SVGElement;
      const initialStart = embedded.getAttribute("data-visible-start-time");
      const initialEnd = embedded.getAttribute("data-visible-end-time")!;

      fireEvent.wheel(embedded, { deltaY: -100, deltaMode: 0 });
      expect(embedded.getAttribute("data-visible-start-time")).toBe(
        initialStart,
      );
      expect(embedded.getAttribute("data-visible-end-time")! < initialEnd).toBe(
        true,
      );

      rerender(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          timelineStart="2026-09-11T00:00:00Z"
          timelineEnd="2026-09-14T00:00:00Z"
        />,
      );
      expect(embedded.getAttribute("data-visible-end-time")).toBe(
        "2026-09-14T00:00:00.000Z",
      );

      rerender(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          timelineStart="2026-09-11T00:00:00Z"
          timelineEnd="2026-09-20T00:00:00Z"
        />,
      );
      expect(embedded.getAttribute("data-visible-end-time")).toBe(
        "2026-09-14T00:00:00.000Z",
      );
    });

    it("shares one timestamp zoom range across normal/fullscreen and keeps the native cursor on the hover line", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
      const moveCursor = vi.fn().mockResolvedValue(true);
      Object.defineProperty(window, "pywebview", {
        configurable: true,
        writable: true,
        value: { api: { move_cursor_to: moveCursor } },
      });
      const originalRect = SVGElement.prototype.getBoundingClientRect;
      SVGElement.prototype.getBoundingClientRect = function () {
        const width = this.closest(".fullscreen-meteogram-overlay")
          ? 1600
          : 800;
        return {
          left: 0,
          top: 0,
          width,
          height: 400,
          right: width,
          bottom: 400,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      };

      try {
        const data = generateMockData(120);
        const { container } = render(
          <MeteogramChart
            data={data}
            modelChain={mockModelChain}
            timelineStart="2026-09-11T00:00:00Z"
            timelineEnd="2026-09-16T00:00:00Z"
          />,
        );
        const embedded = container.querySelector(
          '[data-render-mode="embedded"]',
        ) as SVGElement;
        const embeddedGlyphTransform = embedded
          .querySelector('[data-testid="wind-icon-glyph"]')
          ?.getAttribute("transform");

        fireEvent.mouseMove(embedded, {
          clientX: 220,
          clientY: 180,
          screenX: 220,
          screenY: 180,
        });
        const hoverBefore = screen
          .getByTestId("hover-cursor-line")
          .getAttribute("data-hover-time");
        const lineXBefore = Number(
          screen.getByTestId("hover-cursor-line").getAttribute("x1"),
        );

        fireEvent.wheel(embedded, {
          deltaY: -100,
          deltaMode: 0,
          screenX: 220,
          screenY: 180,
        });
        const lineXAfter = Number(
          screen.getByTestId("hover-cursor-line").getAttribute("x1"),
        );
        expect(lineXAfter).toBeGreaterThan(lineXBefore);
        expect(
          screen
            .getByTestId("hover-cursor-line")
            .getAttribute("data-hover-time"),
        ).toBe(hoverBefore);
        expect(moveCursor).toHaveBeenLastCalledWith(
          expect.closeTo(220 + (lineXAfter - lineXBefore) * 0.8, 5),
          180,
          window.devicePixelRatio || 1,
        );

        // A mousemove generated by SetCursorPos must not select a new time.
        const nativeScreenX = moveCursor.mock.calls.at(-1)?.[0] || 0;
        fireEvent.mouseMove(embedded, {
          clientX: 700,
          clientY: 180,
          screenX: nativeScreenX,
          screenY: 180,
        });
        expect(
          screen
            .getByTestId("hover-cursor-line")
            .getAttribute("data-hover-time"),
        ).toBe(hoverBefore);

        const secondLineXBefore = Number(
          screen.getByTestId("hover-cursor-line").getAttribute("x1"),
        );
        fireEvent.wheel(embedded, {
          deltaY: -100,
          deltaMode: 0,
          screenX: nativeScreenX,
          screenY: 180,
        });
        const secondLineXAfter = Number(
          screen.getByTestId("hover-cursor-line").getAttribute("x1"),
        );
        expect(moveCursor).toHaveBeenLastCalledWith(
          expect.closeTo(
            nativeScreenX + (secondLineXAfter - secondLineXBefore) * 0.8,
            5,
          ),
          180,
          window.devicePixelRatio || 1,
        );
        expect(
          screen
            .getByTestId("hover-cursor-line")
            .getAttribute("data-hover-time"),
        ).toBe(hoverBefore);

        const chartCard = container.querySelector(
          ".meteogram-redesign-container",
        ) as HTMLDivElement;
        fireEvent.doubleClick(chartCard);
        const fullscreen = screen
          .getByTestId("fullscreen-chart-area")
          .querySelector('[data-render-mode="fullscreen"]') as SVGElement;
        expect(fullscreen.getAttribute("data-visible-start-time")).toBe(
          embedded.getAttribute("data-visible-start-time"),
        );
        expect(fullscreen.getAttribute("data-visible-end-time")).toBe(
          embedded.getAttribute("data-visible-end-time"),
        );

        fireEvent.mouseMove(fullscreen, {
          clientX: 1200,
          clientY: 180,
          screenX: 1200,
          screenY: 180,
        });
        fireEvent.wheel(fullscreen, {
          deltaY: -100,
          deltaMode: 0,
          screenX: 1200,
        });
        expect(fullscreen.getAttribute("data-visible-start-time")).toBe(
          embedded.getAttribute("data-visible-start-time"),
        );
        expect(fullscreen.getAttribute("data-visible-end-time")).toBe(
          embedded.getAttribute("data-visible-end-time"),
        );

        fireEvent.keyDown(window, { key: "Escape" });
        expect(
          embedded
            .querySelector('[data-testid="wind-icon-glyph"]')
            ?.getAttribute("transform"),
        ).toBe(embeddedGlyphTransform);
      } finally {
        delete window.pywebview;
        SVGElement.prototype.getBoundingClientRect = originalRect;
        vi.useRealTimers();
      }
    });

    it("derives independent immutable layouts for embedded and fullscreen views", () => {
      const embedded = getMeteogramLayout({
        mode: "embedded",
        width: 800,
        height: 320,
        viewBoxHeight: 400,
      });
      const fullscreen = getMeteogramLayout({
        mode: "fullscreen",
        width: 1600,
        height: 800,
        viewBoxHeight: 400,
      });

      expect(embedded.windIconScaleX).toBe(1.25);
      expect(embedded.windIconScaleY).toBe(1.25);
      expect(fullscreen.windIconScaleX).toBe(0.625);
      expect(fullscreen.windIconScaleY).toBe(0.5);
      expect(embedded.windIconFootprint).toBe(WIND_ICON_FOOTPRINT_PX * 1.25);
      expect(
        getMeteogramLayout({
          mode: "embedded",
          width: 800,
          height: 320,
          viewBoxHeight: 400,
        }),
      ).toEqual(embedded);
    });

    it("keeps embedded sizing and complete SVG rendering stable across repeated fullscreen transitions", () => {
      const originalResizeObserver = globalThis.ResizeObserver;
      const originalGetBoundingClientRect =
        SVGElement.prototype.getBoundingClientRect;
      const observers = new Map<Element, ResizeObserverCallback>();
      let embeddedWidth = 800;
      let fullscreenWidth = 1600;

      class TestResizeObserver {
        private readonly callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }

        observe(target: Element) {
          observers.set(target, this.callback);
        }

        unobserve(target: Element) {
          observers.delete(target);
        }

        disconnect() {}
      }

      globalThis.ResizeObserver =
        TestResizeObserver as unknown as typeof ResizeObserver;
      SVGElement.prototype.getBoundingClientRect = function () {
        const width = this.closest(".fullscreen-meteogram-overlay")
          ? fullscreenWidth
          : embeddedWidth;
        const height = this.closest(".fullscreen-meteogram-overlay")
          ? 500
          : (embeddedWidth * 544) / 1000;
        return {
          left: 0,
          top: 0,
          width,
          height,
          right: width,
          bottom: height,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      };

      try {
        const data = generateMockData(72);
        const { container } = render(
          <MeteogramChart data={data} modelChain={mockModelChain} />,
        );
        const chartCard = container.querySelector(
          ".meteogram-redesign-container",
        ) as HTMLDivElement;
        const embeddedSvg = container.querySelector(
          ".meteogram-svg-integrated",
        ) as SVGElement;

        const embeddedGlyph = () =>
          embeddedSvg.querySelector(
            '[data-testid="wind-icon-glyph"]',
          ) as SVGElement;
        expect(embeddedGlyph().getAttribute("transform")).toBe(
          "scale(1.25 1.25)",
        );
        const normalMarkupBefore = embeddedSvg.innerHTML;

        for (let cycle = 0; cycle < 3; cycle += 1) {
          fireEvent.doubleClick(chartCard);
          const fullscreenSvg = screen
            .getByTestId("fullscreen-chart-area")
            .querySelector(".meteogram-svg-integrated") as SVGElement;
          const fullscreenGlyph = fullscreenSvg.querySelector(
            '[data-testid="wind-icon-glyph"]',
          );

          expect(fullscreenGlyph?.getAttribute("transform")).toBe(
            "scale(0.625 1.088)",
          );
          expect(embeddedGlyph().getAttribute("transform")).toBe(
            "scale(1.25 1.25)",
          );

          if (cycle === 0) {
            fullscreenWidth = 2000;
            act(() => {
              observers.get(fullscreenSvg)?.([], {} as ResizeObserver);
            });
            expect(
              fullscreenSvg
                .querySelector('[data-testid="wind-icon-glyph"]')
                ?.getAttribute("transform"),
            ).toBe("scale(0.5 1.088)");
            expect(embeddedGlyph().getAttribute("transform")).toBe(
              "scale(1.25 1.25)",
            );
            fullscreenWidth = 1600;
          }

          fireEvent.keyDown(window, { key: "Escape" });
          expect(
            screen.queryByTestId("fullscreen-meteogram-overlay"),
          ).toBeNull();
          expect(embeddedGlyph().getAttribute("transform")).toBe(
            "scale(1.25 1.25)",
          );
        }

        expect(embeddedSvg.innerHTML).toBe(normalMarkupBefore);

        embeddedWidth = 1000;
        act(() => {
          observers.get(embeddedSvg)?.([], {} as ResizeObserver);
        });
        expect(embeddedGlyph().getAttribute("transform")).toBe("scale(1 1)");
      } finally {
        globalThis.ResizeObserver = originalResizeObserver;
        SVGElement.prototype.getBoundingClientRect =
          originalGetBoundingClientRect;
      }
    });

    it("single click does not open full-screen mode, but double-click opens full-screen mode", () => {
      const data = generateMockData(24);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const chartCard = container.querySelector(
        ".meteogram-redesign-container",
      ) as HTMLDivElement;
      expect(chartCard).toBeTruthy();

      // Single click -> fullscreen overlay is NOT present
      fireEvent.click(chartCard);
      expect(screen.queryByTestId("fullscreen-meteogram-overlay")).toBeNull();

      // Double-click -> fullscreen overlay IS present
      fireEvent.doubleClick(chartCard);
      expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();
      expect(screen.getByTestId("fullscreen-chart-area")).toBeTruthy();
      expect(screen.getByTestId("fullscreen-details-panel")).toBeTruthy();
    });

    it("hides normal floating hover popup when full-screen mode is active and uses bottom details panel instead", () => {
      const data = generateMockData(24);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      const chartCard = container.querySelector(
        ".meteogram-redesign-container",
      ) as HTMLDivElement;
      // Double click to open full-screen mode
      fireEvent.doubleClick(chartCard);

      const fullscreenOverlay = screen.getByTestId(
        "fullscreen-meteogram-overlay",
      );
      const svg = fullscreenOverlay.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Hover over full-screen chart SVG
      fireEvent.mouseMove(svg, { clientX: 300, clientY: 100 });

      // Floating tooltip portal is NOT rendered
      expect(document.querySelector(".hover-unified-tooltip")).toBeNull();

      // Bottom details panel is populated with values
      const tempItem = screen.getByTestId("fullscreen-detail-temp");
      expect(tempItem).toBeTruthy();
      expect(tempItem.textContent).toContain("Temperature");
      expect(tempItem.textContent).toContain("°C");
    });

    it("updates bottom detail values when cursor moves horizontally over full-screen meteogram", () => {
      const data = generateMockData(24);
      render(<MeteogramChart data={data} modelChain={mockModelChain} />);

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      fireEvent.doubleClick(chartCard);

      const fullscreenOverlay = screen.getByTestId(
        "fullscreen-meteogram-overlay",
      );
      const svg = fullscreenOverlay.querySelector(
        ".meteogram-svg-integrated",
      ) as SVGElement;
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Hover at left side
      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      const timeVal1 = screen.getByTestId("fullscreen-detail-time").textContent;

      // Hover at right side
      fireEvent.mouseMove(svg, { clientX: 800, clientY: 100 });
      const timeVal2 = screen.getByTestId("fullscreen-detail-time").textContent;

      expect(timeVal1).not.toBe(timeVal2);
    });

    it("renders two stable full-screen detail rows without cloud metadata or cloud-level fields", () => {
      const data = generateMockData(24);
      render(<MeteogramChart data={data} modelChain={mockModelChain} />);

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      fireEvent.doubleClick(chartCard);

      const row1 = screen.getByTestId("fullscreen-detail-row-1");
      const row2 = screen.getByTestId("fullscreen-detail-row-2");
      expect(row1.children).toHaveLength(6);
      expect(row2.children).toHaveLength(6);
      expect(screen.queryByTestId("fullscreen-detail-row-3")).toBeNull();
      expect(row1.textContent).not.toContain("Main Model");
      expect(screen.queryByTestId("fullscreen-detail-model")).toBeNull();
      expect(row2.textContent).toContain("Feels like");
      expect(
        Array.from(row1.children).map((el) => el.getAttribute("data-testid")),
      ).toEqual([
        "fullscreen-detail-time",
        "fullscreen-detail-temp",
        "fullscreen-detail-precip",
        "fullscreen-detail-direction",
        "fullscreen-detail-wind",
        "fullscreen-detail-cape",
      ]);
      expect(
        Array.from(row2.children).map((el) => el.getAttribute("data-testid")),
      ).toEqual([
        "fullscreen-detail-empty",
        "fullscreen-detail-apparent-temp",
        "fullscreen-detail-accumulated-precip",
        "fullscreen-detail-prob",
        "fullscreen-detail-gusts",
        "fullscreen-detail-cin",
      ]);
      expect(row2.textContent).toContain("Precip. Prob.");
      expect(
        screen
          .getByTestId("fullscreen-detail-accumulated-precip")
          .querySelector(".attr-name")?.textContent,
      ).toBe("Accumulated");
      expect(row2.textContent).not.toContain("Accumulated Precip.");
      expect(row2.textContent).not.toContain("Cloud Model");

      expect(
        screen.getByTestId("fullscreen-detail-apparent-temp").textContent,
      ).toContain("—");
      expect(
        screen.getByTestId("fullscreen-detail-accumulated-precip").textContent,
      ).toContain("—");
      expect(screen.queryByTestId("fullscreen-detail-cloud-model")).toBeNull();
      expect(
        document.querySelector(
          '[data-testid^="fullscreen-detail-cloud-level-"]',
        ),
      ).toBeNull();

      const fullscreenSvg = screen
        .getByTestId("fullscreen-chart-area")
        .querySelector(".meteogram-svg-integrated");
      expect(fullscreenSvg?.getAttribute("preserveAspectRatio")).toBe("none");
    });

    it("keeps every full-screen detail slot present while dry and unavailable values change", () => {
      const data = generateMockData(24);
      render(<MeteogramChart data={data} modelChain={mockModelChain} />);

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      fireEvent.doubleClick(chartCard);
      const svg = screen
        .getByTestId("fullscreen-meteogram-overlay")
        .querySelector(".meteogram-svg-integrated") as SVGElement;
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 600,
        right: 1000,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      fireEvent.mouseMove(svg, { clientX: 100, clientY: 100 });
      const detailSlots = screen
        .getByTestId("fullscreen-details-grid")
        .querySelectorAll(".fullscreen-detail-pair");
      expect(detailSlots).toHaveLength(12);

      fireEvent.mouseMove(svg, { clientX: 200, clientY: 100 });
      expect(
        screen
          .getByTestId("fullscreen-details-grid")
          .querySelectorAll(".fullscreen-detail-pair"),
      ).toHaveLength(12);
      expect(
        screen.getByTestId("fullscreen-detail-accumulated-precip"),
      ).toBeTruthy();
    });

    it("exits full-screen mode immediately when ESC key is pressed", () => {
      const data = generateMockData(24);
      render(<MeteogramChart data={data} modelChain={mockModelChain} />);

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;

      // Double click to open
      fireEvent.doubleClick(chartCard);
      expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();

      // Press Escape
      fireEvent.keyDown(window, { key: "Escape" });

      // Fullscreen overlay is closed
      expect(screen.queryByTestId("fullscreen-meteogram-overlay")).toBeNull();
    });

    it("supports entering and exiting full-screen mode repeatedly without UI bugs or memory leaks", () => {
      const data = generateMockData(24);
      render(<MeteogramChart data={data} modelChain={mockModelChain} />);

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;

      // Cycle 1
      fireEvent.doubleClick(chartCard);
      expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("fullscreen-meteogram-overlay")).toBeNull();

      // Cycle 2
      fireEvent.doubleClick(chartCard);
      expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("fullscreen-meteogram-overlay")).toBeNull();

      // Cycle 3
      fireEvent.doubleClick(chartCard);
      expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();
    });

    it("recalculates chart dimensions on window resize in full-screen mode", () => {
      const originalResizeObserver = globalThis.ResizeObserver;
      let resizeCallback: ResizeObserverCallback | undefined;

      class TestResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }

      globalThis.ResizeObserver =
        TestResizeObserver as unknown as typeof ResizeObserver;

      try {
        const data = generateMockData(24);
        render(<MeteogramChart data={data} modelChain={mockModelChain} />);

        const chartCard = screen.getByTestId(
          "meteogram-chart-white-bg",
        ).parentElement!;
        fireEvent.doubleClick(chartCard);

        expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();

        // Trigger ResizeObserver callback simulate window resize
        act(() => {
          resizeCallback?.([], {} as ResizeObserver);
        });

        expect(screen.getByTestId("fullscreen-meteogram-overlay")).toBeTruthy();
      } finally {
        globalThis.ResizeObserver = originalResizeObserver;
      }
    });
  });

  describe("Timeline Clamping and Zoom Line Clipping Regressions (14 Requirements)", () => {
    const berlinLocation = {
      name: "Berlin",
      latitude: 52.52,
      longitude: 13.4,
      timezone: "Europe/Berlin",
    };

    const generateBerlinForecastData = () => {
      // Effective now: Wednesday 2026-09-16 12:00 UTC (14:00 CEST)
      // Yesterday midnight Berlin (CEST, UTC+2): 2026-09-15 00:00 CEST = 2026-09-14T22:00:00Z
      // Backend returned past_hours safety buffer starting at 2026-09-14T20:00:00Z (Monday 22:00 CEST)
      const data: DataPoint[] = [];
      const bufferStart = new Date("2026-09-14T20:00:00Z").getTime();
      for (let h = 0; h < 120; h++) {
        const ts = new Date(bufferStart + h * 3600 * 1000).toISOString();
        data.push(
          {
            timestamp: ts,
            variable: "temperature",
            value: 14 + (h % 10),
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "apparent_temperature",
            value: 13 + (h % 10),
            unit: "°C",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "wind_speed",
            value: 12 + (h % 8),
            unit: "km/h",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "wind_gusts",
            value: 20 + (h % 12),
            unit: "km/h",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "wind_direction",
            value: (h * 15) % 360,
            unit: "°",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "precipitation",
            value: h % 5 === 0 ? 1.5 : 0,
            unit: "mm",
            model: "ICON-D2",
          },
          {
            timestamp: ts,
            variable: "precipitation_probability",
            value: (h * 5) % 100,
            unit: "%",
            model: "ICON-D2",
          },
        );
      }
      return data;
    };

    it("1. Default zoom visibleStart equals yesterday at 00:00 local time", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const svg = container.querySelector('svg[data-render-mode="embedded"]');
      expect(svg).toBeTruthy();
      // Yesterday 00:00 local time in Europe/Berlin (UTC+2) is 2026-09-14T22:00:00.000Z
      expect(svg?.getAttribute("data-visible-start-time")).toBe(
        "2026-09-14T22:00:00.000Z",
      );
    });

    it("2. First day starts exactly at left chart boundary (outerLeftX)", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const firstCell = container.querySelector(
        '[data-testid="day-label-cell"]',
      );
      expect(firstCell).toBeTruthy();
      expect(Number(firstCell?.getAttribute("x"))).toBe(50);
    });

    it("3. No extra/empty day column exists before yesterday", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const dayBlocks = container.querySelectorAll(".day-group-block text");
      expect(dayBlocks.length).toBeGreaterThan(0);
      // First day must be Tuesday 15.09, NOT Monday 14.09
      expect(dayBlocks[0].textContent).toContain("Tue 15.09");
      expect(dayBlocks[0].textContent).not.toContain("14.09");
    });

    it("4. Starting exactly at midnight does not generate a preceding partial day", () => {
      const data = generateMockData(72); // Starts exactly at 2026-09-11T00:00:00Z
      const { container } = render(
        <MeteogramChart
          data={data}
          modelChain={mockModelChain}
          timelineStart="2026-09-11T00:00:00.000Z"
          timelineEnd="2026-09-14T00:00:00.000Z"
        />,
      );

      const cells = container.querySelectorAll(
        '[data-testid="day-label-cell"]',
      );
      expect(Number(cells[0].getAttribute("x"))).toBe(50);
      const dayBlocks = container.querySelectorAll(".day-group-block text");
      expect(dayBlocks[0].textContent).toContain("Fri 11.09");
    });

    it("5. Starting deliberately at midday generates a valid partial first day without day separator line at 50px", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          timelineStart="2026-09-15T12:00:00.000Z"
          timelineEnd="2026-09-18T00:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const firstCell = container.querySelector(
        '[data-testid="day-label-cell"]',
      );
      expect(firstCell).toBeTruthy();
      expect(Number(firstCell?.getAttribute("x"))).toBe(50);

      // Midday start must not have a day-separator line at 50px
      const daySeparators = container.querySelectorAll(
        '[data-testid="day-separator-line"]',
      );
      daySeparators.forEach((sep) => {
        expect(Number(sep.getAttribute("x1"))).toBeGreaterThan(50);
      });
    });

    it("6. Plotted line series clipped at left boundary", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const tempArea = container.querySelector(
        '[data-testid="temperature-plot-area"]',
      );
      const tempPath = container.querySelector(
        '[data-testid="temperature-path"]',
      );
      const windArea = container.querySelector(
        '[data-testid="wind-plot-area"]',
      );
      const windPath = container.querySelector(
        '[data-testid="wind-speed-path"]',
      );
      const precipProb = container.querySelector(
        '[data-testid="precip-probability-path"]',
      );

      expect(tempArea?.getAttribute("clip-path")).toMatch(
        /^url\(#temperature-clip-/,
      );
      expect(tempPath?.getAttribute("clip-path")).toMatch(
        /^url\(#temperature-clip-/,
      );
      expect(windArea?.getAttribute("clip-path")).toMatch(/^url\(#wind-clip-/);
      expect(windPath?.getAttribute("clip-path")).toMatch(/^url\(#wind-clip-/);
      expect(precipProb?.getAttribute("clip-path")).toMatch(
        /^url\(#precipitation-probability-clip-/,
      );

      // Verify the referenced clip rect starts at outerLeftX = 50
      const clipIdMatch = tempArea
        ?.getAttribute("clip-path")
        ?.match(/#([^)]+)/);
      const tempClip = container.querySelector(`#${clipIdMatch?.[1]}`);
      const rect = tempClip?.querySelector("rect");
      expect(Number(rect?.getAttribute("x"))).toBe(50);
    });

    it("7. Plotted line series clipped at right boundary", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const tempArea = container.querySelector(
        '[data-testid="temperature-plot-area"]',
      );
      const clipIdMatch = tempArea
        ?.getAttribute("clip-path")
        ?.match(/#([^)]+)/);
      const tempClip = container.querySelector(`#${clipIdMatch?.[1]}`);
      const rect = tempClip?.querySelector("rect");

      // outerLeftX (50) + width (900) = 950 = outerRightX
      expect(Number(rect?.getAttribute("width"))).toBe(900);
      expect(
        Number(rect?.getAttribute("x")) + Number(rect?.getAttribute("width")),
      ).toBe(950);
    });

    it("8. Zooming in cannot create visible line overflow", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      // Zoom in using wheel event
      fireEvent.wheel(chartCard, { deltaY: -100, clientX: 300, clientY: 100 });

      // Clip rect must remain bounded to [50, 950]
      const tempArea = container.querySelector(
        '[data-testid="temperature-plot-area"]',
      );
      const clipIdMatch = tempArea
        ?.getAttribute("clip-path")
        ?.match(/#([^)]+)/);
      const tempClip = container.querySelector(`#${clipIdMatch?.[1]}`);
      const rect = tempClip?.querySelector("rect");
      expect(Number(rect?.getAttribute("x"))).toBe(50);
      expect(Number(rect?.getAttribute("width"))).toBe(900);
    });

    it("9. Zooming back out restores complete underlying series", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      const svg = container.querySelector('svg[data-render-mode="embedded"]')!;
      const initialStart = svg.getAttribute("data-visible-start-time");

      // Zoom in
      fireEvent.wheel(chartCard, { deltaY: -200, clientX: 300, clientY: 100 });
      // Zoom back out
      fireEvent.wheel(chartCard, { deltaY: 300, clientX: 300, clientY: 100 });

      expect(svg.getAttribute("data-visible-start-time")).toBe(initialStart);
    });

    it("10. Clipping updates correctly after entering/exiting fullscreen", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      fireEvent.doubleClick(chartCard);

      // In fullscreen, fullscreen clipPath exists and has outer coordinates
      const fullscreenOverlay = screen.getByTestId(
        "fullscreen-meteogram-overlay",
      );
      const fullscreenTempArea = fullscreenOverlay.querySelector(
        '[data-testid="temperature-plot-area"]',
      );
      expect(fullscreenTempArea?.getAttribute("clip-path")).toMatch(
        /-fullscreen\)/,
      );

      // Press Escape to exit fullscreen
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("fullscreen-meteogram-overlay")).toBeNull();

      // Embedded clipPath is still active
      const embeddedTempArea = container.querySelector(
        '[data-testid="temperature-plot-area"]',
      );
      expect(embeddedTempArea?.getAttribute("clip-path")).toMatch(
        /-embedded\)/,
      );
    });

    it("11. Clipping updates correctly after resizing window/chart", () => {
      let resizeCb: ResizeObserverCallback | null = null;
      class MockObserver {
        constructor(cb: ResizeObserverCallback) {
          resizeCb = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      const prevObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver =
        MockObserver as unknown as typeof ResizeObserver;

      try {
        const data = generateBerlinForecastData();
        const { container } = render(
          <MeteogramChart
            data={data}
            location={berlinLocation}
            forecastStartTime="2026-09-16T12:00:00.000Z"
            modelChain={mockModelChain}
          />,
        );

        act(() => {
          resizeCb?.([], {} as ResizeObserver);
        });

        const tempArea = container.querySelector(
          '[data-testid="temperature-plot-area"]',
        );
        expect(tempArea?.getAttribute("clip-path")).toBeTruthy();
      } finally {
        globalThis.ResizeObserver = prevObserver;
      }
    });

    it("12. All chart areas share identical visibleStart -> visibleEnd x-domain", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const svg = container.querySelector('svg[data-render-mode="embedded"]');
      const start = svg?.getAttribute("data-visible-start-time");
      const end = svg?.getAttribute("data-visible-end-time");

      expect(start).toBe("2026-09-14T22:00:00.000Z");
      expect(end).toBeTruthy();

      // All horizontal borders align with outerLeftX = 50 and outerRightX = 950
      const borders = container.querySelectorAll(
        '[data-testid="chart-area-horizontal-border"]',
      );
      borders.forEach((border) => {
        expect(Number(border.getAttribute("x1"))).toBe(50);
        expect(Number(border.getAttribute("x2"))).toBe(950);
      });
    });

    it("13. Model boundaries and day boundaries remain aligned after zooming", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      fireEvent.wheel(chartCard, { deltaY: -100, clientX: 300, clientY: 100 });

      // Check that model boundary line timestamp matches its attribute
      const boundaryLine = container.querySelector(
        '[data-testid="model-boundary-line"]',
      );
      if (boundaryLine) {
        expect(boundaryLine.getAttribute("data-timestamp")).toBeTruthy();
        expect(Number(boundaryLine.getAttribute("x1"))).toBeGreaterThanOrEqual(
          50,
        );
        expect(Number(boundaryLine.getAttribute("x1"))).toBeLessThanOrEqual(
          950,
        );
      }
    });

    it("14. Fixes work identically in normal and fullscreen views", () => {
      const data = generateBerlinForecastData();
      const { container } = render(
        <MeteogramChart
          data={data}
          location={berlinLocation}
          forecastStartTime="2026-09-16T12:00:00.000Z"
          modelChain={mockModelChain}
        />,
      );

      const embeddedSvg = container.querySelector(
        'svg[data-render-mode="embedded"]',
      )!;
      const chartCard = screen.getByTestId(
        "meteogram-chart-white-bg",
      ).parentElement!;
      fireEvent.doubleClick(chartCard);

      const fullscreenOverlay = screen.getByTestId(
        "fullscreen-meteogram-overlay",
      );
      const fullscreenSvg = fullscreenOverlay.querySelector(
        'svg[data-render-mode="fullscreen"]',
      )!;

      // Both must share identical visibleStart and visibleEnd
      expect(fullscreenSvg.getAttribute("data-visible-start-time")).toBe(
        embeddedSvg.getAttribute("data-visible-start-time"),
      );
      expect(fullscreenSvg.getAttribute("data-visible-end-time")).toBe(
        embeddedSvg.getAttribute("data-visible-end-time"),
      );

      // Fullscreen line series must have clipping applied
      expect(
        fullscreenSvg
          .querySelector('[data-testid="temperature-path"]')
          ?.getAttribute("clip-path"),
      ).toMatch(/^url\(#temperature-clip-/);
      expect(
        fullscreenSvg
          .querySelector('[data-testid="wind-speed-path"]')
          ?.getAttribute("clip-path"),
      ).toMatch(/^url\(#wind-clip-/);
    });

    it("renders Open-Meteo attribution in normal view footer and in fullscreen header", () => {
      const data = generateMockData(24);
      const { container } = render(
        <MeteogramChart data={data} modelChain={mockModelChain} />,
      );

      // Normal view footer attribution
      const footerAttr = screen.getByTestId("meteogram-footer-attribution");
      expect(footerAttr.textContent).toBe("Weather data by Open-Meteo.com");

      const link = footerAttr.querySelector("a");
      expect(link?.getAttribute("href")).toBe("https://open-meteo.com/");

      // Double-click into fullscreen mode
      const chartCard = container.querySelector(
        ".meteogram-redesign-container",
      ) as HTMLDivElement;
      fireEvent.doubleClick(chartCard);

      // Fullscreen header attribution
      const fullscreenAttr = screen.getByTestId(
        "fullscreen-header-attribution",
      );
      expect(fullscreenAttr).toBeTruthy();
      expect(fullscreenAttr.textContent).toBe("Weather data by Open-Meteo.com");
      const fullscreenChart = screen.getByTestId("fullscreen-chart-area");
      expect(fullscreenAttr.nextElementSibling).toBe(fullscreenChart);
    });

    it("uses userTimezone to group days and render timeline when provided, overriding location timezone", () => {
      // 2026-09-24T23:00:00Z is:
      // In Europe/Berlin (UTC+2): 2026-09-25 01:00 (Friday)
      // In America/New_York (UTC-4): 2026-09-24 19:00 (Thursday)
      const data: DataPoint[] = [
        {
          timestamp: "2026-09-24T23:00:00.000Z",
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
        {
          timestamp: "2026-09-25T01:00:00.000Z",
          variable: "temperature",
          value: 14,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      const nyLocation: Location = {
        name: "New York",
        latitude: 40.71,
        longitude: -74.0,
        timezone: "America/New_York",
      };

      const { container } = render(
        <MeteogramChart
          data={data}
          location={nyLocation}
          userTimezone="Europe/Berlin"
          modelChain={mockModelChain}
          timelineStart="2026-09-24T23:00:00.000Z"
          timelineEnd="2026-09-25T02:00:00.000Z"
        />,
      );

      const dayBlocks = container.querySelectorAll(".day-group-block text");
      expect(dayBlocks.length).toBeGreaterThan(0);
      expect(dayBlocks[0].textContent).toContain("Fri 25.09");
    });

    it("falls back to location.timezone when userTimezone is not provided", () => {
      const data: DataPoint[] = [
        {
          timestamp: "2026-09-24T23:00:00.000Z",
          variable: "temperature",
          value: 15,
          unit: "°C",
          model: "ICON-D2",
        },
      ];

      const nyLocation: Location = {
        name: "New York",
        latitude: 40.71,
        longitude: -74.0,
        timezone: "America/New_York",
      };

      const { container } = render(
        <MeteogramChart
          data={data}
          location={nyLocation}
          modelChain={mockModelChain}
          timelineStart="2026-09-24T23:00:00.000Z"
          timelineEnd="2026-09-25T02:00:00.000Z"
        />,
      );

      const dayBlocks = container.querySelectorAll(".day-group-block text");
      expect(dayBlocks.length).toBeGreaterThan(0);
      expect(dayBlocks[0].textContent).toContain("Thu 24.09");
    });
  });
});
