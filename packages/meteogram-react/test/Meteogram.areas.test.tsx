// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Area features through `<Meteogram>` (sun times, thunderstorms, convection). The stitched series is built by
 * hand (stitching is DL's `mergeForecastSegments`), model metadata comes
 * through the chain or `availableModels`, fullscreen cases stay with the app.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataPoint, MeteogramInput } from "@graupel/meteogram";
import { Meteogram } from "../src";
import { DAY, HOUR, chartSvg, hoverAt, mockRect, toInput } from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sunrise / sunset times in the chart (#171)", () => {
  const START = Date.UTC(2026, 9, 19);
  const DAYS = 4;

  function input(): MeteogramInput {
    const data: DataPoint[] = [];
    for (let h = 0; h < DAYS * 24; h++) {
      data.push({
        timestamp: new Date(START + h * HOUR).toISOString(),
        variable: "temperature",
        value: 10 + 5 * Math.sin((h / 24) * 2 * Math.PI),
        unit: "°C",
        model: "ECMWF",
      });
    }
    return toInput({
      data,
      modelChain: [{ name: "ECMWF", max_forecast_horizon_hours: DAYS * 24 }],
      timelineStart: new Date(START).toISOString(),
      timelineEnd: new Date(START + DAYS * DAY).toISOString(),
      forecastStartTime: new Date(START + DAY + 6 * HOUR).toISOString(),
      userTimezone: "UTC",
      sunPhases: Array.from({ length: DAYS }, (_, i) => ({
        day: new Date(START + i * DAY).toISOString().slice(0, 10),
        sunrise: new Date(START + i * DAY + 6.5 * HOUR).toISOString(),
        sunset: new Date(START + i * DAY + 18.25 * HOUR).toISOString(),
      })),
    });
  }

  const texts = (selector: string) =>
    Array.from(document.querySelectorAll(`svg.meteogram-svg-integrated ${selector}`)).map(
      (el) => `${el.getAttribute("data-day")} ${el.textContent}`,
    );

  it("draws them in the temperature area of the built-in layout", () => {
    render(<Meteogram input={input()} />);
    expect(texts('[data-testid="sunrise"]')).toEqual(["2026-10-19 06:30", "2026-10-22 06:30"]);
    expect(texts('[data-testid="sunset"]')).toEqual(["2026-10-19 18:15", "2026-10-22 18:15"]);
    const group = document.querySelector('[data-testid="sun-time-labels"]')!;
    const panel = group.closest('[data-area-id="temp"]')!;
    expect(panel).toBeTruthy();
    // Background: in the frame grey, before (behind) curves and min/max labels.
    expect(group.querySelector("text")?.getAttribute("fill")).toBe("#cbd5e1");
    const order = Array.from(panel.querySelectorAll("[data-testid]")).map((el) => el.getAttribute("data-testid"));
    expect(order.indexOf("sun-time-labels")).toBeLessThan(order.indexOf("daily-max-temp"));
    expect(order.indexOf("sun-time-labels")).toBeLessThan(order.indexOf("temperature-path"));
  });

  it("draws nothing with the area option off", () => {
    render(
      <Meteogram
        input={input()}
        options={{
          layout: {
            id: "own",
            name: "Own",
            areas: [
              {
                id: "temp",
                sunTimes: false,
                series: [{ quantity: "temperature", style: "line", extremeLabels: true }],
              },
            ],
          },
        }}
      />,
    );
    expect(document.querySelector('[data-testid="sun-time-labels"]')).toBeNull();
  });
});

