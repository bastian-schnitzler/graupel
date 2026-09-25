import type {
  MeteogramConfig,
  Location,
  HarmonizedForecastResponse,
  ModelMetadata,
  DataPoint,
  WeatherModel,
  VerticalCloudProfile,
  VerticalCloudLevel,
  DetailedCloudForecast,
  VerticalCloudTransition,
  SunPeriod,
} from "../types";
import {
  DEFAULT_MODEL_CHAIN,
  DEFAULT_CLOUD_MODEL_CHAIN,
} from "../models/openMeteoModels";
import {
  HOUR_MS,
  buildHourlyTimeline,
  canonicalTimestamp,
  getBoundaryTimestamp,
  normalizeTimestamp,
  uniqueSortedTimestamps,
} from "../utils/timeline";

declare global {
  interface Window {
    pywebview?: {
      api?: {
        get_models: () => Promise<ModelMetadata[]>;
        get_configurations: () => Promise<MeteogramConfig[]>;
        create_configuration?: (
          config: MeteogramConfig,
          position?: number,
        ) => Promise<MeteogramConfig>;
        reorder_configurations?: (
          configurationIds: string[],
        ) => Promise<MeteogramConfig[]>;
        update_configuration?: (
          id: string,
          changes: Partial<MeteogramConfig>,
        ) => Promise<MeteogramConfig>;
        save_configuration: (
          config: MeteogramConfig,
        ) => Promise<MeteogramConfig>;
        delete_configuration: (id: string) => Promise<{ success: boolean }>;
        get_forecast: (
          location?: Location,
          configurationId?: string,
          variables?: string[],
        ) => Promise<HarmonizedForecastResponse>;
        refresh_forecast: (
          location?: Location,
          configurationId?: string,
          variables?: string[],
        ) => Promise<HarmonizedForecastResponse>;
        log_ui_error?: (
          typescript_function: string,
          api_function: string,
          error_message: string,
          error_description: string,
          description_of_typescript_function: string,
          api_function_input_data: any,
          api_function_output_data: any,
        ) => Promise<void>;
        open_external_url?: (url: string) => Promise<boolean>;
        move_cursor_to?: (
          screenX: number,
          screenY: number,
          devicePixelRatio: number,
        ) => Promise<boolean>;
        record_location_selection?: (
          location: Location,
        ) => Promise<{ success: boolean }>;
        get_most_used_locations?: (limit?: number) => Promise<Location[]>;
        get_user_timezone?: () => Promise<string>;
      };
    };
  }
}

class ApiService {
  private currentRequestId = 0;
  private storageKey = "meteogram_configs_v1";
  private cachedUserTimezone: string | null = null;

  async getUserTimezone(): Promise<string> {
    if (this.cachedUserTimezone) {
      return this.cachedUserTimezone;
    }
    if (
      this.isPywebviewAvailable() &&
      window.pywebview?.api?.get_user_timezone
    ) {
      try {
        const tz = await window.pywebview.api.get_user_timezone();
        if (tz && typeof tz === "string") {
          this.cachedUserTimezone = tz;
          return tz;
        }
      } catch (e) {
        console.warn("Failed to get user timezone from Python bridge", e);
      }
    }
    try {
      const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (fallback) {
        this.cachedUserTimezone = fallback;
        return fallback;
      }
    } catch {
      // ignore
    }
    return "UTC";
  }

  getCachedUserTimezone(): string | null {
    return this.cachedUserTimezone;
  }

  private isPywebviewAvailable(): boolean {
    return Boolean(window.pywebview && window.pywebview.api);
  }

  private generateMockForecast(
    _location: Location,
    config?: MeteogramConfig,
  ): HarmonizedForecastResponse {
    const chain =
      config?.main_model_chain || config?.model_chain || DEFAULT_MODEL_CHAIN;
    const now = new Date();
    const forecastStart = new Date(now);
    forecastStart.setMinutes(0, 0, 0);
    const yesterdayMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      0,
      0,
      0,
    );
    const pastHours = Math.round(
      (forecastStart.getTime() - yesterdayMidnight.getTime()) / HOUR_MS,
    );
    const timestamps: string[] = [];

    const maxHorizon = Math.max(
      ...chain.map((model) => model.max_forecast_horizon_hours),
      0,
    );
    for (let i = 0; i < pastHours + maxHorizon; i++) {
      const d = new Date(yesterdayMidnight.getTime() + i * 3600 * 1000);
      timestamps.push(d.toISOString());
    }

    const forecastStartTime = forecastStart.toISOString();

    const variables = [
      "temperature",
      "apparent_temperature",
      "wind_speed",
      "wind_gusts",
      "wind_direction",
      "cloud_cover",
      "precipitation",
      "precipitation_probability",
      "weather_code",
    ];

    const modelForecasts: Record<string, DataPoint[]> = {};

