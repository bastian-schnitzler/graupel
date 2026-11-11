// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Hover, cursor lines and tooltip through `<Meteogram>` ("MeteogramChart Redesign
 * Component", "Persistent Current-Time Cursor Line & Details Popup
 * Behavior", "accumulated precipitation in hover tooltip", "Canonical
 * meteogram timeline regressions"). Differences to the old component: the
 * core listens to pointer events, and the tooltip element stays in the DOM
 * with `display: none` when hidden.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPoint, DetailedCloudForecast } from "@graupel/meteogram";
import { Meteogram } from "../src";
import {
  HOUR,
  chartSvg,
  generateMockData,
  hoverAt,
  leave,
  mockModelChain,
  mockRect,
  toInput,
  tooltipElement,
  tooltipShown,
} from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const renderChart = (data: DataPoint[], extra: Partial<Parameters<typeof toInput>[0]> = {}) =>
  render(<Meteogram input={toInput({ data, modelChain: mockModelChain, ...extra })} />);

describe("Meteogram hover (MeteogramChart Redesign Component)", () => {
  it("handles mouse hover and shows unified tooltip crosshair with metrics", () => {
    const { container } = renderChart(generateMockData(24));
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });

    hoverAt(svg, 300);

    expect(tooltipShown(container)).toBe(true);
    const crosshair = container.querySelector(".hover-crosshair-group");
    expect(crosshair).toBeTruthy();
    const crosshairLine = crosshair?.querySelector("line");
    expect(crosshairLine?.getAttribute("y1")).toBe("22"); // dayHeaderTop
    expect(crosshairLine?.getAttribute("stroke")).toBe("#f43f5e");
    expect(crosshairLine?.getAttribute("stroke-dasharray")).toBe("4 2");
    expect(crosshair?.querySelector("circle")).toBeNull(); // endpoint circle removed

    expect(screen.getByText(/Temperature:/)).toBeTruthy();
    expect(screen.getByText(/Wind Speed:/)).toBeTruthy();
    expect(screen.getByText("Precipitation:")).toBeTruthy();

    // Leaving hides the tooltip and the hover line.
    leave(svg);
    expect(tooltipShown(container)).toBe(false);
    expect(container.querySelector(".hover-crosshair-group")).toBeNull();
  });

  it("shows precipitation probability before precipitation and omits cloud details from the hover popup", () => {
    const data = generateMockData(24);
    const verticalCloudForecast: DetailedCloudForecast = {
      location: { name: "Test", latitude: 0, longitude: 0 },
      profiles: [
        {
          timestamp: data[0]!.timestamp,
          source_model_id: "ecmwf_ifs025",
          source_model_name: "ECMWF IFS 0.25°",
          levels: [{ pressure_hpa: 1000, altitude_m_asl: 200, cloud_cover_percent: 93 }],
        },
      ],
    };
    const { container } = renderChart(data, { verticalCloudForecast });
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });

    hoverAt(svg, 51);

    const tooltip = tooltipElement(container);
    const labels = Array.from(tooltip.querySelectorAll(".tooltip-row .label"), (node) => node.textContent);
    expect(labels.indexOf("Precip. Prob:")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Precip. Prob:")).toBeLessThan(labels.indexOf("Precipitation:"));
    expect(tooltip.textContent).not.toContain("ECMWF IFS 0.25°");
    expect(tooltip.textContent).not.toContain("Detailed Cloud Profile");
    expect(tooltip.textContent).not.toContain("1000 hPa");
    expect(tooltip.textContent).not.toContain("93 %");
  });

  it("uses the exact 15:00 timestamp for tooltip values and the cloud profile", () => {
    const times = [14, 15, 16].map((hour) => `2026-09-14T${hour}:00:00.000Z`);
    const data: DataPoint[] = times.flatMap((timestamp, index) =>
      (
        [
          ["temperature", 140 + index * 10, "°C"],
          ["apparent_temperature", 240 + index * 10, "°C"],
          ["precipitation", index + 1, "mm"],
          ["precipitation_probability", 40 + index, "%"],
          ["wind_speed", 50 + index, "km/h"],
          ["wind_gusts", 60 + index, "km/h"],
          ["wind_direction", 70 + index, "°"],
        ] as const
      ).map(([variable, value, unit]) => ({ timestamp, variable, value, unit, model: "ICON-EU" })),
    );
    const cloud: DetailedCloudForecast = {
      location: { name: "Test", latitude: 0, longitude: 0 },
      profiles: times.map((timestamp, index) => ({
        timestamp,
        source_model_id: "icon_eu",
        source_model_name: "ICON-EU",
        levels: [{ pressure_hpa: 850, altitude_m_asl: 1500, cloud_cover_percent: 54 + index }],
      })),
    };
    const { container } = render(
      <Meteogram
        input={toInput({
          data,
          modelChain: [{ name: "ICON-EU", max_forecast_horizon_hours: 3 }],
          verticalCloudForecast: cloud,
          timelineStart: times[0],
          timelineEnd: "2026-09-14T17:00:00.000Z",
        })}
      />,
    );
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 450 });

    hoverAt(svg, 50 + 900 / 3, 200);

    expect(screen.getByTestId("hover-cursor-line").getAttribute("data-timestamp")).toBe(times[1]);
    expect(screen.getByText("150 °C")).toBeTruthy();
    expect(screen.getByText("250 °C")).toBeTruthy();
    expect(screen.getByText("2 mm")).toBeTruthy();
    expect(screen.getByText("41 %")).toBeTruthy();
    expect(screen.getByText("51 km/h")).toBeTruthy();
    expect(screen.getByText("61 km/h")).toBeTruthy();
    expect(screen.queryByText("55 %")).toBeNull();
    expect(screen.queryByText(/Detailed Cloud Profile/)).toBeNull();
  });
});

