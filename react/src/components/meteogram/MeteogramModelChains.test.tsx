import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeteogramModelChains } from "./MeteogramModelChains";
import type { WeatherModel } from "../../types";

describe("MeteogramModelChains Component", () => {
  const mainChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "GFS", max_forecast_horizon_hours: 384 },
  ];

  const cloudChain: WeatherModel[] = [
    { name: "ECMWF IFS 0.25°", max_forecast_horizon_hours: 120 },
  ];

  it("renders both METEO and CLOUDS labels when cloud chain is non-empty", () => {
    render(
      <MeteogramModelChains
        activeModelChain={mainChain}
        activeCloudModelChain={cloudChain}
        availableModels={{}}
        onModelChainChange={vi.fn()}
        onModelChainResizeEnd={vi.fn()}
        onCloudModelChainChange={vi.fn()}
        onCloudModelChainResizeEnd={vi.fn()}
        onCloudBoundaryDrag={vi.fn()}
      />,
    );

    expect(screen.getByText("METEO")).toBeTruthy();
    expect(screen.getByText("CLOUDS")).toBeTruthy();
    expect(screen.getByText("ICON-D2")).toBeTruthy();
    expect(screen.getByText("GFS")).toBeTruthy();
    expect(screen.getByText("ECMWF IFS 0.25°")).toBeTruthy();
  });

  it("omits CLOUDS builder when cloud model chain is empty", () => {
    render(
      <MeteogramModelChains
        activeModelChain={mainChain}
        activeCloudModelChain={[]}
        availableModels={{}}
        onModelChainChange={vi.fn()}
        onModelChainResizeEnd={vi.fn()}
        onCloudModelChainChange={vi.fn()}
        onCloudModelChainResizeEnd={vi.fn()}
        onCloudBoundaryDrag={vi.fn()}
      />,
    );

    expect(screen.getByText("METEO")).toBeTruthy();
    expect(screen.queryByText("CLOUDS")).toBeNull();
  });

  it("renders collapse buttons and triggers independent collapse toggles", () => {
    const toggleMain = vi.fn();
    const toggleCloud = vi.fn();
    render(
      <MeteogramModelChains
        activeModelChain={mainChain}
        activeCloudModelChain={cloudChain}
        availableModels={{}}
        onModelChainChange={vi.fn()}
        onModelChainResizeEnd={vi.fn()}
        onCloudModelChainChange={vi.fn()}
        onCloudModelChainResizeEnd={vi.fn()}
        onCloudBoundaryDrag={vi.fn()}
        isMainChainCollapsed={false}
        onToggleMainChainCollapse={toggleMain}
        isCloudChainCollapsed={true}
        onToggleCloudChainCollapse={toggleCloud}
      />,
    );

    const mainCollapseBtn = screen.getByTestId("collapse-btn-meteo");
    const cloudCollapseBtn = screen.getByTestId("collapse-btn-clouds");
    expect(mainCollapseBtn).toBeTruthy();
    expect(cloudCollapseBtn).toBeTruthy();

    // Verify collapse button is rendered inside the last model box
    const gfsCard = screen.getByTestId("model-card-GFS");
    expect(gfsCard.contains(mainCollapseBtn)).toBe(true);

    const ecmwfCard = screen.getByTestId("model-card-ECMWF IFS 0.25°");
    expect(ecmwfCard.contains(cloudCollapseBtn)).toBe(true);

    mainCollapseBtn.click();
    expect(toggleMain).toHaveBeenCalledTimes(1);

    cloudCollapseBtn.click();
    expect(toggleCloud).toHaveBeenCalledTimes(1);
  });

  it("renders collapsed single-line card while keeping boundary handles interactive", () => {
    const { container } = render(
      <MeteogramModelChains
        activeModelChain={mainChain}
        activeCloudModelChain={[]}
        availableModels={{}}
        onModelChainChange={vi.fn()}
        onModelChainResizeEnd={vi.fn()}
        onCloudModelChainChange={vi.fn()}
        onCloudModelChainResizeEnd={vi.fn()}
        onCloudBoundaryDrag={vi.fn()}
        isMainChainCollapsed={true}
        onToggleMainChainCollapse={vi.fn()}
      />,
    );

    const chainContainer = container.querySelector(
      ".horizontal-chain-container.is-collapsed",
    );
    expect(chainContainer).toBeTruthy();

    const collapsedCards = container.querySelectorAll(
      ".model-card.model-card-collapsed",
    );
    expect(collapsedCards.length).toBe(2);
    expect(screen.getByText("ICON-D2")).toBeTruthy();
    expect(screen.getByText("GFS")).toBeTruthy();

    // Resize handle between ICON-D2 and GFS is still rendered
    const handle = container.querySelector(".model-resize-handle");
    expect(handle).toBeTruthy();
  });
});
