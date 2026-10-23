import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeteogramChart } from "./MeteogramChart";
import type { DataPoint, WeatherModel } from "../types";
import type { TimeRange } from "../utils/meteogramZoom";

const chain: WeatherModel[] = [
  { name: "ICON-EU", max_forecast_horizon_hours: 48 },
];

const makeData = (hours: number): DataPoint[] => {
  const start = Date.parse("2026-09-11T00:00:00Z");
  const points: DataPoint[] = [];
  for (let h = 0; h < hours; h++) {
    const timestamp = new Date(start + h * 3600_000).toISOString();
    points.push(
      { timestamp, variable: "temperature", value: 10, unit: "°C", model: "ICON-EU" },
      { timestamp, variable: "wind_speed", value: 12, unit: "km/h", model: "ICON-EU" },
    );
  }
  return points;
};

describe("MeteogramChart state handling", () => {
  it("switches between data and the empty state without breaking hook order", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(
      <MeteogramChart data={makeData(48)} modelChain={chain} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();

    rerender(<MeteogramChart data={[]} modelChain={chain} />);
    expect(
      screen.getByText("No forecast data available for the selected parameters."),
    ).toBeTruthy();

    rerender(<MeteogramChart data={makeData(48)} modelChain={chain} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes("hooks"),
      ),
    ).toBe(false);
    errors.mockRestore();
  });

  it("restores a persisted zoom range and reports range changes", () => {
    const start = Date.parse("2026-09-11T06:00:00Z");
    const persisted: TimeRange = { start, end: start + 12 * 3600_000 };
    const onChange = vi.fn();
    render(
      <MeteogramChart
        data={makeData(48)}
        modelChain={chain}
        timelineStart="2026-09-11T00:00:00Z"
        timelineEnd="2026-09-13T00:00:00Z"
        getPersistedVisibleRange={() => persisted}
        onVisibleRangeChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenLastCalledWith(persisted);
  });
});
