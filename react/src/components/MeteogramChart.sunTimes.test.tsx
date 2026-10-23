import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeteogramChart } from "./MeteogramChart";
import type { DataPoint } from "../types";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 19);
const DAYS = 4;

function props() {
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
  return {
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
  };
}

const texts = (selector: string) =>
  Array.from(
    document.querySelectorAll(`svg[data-render-mode="embedded"] ${selector}`),
  ).map((el) => `${el.getAttribute("data-day")} ${el.textContent}`);

describe("sunrise / sunset times in the chart (#171)", () => {
  it("draws them in the temperature area of the built-in layout", () => {
    render(<MeteogramChart {...props()} />);
    expect(texts('[data-testid="sunrise"]')).toEqual([
      "2026-10-19 06:30",
      "2026-10-22 06:30",
    ]);
    expect(texts('[data-testid="sunset"]')).toEqual([
      "2026-10-19 18:15",
      "2026-10-22 18:15",
    ]);
    const group = document.querySelector('[data-testid="sun-time-labels"]')!;
    expect(group.closest('[data-area-id="temp"]')).toBeTruthy();
    // Background: in the frame grey, before (behind) curves and min/max labels.
    expect(group.querySelector("text")?.getAttribute("fill")).toBe("#cbd5e1");
    const panel = group.closest('[data-area-id="temp"]')!;
    const order = Array.from(panel.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order.indexOf("sun-time-labels")).toBeLessThan(
      order.indexOf("daily-max-temp"),
    );
    expect(order.indexOf("sun-time-labels")).toBeLessThan(
      order.indexOf("temperature-path"),
    );
  });

  it("draws nothing with the area option off", () => {
    render(
      <MeteogramChart
        {...props()}
        chartLayout={{
          id: "own",
          name: "Own",
          areas: [
            {
              id: "temp",
              sunTimes: false,
              series: [{ quantity: "temperature", style: "line", extremeLabels: true }],
            },
          ],
        }}
      />,
    );
    expect(document.querySelector('[data-testid="sun-time-labels"]')).toBeNull();
  });
});