describe("Persistent Current-Time Cursor Line & Details Popup Behavior", () => {
  it("renders current-time cursor line when mouse is not hovering and current time is in range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-11T00:00:00Z") + 12 * HOUR);
    const { container } = renderChart(generateMockData(24));

    const currentTimeCrosshair = container.querySelector('[data-testid="current-time-crosshair-group"]');
    expect(currentTimeCrosshair).toBeTruthy();
    expect(container.querySelector('[data-testid="hover-crosshair-group"]')).toBeNull();

    const line = currentTimeCrosshair?.querySelector("line");
    expect(line?.getAttribute("stroke")).toBe("#f43f5e");
    expect(line?.getAttribute("stroke-dasharray")).toBe("4 2");
    expect(line?.getAttribute("y1")).toBe("22");
    expect(line?.getAttribute("y2")).toBe("534");
    const xVal = parseFloat(line?.getAttribute("x1") || "0");
    expect(xVal).toBeGreaterThan(50);
    expect(xVal).toBeLessThan(950);
  });

  it("does not render current-time line if current time is outside forecast time range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const { container } = renderChart(generateMockData(24));
    expect(container.querySelector('[data-testid="current-time-crosshair-group"]')).toBeNull();
    expect(container.querySelector('[data-testid="hover-crosshair-group"]')).toBeNull();
  });

  it("hides current-time line and shows hover line on mouse move, then restores current-time line on mouse leave", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-11T00:00:00Z") + 6 * HOUR);
    const { container } = renderChart(generateMockData(24));
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });
    const current = () => container.querySelector('[data-testid="current-time-crosshair-group"]');
    const hovered = () => container.querySelector('[data-testid="hover-crosshair-group"]');

    expect(current()).toBeTruthy();
    expect(hovered()).toBeNull();

    hoverAt(svg, 400, 200);
    expect(current()).toBeNull();
    expect(hovered()).toBeTruthy();

    leave(svg);
    expect(current()).toBeTruthy();
    expect(hovered()).toBeNull();
  });

  it("positions details popup pinned below date header on opposite side of cursor", () => {
    const { container } = renderChart(generateMockData(24));
    const box = { left: 100, top: 200, width: 1000, height: 500 };
    mockRect(container.querySelector('[data-testid="meteogram"]')!, box);
    const svg = chartSvg(container);
    mockRect(svg, box);

    // Hover in the left half: popup pinned to the right side.
    hoverAt(svg, 300, 400);
    const tooltip = tooltipElement(container);
    // Position relative to the meteogram element: below the date header.
    const topPos = parseFloat(tooltip.style.top);
    expect(topPos).toBeGreaterThan(0);
    expect(topPos).toBeLessThan(200);
    const rightSideLeft = parseFloat(tooltip.style.left);
    expect(rightSideLeft).toBeGreaterThan(500);

    // Hover in the right half: popup pinned to the left side, same height.
    hoverAt(svg, 900, 150);
    expect(parseFloat(tooltip.style.top)).toBe(topPos);
    const leftSideLeft = parseFloat(tooltip.style.left);
    expect(leftSideLeft).toBeLessThan(500);
    expect(leftSideLeft).toBeLessThan(rightSideLeft);
  });
});

