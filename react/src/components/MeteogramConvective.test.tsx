import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeteogramChart } from "./MeteogramChart";
import { mergeForecastSegments } from "../services/apiService";
import type { DataPoint, WeatherModel } from "../types";

const start = "2026-09-11T00:00:00Z";
const timestamp = (hour: number) =>
  new Date(Date.parse(start) + hour * 3600000).toISOString();
const chain: WeatherModel[] = [
  { name: "Alpha", id: "alpha", max_forecast_horizon_hours: 2 },
  { name: "Beta", id: "beta", max_forecast_horizon_hours: 4 },
  { name: "Gamma", id: "gamma", max_forecast_horizon_hours: 6 },
];
const metadata = Object.fromEntries(
  chain.map((m, i) => [
    m.id!,
    {
      ...m,
      supported_variables:
        i === 1
          ? ["cape", "convective_inhibition"]
          : ["cape", "convective_inhibition", "lightning_potential"],
    },
  ]),
);
const variables = [
  "temperature",
  "precipitation",
  "cape",
  "convective_inhibition",
  "lightning_potential",
];
function fixture() {
  const forecasts = Object.fromEntries(
    chain.map((model, modelIndex) => [
      model.name,
      Array.from({ length: 6 }, (_, hour) =>
        variables
          .filter((v) => modelIndex !== 1 || v !== "lightning_potential")
          .map((variable) => ({
            timestamp: timestamp(hour),
            variable,
            model: model.name,
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
          })),
      ).flat(),
    ]),
  ) as Record<string, DataPoint[]>;
  const data = mergeForecastSegments(
    chain,
    forecasts,
    variables,
    start,
    start,
    timestamp(6),
  );
  return { forecasts, data };
}
function setup(fullscreen = false) {
  const { forecasts, data } = fixture();
  const raw = JSON.stringify(forecasts);
  const result = render(
    <MeteogramChart
      data={data}
      modelChain={chain}
      availableModels={metadata}
      modelForecasts={forecasts}
      forecastStartTime={start}
      timelineStart={start}
      timelineEnd={timestamp(6)}
    />,
  );
  if (fullscreen)
    fireEvent.doubleClick(
      result.container.querySelector(".meteogram-redesign-container")!,
    );
  const svg = fullscreen
    ? screen.getByTestId("fullscreen-chart-area").querySelector("svg")!
    : result.container.querySelector("svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 544,
    width: 1000,
    height: 544,
    toJSON: () => ({}),
  });
  return { ...result, svg, forecasts, data, raw };
}
const number = (element: Element, attr: string) =>
  Number(element.getAttribute(attr));
const points = (path: Element) =>
  [...path.getAttribute("d")!.matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)].map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]) }),
  );

