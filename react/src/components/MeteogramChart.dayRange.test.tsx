import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeteogramChart } from "./MeteogramChart";
import type { DataPoint } from "../types";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 19);

function chartProps(days: number) {
  const data: DataPoint[] = [];
  for (let h = 0; h < days * 24; h++) {
    data.push({
      timestamp: new Date(START + h * HOUR).toISOString(),
      variable: "temperature",
      value: 10,
      unit: "°C",
      model: "ECMWF",
    });
  }
  return {
    data,
    modelChain: [{ name: "ECMWF", max_forecast_horizon_hours: days * 24 }],
    timelineStart: new Date(START).toISOString(),
    timelineEnd: new Date(START + days * DAY).toISOString(),
    forecastStartTime: new Date(START + DAY + 6 * HOUR).toISOString(),
    userTimezone: "UTC",
  };
}

const visible = (mode: "embedded" | "fullscreen") => {
  const svg = document.querySelector(`svg[data-render-mode="${mode}"]`)!;
  return [
    Date.parse(svg.getAttribute("data-visible-start-time")!),
    Date.parse(svg.getAttribute("data-visible-end-time")!),
  ];
};

const pressed = (group: HTMLElement) =>
  within(group)
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

describe("day-range buttons (spec §16.1, #162)", () => {
  it("sets the visible range from the timeline start and highlights the button", () => {
    const onChoice = vi.fn();
    render(<MeteogramChart {...chartProps(16)} onDayRangeChoiceChange={onChoice} />);
    const group = screen.getByTestId("day-range-buttons");
    // Whole forecast at first: "All" is highlighted.
    expect(pressed(group)).toEqual(["All"]);

    for (const [label, days] of [["4d", 4], ["7d", 7], ["10d", 10], ["14d", 14]] as const) {
      fireEvent.click(within(group).getByRole("button", { name: label }));
      expect(visible("embedded")).toEqual([START, START + days * DAY]);
      expect(pressed(group)).toEqual([label]);
    }
    fireEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(visible("embedded")).toEqual([START, START + 16 * DAY]);
    expect(onChoice).toHaveBeenLastCalledWith(null);
  });

  it("clamps when fewer days are available", () => {
    render(<MeteogramChart {...chartProps(5)} />);
    const group = screen.getByTestId("day-range-buttons");
    fireEvent.click(within(group).getByRole("button", { name: "7d" }));
    expect(visible("embedded")).toEqual([START, START + 5 * DAY]);
    // 7d, 14d and All cover the same 5 days: the chosen one stays lit.
    expect(pressed(group)).toEqual(["7d"]);
  });

  it("shows the same range in fullscreen", () => {
    render(<MeteogramChart {...chartProps(16)} />);
    fireEvent.click(
      within(screen.getByTestId("day-range-buttons")).getByRole("button", { name: "4d" }),
    );
    fireEvent.doubleClick(document.querySelector(".meteogram-redesign-container")!);
    const fullscreen = screen.getByTestId("fullscreen-day-range-buttons");
    expect(visible("fullscreen")).toEqual([START, START + 4 * DAY]);
    expect(pressed(fullscreen)).toEqual(["4d"]);
    fireEvent.click(within(fullscreen).getByRole("button", { name: "10d" }));
    expect(visible("fullscreen")).toEqual([START, START + 10 * DAY]);
    expect(visible("embedded")).toEqual([START, START + 10 * DAY]);
  });

  it("starts a new forecast with the remembered choice", () => {
    render(<MeteogramChart {...chartProps(16)} dayRangeChoice={7} />);
    expect(visible("embedded")).toEqual([START, START + 7 * DAY]);
    expect(pressed(screen.getByTestId("day-range-buttons"))).toEqual(["7d"]);
  });
});
