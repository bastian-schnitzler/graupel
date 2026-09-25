import { MockMap, MockMarker, maplibreMock } from "./test/maplibreMock";
vi.mock("maplibre-gl", () => maplibreMock);
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import App from "./App";
import { apiService as forecastApi } from "./services/apiService";
import { apiService as locationApi } from "./services/apiService";
import type { MeteogramConfig } from "./types";

describe("Meteogram App Full Integration", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  it("loads default configuration on startup and displays Meteogram view with Header Location Selector", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Graupel",
      );
      expect(screen.getByText("Graupel")).toBeTruthy();
    });

    expect(
      screen.getByRole("img", { name: "Graupel cloud" }).getAttribute("src"),
    ).toBe("./favicon.svg");
    expect(container.querySelector(".lucide-cloud-sun")).toBeNull();
    expect(screen.queryByText("Open-Meteo Meteogram")).toBeNull();
    expect(
      screen.queryByText("Multi-Model Seamless Weather Forecast"),
    ).toBeNull();
    expect(screen.getByText(/Default Configuration/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Meteo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Config" })).toBeTruthy();

    const appLayout = container.querySelector(".app-layout");
    const headerRight = container.querySelector(".header-right-section");
    const locationSelector = container.querySelector(
      ".location-selector-widget",
    );
    const mainWorkspace = container.querySelector(".main-workspace");

    expect(appLayout).toBeTruthy();
    expect(headerRight).toBeTruthy();
    expect(locationSelector).toBeTruthy();
    expect(mainWorkspace).toBeTruthy();
  });

  it("opens fullscreen from the current header location while preserving saved Config location and OK/Cancel", async () => {
    const zugspitze = {
      name: "Zugspitze",
      latitude: 47.4211,
      longitude: 10.9853,
      elevation: 2962,
    };
    const lausanne = {
      name: "Lausanne",
      latitude: 46.516,
      longitude: 6.6328,
      elevation: 453,
    };
    const config: MeteogramConfig = {
      id: "nordalpen",
      name: "Nordalpen (Zugspitze)",
      location: zugspitze,
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
    };
    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([config]);
    const forecast = vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });
    vi.spyOn(locationApi, "searchLocations").mockResolvedValue([lausanne]);
    const elevation = vi
      .spyOn(locationApi, "getElevationForCoords")
      .mockResolvedValue(453);
    const save = vi.spyOn(forecastApi, "saveConfiguration");
    const update = vi.spyOn(forecastApi, "updateConfiguration");
    const { container } = render(<App />);
    await waitFor(() => expect(screen.getByText("2962 m a.s.l.")).toBeTruthy());
    await waitFor(() => {
      expect(screen.getByText("2962 m a.s.l.")).toBeTruthy();
      expect(MockMap.instances.length).toBeGreaterThan(0);
    });

    const headerMap = MockMap.instances.at(-1)!;
    const headerMarker = MockMarker.instances.at(-1)!;
    const openFromMapLibre = () => {
      // Exercise the listener registered when the header map was first created,
      // rather than the freshly rendered React wrapper click handler.
      act(() => {
        headerMap.fire("click", { originalEvent: new MouseEvent("click") });
      });
    };
    const expectFullscreenAt = (location: typeof zugspitze) => {
      const fullscreen = MockMap.instances.at(-1)!;
      const marker = MockMarker.instances.at(-1)!;
      expect(fullscreen.options.center).toEqual([
        location.longitude,
        location.latitude,
      ]);
      expect(marker.coordinates).toEqual([
        location.longitude,
        location.latitude,
      ]);
    };

    // No override: fullscreen uses the displayed saved location.
    openFromMapLibre();
    expectFullscreenAt(zugspitze);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.change(screen.getByPlaceholderText("Search location..."), {
      target: { value: "Lausanne" },
    });
    await waitFor(() =>
      expect(container.querySelector(".dropdown-item")).toBeTruthy(),
    );
    fireEvent.click(container.querySelector(".dropdown-item")!);
    await waitFor(() =>
      expect(screen.getByText("46.5160° N · 6.6328° E")).toBeTruthy(),
    );
    expect(
      (screen.getByPlaceholderText("Search location...") as HTMLInputElement)
        .value,
    ).toBe("Lausanne");
    expect(screen.getByText("453 m a.s.l.")).toBeTruthy();
    expect(headerMarker.coordinates).toEqual([
      lausanne.longitude,
      lausanne.latitude,
    ]);
    expect(headerMap.options.center[1]).toBeCloseTo(lausanne.latitude);
    expect(headerMap.options.center[0]).toBeCloseTo(lausanne.longitude);

    const fetchCount = forecast.mock.calls.length;
    const elevationCount = elevation.mock.calls.length;
    openFromMapLibre();
    expectFullscreenAt(lausanne);
    expect(forecast).toHaveBeenCalledTimes(fetchCount);
    expect(elevation).toHaveBeenCalledTimes(elevationCount);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(headerMarker.coordinates).toEqual([
      lausanne.longitude,
      lausanne.latitude,
    ]);
    expect(
      (screen.getByPlaceholderText("Search location...") as HTMLInputElement)
        .value,
    ).toBe("Lausanne");

    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    await waitFor(() => expect(screen.getByText("2962 m a.s.l.")).toBeTruthy());
    expect(headerMarker.coordinates).toEqual([
      zugspitze.longitude,
      zugspitze.latitude,
    ]);
    openFromMapLibre();
    expectFullscreenAt(zugspitze);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Configuration Name")).toBeTruthy();
    expect(screen.getByText("2962 m a.s.l.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));
    await waitFor(() => expect(screen.getByText("453 m a.s.l.")).toBeTruthy());
    openFromMapLibre();
    expectFullscreenAt(lausanne);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText("Search location...") as HTMLInputElement)
          .value,
      ).toBe("Lausanne");
    });
    expect(forecast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "Lausanne",
        latitude: lausanne.latitude,
        longitude: lausanne.longitude,
        elevation: 453,
      }),
      config.id,
    );
    expect(save).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(config.location).toEqual(zugspitze);
    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    await waitFor(() => expect(screen.getByText("2962 m a.s.l.")).toBeTruthy());
    expect(headerMarker.coordinates).toEqual([
      zugspitze.longitude,
      zugspitze.latitude,
    ]);
  });

  it("reloads configurations when the pywebview bridge becomes ready", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Default Configuration/)).toBeTruthy();
    });

    const bridgeConfig = {
      id: "stored-default-id",
      name: "Stored Default Configuration",
      location: {
        name: "Offenbach am Main",
        latitude: 50.0956,
        longitude: 8.7761,
      },
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
    };
    const getConfigurations = vi.fn().mockResolvedValue([bridgeConfig]);
    const getForecast = vi.fn().mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });
    window.pywebview = {
      api: {
        get_models: vi.fn().mockResolvedValue([]),
        get_configurations: getConfigurations,
        save_configuration: vi.fn(),
        delete_configuration: vi.fn(),
        get_forecast: getForecast,
        refresh_forecast: vi.fn(),
      },
    };

    act(() => {
      window.dispatchEvent(new Event("pywebviewready"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Stored Default Configuration/)).toBeTruthy();
      expect(getConfigurations).toHaveBeenCalled();
      expect(getForecast).toHaveBeenCalledWith(
        expect.objectContaining({
          name: bridgeConfig.location.name,
          latitude: bridgeConfig.location.latitude,
          longitude: bridgeConfig.location.longitude,
        }),
        bridgeConfig.id,
        undefined,
      );
    });
  });

  it("switches navigation between Meteogram and Configuration views and hides config dropdown in Config View", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Default Configuration/)).toBeTruthy();
    });

    // Dropdown visible in Meteogram View
    expect(container.querySelector(".config-select-dropdown")).toBeTruthy();

    const configTab = screen.getByRole("button", { name: "Config" });
    fireEvent.click(configTab);

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
      expect(screen.queryByText("Edit Configuration")).toBeNull();
      expect(container.querySelector(".header-save-status")).toBeNull();
    });

    // Requirement 2: Dropdown NOT rendered in Configuration View
    expect(container.querySelector(".config-select-dropdown")).toBeNull();

    // Location selector is integrated in Header in both views
    expect(container.querySelector(".location-selector-widget")).toBeTruthy();

    const meteogramTab = screen.getByRole("button", { name: "Meteo" });
    fireEvent.click(meteogramTab);

    await waitFor(() => {
      expect(screen.getAllByText("ICON-D2").length).toBeGreaterThan(0);
    });

    expect(container.querySelector(".config-select-dropdown")).toBeTruthy();
    expect(container.querySelector(".location-selector-widget")).toBeTruthy();
  });

  it("allows creating a new configuration and selects it automatically", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Default Configuration/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Create new configuration/i }),
      ).toBeTruthy();
    });

    const newBtn = screen.getByRole("button", {
      name: /Create new configuration/i,
    });
    fireEvent.click(newBtn);

    await waitFor(() => {
      expect(screen.getByText("New Configuration 1")).toBeTruthy();
      expect(screen.queryByText("Saved")).toBeNull();
      expect(container.querySelector(".header-save-status")).toBeNull();
    });

    const nameInput = screen.getByPlaceholderText("e.g. European Short Range");
    fireEvent.change(nameInput, { target: { value: "My Regional Model" } });

    await waitFor(() => {
      expect(screen.getByText("My Regional Model")).toBeTruthy();
    });
  });

  it("searches locations with autocomplete", async () => {
    vi.spyOn(locationApi, "searchLocations").mockResolvedValue([
      {
        name: "Munich",
        latitude: 48.137,
        longitude: 11.576,
        country: "Germany",
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search location...")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText("Search location...");
    fireEvent.change(searchInput, { target: { value: "Muni" } });

    await waitFor(
      () => {
        expect(screen.getByText("Munich")).toBeTruthy();
      },
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByText("Munich"));
    expect((searchInput as HTMLInputElement).value).toBe("Munich");
  });

  it("handles forecast fetch errors gracefully with user-friendly error state", async () => {
    vi.spyOn(forecastApi, "getForecast").mockRejectedValue(
      new Error("Network timeout reaching Open-Meteo API"),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Error Loading Forecast/i)).toBeTruthy();
      expect(
        screen.getByText(/Network timeout reaching Open-Meteo API/i),
      ).toBeTruthy();
    });
  });
});