describe.each([false, true])("Convective chart fullscreen=%s", (fullscreen) => {
  it("plots CAPE and either CIN sign from the same zero with readable independent halves", () => {
    const { svg } = setup(fullscreen);
    const zero = number(
      svg.querySelector('[data-testid="convective-zero-line"]')!,
      "y1",
    );
    const cape = [...svg.querySelectorAll('[data-testid="cape-bar"]')];
    const cin = [...svg.querySelectorAll('[data-testid="cin-bar"]')];
    expect(cape).toHaveLength(6);
    expect(cin).toHaveLength(6);
    cape.forEach((bar) => {
      expect(number(bar, "y")).toBeLessThan(zero);
      expect(number(bar, "y") + number(bar, "height")).toBeCloseTo(zero, 10);
    });
    cin.forEach((bar) => {
      expect(number(bar, "y")).toBe(zero);
      expect(number(bar, "height")).toBeGreaterThan(50);
    });
    expect(number(cin[0], "height")).toBe(number(cin[1], "height"));
  });
  it("uses fixed independent LPI scale, caps only positions, and preserves exact hourly X alignment", () => {
    const { svg, forecasts, raw } = setup(fullscreen);
    const path = svg.querySelector('[data-testid="lpi-path"]')!;
    expect(path.getAttribute("data-scale-min")).toBe("0");
    expect(path.getAttribute("data-scale-max")).toBe("30");
    const top = number(path, "data-scale-top");
    const zero = number(path, "data-scale-bottom");
    const p = points(path);
    expect(p[0].y).toBe((top + zero) / 2);
    expect(p[1].y).toBe(top);
    svg.querySelectorAll('[data-testid="lpi-path"]').forEach((line) =>
      points(line).forEach((point) => {
        expect(point.y).toBeGreaterThanOrEqual(top);
        expect(point.y).toBeLessThanOrEqual(zero);
      }),
    );
    expect(JSON.stringify(forecasts)).toBe(raw);
    for (const variable of ["cape", "cin", "precip"]) {
      const bars = [...svg.querySelectorAll(`[data-testid="${variable}-bar"]`)];
      expect(bars.map((b) => b.getAttribute("data-timestamp"))).toEqual(
        Array.from({ length: 6 }, (_, h) => timestamp(h)),
      );
      expect(bars.map((b) => number(b, "x"))).toEqual(
        Array.from({ length: 6 }, (_, h) => 50 + (h / 6) * 900),
      );
    }
    expect(p[0].x).toBe(50);
    expect(p[1].x).toBe(
      number(svg.querySelectorAll('[data-testid="cape-bar"]')[1], "x"),
    );
  });
  it("stops LPI exactly at unsupported handover and starts a separate later segment", () => {
    const { svg } = setup(fullscreen);
    const paths = [...svg.querySelectorAll('[data-testid="lpi-path"]')];
    expect(paths).toHaveLength(2);
    expect(paths.map((p) => p.getAttribute("data-model"))).toEqual([
      "Alpha",
      "Gamma",
    ]);
    const boundary = svg.querySelector('[data-testid="model-boundary-line"]')!;
    expect(points(paths[0]).at(-1)!.x).toBe(number(boundary, "x1"));
    expect(points(paths[1])[0].x).toBe(50 + (4 / 6) * 900);
    paths.forEach((path) =>
      points(path).forEach((p) =>
        expect(p.x <= 50 + (2 / 6) * 900 || p.x >= 50 + (4 / 6) * 900).toBe(
          true,
        ),
      ),
    );
  });
  it("extends shared crosshairs and decorations through the panel and keeps zoom synchronized", () => {
    const { svg, container } = setup(fullscreen);
    fireEvent.mouseMove(svg, { clientX: 400, clientY: 450 });
    const bottom = number(
      svg.querySelector('[data-edge="convective-bottom"]')!,
      "y1",
    );
    expect(
      number(svg.querySelector('[data-testid="hover-cursor-line"]')!, "y2"),
    ).toBe(bottom);
    svg
      .querySelectorAll('[data-testid="model-boundary-line"]')
      .forEach((line) => expect(number(line, "y2")).toBe(bottom));
    expect(svg.querySelector('[data-area="convective"]')).not.toBeNull();
    fireEvent.wheel(svg, { deltaY: -100 });
    if (fullscreen)
      expect(svg.getAttribute("data-visible-end-time")).toBe(
        container.querySelector("svg")!.getAttribute("data-visible-end-time"),
      );
  });
});

