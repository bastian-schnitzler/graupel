import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConvectionArea } from "./ConvectionArea";

describe("ConvectionArea Component", () => {
  it("renders CAPE/CIN labels, zero line, and CAPE/CIN bars", () => {
    render(
      <svg>
        <ConvectionArea
          paddingLeft={50}
          outerLeftX={50}
          outerRightX={970}
          convectiveTop={410}
          convectiveZero={450}
          convectiveBottom={490}
          convectiveHalfHeight={40}
          capeMax={1000}
          cinMax={200}
          convectiveClipId="conv-clip"
          lpiClipId="lpi-clip"
          timestamps={[1000, 2000]}
          timeline={{
            intervalToGeometry: (ts) => ({
              x: ts === 1000 ? 50 : 100,
              width: 20,
            }),
          }}
          capeValues={[500, 0]}
          cinValues={[0, -100]}
          lpiSegments={[{ path: "M 50 440 L 100 420", model: "ICON-D2" }]}
        />
      </svg>,
    );

    expect(screen.getByTestId("panel-convective")).toBeTruthy();
    expect(screen.getByText("CAPE")).toBeTruthy();
    expect(screen.getByText("CIN")).toBeTruthy();
    expect(screen.getByText("1000 J/kg")).toBeTruthy();
    expect(screen.getByText("−200 J/kg")).toBeTruthy();
    expect(screen.getByTestId("convective-zero-line")).toBeTruthy();
    expect(screen.getByTestId("cape-bar")).toBeTruthy();
    expect(screen.getByTestId("cin-bar")).toBeTruthy();
    expect(screen.getByTestId("lpi-layer")).toBeTruthy();
    expect(screen.getByTestId("lpi-path")).toBeTruthy();
  });
});
