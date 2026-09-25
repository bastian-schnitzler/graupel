import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ChartTooltip } from "./ChartTooltip";
import React from "react";

describe("ChartTooltip", () => {
  const dummyDate = new Date("2026-09-16T12:00:00Z");
  const dummyParts = { hour: "14", minute: "00" };
  const dummyPos = { top: 100, left: 200 };
  const popupRef = React.createRef<HTMLDivElement>();

  const createPoint = (variable: string, value: number, unit: string = "") => ({
    timestamp: "2026-09-16T12:00:00Z",
    variable,
    value,
    unit,
    model: "ICON-D2",
  });

  const dummyData = {
    temperature: createPoint("temperature", 18.5, "°C"),
    apparent_temperature: createPoint("apparent_temperature", 17.2, "°C"),
    wind_speed: createPoint("wind_speed", 22, "km/h"),
    wind_gusts: createPoint("wind_gusts", 35, "km/h"),
    wind_direction: createPoint("wind_direction", 270, "°"),
    precipitation: createPoint("precipitation", 1.5, "mm"),
    precipitation_probability: createPoint(
      "precipitation_probability",
      65,
      "%",
    ),
    cape: createPoint("cape", 120, "J/kg"),
    convective_inhibition: createPoint("convective_inhibition", -25, "J/kg"),
    weather_code: createPoint("weather_code", 3, ""),
  };

  it("renders weather variables, model title, and accumulated precip when visible", () => {
    render(
      <ChartTooltip
        isFullscreen={false}
        hoverData={dummyData}
        hoverX={150}
        hoverDateObj={dummyDate}
        hoverDateParts={dummyParts}
        popupPos={dummyPos}
        popupRef={popupRef}
        hoverTimestamp={dummyDate.getTime()}
        accumulatedPrecip={5.25}
        lpiValue={15}
      />,
    );

    expect(screen.getByText("ICON-D2")).toBeTruthy();
    expect(screen.getByText("18.5 °C")).toBeTruthy();
    expect(screen.getByText("17.2 °C")).toBeTruthy();
    expect(screen.getByText("22 km/h")).toBeTruthy();
    expect(screen.getByText("35 km/h")).toBeTruthy();
    expect(screen.getByText(/270° W/)).toBeTruthy();
    expect(screen.getByText("65 %")).toBeTruthy();
    expect(screen.getByText("1.5 mm")).toBeTruthy();
    expect(screen.getByText("120 J/kg")).toBeTruthy();
    expect(screen.getByText("-25 J/kg")).toBeTruthy();
    expect(screen.getByText("15 J/kg")).toBeTruthy();
    expect(screen.getByTestId("accumulated-precip-val").textContent).toBe(
      "5.25 mm",
    );
  });

  it("does not render when isFullscreen is true", () => {
    render(
      <ChartTooltip
        isFullscreen={true}
        hoverData={dummyData}
        hoverX={150}
        hoverDateObj={dummyDate}
        hoverDateParts={dummyParts}
        popupPos={dummyPos}
        popupRef={popupRef}
        hoverTimestamp={dummyDate.getTime()}
        accumulatedPrecip={5.25}
      />,
    );

    expect(screen.queryByText("ICON-D2")).toBeNull();
  });

  it("does not render when hoverData is null", () => {
    render(
      <ChartTooltip
        isFullscreen={false}
        hoverData={null}
        hoverX={150}
        hoverDateObj={dummyDate}
        hoverDateParts={dummyParts}
        popupPos={dummyPos}
        popupRef={popupRef}
        hoverTimestamp={dummyDate.getTime()}
        accumulatedPrecip={null}
      />,
    );

    expect(screen.queryByText("ICON-D2")).toBeNull();
  });
});
