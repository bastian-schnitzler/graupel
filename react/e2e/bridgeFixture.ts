import type { Page } from '@playwright/test';

/** A deterministic pywebview boundary, exercised by the real React app in Chromium. */
export async function installForecastBridge(page: Page) {
  await page.addInitScript(() => {
    const location = {
      name: 'Test Valley', latitude: 46.8, longitude: 9.8,
      elevation: 1200, timezone: 'Europe/Berlin',
    };
    const model = {
      name: 'ICON-D2', id: 'icon_d2', max_forecast_horizon_hours: 48,
      max_forecast_hours: 48, spatial_resolution_km: 2.2,
      temporal_resolution_hours: 1, provider: 'DWD', region: 'Europe',
    };
    const config = {
      id: 'e2e-config', name: 'E2E Forecast', location,
      model_chain: [model], main_model_chain: [model], cloud_model_chain: [],
    };
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 1);
    start.setUTCHours(0, 0, 0, 0);
    const times = Array.from({ length: 80 }, (_, i) => new Date(start.getTime() + i * 3600000).toISOString());
    const points: Array<{ timestamp: string; variable: string; value: number; unit: string; model: string }> = [];
    const series = [
      ['temperature', '°C', () => -2],
      ['apparent_temperature', '°C', () => -4],
      ['wind_speed', 'km/h', () => 12],
      ['wind_gusts', 'km/h', () => 18],
      ['wind_direction', '°', () => 270],
      ['precipitation', 'mm', (i: number) => [10, 11, 12, 13].includes(i) ? 2 : 0],
      ['snowfall', 'cm', (i: number) => [10, 11].includes(i) ? i - 9 : i === 13 ? 1 : 0],
      ['snow_depth', 'm', () => 0.2],
      ['precipitation_probability', '%', () => 60],
      ['cape', 'J/kg', () => 0],
      ['convective_inhibition', 'J/kg', () => 0],
      ['weather_code', 'wmo code', () => 71],
    ] as const;
    times.forEach((timestamp, i) => {
      series.forEach(([variable, unit, value]) => {
        points.push({ timestamp, variable, value: value(i), unit, model: model.name });
      });
    });
    const forecast = {
      combined_forecast: points,
      model_forecasts: { [model.name]: points },
      vertical_cloud_forecast: null,
      vertical_cloud_transitions: [],
      vertical_cloud_model_forecasts: {},
      sun_phases: [],
      forecast_start_time: now.toISOString(),
      timeline_start: times[0],
      timeline_end: new Date(now.getTime() + 48 * 3600000).toISOString(),
      user_timezone: 'Europe/Berlin',
      generated_at: '2026-10-16T20:45:00Z',
    };
    const archivedFetch = {
      id: 1, fetched_at: times[20], latitude: location.latitude,
      longitude: location.longitude, location, mode: 'power', region_id: null,
      chain: { main: [model], cloud: [] }, layout_id: null,
      config_id: config.id, config_version_id: 1,
      config_version: {
        version_id: 1, name: config.name, valid_from: times[0], valid_to: null,
      },
    };
    const state = { failForecast: false, forecastCalls: 0 };
    (window as any).__e2e = state;
    (window as any).pywebview = { api: {
      get_user_timezone: async () => 'Europe/Berlin',
      get_models: async () => [model],
      get_configurations: async () => [config],
      get_forecast: async () => {
        state.forecastCalls++;
        if (state.failForecast) throw new Error('E2E forecast failure');
        return forecast;
      },
      refresh_forecast: async () => {
        state.forecastCalls++;
        if (state.failForecast) throw new Error('E2E forecast failure');
        return forecast;
      },
      record_location_selection: async () => ({ success: true }),
      get_most_used_locations: async () => [],
      // One archived fetch for the historic viewer (#144); no snow archived.
      list_archived_forecasts: async () => [archivedFetch],
      get_historic_forecast: async () => ({
        fetch: archivedFetch,
        forecast: {
          ...forecast,
          model_forecasts: {
            [model.name]: points.filter((p) => !p.variable.startsWith('snow')),
          },
        },
      }),
      log_ui_error: async () => {},
    } };
  });
}