describe("accumulated precipitation in hover tooltip", () => {
  const baseChain = [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }];

  /** Hourly samples are start-stamped intervals: N hours, N equal intervals. */
  const hoverIndex = (svg: SVGElement, count: number, index: number) => {
    hoverAt(svg, 50 + (index / count) * 900, 200);
  };

  it("calculates accumulated precipitation across contiguous columns with precipitation", () => {
    const start = Date.parse("2026-09-11T00:00:00Z");
    const precip: Record<number, number> = { 2: 1.0, 3: 2.5, 4: 0.5, 7: 3.2 };
    const data: DataPoint[] = [];
    for (let h = 0; h < 10; h++) {
      const timestamp = new Date(start + h * HOUR).toISOString();
      data.push(
        { timestamp, variable: "temperature", value: 15, unit: "°C", model: "ICON-D2" },
        { timestamp, variable: "precipitation", value: precip[h] ?? 0, unit: "mm", model: "ICON-D2" },
      );
    }
    const { container } = render(<Meteogram input={toInput({ data, modelChain: baseChain })} />);
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });

    const accumulated = () => screen.getByTestId("accumulated-precip-val").textContent;
    hoverIndex(svg, 10, 3);
    expect(screen.getByTestId("accumulated-precip-row")).toBeTruthy();
    expect(accumulated()).toBe("4 mm");
    hoverIndex(svg, 10, 2);
    expect(accumulated()).toBe("4 mm");
    hoverIndex(svg, 10, 4);
    expect(accumulated()).toBe("4 mm");
    hoverIndex(svg, 10, 7);
    expect(accumulated()).toBe("3.2 mm");
    hoverIndex(svg, 10, 1);
    expect(screen.queryByTestId("accumulated-precip-row")).toBeNull();
    hoverIndex(svg, 10, 5);
    expect(screen.queryByTestId("accumulated-precip-row")).toBeNull();
  });

  it("stops accumulation if there is a gap greater than 1 hour between timestamps", () => {
    const point = (timestamp: string, variable: string, value: number, unit: string): DataPoint => ({
      timestamp,
      variable,
      value,
      unit,
      model: "ICON-D2",
    });
    const ts0 = "2026-09-11T00:00:00.000Z";
    const ts1 = "2026-09-11T01:00:00.000Z";
    const ts3 = "2026-09-11T03:00:00.000Z";
    const data = [ts0, ts1, ts3].flatMap((timestamp, index) => [
      point(timestamp, "temperature", 15, "°C"),
      point(timestamp, "precipitation", index + 1, "mm"),
    ]);
    const { container } = render(
      <Meteogram
        input={toInput({
          data,
          modelChain: baseChain,
          timelineStart: ts0,
          timelineEnd: "2026-09-11T04:00:00.000Z",
        })}
      />,
    );
    const svg = chartSvg(container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 550 });

    // 00:00 and 01:00 belong together (1 + 2 mm), 03:00 stands alone.
    hoverIndex(svg, 4, 1);
    expect(screen.getByTestId("accumulated-precip-val").textContent).toBe("3 mm");
    hoverIndex(svg, 4, 3);
    expect(screen.getByTestId("accumulated-precip-val").textContent).toBe("3 mm");
    hoverIndex(svg, 4, 3.5);
    expect(screen.getByTestId("hover-cursor-line").getAttribute("data-timestamp")).toBe(ts3);
  });
});