    chain.forEach((model) => {
      const modelPts: DataPoint[] = [];
      const horizon = model.max_forecast_horizon_hours;
      const modelEnd = getBoundaryTimestamp(forecastStartTime, horizon);
      const modelTs = timestamps.filter(
        (timestamp) => normalizeTimestamp(timestamp) < modelEnd,
      );

      modelTs.forEach((ts, idx) => {
        const hour = idx;
        const temp = 15 + Math.sin(hour / 4) * 8 + (Math.random() * 2 - 1);
        const apparentTemp = temp - 1.5 + Math.cos(hour / 3) * 2;
        const windSpeed = 12 + Math.cos(hour / 6) * 6 + Math.random() * 3;
        const windGusts = windSpeed + 8 + Math.random() * 5;
        const windDir =
          (180 + Math.sin(hour / 10) * 90 + Math.random() * 20) % 360;
        const cloudTotal = Math.min(
          100,
          Math.max(0, 50 + Math.sin(hour / 8) * 40),
        );
        const precipProb = Math.min(100, Math.max(0, Math.sin(hour / 5) * 80));
        const precip =
          precipProb > 40 ? (precipProb / 20) * (0.5 + Math.random()) : 0;

        const varValues: Record<string, { val: number; unit: string }> = {
          temperature: { val: parseFloat(temp.toFixed(1)), unit: "°C" },
          apparent_temperature: {
            val: parseFloat(apparentTemp.toFixed(1)),
            unit: "°C",
          },
          wind_speed: { val: parseFloat(windSpeed.toFixed(1)), unit: "km/h" },
          wind_gusts: { val: parseFloat(windGusts.toFixed(1)), unit: "km/h" },
          wind_direction: { val: parseFloat(windDir.toFixed(0)), unit: "°" },
          cloud_cover: { val: parseFloat(cloudTotal.toFixed(0)), unit: "%" },
          precipitation: { val: parseFloat(precip.toFixed(1)), unit: "mm" },
          precipitation_probability: {
            val: parseFloat(precipProb.toFixed(0)),
            unit: "%",
          },
          weather_code: {
            val:
              precip > 0
                ? precipProb > 70
                  ? 63
                  : 61
                : cloudTotal > 50
                  ? 3
                  : 0,
            unit: "wmo code",
          },
        };

        variables.forEach((v) => {
          const varData = varValues[v] || { val: 0, unit: "" };
          modelPts.push({
            timestamp: ts,
            value: varData.val,
            unit: varData.unit,
            variable: v,
            model: model.name,
          });
        });
      });

      modelForecasts[model.name] = modelPts;
    });

    const timelineStart = timestamps[0];
    const timelineEnd = canonicalTimestamp(
      getBoundaryTimestamp(forecastStartTime, maxHorizon),
    );
    const combinedForecast = mergeForecastSegments(
      chain,
      modelForecasts,
      variables,
      forecastStartTime,
      timelineStart,
      timelineEnd,
    );

    // Cloud Chain Handling & Mock Vertical Cloud Profiles
    const cloudChain =
      config?.cloud_model_chain !== undefined
        ? config.cloud_model_chain
        : DEFAULT_CLOUD_MODEL_CHAIN;

    const pressureLevels = [
      1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150,
      100,
    ];
    const defaultAltitudes = [
      110, 540, 760, 990, 1450, 1950, 3000, 4200, 5570, 7200, 9160, 10360,
      11800, 13600, 15800,
    ];

    const verticalCloudModelForecasts: Record<string, DetailedCloudForecast> =
      {};
    let verticalCloudForecast: DetailedCloudForecast | undefined = undefined;
    let mockTransitions: VerticalCloudTransition[] = [];

    if (cloudChain && cloudChain.length > 0) {
      cloudChain.forEach((cModel) => {
        const cModelId = cModel.id || cModel.name;
        const cHorizon = cModel.max_forecast_horizon_hours || 345;
        const cTs = timestamps.slice(0, pastHours + cHorizon);
        const cProfiles: VerticalCloudProfile[] = cTs.map((ts, idx) => {
          const levels: VerticalCloudLevel[] = pressureLevels.map((p, pIdx) => {
            const alt = defaultAltitudes[pIdx];
            const baseCloud = Math.min(
              100,
              Math.max(0, 50 + Math.sin((idx + pIdx) / 5) * 40),
            );
            let levelCloud = baseCloud;
            if (p > 850) levelCloud *= 0.4;
            else if (p > 500) levelCloud *= 0.8;
            else levelCloud *= 0.5;

            return {
              pressure_hpa: p,
              altitude_m_asl: alt,
              cloud_cover_percent: parseFloat(
                Math.min(100, Math.max(0, levelCloud)).toFixed(0),
              ),
            };
          });
          return {
            timestamp: ts,
            source_model_id: cModelId,
            source_model_name: cModel.name,
            levels,
          };
        });

        const fc: DetailedCloudForecast = {
          location: _location,
          profiles: cProfiles,
        };
        verticalCloudModelForecasts[cModel.name] = fc;
        if (cModel.id) {
          verticalCloudModelForecasts[cModel.id] = fc;
        }
      });

      const mergedClouds = mergeVerticalCloudSegments(
        cloudChain,
        verticalCloudModelForecasts,
        timestamps,
        forecastStartTime,
        _location,
      );
      verticalCloudForecast = mergedClouds.verticalCloudForecast;
      mockTransitions = mergedClouds.verticalCloudTransitions;
    }

