import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WindArea } from "./WindArea";
import type { MeteogramLayout } from "../MeteogramChart";

describe("WindArea Component", () => {
  const dummyLayout: MeteogramLayout = {
    mode: "embedded",
    renderedWidth: 1000,
    renderedHeight: 450,
    windIconScaleX: 1,
    windIconScaleY: 1,
    windIconFootprint: 18,
  };

  it("renders wind axis labels, speed/gust curves, and wind direction icons", () => {
    const { container } = render(
      <svg>
        <WindArea
          paddingLeft={50}
          windTop={320}
          windHeight={90}
          windBottom={410}
          maxWind={60}
          windClipId="wind-clip"
          windSpeedPath="M 50 380 L 100 360"
          windGustsPath="M 50 350 L 100 330"
          windIcons={[
            {
              id: "wind-1",
              x: 100,
              timestamp: "2026-09-16T12:00:00Z",
              arrowAngle: 180,
              dir: 180,
            },
          ]}
          layout={dummyLayout}
          instance="embedded"
        />
      </svg>,
    );

    expect(screen.getByText("60 km/h")).toBeTruthy();
    expect(screen.getByText("0 km/h")).toBeTruthy();
    expect(screen.getByTestId("wind-speed-path")).toBeTruthy();
    expect(screen.getByTestId("wind-gusts-path")).toBeTruthy();
    expect(screen.getByTestId("wind-arrow-group")).toBeTruthy();
    expect(screen.getByTestId("wind-arrow")).toBeTruthy();
    expect(container.querySelector(".panel-wind")).toBeTruthy();
  });
});
