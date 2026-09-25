import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TemperatureArea } from "./TemperatureArea";

describe("TemperatureArea Component", () => {
  it("renders temperature labels, freezing line when range spans zero, and temperature paths", () => {
    const { container } = render(
      <svg>
        <TemperatureArea
          paddingLeft={50}
          paddingRight={50}
          svgWidth={1000}
          tempTop={35}
          tempHeight={150}
          minTemp={-5}
          maxTemp={25}
          temperatureClipId="temp-clip-test"
          apparentTempPath="M 50 100 L 970 80"
          tempPath="M 50 95 L 970 75"
          dailyExtremes={[
            {
              dayKey: "2026-09-16",
              max: { x: 200, y: 50, text: "25°C", visible: true },
              min: { x: 300, y: 160, text: "-5°C", visible: true },
            },
          ]}
        />
      </svg>,
    );

    expect(screen.getByText("25°")).toBeTruthy();
    expect(screen.getByText("-5°")).toBeTruthy();
    expect(screen.getByTestId("freezing-line")).toBeTruthy();
    expect(screen.getByTestId("temperature-path")).toBeTruthy();
    expect(screen.getByTestId("apparent-temperature-path")).toBeTruthy();
    expect(screen.getByTestId("daily-max-temp").textContent).toBe("25°C");
    expect(screen.getByTestId("daily-min-temp").textContent).toBe("-5°C");
    expect(container.querySelector(".panel-temperature")).toBeTruthy();
  });

  it("omits freezing line when minTemp is strictly greater than 0", () => {
    render(
      <svg>
        <TemperatureArea
          paddingLeft={50}
          paddingRight={50}
          svgWidth={1000}
          tempTop={35}
          tempHeight={150}
          minTemp={5}
          maxTemp={25}
          temperatureClipId="temp-clip-test"
          apparentTempPath="M 50 100 L 970 80"
          tempPath="M 50 95 L 970 75"
          dailyExtremes={[]}
        />
      </svg>,
    );

    expect(screen.queryByTestId("freezing-line")).toBeNull();
  });
});
