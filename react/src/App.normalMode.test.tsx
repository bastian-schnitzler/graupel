import { maplibreMock } from "./test/maplibreMock";
vi.mock("maplibre-gl", () => maplibreMock);
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import App from "./App";
import { apiService, FALLBACK_SETTINGS } from "./services/apiService";
import type {
  AppSettings,
  AutoChainInfo,
  HarmonizedForecastResponse,
  Location,
  MeteogramConfig,
} from "./types";
import { AUTO_CONFIG_ID } from "./utils/autoChain";

const settingsWith = (mode: AppSettings["mode"]): AppSettings => ({
  ...FALLBACK_SETTINGS,
  mode,
});

const zugspitze: Location = {
  name: "Zugspitze",
  latitude: 47.4211,
  longitude: 10.9853,
  elevation: 2962,
};
const lausanne: Location = {
  name: "Lausanne",
  latitude: 46.516,
  longitude: 6.6328,
  elevation: 453,
};

const config: MeteogramConfig = {
  id: "nordalpen",
  name: "Nordalpen",
  location: zugspitze,
  model_chain: [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }],
  cloud_model_chain: [],
};

const chainFor = (loc: Location): AutoChainInfo =>
  loc.name === "Lausanne"
    ? {
        region_id: "switzerland",
        region_name: "Switzerland",
        resolution_reason: "region",
        main_model_chain: [
          {
            name: "MeteoSwiss ICON-CH1",
            id: "meteoswiss_icon_ch1",
            short_name: "ICON-CH1",
            max_forecast_horizon_hours: 33,
          },
          {
            name: "ECMWF IFS",
            id: "ecmwf_ifs",
            short_name: "IFS",
            max_forecast_horizon_hours: 360,
          },
        ],
        cloud_model_chain: [
          { name: "ECMWF IFS 0.25°", id: "ecmwf_ifs025", max_forecast_horizon_hours: 360 },
        ],
      }
    : {
        region_id: "northern_alps",
        region_name: "Northern Alps",
        resolution_reason: "region",
        main_model_chain: [
          { name: "ICON-D2", id: "icon_d2", max_forecast_horizon_hours: 48 },
          { name: "ICON-EU", id: "icon_eu", max_forecast_horizon_hours: 120 },
          {
            name: "ECMWF IFS",
            id: "ecmwf_ifs",
            short_name: "IFS",
            max_forecast_horizon_hours: 360,
          },
        ],
        cloud_model_chain: [
          { name: "ECMWF IFS 0.25°", id: "ecmwf_ifs025", max_forecast_horizon_hours: 360 },
        ],
      };

const emptyForecast = (
  auto?: AutoChainInfo,
): HarmonizedForecastResponse => ({
  combined_forecast: [],
  model_forecasts: {},
  auto_chain: auto ?? null,
});

function setup(mode: AppSettings["mode"]) {
  vi.spyOn(apiService, "getSettings").mockResolvedValue(settingsWith(mode));
  vi.spyOn(apiService, "updateSettings").mockImplementation(
    async (changes) => ({ ...settingsWith(mode), ...changes }),
  );
  vi.spyOn(apiService, "getConfigurations").mockResolvedValue([config]);
  vi.spyOn(apiService, "getElevationForCoords").mockResolvedValue(453);
  const resolve = vi
    .spyOn(apiService, "resolveAutoChain")
    .mockImplementation(async (loc) => chainFor(loc));
  const autoForecast = vi
    .spyOn(apiService, "getAutoForecast")
    .mockImplementation(async (loc) => {
      // ICON-D2 has no data at the location: the backend drops it.
      const info = chainFor(loc);
      return emptyForecast(
        loc.name === "Zugspitze"
          ? {
              ...info,
              main_model_chain: info.main_model_chain.slice(1),
              dropped_models: ["ICON-D2"],
            }
          : info,
      );
    });
  const forecast = vi
    .spyOn(apiService, "getForecast")
    .mockResolvedValue(emptyForecast());
  return { resolve, autoForecast, forecast };
}

const label = () => screen.queryByTestId("auto-chain-label")?.textContent;

