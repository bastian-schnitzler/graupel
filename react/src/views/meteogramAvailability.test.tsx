import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  applyAvailabilityToMetadata,
  capChainToAvailability,
  mergeDraggedChain,
} from "./meteogramViewUtils";
import { formatModelRunTime } from "../components/modelChain/modelChainBuilderUtils";
import { MeteogramView } from "./MeteogramView";
import { apiService } from "../services/apiService";
import type {
  DataPoint,
  HarmonizedForecastResponse,
  MeteogramConfig,
  ModelAvailability,
  WeatherModel,
} from "../types";

const chain: WeatherModel[] = [
  { name: "ICON-D2", id: "icon_d2", max_forecast_horizon_hours: 48 },
  { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 120 },
  { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 240 },
];
const availability = (
  model: string,
  hours: number | null,
  run?: string,
): ModelAvailability => ({
  model,
  chain: "main",
  available_hours: hours,
  last_run_init_time: run ?? null,
});

describe("capChainToAvailability", () => {
  it("moves boundaries to the delivered hours and keeps them non-decreasing", () => {
    const capped = capChainToAvailability(chain, {
      "ICON-D2": availability("ICON-D2", 45),
      "ICON-EU": availability("ICON-EU", 114),
      "ECMWF IFS": availability("ECMWF IFS", null),
    });
    expect(capped.map((m) => m.max_forecast_horizon_hours)).toEqual([
      45, 114, 240,
    ]);
    // A model delivering less than the previous boundary gets a 0h span.
    const collapsed = capChainToAvailability(chain, {
      "ICON-EU": availability("ICON-EU", 30),
    });
    expect(collapsed.map((m) => m.max_forecast_horizon_hours)).toEqual([
      48, 48, 240,
    ]);
  });

  it("returns the same chain without availability info", () => {
    expect(capChainToAvailability(chain, undefined)).toBe(chain);
    expect(capChainToAvailability(chain, {})).toBe(chain);
  });
});

describe("mergeDraggedChain", () => {
  it("takes only the dragged boundary and keeps other requested horizons", () => {
    const capped = capChainToAvailability(chain, {
      "ICON-EU": availability("ICON-EU", 114),
    });
    const dragged = capped.map((m, i) =>
      i === 0 ? { ...m, max_forecast_horizon_hours: 40 } : m,
    );
    const merged = mergeDraggedChain(chain, capped, dragged);
    // ICON-EU stays at the requested 120h, so a longer run extends it again.
    expect(merged.map((m) => m.max_forecast_horizon_hours)).toEqual([
      40, 120, 240,
    ]);
  });
});

describe("applyAvailabilityToMetadata", () => {
  it("shows delivered hours and the run time for capped models only", () => {
    const models = {
      icon_eu: { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 },
      ecmwf_ifs: { id: "ecmwf_ifs", name: "ECMWF IFS", max_forecast_horizon_hours: 360 },
    };
    const result = applyAvailabilityToMetadata(models, chain, {
      "ICON-EU": availability("ICON-EU", 114, "2026-10-06T06:00:00Z"),
      "ECMWF IFS": availability("ECMWF IFS", null, "2026-10-06T00:00:00Z"),
    });
    expect(result["icon_eu"].max_forecast_horizon_hours).toBe(114);
    expect(result["ICON-EU"].last_run_init_time).toBe("2026-10-06T06:00:00Z");
    expect(result["ecmwf_ifs"].max_forecast_horizon_hours).toBe(360);
    expect(result["ecmwf_ifs"].last_run_init_time).toBe("2026-10-06T00:00:00Z");
    // The catalogue itself is untouched (Config View keeps full horizons).
    expect(models.icon_eu.max_forecast_horizon_hours).toBe(120);
  });

  it("attaches the horizon explanation inputs", () => {
    const models = {
      icon_eu: { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 },
    };
    const result = applyAvailabilityToMetadata(
      models,
      chain,
      { "ICON-EU": availability("ICON-EU", 114, "2026-10-06T06:00:00Z") },
      "2026-10-06T12:00:00Z",
    );
    expect(result["ICON-EU"].horizon_info).toEqual({
      catalogue_hours: 120,
      available_hours: 114,
      limited_by_run: true,
      forecast_start_time: "2026-10-06T12:00:00Z",
      run_segments: [],
      run_init_time: "2026-10-06T06:00:00Z",
      run_availability_time: null,
      slice_start_hours: 48,
      slice_end_hours: 114,
      ensemble: null,
      probability_valid_until: null,
    });
  });
});

