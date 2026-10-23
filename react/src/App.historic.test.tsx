import { maplibreMock } from "./test/maplibreMock";
vi.mock("maplibre-gl", () => maplibreMock);
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import App from "./App";
import { apiService } from "./services/apiService";
import type {
  ArchivedFetchSummary,
  HarmonizedForecastResponse,
  MeteogramConfig,
} from "./types";

const location = { name: "Innsbruck", latitude: 47.26, longitude: 11.39 };
const config: MeteogramConfig = {
  id: "alpen",
  name: "Alpen",
  location,
  model_chain: [{ name: "ECMWF IFS", max_forecast_horizon_hours: 48 }],
  cloud_model_chain: [],
};
const summary: ArchivedFetchSummary = {
  id: 7,
  fetched_at: "2026-10-20T06:00:00Z",
  latitude: 47.26,
  longitude: 11.39,
  location,
  mode: "power",
  region_id: null,
  chain: {
    main: [{ name: "ICON-D2", max_forecast_horizon_hours: 24 }],
    cloud: [],
  },
  layout_id: null,
  config_id: "alpen",
  config_version_id: 3,
  config_version: {
    version_id: 3,
    name: "Alpen old",
    valid_from: "2026-10-18T10:00:00Z",
    valid_to: "2026-10-20T10:00:00Z",
  },
};
const archived: HarmonizedForecastResponse = {
  combined_forecast: [],
  model_forecasts: {
    "ICON-D2": Array.from({ length: 24 }, (_, h) => ({
      timestamp: new Date(Date.parse("2026-10-20T06:00:00Z") + h * 3600_000)
        .toISOString(),
      value: 5,
      unit: "°C",
      variable: "temperature",
      model: "ICON-D2",
    })),
  },
  forecast_start_time: "2026-10-20T06:00:00Z",
  timeline_start: "2026-10-20T06:00:00Z",
  timeline_end: "2026-10-21T06:00:00Z",
  generated_at: "2026-10-20T06:00:00Z",
};

describe("Historic data viewer (spec §10, #144)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
    vi.spyOn(apiService, "getElevationForCoords").mockResolvedValue(574);
    vi.spyOn(apiService, "getConfigurations").mockResolvedValue([config]);
  });

  it("lists archived fetches, draws one and returns to live", async () => {
    const live = vi.spyOn(apiService, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });
    const list = vi
      .spyOn(apiService, "listArchivedForecasts")
      .mockResolvedValue([summary]);
    vi.spyOn(apiService, "getHistoricForecast").mockResolvedValue({
      fetch: summary,
      forecast: archived,
    });
    render(<App />);
    await waitFor(() => expect(live).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("model-card-ECMWF IFS")).toBeTruthy(),
    );
    const liveCalls = live.mock.calls.length;

    fireEvent.click(screen.getByTestId("history-button"));
    const item = await screen.findByTestId("history-item-7");
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 47.26, longitude: 11.39 }),
    );
    expect(item.textContent).toContain("ICON-D2");
    expect(item.textContent).toContain("Alpen old");
    fireEvent.click(item);

    const badge = await screen.findByTestId("historic-badge");
    expect(badge.textContent).toMatch(/^historic: fetched 20\.10\. \d\d:00$/);
    expect(screen.getByTestId("historic-version").textContent).toContain(
      "Alpen old",
    );
    // The current layout draws quantities the archive entry lacks.
    expect(screen.getByTestId("historic-missing").textContent).toMatch(
      /^Not archived: /,
    );
    await waitFor(() =>
      expect(screen.getByTestId("model-card-ICON-D2")).toBeTruthy(),
    );
    const refresh = screen.getByRole("button", {
      name: "Refresh Forecast",
    }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(live).toHaveBeenCalledTimes(liveCalls);

    fireEvent.click(screen.getByTestId("historic-back-to-live"));
    await waitFor(() =>
      expect(screen.queryByTestId("historic-badge")).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("model-card-ECMWF IFS")).toBeTruthy(),
    );
    expect(refresh.disabled).toBe(false);
  });

  it("shows a note when nothing is archived near the location", async () => {
    vi.spyOn(apiService, "getForecast").mockResolvedValue({
      combined_forecast: [],
      model_forecasts: {},
    });
    vi.spyOn(apiService, "listArchivedForecasts").mockResolvedValue([]);
    render(<App />);
    fireEvent.click(await screen.findByTestId("history-button"));
    expect((await screen.findByTestId("history-empty")).textContent).toContain(
      "Config → Basic",
    );
  });
});