describe("thunderstorm chart integration", () => {
  const start = "2026-01-01T00:00:00Z";
  const origin = Date.parse(start);
  const chain = [
    { name: "A", max_forecast_horizon_hours: 10 },
    { name: "B", max_forecast_horizon_hours: 24 },
  ];
  const point = (h: number, value: number | null, model = "A", variable = "weather_code"): DataPoint => ({
    timestamp: new Date(origin + h * HOUR).toISOString(),
    variable,
    value,
    model,
    unit: "",
  });
  const data = Array.from({ length: 48 }, (_, h) => [
    point(h, 95),
    point(h, 10, "A", "temperature"),
    point(h, 90, "A", "wind_direction"),
  ]).flat();
  const chartInput = (series: DataPoint[]) => toInput({ data: series, modelChain: chain, forecastStartTime: start });

  it("shares wind centers and renders above cloud/precipitation without changing height", () => {
    const { container, rerender } = render(<Meteogram input={chartInput(data)} />);
    const height = chartSvg(container).getAttribute("viewBox");
    const centers = Array.from(container.querySelectorAll('[data-testid="wind-arrow-group"]')).map((el) =>
      el.getAttribute("data-center-x"),
    );
    const icons = container.querySelectorAll('[data-testid="thunderstorm-icon"]');
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(centers).toContain(icon.getAttribute("data-center-x"));
    const layer = screen.getByTestId("thunderstorm-layer");
    expect(
      screen.getByTestId("precipitation-probability-layer").compareDocumentPosition(layer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    rerender(<Meteogram input={chartInput(data.filter((p) => p.variable !== "weather_code"))} />);
    expect(chartSvg(container).getAttribute("viewBox")).toBe(height);
    expect(container.querySelectorAll('[data-testid="thunderstorm-icon"]')).toHaveLength(0);
  });

  it("responds to wheel zoom with new icon slots", () => {
    const { container } = render(<Meteogram input={chartInput(data)} />);
    const signature = () =>
      Array.from(container.querySelectorAll('[data-testid="thunderstorm-icon"]')).map((el) => [
        el.getAttribute("data-interval-start"),
        el.getAttribute("data-interval-end"),
        el.getAttribute("data-weather-code"),
      ]);
    const before = signature();
    fireEvent.wheel(chartSvg(container), { deltaY: -100 });
    expect(signature()).not.toEqual(before);
  });

  it("does not warn for absent weather codes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Meteogram input={chartInput(data.filter((p) => p.variable !== "weather_code"))} />);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("convective area", () => {
  const start = "2026-09-11T00:00:00Z";
  const timestamp = (hour: number) => new Date(Date.parse(start) + hour * HOUR).toISOString();
  // Alpha +0–2 h, Beta +2–4 h (no LPI), Gamma +4–6 h.
  const chain = [
    { model: "Alpha", id: "alpha", sliceEndHours: 2, supportedVariables: ["cape", "convective_inhibition", "lightning_potential"] },
    { model: "Beta", id: "beta", sliceEndHours: 4, supportedVariables: ["cape", "convective_inhibition"] },
    { model: "Gamma", id: "gamma", sliceEndHours: 6, supportedVariables: ["cape", "convective_inhibition", "lightning_potential"] },
  ];
  const variables = ["temperature", "precipitation", "cape", "convective_inhibition", "lightning_potential"];

  function input(): MeteogramInput {
    const series: DataPoint[] = [];
    for (let hour = 0; hour < 6; hour++) {
      const modelIndex = Math.floor(hour / 2);
      const model = chain[modelIndex]!.model;
      for (const variable of variables) {
        if (modelIndex === 1 && variable === "lightning_potential") continue;
        series.push({
          timestamp: timestamp(hour),
          variable,
          model,
          unit: variable === "temperature" ? "°C" : "J/kg",
          value:
            variable === "cape"
              ? 5000 + modelIndex * 1000
              : variable === "convective_inhibition"
                ? hour % 2
                  ? -50
                  : 50
                : variable === "lightning_potential"
                  ? hour % 2
                    ? 60
                    : 15
                  : 10,
        });
      }
    }
    return { chain, series, timeline: { start, end: timestamp(6), now: start } };
  }

  function setup() {
    const result = render(<Meteogram input={input()} />);
    const svg = chartSvg(result.container);
    mockRect(svg, { left: 0, top: 0, width: 1000, height: 544 });
    return { ...result, svg };
  }

  it("extends shared crosshairs and decorations through the panel", () => {
    const { svg } = setup();
    hoverAt(svg, 400, 450);
    const bottom = Number(svg.querySelector('[data-edge="convective-bottom"]')!.getAttribute("y1"));
    expect(Number(svg.querySelector('[data-testid="hover-cursor-line"]')!.getAttribute("y2"))).toBe(bottom);
    svg
      .querySelectorAll('[data-testid="model-boundary-line"]')
      .forEach((line) => expect(Number(line.getAttribute("y2"))).toBe(bottom));
    expect(svg.querySelector('[data-area="convective"]')).not.toBeNull();
  });

  it("shows uncapped LPI in the normal hover popup and omits it on a model without LPI", () => {
    const { svg } = setup();
    hoverAt(svg, 250, 450);
    expect(screen.getByTestId("tooltip-lpi").textContent).toContain("60 J/kg");
    hoverAt(svg, 550, 450);
    expect(screen.queryByTestId("tooltip-lpi")).toBeNull();
  });

  it("omits LPI completely and emits no capability warning when the chain says unsupported", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = input();
    const { container } = render(
      <Meteogram
        input={{
          ...base,
          chain: base.chain.map((model) => ({ ...model, supportedVariables: ["cape", "convective_inhibition"] })),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="lpi-layer"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="cape-bar"]')).toHaveLength(6);
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves LPI from catalogue ids in availableModels despite case differences", () => {
    const base = input();
    const { container } = render(
      <Meteogram
        input={{
          ...base,
          chain: base.chain.map((model) => ({ model: model.model, id: model.id, sliceEndHours: model.sliceEndHours })),
        }}
        options={{
          availableModels: {
            other: {
              name: "ALPHA",
              id: "ALPHA",
              max_forecast_horizon_hours: 2,
              supported_variables: ["cape", "convective_inhibition", "lightning_potential"],
            },
          },
        }}
      />,
    );
    expect(container.querySelectorAll('[data-testid="lpi-path"]')).toHaveLength(1);
  });
});