describe("formatModelRunTime", () => {
  it("formats a run start in the given time zone", () => {
    expect(formatModelRunTime("2026-10-06T09:00:00Z", "Europe/Berlin")).toBe(
      "06.10. 11:00",
    );
    expect(formatModelRunTime(null)).toBeNull();
    expect(formatModelRunTime("not a date")).toBeNull();
  });
});

describe("MeteogramView run availability", () => {
  it("caps the displayed chain and shows the latest run without changing the config", async () => {
    vi.spyOn(apiService, "getModels").mockResolvedValue([]);
    const config: MeteogramConfig = {
      id: "cfg",
      name: "Cfg",
      location: { name: "Here", latitude: 47, longitude: 11 },
      model_chain: [
        { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 10 },
        { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 20 },
      ],
      cloud_model_chain: [],
    };
    const start = Date.parse("2026-10-06T12:00:00Z");
    const ts = (h: number) => new Date(start + h * 3600_000).toISOString();
    const series = (model: string, hours: number): DataPoint[] =>
      Array.from({ length: hours }, (_, h) => ({
        timestamp: ts(h),
        variable: "temperature",
        value: 5,
        unit: "°C",
        model,
      }));
    const response: HarmonizedForecastResponse = {
      combined_forecast: [],
      model_forecasts: {
        "ICON-EU": series("ICON-EU", 7),
        "ECMWF IFS": series("ECMWF IFS", 20),
      },
      forecast_start_time: ts(0),
      timeline_start: ts(0),
      timeline_end: ts(20),
      model_availability: {
        "ICON-EU": availability("ICON-EU", 7, "2026-10-06T09:00:00Z"),
        "ECMWF IFS": availability("ECMWF IFS", null),
      },
    };

    const { container } = render(
      <MeteogramView
        currentConfig={config}
        forecastResponse={response}
        loading={false}
        error={null}
      />,
    );

    await waitFor(() => expect(screen.getByText("0h — 7h")).toBeTruthy());
    expect(screen.getByText("7h — 20h")).toBeTruthy();
    expect(screen.getByText("Max: 7/10h")).toBeTruthy();
    expect(container.querySelector(".model-run-time")?.textContent).toMatch(
      /^Run: 06\.10\. \d\d:00$/,
    );
    // Chart header boundary follows the capped chain.
    const labels = Array.from(
      container.querySelectorAll('[data-testid="model-label-segment"]'),
    ).map((el) => el.textContent);
    expect(labels.join(" ")).toContain("ICON-EU");
    // The stored configuration keeps its full horizon.
    expect(config.model_chain[0].max_forecast_horizon_hours).toBe(10);
  });
});

describe("run-split model headers", () => {
  it("formats runs as UTC MM/DDZhh", async () => {
    const { formatRunLabel } = await import("../utils/meteogramTimelineUtils");
    expect(formatRunLabel("2026-10-06T06:00:00Z")).toBe("10/06Z06");
  });

  it("splits one chain model into one header per run", async () => {
    const { calculateModelSegments } = await import(
      "../utils/meteogramTimelineUtils"
    );
    const { createTimelineScale } = await import("../utils/timeline");
    const start = Date.parse("2026-10-06T14:00:00Z");
    const hour = 3600_000;
    const timeline = createTimelineScale(start, start + 20 * hour, 0, 200);
    const segments = calculateModelSegments(
      [
        { name: "ICON-D2", max_forecast_horizon_hours: 4 },
        { name: "ECMWF", max_forecast_horizon_hours: 20 },
      ],
      "2026-10-06T14:00:00Z",
      timeline,
      {
        ECMWF: [
          {
            run_init_time: "2026-10-06T06:00:00Z",
            valid_until: "2026-10-07T00:00:00Z",
          },
          {
            run_init_time: "2026-10-06T00:00:00Z",
            valid_from: "2026-10-07T00:00:00Z",
          },
        ],
      },
    );
    expect(segments.map((s) => [s.label, s.startX, s.endX])).toEqual([
      ["ICON-D2", 0, 40],
      ["ECMWF (10/06Z06)", 40, 100],
      ["ECMWF (10/06Z00)", 100, 200],
    ]);
    // The model chain still has one ECMWF entry; both headers name it.
    expect(segments.filter((s) => s.modelName === "ECMWF")).toHaveLength(2);
  });
});