    // Generate full 16 days of mock astronomical sunrise and sunset periods
    const mockSunPhases: SunPeriod[] = [];
    for (let d = 0; d < 17; d++) {
      const dayDate = new Date(yesterdayMidnight.getTime() + d * 86400 * 1000);
      const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;
      mockSunPhases.push({
        day: dayStr,
        sunrise: `${dayStr}T06:30`,
        sunset: `${dayStr}T19:45`,
      });
    }

    return {
      combined_forecast: combinedForecast,
      model_forecasts: modelForecasts,
      vertical_cloud_forecast: verticalCloudForecast,
      vertical_cloud_transitions: mockTransitions,
      vertical_cloud_model_forecasts: verticalCloudModelForecasts,
      sun_phases: mockSunPhases,
      forecast_start_time: forecastStartTime,
      timeline_start: timelineStart,
      timeline_end: timelineEnd,
      user_timezone: this.cachedUserTimezone || "Europe/Berlin",
    };
  }

  async getModels(): Promise<ModelMetadata[]> {
    if (this.isPywebviewAvailable()) {
      try {
        const res = await window.pywebview!.api!.get_models();
        return res as ModelMetadata[];
      } catch (e) {
        console.error("Failed to load models from backend", e);
        throw e;
      }
    }
    // Mock catalogue when running standalone without pywebview bridge
    return [
      {
        id: "icon_d2",
        name: "ICON-D2",
        max_forecast_horizon_hours: 48,
        provider: "DWD",
        region: "Central Europe",
        spatial_resolution_km: 2.2,
        temporal_resolution_hours: 1,
      },
      {
        id: "icon_eu",
        name: "ICON-EU",
        max_forecast_horizon_hours: 120,
        provider: "DWD",
        region: "Europe",
        spatial_resolution_km: 6.5,
        temporal_resolution_hours: 1,
      },
      {
        id: "icon_global",
        name: "ICON Global",
        max_forecast_horizon_hours: 180,
        provider: "DWD",
        region: "Global",
        spatial_resolution_km: 13.0,
        temporal_resolution_hours: 1,
      },
      {
        id: "meteoswiss_icon_ch1",
        name: "MeteoSwiss ICON-CH1",
        max_forecast_horizon_hours: 33,
        provider: "MeteoSwiss",
        region: "Switzerland / Alps",
        spatial_resolution_km: 1.1,
        temporal_resolution_hours: 1,
      },
      {
        id: "meteoswiss_icon_ch2",
        name: "MeteoSwiss ICON-CH2",
        max_forecast_horizon_hours: 120,
        provider: "MeteoSwiss",
        region: "Switzerland / Alps",
        spatial_resolution_km: 2.1,
        temporal_resolution_hours: 1,
      },
      {
        id: "gfs_seamless",
        name: "GFS Seamless",
        max_forecast_horizon_hours: 384,
        provider: "NOAA",
        region: "Global",
        spatial_resolution_km: 13.0,
        temporal_resolution_hours: 1,
      },
      {
        id: "ecmwf_ifs025",
        name: "ECMWF IFS 0.25°",
        max_forecast_horizon_hours: 240,
        provider: "ECMWF",
        region: "Global",
        spatial_resolution_km: 25.0,
        temporal_resolution_hours: 1,
      },
      {
        id: "meteofrance_arpege_world",
        name: "ARPEGE World",
        max_forecast_horizon_hours: 114,
        provider: "Météo-France",
        region: "Global",
        spatial_resolution_km: 25.0,
        temporal_resolution_hours: 1,
      },
    ];
  }

  async getConfigurations(): Promise<MeteogramConfig[]> {
    if (this.isPywebviewAvailable()) {
      return await window.pywebview!.api!.get_configurations();
    }

    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((c: MeteogramConfig) => ({
            ...c,
            model_chain:
              c.model_chain || c.main_model_chain || DEFAULT_MODEL_CHAIN,
            main_model_chain:
              c.main_model_chain || c.model_chain || DEFAULT_MODEL_CHAIN,
            cloud_model_chain:
              c.cloud_model_chain !== undefined
                ? c.cloud_model_chain
                : DEFAULT_CLOUD_MODEL_CHAIN,
          }));
        }
      } catch (e) {
        console.error("Failed to parse saved configs", e);
      }
    }

    const defaultConfig: MeteogramConfig = {
      id: "default-config-1",
      name: "Default Configuration",
      location: {
        name: "Offenbach am Main",
        latitude: 50.0956,
        longitude: 8.7761,
        country: "Germany",
        elevation: 98,
        timezone: "Europe/Berlin",
      },
      model_chain: DEFAULT_MODEL_CHAIN,
      main_model_chain: DEFAULT_MODEL_CHAIN,
      cloud_model_chain: DEFAULT_CLOUD_MODEL_CHAIN,
    };

    localStorage.setItem(this.storageKey, JSON.stringify([defaultConfig]));
    return [defaultConfig];
  }

  async createConfiguration(
    config: MeteogramConfig,
    position?: number,
  ): Promise<MeteogramConfig> {
    if (
      this.isPywebviewAvailable() &&
      window.pywebview?.api?.create_configuration
    ) {
      return await window.pywebview.api.create_configuration(config, position);
    }
    const configs = await this.getConfigurations();
    const configToSave = {
      ...config,
      id:
        config.id ||
        `cfg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    };
    if (position !== undefined && position >= 0 && position <= configs.length) {
      configs.splice(position, 0, configToSave);
    } else {
      configs.push(configToSave);
    }
    configs.forEach((c, idx) => {
      c.position = idx;
    });
    localStorage.setItem(this.storageKey, JSON.stringify(configs));
    return configToSave;
  }

  async reorderConfigurations(
    orderedIds: string[],
  ): Promise<MeteogramConfig[]> {
    if (
      this.isPywebviewAvailable() &&
      window.pywebview?.api?.reorder_configurations
    ) {
      return await window.pywebview.api.reorder_configurations(orderedIds);
    }
    const configs = await this.getConfigurations();
    const idMap = new Map(configs.map((c) => [c.id, c]));
    const reordered: MeteogramConfig[] = [];
    for (const id of orderedIds) {
      if (id && idMap.has(id)) {
        reordered.push(idMap.get(id)!);
        idMap.delete(id);
      }
    }
    for (const remaining of idMap.values()) {
      reordered.push(remaining);
    }
    reordered.forEach((c, idx) => {
      c.position = idx;
    });
    localStorage.setItem(this.storageKey, JSON.stringify(reordered));
    return reordered;
  }

  async updateConfiguration(
    id: string,
    changes: Partial<MeteogramConfig>,
  ): Promise<MeteogramConfig> {
    if (
      this.isPywebviewAvailable() &&
      window.pywebview?.api?.update_configuration
    ) {
      return await window.pywebview.api.update_configuration(id, changes);
    }

    const configs = await this.getConfigurations();
    const existingIdx = configs.findIndex((c) => c.id === id);
    if (existingIdx < 0) {
      throw new Error(`Configuration with id ${id} not found`);
    }

    const updated = {
      ...configs[existingIdx],
      ...changes,
      id,
    };
    configs[existingIdx] = updated;
    localStorage.setItem(this.storageKey, JSON.stringify(configs));
    return updated;
  }

  async saveConfiguration(config: MeteogramConfig): Promise<MeteogramConfig> {
    if (this.isPywebviewAvailable()) {
      return await window.pywebview!.api!.save_configuration(config);
    }

    const configs = await this.getConfigurations();
    const configToSave = {
      ...config,
      id:
        config.id ||
        `cfg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    };

    const existingIdx = configs.findIndex((c) => c.id === configToSave.id);
    if (existingIdx >= 0) {
      configs[existingIdx] = configToSave;
    } else {
      configs.push(configToSave);
    }

    localStorage.setItem(this.storageKey, JSON.stringify(configs));
    return configToSave;
  }

  async deleteConfiguration(id: string): Promise<boolean> {
    if (this.isPywebviewAvailable()) {
      const res = await window.pywebview!.api!.delete_configuration(id);
      return res.success;
    }

    const configs = await this.getConfigurations();
    const filtered = configs.filter((c) => c.id !== id);
    localStorage.setItem(this.storageKey, JSON.stringify(filtered));
    return true;
  }

  async getForecast(
    location?: Location,
    configurationId?: string,
    variables?: string[],
  ): Promise<HarmonizedForecastResponse> {
    const requestId = ++this.currentRequestId;

    if (this.isPywebviewAvailable()) {
      const res = await window.pywebview!.api!.get_forecast(
        location,
        configurationId,
        variables,
      );
      if (requestId !== this.currentRequestId) {
        throw new Error("STALE_REQUEST");
      }
      if (res?.user_timezone) {
        this.cachedUserTimezone = res.user_timezone;
      }
      return res;
    }

    await new Promise((r) => setTimeout(r, 100));
    if (requestId !== this.currentRequestId) {
      throw new Error("STALE_REQUEST");
    }

    const configs = await this.getConfigurations();
    if (requestId !== this.currentRequestId) {
      throw new Error("STALE_REQUEST");
    }
    const cfg = configurationId
      ? configs.find((c) => c.id === configurationId)
      : configs[0];
    const targetLoc = location ||
      cfg?.location || {
        name: "Berlin",
        latitude: 52.52,
        longitude: 13.405,
        timezone: "Europe/Berlin",
      };

    return this.generateMockForecast(targetLoc, cfg);
  }

  async refreshForecast(
    location?: Location,
    configurationId?: string,
    variables?: string[],
  ): Promise<HarmonizedForecastResponse> {
    return this.getForecast(location, configurationId, variables);
  }

  async logUiError(
    typescriptFunction: string,
    apiFunction: string,
    errorMessage: string,
    errorDescription: string,
    descriptionOfTypescriptFunction: string,
    apiFunctionInputData: any = null,
    apiFunctionOutputData: any = null,
  ): Promise<void> {
    if (this.isPywebviewAvailable() && window.pywebview?.api?.log_ui_error) {
      try {
        await window.pywebview.api.log_ui_error(
          typescriptFunction,
          apiFunction,
          errorMessage,
          errorDescription,
          descriptionOfTypescriptFunction,
          apiFunctionInputData,
          apiFunctionOutputData,
        );
      } catch (err) {
        console.error("Failed to log UI error to backend:", err);
      }
    }
  }

  async openExternalUrl(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      if (window.pywebview) {
        return (await window.pywebview.api?.open_external_url?.(url)) ?? false;
      }
      // Standalone browser development has no Python bridge.
      return window.open(url, "_blank", "noopener,noreferrer") !== null;
    } catch (err) {
      console.warn("Failed to open external attribution URL:", err);
      return false;
    }
  }

  async moveCursorTo(screenX: number, screenY: number): Promise<boolean> {
    if (!this.isPywebviewAvailable() || !window.pywebview?.api?.move_cursor_to)
      return false;
    try {
      return await window.pywebview.api.move_cursor_to(
        screenX,
        screenY,
        window.devicePixelRatio || 1,
      );
    } catch (err) {
      console.warn(
        "Failed to synchronize native cursor with meteogram zoom:",
        err,
      );
      return false;
    }
  }

  async getElevationForCoords(
    latitude: number,
    longitude: number,
  ): Promise<number | undefined> {
    try {
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`;
      const response = await fetch(url);
      if (!response.ok) return undefined;
      const data = await response.json();
      if (
        data &&
        Array.isArray(data.elevation) &&
        typeof data.elevation[0] === "number"
      ) {
        return data.elevation[0];
      }
    } catch (e) {
      console.warn("Failed to fetch elevation for coordinates", e);
    }
    return undefined;
  }

  async searchLocations(query: string): Promise<Location[]> {
    if (!query || query.trim().length < 2) {
      return [];
    }

    let candidates: Location[] = [];

    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        query.trim(),
      )}&count=10&language=en&format=json`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Geocoding HTTP error: ${response.status}`);
      }

      const data = await response.json();
      if (data.results && Array.isArray(data.results)) {
        candidates = data.results.map((item: any) => ({
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          country: item.country,
          admin1: item.admin1,
          elevation:
            typeof item.elevation === "number"
              ? item.elevation
              : item.elevation !== undefined && item.elevation !== null
                ? Number(item.elevation)
                : undefined,
          timezone: item.timezone || undefined,
        }));
      }
    } catch (e) {
      console.warn(
        "Geocoding search failed, falling back to local common cities",
        e,
      );
      const COMMON_LOCATIONS: Location[] = [
        {
          name: "Offenbach am Main",
          latitude: 50.0956,
          longitude: 8.7761,
          country: "Germany",
          admin1: "Hessen",
          elevation: 98,
          timezone: "Europe/Berlin",
        },
        {
          name: "Offenbach an der Queich",
          latitude: 49.196,
          longitude: 8.197,
          country: "Germany",
          admin1: "Rheinland-Pfalz",
          elevation: 131,
          timezone: "Europe/Berlin",
        },
        {
          name: "Berlin",
          latitude: 52.52,
          longitude: 13.405,
          country: "Germany",
          admin1: "Berlin",
          elevation: 34,
          timezone: "Europe/Berlin",
        },
        {
          name: "Hamburg",
          latitude: 53.55,
          longitude: 9.99,
          country: "Germany",
          admin1: "Hamburg",
          elevation: 6,
          timezone: "Europe/Berlin",
        },
        {
          name: "Munich",
          latitude: 48.137,
          longitude: 11.576,
          country: "Germany",
          admin1: "Bavaria",
          elevation: 519,
          timezone: "Europe/Berlin",
        },
        {
          name: "Cologne",
          latitude: 50.937,
          longitude: 6.96,
          country: "Germany",
          admin1: "North Rhine-Westphalia",
          elevation: 53,
          timezone: "Europe/Berlin",
        },
        {
          name: "Frankfurt am Main",
          latitude: 50.11,
          longitude: 8.682,
          country: "Germany",
          admin1: "Hessen",
          elevation: 112,
          timezone: "Europe/Berlin",
        },
        {
          name: "Vienna",
          latitude: 48.208,
          longitude: 16.373,
          country: "Austria",
          admin1: "Vienna",
          elevation: 171,
          timezone: "Europe/Vienna",
        },
        {
          name: "Zurich",
          latitude: 47.376,
          longitude: 8.541,
          country: "Switzerland",
          admin1: "Zurich",
          elevation: 408,
          timezone: "Europe/Zurich",
        },
        {
          name: "London",
          latitude: 51.507,
          longitude: -0.127,
          country: "United Kingdom",
          admin1: "England",
          elevation: 11,
          timezone: "Europe/London",
        },
        {
          name: "Paris",
          latitude: 48.856,
          longitude: 2.352,
          country: "France",
          admin1: "Île-de-France",
          elevation: 35,
          timezone: "Europe/Paris",
        },
        {
          name: "Tokyo",
          latitude: 35.676,
          longitude: 139.65,
          country: "Japan",
          admin1: "Tokyo",
          elevation: 40,
          timezone: "Asia/Tokyo",
        },
        {
          name: "New York",
          latitude: 40.7128,
          longitude: -74.006,
          country: "United States",
          admin1: "New York",
          elevation: 10,
          timezone: "America/New_York",
        },
      ];

      candidates = COMMON_LOCATIONS.filter((loc) =>
        loc.name.toLowerCase().includes(query.toLowerCase()),
      );
    }

    const resolvedCandidates = await Promise.all(
      candidates.map(async (loc) => {
        const numericEl = getNumericElevation(loc.elevation);
        if (numericEl !== null) {
          return { ...loc, elevation: numericEl };
        }

        try {
          const fetchedElevation = await this.getElevationForCoords(
            loc.latitude,
            loc.longitude,
          );
          const parsedFetched = getNumericElevation(fetchedElevation);
          return {
            ...loc,
            elevation: parsedFetched !== null ? parsedFetched : undefined,
          };
        } catch {
          return { ...loc, elevation: undefined };
        }
      }),
    );

    return sortLocationsByElevation(resolvedCandidates);
  }

  async recordLocationSelection(location: Location): Promise<void> {
    try {
      if (
        this.isPywebviewAvailable() &&
        window.pywebview?.api?.record_location_selection
      ) {
        await window.pywebview.api.record_location_selection(location);
        return;
      }
      if (typeof window !== "undefined" && window.localStorage) {
        const key = "meteogram_location_history_v1";
        const raw = window.localStorage.getItem(key);
        let items: Array<Location & { count?: number; lastSelected?: string }> =
          [];
        if (raw) {
          try {
            items = JSON.parse(raw);
          } catch {
            items = [];
          }
        }
        const latKey = Number(location.latitude.toFixed(4));
        const lonKey = Number(location.longitude.toFixed(4));
        const existingIdx = items.findIndex(
          (it) =>
            Number(it.latitude.toFixed(4)) === latKey &&
            Number(it.longitude.toFixed(4)) === lonKey,
        );
        const now = new Date().toISOString();
        if (existingIdx >= 0) {
          items[existingIdx] = {
            ...items[existingIdx],
            ...location,
            count: (items[existingIdx].count || 1) + 1,
            lastSelected: now,
          };
        } else {
          items.push({
            ...location,
            count: 1,
            lastSelected: now,
          });
        }
        items.sort((a, b) => {
          const diff = (b.count || 1) - (a.count || 1);
          if (diff !== 0) return diff;
          return (b.lastSelected || "").localeCompare(a.lastSelected || "");
        });
        window.localStorage.setItem(key, JSON.stringify(items.slice(0, 50)));
      }
    } catch (e) {
      console.warn("Failed to record location selection:", e);
    }
  }

  async getMostUsedLocations(limit = 10): Promise<Location[]> {
    try {
      if (
        this.isPywebviewAvailable() &&
        window.pywebview?.api?.get_most_used_locations
      ) {
        const locations =
          await window.pywebview.api.get_most_used_locations(limit);
        return locations || [];
      }
      if (typeof window !== "undefined" && window.localStorage) {
        const key = "meteogram_location_history_v1";
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const items: Location[] = JSON.parse(raw);
          return items.slice(0, limit);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch most used locations:", e);
    }
    return [];
  }
}

export function getNumericElevation(elevation: unknown): number | null {
  if (elevation === null || elevation === undefined) return null;
  const num = typeof elevation === "number" ? elevation : Number(elevation);
  return isNaN(num) ? null : num;
}

export function sortLocationsByElevation(locations: Location[]): Location[] {
  return [...locations].sort((a, b) => {
    const elA = getNumericElevation(a.elevation);
    const elB = getNumericElevation(b.elevation);

    if (elA !== null && elB !== null) {
      const isHighA = elA >= 1000;
      const isHighB = elB >= 1000;

      if (isHighA && !isHighB) {
        return -1;
      }
      if (!isHighA && isHighB) {
        return 1;
      }

      if (isHighA && isHighB) {
        if (elA !== elB) {
          return elB - elA;
        }
        return 0;
      }

      if (elA !== elB) {
        return elA - elB;
      }
      return 0;
    }

    if (elA !== null && elB === null) {
      return -1;
    }
    if (elA === null && elB !== null) {
      return 1;
    }
    return 0;
  });
}

export function getNextConfigurationName(
  configsOrNames: (MeteogramConfig | string)[],
): string {
  const usedNumbers = new Set<number>();
  const pattern = /^New Configuration (\d+)$/;

  configsOrNames.forEach((item) => {
    const name = typeof item === "string" ? item : item?.name;
    if (!name) return;
    const match = name.trim().match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num >= 1) {
        usedNumbers.add(num);
      }
    }
  });

  let n = 1;
  while (usedNumbers.has(n)) {
    n++;
  }
  return `New Configuration ${n}`;
}

export function removeModelFromChain(
  modelChain: WeatherModel[],
  indexToRemove: number,
): WeatherModel[] {
  if (indexToRemove < 0 || indexToRemove >= modelChain.length) {
    return modelChain;
  }
  return modelChain.filter((_, idx) => idx !== indexToRemove);
}

export function mergeForecastSegments(
  modelChain: WeatherModel[],
  modelForecasts: Record<string, DataPoint[]>,
  targetVariables: string[],
  forecastStartTime?: string,
  timelineStart?: string,
  timelineEnd?: string,
): DataPoint[] {
  if (!modelChain || modelChain.length === 0) return [];

  const allTimestampValues: string[] = [];
  Object.values(modelForecasts || {}).forEach((pts) => {
    if (Array.isArray(pts)) {
      pts.forEach((pt) => {
        if (pt && pt.timestamp) {
          allTimestampValues.push(pt.timestamp);
        }
      });
    }
  });

  const sourceTimes = uniqueSortedTimestamps(allTimestampValues);
  if (sourceTimes.length === 0) return [];

  let tNow = sourceTimes[0];
  if (forecastStartTime) {
    tNow = normalizeTimestamp(forecastStartTime);
  }
  const sortedTimes =
    timelineStart && timelineEnd
      ? buildHourlyTimeline(timelineStart, timelineEnd)
      : sourceTimes;
  const merged: DataPoint[] = [];

  const activeChain = modelChain.filter((m, idx) => {
    const prevH = idx > 0 ? modelChain[idx - 1].max_forecast_horizon_hours : 0;
    return m.max_forecast_horizon_hours > prevH;
  });
  const effectiveChain = activeChain.length > 0 ? activeChain : modelChain;

  const failedModelNames = new Set(
    effectiveChain
      .filter((m) => {
        const pts = (modelForecasts && modelForecasts[m.name]) || [];
        return !pts.some(
          (p) =>
            p && p.value !== null && p.value !== undefined && !isNaN(p.value),
        );
      })
      .map((m) => m.name),
  );

  const lookupByModel = new Map<string, Map<number, Map<string, DataPoint>>>();
  const validTimesByModel = new Map<string, Set<number>>();
  const validVariablesByModel = new Map<string, Set<string>>();
  for (const model of effectiveChain) {
    const byTime = new Map<number, Map<string, DataPoint>>();
    const validTimes = new Set<number>();
    const validVariables = new Set<string>();
    for (const point of (modelForecasts && modelForecasts[model.name]) || []) {
      if (!point || !point.timestamp) continue;
      const timeMs = normalizeTimestamp(point.timestamp);
      const byVariable = byTime.get(timeMs) || new Map<string, DataPoint>();
      byVariable.set(point.variable, point);
      byTime.set(timeMs, byVariable);
      if (
        point.value !== null &&
        point.value !== undefined &&
        !isNaN(point.value)
      ) {
        validTimes.add(timeMs);
        validVariables.add(point.variable);
      }
    }
    lookupByModel.set(model.name, byTime);
    validTimesByModel.set(model.name, validTimes);
    validVariablesByModel.set(model.name, validVariables);
  }

  sortedTimes.forEach((tsTime) => {
    const ts = canonicalTimestamp(tsTime);

    let primaryModel: WeatherModel | undefined;
    if (tsTime < tNow) {
      primaryModel = effectiveChain[0];
    } else {
      const hoursFromNow = (tsTime - tNow) / (1000 * 3600);
      primaryModel = effectiveChain.find(
        (m) => hoursFromNow < m.max_forecast_horizon_hours,
      );
      if (!primaryModel) {
        primaryModel = effectiveChain[effectiveChain.length - 1];
      }
    }

    const primaryHasDataAtTs = primaryModel
      ? (validTimesByModel.get(primaryModel.name)?.has(tsTime) ?? false)
      : false;

    if (
      primaryModel &&
      !primaryHasDataAtTs &&
      !failedModelNames.has(primaryModel.name)
    ) {
      const activeName = primaryModel.name;
      const primaryIdx = effectiveChain.findIndex((m) => m.name === activeName);
      const candidates = [
        ...effectiveChain.slice(primaryIdx + 1),
        ...effectiveChain.slice(0, primaryIdx),
      ];
      for (const candidate of candidates) {
        if (failedModelNames.has(candidate.name)) continue;
        if (validTimesByModel.get(candidate.name)?.has(tsTime)) {
          primaryModel = candidate;
          break;
        }
      }
    }

    targetVariables.forEach((variable) => {
      let chosenPt: DataPoint | null = null;

      const ptInPrimary = primaryModel
        ? lookupByModel.get(primaryModel.name)?.get(tsTime)?.get(variable)
        : undefined;
      if (
        ptInPrimary &&
        ptInPrimary.value !== null &&
        ptInPrimary.value !== undefined &&
        !isNaN(ptInPrimary.value)
      ) {
        chosenPt = ptInPrimary;
      }

      // Check if primary model has valid data for this variable
      const primaryHasData = primaryModel
        ? (validVariablesByModel.get(primaryModel.name)?.has(variable) ?? false)
        : false;

      // Boundary handover fallback only if primary model has data overall
      if (
        !chosenPt &&
        primaryHasData &&
        primaryModel &&
        ![
          "cape",
          "convective_inhibition",
          "lightning_potential",
          "weather_code",
        ].includes(variable)
      ) {
        for (const fallbackModel of effectiveChain) {
          if (fallbackModel.name === primaryModel.name) continue;
          const fbPt = lookupByModel
            .get(fallbackModel.name)
            ?.get(tsTime)
            ?.get(variable);
          if (
            fbPt &&
            fbPt.value !== null &&
            fbPt.value !== undefined &&
            !isNaN(fbPt.value)
          ) {
            chosenPt = fbPt;
            break;
          }
        }
      }

      if (!chosenPt) {
        chosenPt = {
          timestamp: ts,
          variable,
          value: null,
          unit: ptInPrimary?.unit || "",
          model: primaryModel ? primaryModel.name : "",
        };
      }

      merged.push({ ...chosenPt, timestamp: ts });
    });
  });

  return merged;
}

export const apiService = new ApiService();

export function getDuplicateConfigurationName(
  baseName: string,
  existingConfigsOrNames: (MeteogramConfig | string)[],
): string {
  const existingNames = new Set(
    existingConfigsOrNames.map((item) =>
      (typeof item === "string" ? item : item.name).trim().toLowerCase(),
    ),
  );

  const trimmedBase = baseName.trim();
  const match = trimmedBase.match(/^(.*?)(?:\s+(\d+))?$/);
  let stem = trimmedBase;
  let startNum = 2;

  if (match && match[2] !== undefined) {
    stem = match[1];
    startNum = parseInt(match[2], 10) + 1;
  }

  let currentNum = startNum;
  while (true) {
    const candidate = `${stem} ${currentNum}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    currentNum++;
  }
}

