import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PrecipitationCloudArea } from "./PrecipitationCloudArea";
import type { MeteogramLayout } from "../MeteogramChart";

describe("PrecipitationCloudArea Component", () => {
  const dummyLayout: MeteogramLayout = {
    mode: "embedded",
    renderedWidth: 1000,
    renderedHeight: 450,
    windIconScaleX: 1,
    windIconScaleY: 1,
    windIconFootprint: 18,
  };

  it("renders precipitation bars, probability path, and altitude labels when hasDetailedCloud is true", () => {
    render(
      <svg>
        <PrecipitationCloudArea
          paddingLeft={50}
          paddingRight={50}
          svgWidth={1000}
          combinedPlotTop={185}
          combinedPlotHeight={135}
          combinedPlotBottom={320}
          hasDetailedCloud={true}
          maxAltitudeKm={12}
          combinedClipId="combined-clip"
          probabilityClipId="prob-clip"
          timestamps={[1000, 2000]}
          timeline={{
            intervalToGeometry: (ts) => ({
              x: ts === 1000 ? 50 : 100,
              width: 20,
            }),
            xToTimestamp: (x) => x * 10,
          }}
          vcloudMap={new Map()}
          getAltitudeY={(alt) => 320 - alt * 10}
          draggedCloudX={null}
          cloudTransitionXs={[]}
          precipValues={[2.5, 0]}
          precipAxisMax={5}
          precipitationProbabilityPath="M 50 300 L 100 280"
          thunderstormIcons={[]}
          layout={dummyLayout}
          instance="embedded"
          getX={(ts) => ts / 10}
        />
      </svg>,
    );

    expect(screen.getByTestId("panel-combined-precip-clouds")).toBeTruthy();
    expect(screen.getByTestId("cloud-profile-layer")).toBeTruthy();
    expect(screen.getByTestId("precip-bar")).toBeTruthy();
    expect(screen.getByTestId("precip-probability-path")).toBeTruthy();
    expect(screen.getByTestId("cloud-altitude-label-12")).toBeTruthy();
    expect(screen.getByTestId("cloud-altitude-label-0")).toBeTruthy();
    expect(screen.getByText("5.0 mm")).toBeTruthy();
    expect(screen.getByText("0 mm")).toBeTruthy();
  });

  it("omits cloud profile layer and altitude labels when hasDetailedCloud is false", () => {
    render(
      <svg>
        <PrecipitationCloudArea
          paddingLeft={50}
          paddingRight={50}
          svgWidth={1000}
          combinedPlotTop={185}
          combinedPlotHeight={135}
          combinedPlotBottom={320}
          hasDetailedCloud={false}
          maxAltitudeKm={12}
          combinedClipId="combined-clip"
          probabilityClipId="prob-clip"
          timestamps={[1000]}
          timeline={{
            intervalToGeometry: () => ({ x: 50, width: 20 }),
            xToTimestamp: (x) => x,
          }}
          vcloudMap={new Map()}
          getAltitudeY={(alt) => 320 - alt * 10}
          draggedCloudX={null}
          cloudTransitionXs={[]}
          precipValues={[0]}
          precipAxisMax={2.5}
          precipitationProbabilityPath="M 50 300"
          thunderstormIcons={[]}
          layout={dummyLayout}
          instance="embedded"
          getX={(ts) => ts}
        />
      </svg>,
    );

    expect(screen.queryByTestId("cloud-profile-layer")).toBeNull();
    expect(screen.queryByTestId("cloud-altitude-label-12")).toBeNull();
  });
});
