import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ModelChainBuilder } from "./ModelChainBuilder";
import type { WeatherModel } from "../types";

describe("ModelChainBuilder", () => {
  const sampleChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 36 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { name: "GFS", max_forecast_horizon_hours: 384 },
  ];

  it("renders weather models in horizontal chain sequence", () => {
    render(<ModelChainBuilder modelChain={sampleChain} onChange={() => {}} />);
    expect(screen.getByText("ICON-D2")).toBeTruthy();
    expect(screen.getByText("ICON-EU")).toBeTruthy();
    expect(screen.getByText("GFS")).toBeTruthy();
  });

  const fullChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { name: "GFS", max_forecast_horizon_hours: 384 },
  ];

  it("initially distributes full model boxes equally (33.33% baseline for 3 models)", () => {
    render(<ModelChainBuilder modelChain={fullChain} onChange={() => {}} />);

    const card1 = screen.getByTestId("model-card-ICON-D2");
    const card2 = screen.getByTestId("model-card-ICON-EU");
    const card3 = screen.getByTestId("model-card-GFS");

    // The outer wrapper div gets flex-basis / width of 33.33%
    const wrapper1 = card1.parentElement!;
    const wrapper2 = card2.parentElement!;
    const wrapper3 = card3.parentElement!;

    expect(wrapper1.style.width).toBe("33.333333333333336%");
    expect(wrapper2.style.width).toBe("33.333333333333336%");
    expect(wrapper3.style.width).toBe("33.333333333333336%");

    // Inner segment card spans 100% of wrapper
    expect(card1.style.width).toBe("100%");
    expect(card2.style.width).toBe("100%");
    expect(card3.style.width).toBe("100%");
  });

  it("proportionally scales box width down when time span is reduced", () => {
    render(<ModelChainBuilder modelChain={sampleChain} onChange={() => {}} />);

    const card1 = screen.getByTestId("model-card-ICON-D2");
    const card2 = screen.getByTestId("model-card-ICON-EU");
    const card3 = screen.getByTestId("model-card-GFS");

    const wrapper1 = card1.parentElement!;
    const wrapper2 = card2.parentElement!;
    const wrapper3 = card3.parentElement!;

    // ICON-D2 at 36h out of 48h (75% span) scales from 33.33% down towards 11.11%: 27.78%
    expect(parseFloat(wrapper1.style.width)).toBeCloseTo(27.778, 1);
    // Freed width transferred to adjacent model on right
    expect(parseFloat(wrapper2.style.width)).toBeCloseTo(38.889, 1);
    expect(parseFloat(wrapper3.style.width)).toBeCloseTo(33.333, 1);
  });

  it("allows resizing a model box boundary with the keyboard", () => {
    const handleChange = vi.fn();
    render(
      <ModelChainBuilder modelChain={sampleChain} onChange={handleChange} />,
    );

    const resizeHandles = screen.getAllByRole("separator");
    fireEvent.keyDown(resizeHandles[0], { key: "ArrowLeft" });
    expect(handleChange).toHaveBeenCalledWith([
      { name: "ICON-D2", max_forecast_horizon_hours: 35 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ]);
  });

  it("resizes adjacent models as a pair when boundary handle is dragged", () => {
    const handleChange = vi.fn();
    render(
      <ModelChainBuilder modelChain={sampleChain} onChange={handleChange} />,
    );

    const resizeHandle = screen.getByLabelText(
      "Resize boundary between ICON-D2 and ICON-EU",
    );

    fireEvent.pointerDown(resizeHandle, { pointerId: 1, clientX: 300 });
    // Drag boundary right by shifting clientX by +31px (+12h change)
    fireEvent.pointerMove(resizeHandle, { pointerId: 1, clientX: 331 });

    expect(handleChange).toHaveBeenCalledWith([
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ]);
  });

  it("resizes ICON-EU from 60h to 48h and checks wrapper width", () => {
    const testChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 60 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    let currentChain = testChain;
    const { rerender } = render(
      <ModelChainBuilder
        modelChain={currentChain}
        onChange={(newChain) => {
          currentChain = newChain;
        }}
      />,
    );

    const resizeHandle = screen.getByLabelText(
      "Resize boundary between ICON-EU and GFS",
    );
    fireEvent.pointerDown(resizeHandle, { pointerId: 1, clientX: 600 });
    // Drag left by -100px
    fireEvent.pointerMove(resizeHandle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(resizeHandle, { pointerId: 1 });

    rerender(
      <ModelChainBuilder
        modelChain={currentChain}
        onChange={(newChain) => {
          currentChain = newChain;
        }}
      />,
    );

    const card2 = screen.getByTestId("model-card-ICON-EU");
    expect(parseFloat(card2.parentElement!.style.width)).toBeCloseTo(11.111, 1);
    expect(currentChain[1].max_forecast_horizon_hours).toBe(48);

    rerender(
      <ModelChainBuilder
        modelChain={currentChain.map((m) => ({ ...m }))}
        onChange={(newChain) => {
          currentChain = newChain;
        }}
      />,
    );
    const card3 = screen.getByTestId("model-card-ICON-EU");
    // Retains 1/3 size (11.11%), does not jump back to 33.33%
    expect(parseFloat(card3.parentElement!.style.width)).toBeCloseTo(11.111, 1);

    const cardGfs = screen.getByTestId("model-card-GFS");
    // Model on right absorbed the freed width (55.56%)
    expect(parseFloat(cardGfs.parentElement!.style.width)).toBeCloseTo(
      55.556,
      1,
    );
  });

  it("resizes two adjacent models to 0h and leaves both at 2/3 size with remainder given to third model", () => {
    let currentChain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 48 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ];
    const { rerender } = render(
      <ModelChainBuilder
        modelChain={currentChain}
        onChange={(newChain) => {
          currentChain = newChain;
        }}
      />,
    );

    // 1. Drag boundary between ICON-D2 and ICON-EU to 0h
    const handle0 = screen.getByLabelText(
      "Resize boundary between ICON-D2 and ICON-EU",
    );
    fireEvent.pointerDown(handle0, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle0, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(handle0, { pointerId: 1 });

    rerender(
      <ModelChainBuilder
        modelChain={currentChain}
        onChange={(newChain) => {
          currentChain = newChain;
        }}
      />,
    );

    expect(currentChain[0].max_forecast_horizon_hours).toBe(0);

    // 2. Drag boundary between ICON-EU and GFS to 0h
    const handle1 = screen.getByLabelText(
      "Resize boundary between ICON-EU and GFS",
    );
    fireEvent.pointerDown(handle1, { pointerId: 2, clientX: 600 });
    fireEvent.pointerMove(handle1, { pointerId: 2, clientX: 100 });
    fireEvent.pointerUp(handle1, { pointerId: 2 });

    rerender(
      <ModelChainBuilder
        modelChain={currentChain}
        onChange={(newChain) => {
          currentChain = newChain;
        }}
      />,
    );

    expect(currentChain[0].max_forecast_horizon_hours).toBe(0);
    expect(currentChain[1].max_forecast_horizon_hours).toBe(0);

    const cardD2 = screen.getByTestId("model-card-ICON-D2");
    const cardEU = screen.getByTestId("model-card-ICON-EU");
    const cardGFS = screen.getByTestId("model-card-GFS");

    // Both 0-hour models must be at 1/3 baseline size (11.11%)
    expect(parseFloat(cardD2.parentElement!.style.width)).toBeCloseTo(
      11.111,
      1,
    );
    expect(parseFloat(cardEU.parentElement!.style.width)).toBeCloseTo(
      11.111,
      1,
    );
    // GFS receives all freed width (77.78%)
    expect(parseFloat(cardGFS.parentElement!.style.width)).toBeCloseTo(
      77.778,
      1,
    );
  });

  it("allows removing a model from the chain", () => {
    const handleChange = vi.fn();
    render(
      <ModelChainBuilder modelChain={sampleChain} onChange={handleChange} />,
    );

    const deleteBtns = screen.getAllByTitle("Remove model from chain");
    fireEvent.click(deleteBtns[0]);

    expect(handleChange).toHaveBeenCalledWith(
      [
        { name: "ICON-EU", max_forecast_horizon_hours: 120 },
        { name: "GFS", max_forecast_horizon_hours: 384 },
      ],
      true,
    );
  });

  it("populates add model dropdown from availableModels prop dynamically", () => {
    const dynamicModels = {
      "DYNAMIC-MODEL-1": {
        name: "DYNAMIC-MODEL-1",
        max_forecast_horizon_hours: 24,
        provider: "Test",
      },
      "DYNAMIC-MODEL-2": {
        name: "DYNAMIC-MODEL-2",
        max_forecast_horizon_hours: 72,
        provider: "Test",
      },
    };
    render(
      <ModelChainBuilder
        modelChain={[]}
        onChange={() => {}}
        availableModels={dynamicModels as any}
      />,
    );

    const addBtn = screen.getByTestId("add-model-btn");
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);

    expect(screen.getByText("DYNAMIC-MODEL-1")).toBeTruthy();
    expect(screen.getByText("DYNAMIC-MODEL-2")).toBeTruthy();
  });

  it("displays warning badge for partially supported models", () => {
    const dynamicModels = {
      "PARTIAL-MODEL": {
        name: "PARTIAL-MODEL",
        max_forecast_horizon_hours: 24,
        missing_variables: ["precipitation"],
      },
    };
    render(
      <ModelChainBuilder
        modelChain={[{ name: "PARTIAL-MODEL", max_forecast_horizon_hours: 24 }]}
        onChange={() => {}}
        availableModels={dynamicModels as any}
      />,
    );

    expect(
      screen.getByText((content) => content.includes("no precipitation")),
    ).toBeTruthy();
  });

  it("does not display warning badge for missing variables in cloud model chains on card or in dropdown", () => {
    const dynamicModels = {
      arome_france: {
        name: "AROME France",
        max_forecast_horizon_hours: 46,
        missing_variables: ["precipitation_probability"],
      },
      ecmwf_ifs: {
        name: "ECMWF IFS",
        max_forecast_horizon_hours: 120,
        missing_variables: [],
      },
    };

    const { rerender } = render(
      <ModelChainBuilder
        modelChain={[{ name: "AROME France", max_forecast_horizon_hours: 46 }]}
        onChange={() => {}}
        availableModels={dynamicModels as any}
        isCloudChain={true}
      />,
    );

    // Should NOT show missing variables warning on card
    expect(
      screen.queryByText((content) =>
        content.includes("Missing: precipitation_probability"),
      ),
    ).toBeNull();

    // Open dropdown and check that items in dropdown also do NOT show the missing variables warning
    const addBtn = screen.getByTestId("add-model-btn");
    fireEvent.click(addBtn);
    expect(
      screen.queryByText((content) =>
        content.includes("Missing: precipitation_probability"),
      ),
    ).toBeNull();

    // Rerender with testIdPrefix="cloud-" without explicit isCloudChain (auto-detection test)
    rerender(
      <ModelChainBuilder
        testIdPrefix="cloud-"
        modelChain={[{ name: "AROME France", max_forecast_horizon_hours: 46 }]}
        onChange={() => {}}
        availableModels={dynamicModels as any}
      />,
    );
    expect(
      screen.queryByText((content) =>
        content.includes("Missing: precipitation_probability"),
      ),
    ).toBeNull();
  });

  it("deduplicates availableModels defensively and displays ICON Global, ICON-CH1, and ICON-CH2 exactly once", () => {
    const modelsWithDuplicates = {
      icon_global: {
        id: "icon_global",
        name: "ICON Global",
        provider: "DWD",
        spatial_resolution_km: 13,
        max_forecast_horizon_hours: 180,
      },
      "ICON Global": {
        id: "icon_global",
        name: "ICON Global",
        provider: "DWD",
        spatial_resolution_km: 13,
        max_forecast_horizon_hours: 180,
      },
      meteoswiss_icon_ch1: {
        id: "meteoswiss_icon_ch1",
        name: "MeteoSwiss ICON-CH1",
        provider: "MeteoSwiss",
        spatial_resolution_km: 1.1,
        max_forecast_horizon_hours: 33,
      },
      meteoswiss_icon_ch2: {
        id: "meteoswiss_icon_ch2",
        name: "MeteoSwiss ICON-CH2",
        provider: "MeteoSwiss",
        spatial_resolution_km: 2.1,
        max_forecast_horizon_hours: 120,
      },
    };

    render(
      <ModelChainBuilder
        modelChain={[]}
        onChange={() => {}}
        availableModels={modelsWithDuplicates as any}
      />,
    );

    const addBtn = screen.getByTestId("add-model-btn");
    fireEvent.click(addBtn);

    const iconGlobalItems = screen.getAllByTestId("add-model-item-ICON Global");
    expect(iconGlobalItems).toHaveLength(1);

    const iconCh1Items = screen.getAllByTestId(
      "add-model-item-MeteoSwiss ICON-CH1",
    );
    expect(iconCh1Items).toHaveLength(1);

    const iconCh2Items = screen.getAllByTestId(
      "add-model-item-MeteoSwiss ICON-CH2",
    );
    expect(iconCh2Items).toHaveLength(1);
  });

  it("renders total hours in brackets when showTotalHours is true (default)", () => {
    render(<ModelChainBuilder modelChain={sampleChain} onChange={() => {}} />);

    expect(screen.getByText("0h — 36h (36h total)")).toBeTruthy();
    expect(screen.getByText("36h — 120h (84h total)")).toBeTruthy();
    expect(screen.getByText("120h — 384h (264h total)")).toBeTruthy();
  });

  it("omits total hours in brackets when showTotalHours is false", () => {
    render(
      <ModelChainBuilder
        modelChain={sampleChain}
        onChange={() => {}}
        showTotalHours={false}
      />,
    );

    expect(screen.getByText("0h — 36h")).toBeTruthy();
    expect(screen.getByText("36h — 120h")).toBeTruthy();
    expect(screen.getByText("120h — 384h")).toBeTruthy();
    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it("renders vertical border label and adds has-border-label class when borderLabel is provided", () => {
    const { container } = render(
      <ModelChainBuilder
        modelChain={sampleChain}
        onChange={() => {}}
        borderLabel="METEO"
      />,
    );

    const label = screen.getByTestId("border-label-meteo");
    expect(label).toBeTruthy();
    expect(label.textContent).toBe("METEO");

    const chainContainer = container.querySelector(
      ".horizontal-chain-container",
    );
    expect(chainContainer?.classList.contains("has-border-label")).toBe(true);
  });
});
