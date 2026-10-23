import { maplibreMock } from "./test/maplibreMock";
vi.mock("maplibre-gl", () => maplibreMock);
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import App from "./App";
import { apiService, FALLBACK_SETTINGS } from "./services/apiService";
import type { AppSettings } from "./types";

const settingsWith = (mode: AppSettings["mode"]): AppSettings => ({
  ...FALLBACK_SETTINGS,
  mode,
});

async function renderLoaded() {
  const view = render(<App />);
  await waitFor(() => {
    expect(screen.getByTestId("power-mode-toggle")).toBeTruthy();
  });
  return view;
}

describe("Power mode toggle (spec §3)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  it("hides configuration, dropdown, reset and model chains in normal mode", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("normal"),
    );
    const { container } = await renderLoaded();

    await waitFor(() => {
      expect(container.querySelector(".meteogram-view")).toBeTruthy();
    });
    const toggle = screen.getByTestId("power-mode-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Config" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Meteo" })).toBeNull();
    expect(container.querySelector(".config-select-dropdown")).toBeNull();
    expect(container.querySelector(".config-reset-btn")).toBeNull();
    expect(container.querySelector(".model-chains-container")).toBeNull();
    expect(container.querySelector(".model-info-btn")).toBeNull();
    // Shown in both modes.
    expect(container.querySelector(".location-selector-widget")).toBeTruthy();
  });

  it("shows all power elements in power mode", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("power"),
    );
    const { container } = await renderLoaded();

    await waitFor(() => {
      expect(container.querySelector(".model-chains-container")).toBeTruthy();
    });
    expect(
      screen.getByTestId("power-mode-toggle").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Config" })).toBeTruthy();
    expect(container.querySelector(".config-select-dropdown")).toBeTruthy();
    expect(container.querySelector(".config-reset-btn")).toBeTruthy();
  });

  it("stores the mode and returns to the meteogram when leaving power mode in Config view", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("power"),
    );
    const update = vi
      .spyOn(apiService, "updateSettings")
      .mockImplementation(async (changes) => ({
        ...settingsWith("power"),
        ...changes,
      }));
    const { container } = await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    await waitFor(() => {
      expect(container.querySelector(".config-view-root")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("power-mode-toggle"));

    expect(update).toHaveBeenCalledWith({ mode: "normal" });
    await waitFor(() => {
      expect(container.querySelector(".config-view-root")).toBeNull();
      expect(container.querySelector(".meteogram-view")).toBeTruthy();
    });
    expect(container.querySelector(".model-chains-container")).toBeNull();
    expect(screen.queryByRole("button", { name: "Config" })).toBeNull();
  });

  it("reverts the toggle when the mode cannot be stored", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("normal"),
    );
    vi.spyOn(apiService, "updateSettings").mockRejectedValue(
      new Error("database is locked"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderLoaded();

    fireEvent.click(screen.getByTestId("power-mode-toggle"));

    await waitFor(() => {
      expect(
        screen.getByTestId("power-mode-toggle").getAttribute("aria-pressed"),
      ).toBe("false");
    });
    expect(screen.queryByRole("button", { name: "Config" })).toBeNull();
  });

  it("does not refetch the configuration forecast when toggling the mode", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("power"),
    );
    vi.spyOn(apiService, "updateSettings").mockImplementation(
      async (changes) => ({ ...settingsWith("power"), ...changes }),
    );
    const getForecast = vi.spyOn(apiService, "getForecast");
    const getConfigurations = vi.spyOn(apiService, "getConfigurations");
    const { container } = await renderLoaded();
    await waitFor(() => {
      expect(
        container.querySelector(".meteogram-chart-area-white"),
      ).toBeTruthy();
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const forecastCalls = getForecast.mock.calls.length;
    const configCalls = getConfigurations.mock.calls.length;

    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => {
      expect(container.querySelector(".model-chains-container")).toBeNull();
    });
    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => {
      expect(container.querySelector(".model-chains-container")).toBeTruthy();
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(getForecast.mock.calls.length).toBe(forecastCalls);
    expect(getConfigurations.mock.calls.length).toBe(configCalls);
  });

  it("keeps the mode across a restart through the settings bridge", async () => {
    let stored: AppSettings = settingsWith("normal");
    const bridge = {
      get_models: vi.fn().mockResolvedValue([]),
      get_configurations: vi.fn().mockResolvedValue([
        {
          id: "cfg",
          name: "Nordalpen",
          location: { name: "Zugspitze", latitude: 47.42, longitude: 10.98 },
          model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
        },
      ]),
      save_configuration: vi.fn(),
      delete_configuration: vi.fn(),
      get_forecast: vi.fn().mockResolvedValue({
        combined_forecast: [],
        model_forecasts: {},
      }),
      refresh_forecast: vi.fn(),
      get_settings: vi.fn(async () => stored),
      update_settings: vi.fn(async (changes: Partial<AppSettings>) => {
        stored = { ...stored, ...changes };
        return stored;
      }),
    };
    window.pywebview = { api: bridge };

    const first = await renderLoaded();
    expect(screen.queryByRole("button", { name: "Config" })).toBeNull();
    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => {
      expect(bridge.update_settings).toHaveBeenCalledWith({ mode: "power" });
    });
    first.unmount();

    await renderLoaded();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Config" })).toBeTruthy();
    });
    expect(
      screen.getByTestId("power-mode-toggle").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("falls back to power mode without a settings bridge", async () => {
    const { container } = await renderLoaded();
    await waitFor(() => {
      expect(container.querySelector(".model-chains-container")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Config" })).toBeTruthy();
  });
});

describe("Config view tabs (spec §7)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  it("opens on Model chains and keeps the chosen tab across view switches", async () => {
    const { container } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    const chainsTab = await screen.findByRole("tab", { name: "Model chains" });
    expect(chainsTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Configuration Name")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Basic" }));
    expect(screen.getByTestId("config-tab-panel-basic")).toBeTruthy();
    expect(screen.queryByText("Configuration Name")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Meteogram" }));
    expect(screen.getByTestId("config-tab-panel-meteogram")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));
    await waitFor(() => {
      expect(container.querySelector(".meteogram-view")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    const meteogramTab = await screen.findByRole("tab", { name: "Meteogram" });
    expect(meteogramTab.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Meteogram configurations in Meteogram view (spec §4.3)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  async function libraryWithNormal(layout: unknown) {
    const [normal, power] = await apiService.getLayouts();
    return [{ ...normal, layout }, power];
  }

  it("draws the stored Default entry in normal mode", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("normal"),
    );
    vi.spyOn(apiService, "getLayouts").mockResolvedValue(
      await libraryWithNormal({
        id: "default",
        name: "Default",
        showModelHeaders: false,
        areas: [
          {
            id: "temp",
            series: [{ quantity: "temperature", style: "line" }],
          },
        ],
      }),
    );
    const { container } = await renderLoaded();
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="temperature-plot-area"]'),
      ).toBeTruthy();
    });
    expect(
      container.querySelector('[data-testid="wind-plot-area"]'),
    ).toBeNull();
  });

  it("draws the built-in normal layout with a warning for an invalid entry", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("normal"),
    );
    vi.spyOn(apiService, "getLayouts").mockResolvedValue(
      await libraryWithNormal({ id: "default", name: "x", areas: [] }),
    );
    const { container } = await renderLoaded();
    await waitFor(() => {
      expect(container.querySelector(".meteogram-layout-warning")).toBeTruthy();
    });
    expect(
      container.querySelector('[data-testid="wind-plot-area"]'),
    ).toBeTruthy();
  });

  it("draws the Default entry with model headers for a power configuration without a layout (#203)", async () => {
    vi.spyOn(apiService, "getSettings").mockResolvedValue(
      settingsWith("power"),
    );
    vi.spyOn(apiService, "getLayouts").mockResolvedValue(
      await libraryWithNormal({
        id: "default",
        name: "Default",
        showModelHeaders: false,
        areas: [
          {
            id: "temp",
            series: [{ quantity: "temperature", style: "line" }],
          },
        ],
      }),
    );
    const { container } = await renderLoaded();
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="temperature-plot-area"]'),
      ).toBeTruthy();
    });
    expect(
      container.querySelector('[data-testid="wind-plot-area"]'),
    ).toBeNull();
    // Power mode always adds the model headers.
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="model-header-shape"]'),
      ).toBeTruthy();
    });
  });
});
