import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TimelineOverlay } from "./TimelineOverlay";

describe("TimelineOverlay Component", () => {
  it("renders day label cells, noon grid lines, separator borders, and model boundary lines", () => {
    render(
      <svg>
        <TimelineOverlay
          dayGroups={[
            {
              dayKey: "2026-09-16",
              firstX: 50,
              rightX: 300,
              blockWidth: 250,
              isEven: true,
              isBoundaryVisible: true,
              boundaryX: 50,
              dateLabel: "16.09.",
              weekdayLabel: "Wed",
            },
          ]}
          noonPositions={[{ dayKey: "2026-09-16", x: 175 }]}
          modelSegments={[
            { name: "ICON-D2", startX: 50 },
            { name: "GFS", startX: 500 },
          ]}
          dayHeaderTop={10}
          dayHeaderBottom={35}
          dayHeaderHeight={25}
          tempBottom={185}
          combinedPlotTop={185}
          combinedPlotBottom={320}
          combinedPlotHeight={135}
          windTop={320}
          windBottom={410}
          windHeight={90}
          convectiveTop={410}
          convectiveBottom={490}
          convectiveHalfHeight={40}
          outerLeftX={50}
          outerRightX={950}
          paddingLeft={50}
          paddingRight={50}
          svgWidth={1000}
          modelHeaderBoxBottom={35}
          hasDetailedCloud={true}
          locElevationKm={1.5}
          groundY={305}
          graphWidth={900}
          locationName="Mount Test"
          timeline={{ xToTimestamp: (x) => x * 1000 }}
        />
      </svg>,
    );

    expect(screen.getByTestId("day-label-cell")).toBeTruthy();
    expect(screen.getByText("Wed 16.09.")).toBeTruthy();
    expect(screen.getAllByTestId("day-separator-line").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByTestId("noon-grid-line").length).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("chart-area-horizontal-border").length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("terrain-mask")).toBeTruthy();
    expect(screen.getByTestId("terrain-mask-label").textContent).toContain(
      "1.5 km — Mount Test",
    );
    expect(screen.getByTestId("model-boundary-line")).toBeTruthy();
  });
});
