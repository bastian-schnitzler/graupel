import { maplibreMock } from "./test/maplibreMock";
vi.mock("maplibre-gl", () => maplibreMock);
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { apiService } from "./services/apiService";
import type { HarmonizedForecastResponse, MeteogramConfig } from "./types";

const munich = { name: "Munich", latitude: 48.13, longitude: 11.58 };
const chainA = [{ name: "ICON-D2", max_forecast_horizon_hours: 48 }];
const chainB = [{ name: "GFS", max_forecast_horizon_hours: 384 }];

const cfgA: MeteogramConfig = {
  id: "cfg-a",
  name: "Config A",
  location: munich,
  model_chain: chainA,
  cloud_model_chain: [],
};
// Same location and chains as A: only name and layout differ.
const cfgSame: MeteogramConfig = {
  ...cfgA,
  id: "cfg-same",
  name: "Same chains",
  layout_id: "power-default",
};
const cfgB: MeteogramConfig = {
  id: "cfg-b",
  name: "Config B",
  location: munich,
  model_chain: chainB,
  cloud_model_chain: [],
};

const emptyForecast = {
  combined_forecast: [],
  model_forecasts: {},
} as unknown as HarmonizedForecastResponse;

function selectConfig(container: HTMLElement, id: string) {
  const dropdown = container.querySelector(
    ".config-select-dropdown",
  ) as HTMLSelectElement;
  fireEvent.change(dropdown, { target: { value: id } });
}

async function renderApp(configs: MeteogramConfig[]) {
  vi.spyOn(apiService, "getConfigurations").mockResolvedValue(configs);
  const view = render(<App />);
  await waitFor(() => {
    expect(screen.getByText(new RegExp(configs[0].name))).toBeTruthy();
  });
  return view;
}

describe("in-memory forecast cache (#177)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  it("switches away and back without a request; a new chain fetches", async () => {
    const forecast = vi
      .spyOn(apiService, "getForecast")
      .mockResolvedValue(emptyForecast);
    const { container } = await renderApp([cfgA, cfgB]);
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));

    selectConfig(container, "cfg-b");
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(2));
    expect(forecast).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Munich" }),
      "cfg-b",
    );

    selectConfig(container, "cfg-a");
    selectConfig(container, "cfg-b");
    await new Promise((r) => setTimeout(r, 50));
    expect(forecast).toHaveBeenCalledTimes(2);
  });

  it("serves a configuration with the same chains but another name and layout from memory", async () => {
    const forecast = vi
      .spyOn(apiService, "getForecast")
      .mockResolvedValue(emptyForecast);
    const { container } = await renderApp([cfgA, cfgSame]);
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));

    selectConfig(container, "cfg-same");
    await new Promise((r) => setTimeout(r, 50));
    expect(forecast).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".config-select-dropdown")).toBeTruthy();
  });

  it("refresh button refetches the current key", async () => {
    const forecast = vi
      .spyOn(apiService, "getForecast")
      .mockResolvedValue(emptyForecast);
    await renderApp([cfgA]);
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Refresh Forecast" }));
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(2));
    expect(forecast).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Munich" }),
      "cfg-a",
    );
  });

  it("does not cache a failed request", async () => {
    const forecast = vi
      .spyOn(apiService, "getForecast")
      .mockImplementation(async (_loc, configId) => {
        if (configId === "cfg-b") throw new Error("upstream down");
        return emptyForecast;
      });
    const { container } = await renderApp([cfgA, cfgB]);
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(1));

    selectConfig(container, "cfg-b");
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/upstream down/)).toBeTruthy());

    selectConfig(container, "cfg-a");
    selectConfig(container, "cfg-b");
    await waitFor(() => expect(forecast).toHaveBeenCalledTimes(3));
  });
});