describe("Normal mode (spec §3.3, #138)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  it("fetches the auto chain of the location and shows region and chain in the header", async () => {
    const { resolve, autoForecast, forecast } = setup("normal");
    const { container } = render(<App />);

    // The header shows the chain the backend really used (ICON-D2 dropped).
    await waitFor(() => {
      expect(label()).toBe("Northern Alps · ICON-EU → IFS");
    });
    expect(resolve).toHaveBeenCalledWith(zugspitze);
    expect(autoForecast).toHaveBeenCalledTimes(1);
    const [loc, autoConfig] = autoForecast.mock.calls[0];
    expect(loc).toEqual(zugspitze);
    expect(autoConfig.id).toBe(AUTO_CONFIG_ID);
    expect(autoConfig.cloud_model_chain?.map((m) => m.id)).toEqual([
      "ecmwf_ifs025",
    ]);
    expect(forecast).not.toHaveBeenCalled();
    expect(container.querySelector(".config-select-dropdown")).toBeNull();
    expect(container.querySelector(".model-chains-container")).toBeNull();
  });

  it("resolves a new chain when the location changes", async () => {
    const { resolve, autoForecast } = setup("normal");
    vi.spyOn(apiService, "searchLocations").mockResolvedValue([lausanne]);
    const { container } = render(<App />);
    await waitFor(() => expect(label()).toContain("Northern Alps"));

    fireEvent.change(screen.getByPlaceholderText("Search location..."), {
      target: { value: "Lausanne" },
    });
    await waitFor(() =>
      expect(container.querySelector(".dropdown-item")).toBeTruthy(),
    );
    fireEvent.click(container.querySelector(".dropdown-item")!);

    await waitFor(() => {
      expect(label()).toBe("Switzerland · ICON-CH1 → IFS");
    });
    expect(resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Lausanne" }),
    );
    expect(autoForecast).toHaveBeenCalledTimes(2);
    expect(autoForecast.mock.calls[1][0].name).toBe("Lausanne");
  });

  it("refetches the auto forecast only on the refresh button", async () => {
    const { autoForecast } = setup("normal");
    render(<App />);
    await waitFor(() => expect(label()).toContain("Northern Alps"));
    expect(autoForecast).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle(/refresh/i));
    await waitFor(() => expect(autoForecast).toHaveBeenCalledTimes(2));
  });

  it("switches between auto chain and configuration, served from the session cache", async () => {
    const { autoForecast, forecast } = setup("power");
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector(".config-select-dropdown")).toBeTruthy();
    });
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));
    expect(autoForecast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => expect(label()).toContain("Northern Alps"));
    expect(autoForecast).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => {
      expect(container.querySelector(".config-select-dropdown")).toBeTruthy();
    });
    expect(label()).toBeUndefined();
    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => expect(label()).toContain("Northern Alps"));
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Both forecasts were cached: toggling fetches nothing new.
    expect(forecast).toHaveBeenCalledTimes(1);
    expect(autoForecast).toHaveBeenCalledTimes(1);
  });
});

describe("Auto entry in power mode (spec §16.4, #165)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  const dropdown = (container: HTMLElement) =>
    container.querySelector(".config-select-dropdown") as HTMLSelectElement;
  const autoOption = () => screen.getByTestId("config-option-auto");

  it("is the first, marked entry and names the region of the location", async () => {
    const { forecast, autoForecast } = setup("power");
    const { container } = render(<App />);
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(autoOption().textContent).toBe("✦ Auto · Northern Alps");
    });
    const options = Array.from(dropdown(container).options);
    expect(options[0].value).toBe(AUTO_CONFIG_ID);
    expect(options[0].className).toBe("config-option-auto");
    expect(options[1].value).toBe("nordalpen");
    // The stored configuration stays selected; only the label was resolved.
    expect(dropdown(container).value).toBe("nordalpen");
    expect(autoForecast).not.toHaveBeenCalled();
  });

  it("is selected when switching from normal to power mode", async () => {
    const { forecast, autoForecast } = setup("normal");
    const { container } = render(<App />);
    await waitFor(() => expect(label()).toContain("Northern Alps"));

    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => {
      expect(dropdown(container).value).toBe(AUTO_CONFIG_ID);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The normal-mode forecast is shown again from the cache.
    expect(autoForecast).toHaveBeenCalledTimes(1);
    expect(forecast).not.toHaveBeenCalled();
  });

  it("follows location changes", async () => {
    setup("power");
    vi.spyOn(apiService, "searchLocations").mockResolvedValue([lausanne]);
    const { container } = render(<App />);
    await waitFor(() => {
      expect(autoOption().textContent).toBe("✦ Auto · Northern Alps");
    });

    fireEvent.change(screen.getByPlaceholderText("Search location..."), {
      target: { value: "Lausanne" },
    });
    await waitFor(() =>
      expect(container.querySelector(".dropdown-item")).toBeTruthy(),
    );
    fireEvent.click(container.querySelector(".dropdown-item")!);

    await waitFor(() => {
      expect(autoOption().textContent).toBe("✦ Auto · Switzerland");
    });
  });

  it("selecting it fetches the auto chain, shared with normal mode through the cache", async () => {
    const { forecast, autoForecast } = setup("power");
    const { container } = render(<App />);
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));

    fireEvent.change(dropdown(container), {
      target: { value: AUTO_CONFIG_ID },
    });
    await waitFor(() => expect(autoForecast).toHaveBeenCalledTimes(1));
    expect(autoForecast.mock.calls[0][0]).toEqual(zugspitze);
    expect(dropdown(container).value).toBe(AUTO_CONFIG_ID);
    expect(dropdown(container).classList.contains("auto-selected")).toBe(true);
    // Power mode keeps the chain cards, with the chain the backend used.
    await waitFor(() => {
      expect(container.querySelector(".model-chains-container")).toBeTruthy();
    });

    // Normal mode and back: same auto forecast, nothing fetched again.
    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => expect(label()).toContain("Northern Alps"));
    fireEvent.click(screen.getByTestId("power-mode-toggle"));
    await waitFor(() => {
      expect(dropdown(container).value).toBe(AUTO_CONFIG_ID);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(autoForecast).toHaveBeenCalledTimes(1);
    expect(forecast).toHaveBeenCalledTimes(1);

    // Back to the stored configuration: served from the cache as well.
    fireEvent.change(dropdown(container), { target: { value: "nordalpen" } });
    await waitFor(() => expect(dropdown(container).value).toBe("nordalpen"));
    expect(forecast).toHaveBeenCalledTimes(1);
  });
});