describe("run info for single runs and the popup", () => {
  it("keeps the header plain when the series comes from one run", async () => {
    const { calculateModelSegments } = await import(
      "../utils/meteogramTimelineUtils"
    );
    const { createTimelineScale } = await import("../utils/timeline");
    const start = Date.parse("2026-10-06T14:00:00Z");
    const timeline = createTimelineScale(start, start + 10 * 3600_000, 0, 100);
    const segments = calculateModelSegments(
      [{ name: "ICON-D2", max_forecast_horizon_hours: 10 }],
      "2026-10-06T14:00:00Z",
      timeline,
      { "ICON-D2": [{ run_init_time: "2026-10-06T12:00:00Z", run_length_hours: 48 }] },
    );
    expect(segments.map((s) => s.label)).toEqual(["ICON-D2"]);
  });

  it("finds the run delivering a timestamp", async () => {
    const { findRunAt } = await import("../utils/meteogramTimelineUtils");
    const runs = [
      { run_init_time: "2026-10-06T06:00:00Z", valid_until: "2026-10-12T07:00:00Z", run_length_hours: 144 },
      { run_init_time: "2026-10-06T00:00:00Z", valid_from: "2026-10-12T07:00:00Z", run_length_hours: 360 },
    ];
    expect(findRunAt(runs, Date.parse("2026-10-07T00:00:00Z"))?.run_length_hours).toBe(144);
    expect(findRunAt(runs, Date.parse("2026-10-12T07:00:00Z"))?.run_length_hours).toBe(360);
    expect(findRunAt(undefined, 0)).toBeUndefined();
  });

  it("shows the run line under the model name in the popup", async () => {
    const { ChartTooltip } = await import("../components/drawing/ChartTooltip");
    render(
      <ChartTooltip
        isFullscreen={false}
        hoverData={{
          temperature: { timestamp: "2026-10-07T00:00:00Z", variable: "temperature", value: 5, unit: "°C", model: "ECMWF IFS" },
        }}
        hoverX={10}
        hoverDateObj={new Date("2026-10-07T00:00:00Z")}
        hoverDateParts={{ hour: "02", minute: "00" }}
        popupPos={{ top: 0, left: 0 }}
        popupRef={{ current: null }}
        hoverTimestamp={Date.parse("2026-10-07T00:00:00Z")}
        userTimezone="Europe/Berlin"
        accumulatedPrecip={null}
        runInfo="Run 06.10. 08:00 + 144h"
      />,
    );
    expect(screen.getByTestId("tooltip-run-info").textContent).toBe(
      "Run 06.10. 08:00 + 144h",
    );
    expect(screen.getByText("ECMWF IFS")).toBeTruthy();
  });
});

describe("missing sources of derived quantities", () => {
  it("warns on the model card when a drawn derived quantity lacks a source", async () => {
    vi.spyOn(apiService, "getModels").mockResolvedValue([]);
    const config: MeteogramConfig = {
      id: "cfg",
      name: "Cfg",
      location: { name: "Here", latitude: 47, longitude: 11 },
      model_chain: [
        { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 10 },
        { name: "ECMWF IFS", id: "ecmwf_ifs", max_forecast_horizon_hours: 20 },
      ],
      cloud_model_chain: [],
    };
    const start = Date.parse("2026-10-06T12:00:00Z");
    const ts = (h: number) => new Date(start + h * 3600_000).toISOString();
    const series = (model: string, variables: string[]): DataPoint[] =>
      Array.from({ length: 20 }, (_, h) =>
        variables.map((variable) => ({
          timestamp: ts(h),
          variable,
          value: 1,
          unit: "",
          model,
        })),
      ).flat();
    const response: HarmonizedForecastResponse = {
      combined_forecast: [],
      model_forecasts: {
        "ICON-EU": series("ICON-EU", ["temperature", "precipitation"]),
        "ECMWF IFS": series("ECMWF IFS", ["temperature", "precipitation", "snowfall"]),
      },
      forecast_start_time: ts(0),
      timeline_start: ts(0),
      timeline_end: ts(20),
    };
    const layout = {
      id: "snow",
      name: "Snow",
      areas: [
        {
          id: "snow",
          series: [{ quantity: "snowfall_with_rain", style: "bars" }],
        },
      ],
    };

    const { rerender } = render(
      <MeteogramView
        currentConfig={config}
        forecastResponse={response}
        loading={false}
        error={null}
        chartLayout={layout}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("missing-sources-ICON-EU").textContent).toBe(
        "⚠ no snowfall",
      ),
    );
    expect(screen.queryByTestId("missing-sources-ECMWF IFS")).toBeNull();

    // The default layout draws the bars without snowfall but still warns.
    rerender(
      <MeteogramView
        currentConfig={config}
        forecastResponse={response}
        loading={false}
        error={null}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("missing-sources-ICON-EU").textContent).toBe(
        "⚠ no snowfall",
      ),
    );
    expect(screen.queryByTestId("missing-sources-ECMWF IFS")).toBeNull();
  });
});