it("omits LPI completely and emits no capability warning when metadata says unsupported", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { data } = fixture();
  const { container } = render(
    <MeteogramChart
      data={data}
      modelChain={chain.map((m) => ({
        ...m,
        supported_variables: ["cape", "convective_inhibition"],
      }))}
      forecastStartTime={start}
      timelineStart={start}
      timelineEnd={timestamp(6)}
    />,
  );
  expect(container.querySelector('[data-testid="lpi-layer"]')).toBeNull();
  expect(container.querySelectorAll('[data-testid="cape-bar"]')).toHaveLength(
    6,
  );
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
it("resolves LPI from dynamic catalogue IDs despite case differences and absent saved capabilities", () => {
  const { data } = fixture();
  const { container } = render(
    <MeteogramChart
      data={data}
      modelChain={chain}
      availableModels={{
        other: { ...metadata.alpha, name: "ALPHA", id: "ALPHA" },
      }}
      forecastStartTime={start}
      timelineStart={start}
      timelineEnd={timestamp(6)}
    />,
  );
  expect(container.querySelectorAll('[data-testid="lpi-path"]')).toHaveLength(
    1,
  );
});
it("never borrows a convective missing sample from another main-chain model", () => {
  const { forecasts } = fixture();
  forecasts.Alpha = forecasts.Alpha.filter(
    (p) =>
      !(
        p.timestamp === timestamp(1) &&
        ["cape", "convective_inhibition", "lightning_potential"].includes(
          p.variable,
        )
      ),
  );
  const merged = mergeForecastSegments(
    chain,
    forecasts,
    variables,
    start,
    start,
    timestamp(6),
  );
  for (const variable of [
    "cape",
    "convective_inhibition",
    "lightning_potential",
  ]) {
    expect(
      merged.find(
        (p) => p.timestamp === timestamp(1) && p.variable === variable,
      )?.value,
    ).toBeNull();
  }
});
it("does not show LPI in fullscreen details but shows CAPE and CIN", () => {
  const { svg } = setup(true);
  fireEvent.mouseMove(svg, { clientX: 250, clientY: 450 });
  expect(screen.queryByTestId("fullscreen-detail-lpi")).toBeNull();
  expect(screen.getByTestId("fullscreen-detail-cape").textContent).toContain(
    "5000 J/kg",
  );
  expect(screen.getByTestId("fullscreen-detail-cin").textContent).toContain(
    "-50 J/kg",
  );
  fireEvent.mouseMove(svg, { clientX: 550, clientY: 450 });
  expect(screen.queryByTestId("fullscreen-detail-lpi")).toBeNull();
});

it("moves convective handover with chain resizing while retaining the canonical timeline and axis ranges", () => {
  const { forecasts, data } = fixture();
  const { container, rerender } = render(
    <MeteogramChart
      data={data}
      modelChain={chain}
      availableModels={metadata}
      modelForecasts={forecasts}
      forecastStartTime={start}
      timelineStart={start}
      timelineEnd={timestamp(6)}
    />,
  );
  const before = container
    .querySelector('[data-testid="cape-bar"]')!
    .getAttribute("height");
  const changed = chain.map((m, i) =>
    i === 0 ? { ...m, max_forecast_horizon_hours: 3 } : m,
  );
  const resized = mergeForecastSegments(
    changed,
    forecasts,
    variables,
    start,
    start,
    timestamp(6),
  );
  rerender(
    <MeteogramChart
      data={resized}
      modelChain={changed}
      availableModels={metadata}
      modelForecasts={forecasts}
      forecastStartTime={start}
      timelineStart={start}
      timelineEnd={timestamp(6)}
    />,
  );
  const path = container.querySelector('[data-testid="lpi-path"]')!;
  expect(points(path).at(-1)!.x).toBe(
    number(
      container.querySelector('[data-testid="model-boundary-line"]')!,
      "x1",
    ),
  );
  expect(
    container.querySelector('[data-testid="cape-bar"]')!.getAttribute("height"),
  ).toBe(before);
  expect(
    resized.find((p) => p.variable === "cape" && p.timestamp === timestamp(2))!
      .model,
  ).toBe("Alpha");
});
it("uses identical convective geometry in embedded and fullscreen SVGs", () => {
  const { container, svg } = setup(true);
  const embedded = container.querySelector("svg")!;
  for (const selector of [
    '[data-testid="cape-bar"]',
    '[data-testid="cin-bar"]',
    '[data-testid="lpi-path"]',
    '[data-testid="convective-zero-line"]',
  ]) {
    const geometry = (root: Element) =>
      [...root.querySelectorAll(selector)].map((el) =>
        ["x", "y", "width", "height", "d", "y1", "y2"].map((attr) =>
          el.getAttribute(attr),
        ),
      );
    expect(geometry(svg)).toEqual(geometry(embedded));
  }
});
it("shows uncapped LPI in the normal hover popup and omits it on a model without LPI", () => {
  const { svg } = setup();
  fireEvent.mouseMove(svg, { clientX: 250, clientY: 450 });
  expect(screen.getByTestId("tooltip-lpi").textContent).toContain("60 J/kg");
  fireEvent.mouseMove(svg, { clientX: 550, clientY: 450 });
  expect(screen.queryByTestId("tooltip-lpi")).toBeNull();
});