export function isCloudCompatibleModel(
  m: ModelMetadata | WeatherModel,
): boolean {
  if (!m || !m.supports_vertical_cloud_profile) return false;
  const levels = m.pressure_levels_hpa;
  return Array.isArray(levels) && levels.length >= 10;
}

export function mergeVerticalCloudSegments(
  cloudChain: WeatherModel[],
  verticalCloudModelForecasts?: Record<string, DetailedCloudForecast>,
  timestamps: string[] = [],
  forecastStartTime?: string,
  location?: Location,
): {
  verticalCloudForecast?: DetailedCloudForecast;
  verticalCloudTransitions: VerticalCloudTransition[];
} {
  if (
    !cloudChain ||
    cloudChain.length === 0 ||
    !verticalCloudModelForecasts ||
    timestamps.length === 0
  ) {
    return {
      verticalCloudForecast: undefined,
      verticalCloudTransitions: [],
    };
  }

  const activeChain = cloudChain.filter((m, idx) => {
    const prevH = idx > 0 ? cloudChain[idx - 1].max_forecast_horizon_hours : 0;
    return m.max_forecast_horizon_hours > prevH;
  });
  const effectiveChain = activeChain.length > 0 ? activeChain : cloudChain;

  const canonicalTimes = uniqueSortedTimestamps(timestamps);
  let tNow = canonicalTimes[0];
  if (forecastStartTime) {
    tNow = normalizeTimestamp(forecastStartTime);
  }

  const profileLookupByModel = new Map<
    string,
    Map<number, VerticalCloudProfile>
  >();
  Object.entries(verticalCloudModelForecasts).forEach(
    ([modelKey, forecast]) => {
      if (!forecast || !Array.isArray(forecast.profiles)) return;
      const profiles = new Map<number, VerticalCloudProfile>();
      forecast.profiles.forEach((profile) => {
        if (profile && profile.timestamp) {
          profiles.set(normalizeTimestamp(profile.timestamp), profile);
        }
      });
      profileLookupByModel.set(modelKey, profiles);
    },
  );

  const compositeProfiles: VerticalCloudProfile[] = [];
  const transitions: VerticalCloudTransition[] = [];
  let lastModelId: string | null = null;

  for (const currentDt of canonicalTimes) {
    const ts = canonicalTimestamp(currentDt);
    let primaryModel: WeatherModel | undefined;

    if (currentDt < tNow) {
      primaryModel = effectiveChain[0];
    } else {
      const hoursFromNow = (currentDt - tNow) / (1000 * 3600);
      primaryModel = effectiveChain.find(
        (m) => hoursFromNow < m.max_forecast_horizon_hours,
      );
    }

    if (primaryModel) {
      const cid = primaryModel.id || primaryModel.name;
      const matchingProf =
        profileLookupByModel.get(primaryModel.name)?.get(currentDt) ||
        profileLookupByModel.get(cid)?.get(currentDt);

      if (matchingProf) {
        compositeProfiles.push({
          timestamp: ts,
          source_model_id: cid,
          source_model_name: primaryModel.name,
          source_run: matchingProf.source_run,
          levels: matchingProf.levels,
        });

        if (lastModelId !== null && lastModelId !== cid) {
          transitions.push({
            timestamp: ts,
            from_model: lastModelId,
            to_model: cid,
          });
        }
        lastModelId = cid;
      } else {
        lastModelId = null;
      }
    } else {
      lastModelId = null;
    }
  }

  return {
    verticalCloudForecast: {
      location: location || { name: "Unknown", latitude: 0, longitude: 0 },
      profiles: compositeProfiles,
    },
    verticalCloudTransitions: transitions,
  };
}