describe("Meteogram App Location State Management & Isolation", () => {
  const configA = {
    id: "cfg-a",
    name: "Config A",
    location: { name: "Lausanne", latitude: 46.5197, longitude: 6.6323 },
    model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
  };

  const configB = {
    id: "cfg-b",
    name: "Config B",
    location: { name: "Zermatt", latitude: 46.0207, longitude: 7.7491 },
    model_chain: [{ name: "GFS", max_forecast_horizon_hours: 384 }],
  };

  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();

    vi.spyOn(locationApi, "getElevationForCoords").mockResolvedValue(4808);
    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([
      configA,
      configB,
    ]);
    vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });
  });

  it("switches location to config default before manual session override exists", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/Lausanne/).length).toBeGreaterThan(0);
    });

    // Switch to Config B
    const dropdown = screen.getByRole("combobox");
    fireEvent.change(dropdown, { target: { value: "cfg-b" } });

    await waitFor(() => {
      expect(screen.getAllByText(/Zermatt/).length).toBeGreaterThan(0);
    });

    // Switch back to Config A
    fireEvent.change(dropdown, { target: { value: "cfg-a" } });

    await waitFor(() => {
      expect(screen.getAllByText(/Lausanne/).length).toBeGreaterThan(0);
    });
  });

  it("persists manually selected session location override across configuration switches", async () => {
    vi.spyOn(locationApi, "searchLocations").mockResolvedValue([
      {
        name: "Mont Blanc",
        latitude: 45.8326,
        longitude: 6.8652,
        country: "France",
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search location...")).toBeTruthy();
    });

    // Manually search and select Mont Blanc
    const searchInput = screen.getByPlaceholderText("Search location...");
    fireEvent.change(searchInput, { target: { value: "Mont" } });

    await waitFor(() => {
      expect(screen.getAllByText("Mont Blanc").length).toBeGreaterThan(0);
    });

    const suggestions = screen.getAllByText("Mont Blanc");
    fireEvent.click(suggestions[suggestions.length - 1]);

    await waitFor(() => {
      expect((searchInput as HTMLInputElement).value).toBe("Mont Blanc");
    });

    // Switch from Config A to Config B
    const dropdown = screen.getByRole("combobox");
    fireEvent.change(dropdown, { target: { value: "cfg-b" } });

    // Location MUST remain Mont Blanc (session override in search input), NOT Zermatt
    await waitFor(() => {
      expect((searchInput as HTMLInputElement).value).toBe("Mont Blanc");
    });

    // Switch back to Config A
    fireEvent.change(dropdown, { target: { value: "cfg-a" } });

    // Location STILL remains Mont Blanc
    await waitFor(() => {
      expect((searchInput as HTMLInputElement).value).toBe("Mont Blanc");
    });
  });

  it("isolates Configuration View to config default location without overwriting session override", async () => {
    vi.spyOn(locationApi, "searchLocations").mockResolvedValue([
      {
        name: "Mont Blanc",
        latitude: 45.8326,
        longitude: 6.8652,
        country: "France",
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search location...")).toBeTruthy();
    });

    // Set session override to Mont Blanc
    const searchInput = screen.getByPlaceholderText("Search location...");
    fireEvent.change(searchInput, { target: { value: "Mont" } });

    await waitFor(
      () => {
        expect(screen.getAllByText("Mont Blanc").length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );

    const suggestions = screen.getAllByText("Mont Blanc");
    fireEvent.click(suggestions[suggestions.length - 1]);

    await waitFor(() => {
      expect((searchInput as HTMLInputElement).value).toBe("Mont Blanc");
    });

    // Switch to Config View
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    // Config View header must show Config A default location (Lausanne), NOT Mont Blanc
    await waitFor(() => {
      expect(screen.queryByText("DEFAULT LOCATION")).toBeNull();
      expect(
        (screen.getByPlaceholderText("Search location...") as HTMLInputElement)
          .value,
      ).toBe("Lausanne");
    });

    // Return to Meteogram View
    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    // Meteogram View must restore Mont Blanc without adding a location caption
    await waitFor(() => {
      expect(screen.queryByText("SELECTED LOCATION")).toBeNull();
      expect(
        (screen.getByPlaceholderText("Search location...") as HTMLInputElement)
          .value,
      ).toBe("Mont Blanc");
    });
  });

  it("retains elevation above map view when selecting a location with elevation in Configuration View", async () => {
    vi.spyOn(locationApi, "searchLocations").mockResolvedValue([
      {
        name: "Zermatt",
        latitude: 45.9765,
        longitude: 7.7491,
        country: "Switzerland",
        admin1: "Valais",
        elevation: 1620,
      },
    ]);
    vi.spyOn(forecastApi, "saveConfiguration").mockImplementation(
      async (cfg) => ({
        ...cfg,
        location: { ...cfg.location },
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText(/Lausanne/).length).toBeGreaterThan(0);
    });

    // Switch to Configuration View
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.queryByText("DEFAULT LOCATION")).toBeNull();
    });

    // Search and select Zermatt with elevation 1620
    const searchInput = screen.getByPlaceholderText("Search location...");
    fireEvent.change(searchInput, { target: { value: "Zermatt" } });

    const option = await screen.findByRole("option");
    expect(option.textContent).toContain("1620 m a.s.l.");
    fireEvent.click(option);

    // Above the map view, elevation must display 1620 m a.s.l. and NOT Elevation unavailable
    await waitFor(() => {
      expect(screen.getByText("1620 m a.s.l.")).toBeTruthy();
      expect(screen.queryByText("Elevation unavailable")).toBeNull();
    });
  });

  it("does not enter an infinite re-render / fetch loop on startup", async () => {
    const getConfigsSpy = vi.spyOn(forecastApi, "getConfigurations");
    const getForecastSpy = vi.spyOn(forecastApi, "getForecast");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Graupel",
      );
      expect(screen.getByText("Graupel")).toBeTruthy();
    });

    // Wait to catch any runaway render loop
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(getConfigsSpy).toHaveBeenCalledTimes(1);
    expect(getForecastSpy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("loads top configuration on startup and dropdown preserves canonical order", async () => {
    const cfgTop = {
      id: "cfg-top",
      name: "Top Configuration",
      location: { name: "Berlin", latitude: 52.52, longitude: 13.405 },
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
    };
    const cfgBottom = {
      id: "cfg-bottom",
      name: "Bottom Configuration",
      location: { name: "Vienna", latitude: 48.21, longitude: 16.37 },
      model_chain: [{ name: "GFS", max_forecast_horizon_hours: 384 }],
    };

    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([
      cfgTop,
      cfgBottom,
    ]);
    const forecastSpy = vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Top Configuration/)).toBeTruthy();
    });

    // Verify top config was automatically loaded on startup
    expect(forecastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Berlin" }),
      "cfg-top",
    );

    // Verify dropdown contains options in exact canonical order [cfgTop, cfgBottom]
    const dropdown = container.querySelector(
      ".config-select-dropdown",
    ) as HTMLSelectElement;
    expect(dropdown).toBeTruthy();
    const options = Array.from(dropdown.options);
    expect(options[0].value).toBe("cfg-top");
    expect(options[1].value).toBe("cfg-bottom");
  });

  it("only reloads forecast on switching back from Configuration View if selected configuration changed", async () => {
    const initialConfig = {
      id: "cfg-test",
      name: "Editable Config",
      location: { name: "Munich", latitude: 48.13, longitude: 11.58 },
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
    };

    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([
      initialConfig,
    ]);
    const forecastSpy = vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Editable Config/)).toBeTruthy();
    });

    const initialFetchCount = forecastSpy.mock.calls.length;
    expect(initialFetchCount).toBeGreaterThan(0);

    // 1. Switch to Configuration View
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    // Switch directly back WITHOUT changing anything
    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Graupel",
      );
      expect(screen.getByText("Graupel")).toBeTruthy();
    });

    // Forecast call count must NOT have increased!
    expect(forecastSpy.mock.calls.length).toBe(initialFetchCount);

    // 2. Switch to Configuration View and change model chain horizon
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    // Rename configuration to simulate change
    const nameInput = screen.getByPlaceholderText("e.g. European Short Range");
    fireEvent.change(nameInput, { target: { value: "Renamed Config" } });

    // Switch back to Meteogram View
    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    // Meteogram View must reload forecast because config changed
    await waitFor(() => {
      expect(forecastSpy.mock.calls.length).toBeGreaterThan(initialFetchCount);
    });
  });

  it("skips configuration with empty model chain on startup and loads first runnable dropdown entry", async () => {
    const emptyConfig = {
      id: "cfg-empty",
      name: "Lausanne Empty",
      location: { name: "Lausanne", latitude: 46.5197, longitude: 6.6323 },
      model_chain: [],
    };
    const runnableConfig = {
      id: "cfg-runnable",
      name: "Berchtesgaden Alps",
      location: {
        name: "Berchtesgaden",
        latitude: 47.6324,
        longitude: 13.0019,
      },
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
    };

    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([
      emptyConfig,
      runnableConfig,
    ]);
    const forecastSpy = vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Berchtesgaden Alps/)).toBeTruthy();
    });

    // Lausanne must not have been requested for forecast!
    expect(forecastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "Lausanne" }),
      "cfg-empty",
    );

    // Berchtesgaden must have been loaded on startup
    expect(forecastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Berchtesgaden" }),
      "cfg-runnable",
    );

    // No error banner should be present
    expect(screen.queryByText(/Error Loading Forecast/)).toBeNull();
  });

  it("does not load any meteogram on startup if all configurations have no models", async () => {
    const emptyConfig1 = {
      id: "cfg-empty-1",
      name: "Empty 1",
      location: { name: "Loc 1", latitude: 10, longitude: 10 },
      model_chain: [],
    };
    const emptyConfig2 = {
      id: "cfg-empty-2",
      name: "Empty 2",
      location: { name: "Loc 2", latitude: 20, longitude: 20 },
      model_chain: [],
    };

    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([
      emptyConfig1,
      emptyConfig2,
    ]);
    const forecastSpy = vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText(/No forecast configuration available/),
      ).toBeTruthy();
    });

    // Forecast should NOT have been fetched
    expect(forecastSpy).not.toHaveBeenCalled();
    // No error banner
    expect(screen.queryByText(/Error Loading Forecast/)).toBeNull();
  });

  it("decouples model horizon slider resizing in Meteogram View from saved configuration preset", async () => {
    const initialConfig = {
      id: "cfg-decoupled",
      name: "Decoupled Preset",
      location: { name: "Innsbruck", latitude: 47.26, longitude: 11.4 },
      model_chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 48 },
        { name: "GFS", max_forecast_horizon_hours: 384 },
      ],
    };

    let currentConfigs: MeteogramConfig[] = [initialConfig];
    vi.spyOn(forecastApi, "getConfigurations").mockImplementation(
      async () => currentConfigs,
    );
    const saveSpy = vi
      .spyOn(forecastApi, "saveConfiguration")
      .mockImplementation(async (cfg) => {
        currentConfigs = currentConfigs.map((c) => (c.id === cfg.id ? cfg : c));
        return cfg;
      });
    const forecastSpy = vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Decoupled Preset (Innsbruck)")).toBeTruthy();
    });

    const initialFetchCount = forecastSpy.mock.calls.length;
    expect(initialFetchCount).toBeGreaterThan(0);

    // Locate the resize handle between ICON-D2 and GFS in Meteogram View
    const handle = screen.getByRole("separator", {
      name: /Resize boundary between ICON-D2 and GFS/i,
    });
    expect(handle).toBeTruthy();
    expect(handle.getAttribute("aria-valuenow")).toBe("48");

    // Resize boundary via keyboard arrow left (shift by 1 hour to 47h)
    fireEvent.keyDown(handle, { key: "ArrowLeft" });

    // In Meteogram View, the boundary should now be at 47h
    expect(handle.getAttribute("aria-valuenow")).toBe("47");

    // Critically: saveConfiguration must NEVER have been called from Meteogram View!
    expect(saveSpy).not.toHaveBeenCalled();

    // 1. Switch to Configuration View
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    // Configuration View must display the stored preset (48h), NOT the modified 47h!
    const configHandle = screen.getByRole("separator", {
      name: /Resize boundary between ICON-D2 and GFS/i,
    });
    expect(configHandle.getAttribute("aria-valuenow")).toBe("48");

    // 2. Switch back to Meteogram View WITHOUT modifying the configuration
    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Meteo" })).toBeTruthy();
    });

    // The adjusted distribution from Meteogram View (47h) must be restored!
    const restoredHandle = screen.getByRole("separator", {
      name: /Resize boundary between ICON-D2 and GFS/i,
    });
    expect(restoredHandle.getAttribute("aria-valuenow")).toBe("47");

    // Forecast was NOT refetched because configuration did not change
    expect(forecastSpy.mock.calls.length).toBe(initialFetchCount);

    // 3. Switch to Configuration View and MODIFY the configuration preset
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    // Rename configuration to simulate a modification
    const nameInput = screen.getByPlaceholderText("e.g. European Short Range");
    fireEvent.change(nameInput, {
      target: { value: "Modified Innsbruck Preset" },
    });

    // 4. Switch back to Meteogram View
    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    // Meteogram data must be refetched and reloaded
    await waitFor(() => {
      expect(forecastSpy.mock.calls.length).toBeGreaterThan(initialFetchCount);
    });

    // Ephemeral slider positions must be discarded, restoring the preset (48h)
    await waitFor(() => {
      const resetHandle = screen.getByRole("separator", {
        name: /Resize boundary between ICON-D2 and GFS/i,
      });
      expect(resetHandle.getAttribute("aria-valuenow")).toBe("48");
    });
  });

  it("displays save error in lower-left corner of Config view header on failure and clears upon success, without showing in Meteogram view", async () => {
    const testConfig: MeteogramConfig = {
      id: "cfg-save-error-test",
      name: "Save Error Test Preset",
      location: { name: "Innsbruck", latitude: 47.26, longitude: 11.4 },
      model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
    };
    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([testConfig]);
    vi.spyOn(forecastApi, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });

    let shouldFail = true;
    vi.spyOn(forecastApi, "saveConfiguration").mockImplementation(
      async (cfg) => {
        if (shouldFail) {
          throw new Error("Database locked");
        }
        return cfg;
      },
    );

    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Save Error Test Preset/)).toBeTruthy();
    });

    // In Meteogram view, no save status/error is shown
    expect(container.querySelector(".header-save-status")).toBeNull();
    expect(screen.queryByTestId("config-save-error")).toBeNull();

    // Switch to Config view
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    // On successful initial state, no Saved or Saving or header-save-status is shown
    expect(container.querySelector(".header-save-status")).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.queryByText("Saving...")).toBeNull();

    // Trigger an autosave by changing the name
    const nameInput = screen.getByPlaceholderText("e.g. European Short Range");
    fireEvent.change(nameInput, { target: { value: "Trigger Save Failure" } });

    // Wait for save failure error badge to appear in the header
    await waitFor(() => {
      const errorBadge = screen.getByTestId("config-save-error");
      expect(errorBadge).toBeTruthy();
      expect(errorBadge.textContent).toContain("Could not save configuration");
    });

    // Switch to Meteogram view - error must NOT be shown in Meteogram view
    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    await waitFor(() => {
      expect(screen.queryByTestId("config-save-error")).toBeNull();
      expect(container.querySelector(".header-config-selector")).toBeTruthy();
    });

    // Switch back to Config view
    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    // Trigger another save failure
    const remountedNameInput = screen.getByPlaceholderText(
      "e.g. European Short Range",
    );
    fireEvent.change(remountedNameInput, {
      target: { value: "Trigger Save Failure 2" },
    });

    await waitFor(() => {
      const errorBadge = screen.getByTestId("config-save-error");
      expect(errorBadge).toBeTruthy();
      expect(errorBadge.textContent).toContain("Could not save configuration");
    });

    // Now allow saving to succeed
    shouldFail = false;
    fireEvent.change(remountedNameInput, {
      target: { value: "Trigger Save Success" },
    });

    // Later successful save must clear the error and produce no visible save status
    await waitFor(() => {
      expect(screen.queryByTestId("config-save-error")).toBeNull();
      expect(container.querySelector(".header-save-status")).toBeNull();
      expect(screen.queryByText("Saved")).toBeNull();
    });
  });

  it("resets dragged model chain boundaries and cards back to configuration defaults when clicking reset button", async () => {
    const testConfig: MeteogramConfig = {
      id: "cfg-reset-test",
      name: "Reset Test Preset",
      location: { name: "Lausanne", latitude: 46.5197, longitude: 6.6323 },
      model_chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 48 },
        { name: "GFS", max_forecast_horizon_hours: 384 },
      ],
      main_model_chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 48 },
        { name: "GFS", max_forecast_horizon_hours: 384 },
      ],
    };
    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([testConfig]);

    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Lausanne")).toBeTruthy();
    });

    const resetBtn = container.querySelector(
      ".config-reset-btn",
    ) as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("model-card-ICON-D2")).toBeTruthy();
      expect(screen.getByTestId("model-card-GFS")).toBeTruthy();
    });

    const resizeHandle = container.querySelector(
      ".model-resize-handle",
    ) as HTMLDivElement;
    if (resizeHandle) {
      fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });
    }

    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByTestId("model-card-ICON-D2")).toBeTruthy();
      expect(screen.getByTestId("model-card-GFS")).toBeTruthy();
    });
  });

  it("closes fullscreen map overlay when navigating to Configuration view and does not reopen on return", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Lausanne")).toBeTruthy();
    });

    const headerMap = MockMap.instances.at(-1);
    if (headerMap) {
      act(() => {
        headerMap.fire("click", { originalEvent: new MouseEvent("click") });
      });
    } else {
      const mapPreview = container.querySelector(".header-map-preview");
      if (mapPreview) fireEvent.click(mapPreview);
    }

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Config" }));

    await waitFor(() => {
      expect(screen.getByText("Configuration Name")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Meteo" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Graupel",
      );
      expect(screen.getByText("Graupel")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("does not show an Offenbach error when bridge configuration (Zugspitze) is selected on startup", async () => {
    const zugspitzeConfig = {
      id: "zugspitze-config-id",
      name: "Nordalpen",
      location: {
        name: "Zugspitze",
        latitude: 47.4211,
        longitude: 10.9853,
        elevation: 2962,
      },
      model_chain: [
        { name: "ICON-D2", max_forecast_horizon_hours: 48 },
        { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      ],
    };

    vi.spyOn(forecastApi, "getConfigurations").mockResolvedValue([
      zugspitzeConfig,
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Nordalpen/)).toBeTruthy();
      expect(screen.getByDisplayValue("Zugspitze")).toBeTruthy();
    });

    expect(screen.queryByText(/Error Loading Forecast/i)).toBeNull();
    expect(screen.queryByText(/Offenbach/i)).toBeNull();
  });
});
