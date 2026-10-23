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
  AppSettings,
  StoredLayout,
  AutoChainEntry,
  AutoChainInfo,
  RegionSummary,
  ArchiveStats,
  ArchivedFetchSummary,
  HistoricForecast,
  DataDirCopyParts,
  DataDirInfo,
} from "../types";
import { FALLBACK_AUTO_CHAIN } from "../utils/autoChain";
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
import {
  createLibraryEntry,
  deleteLibraryEntry,
  duplicateLibraryEntry,
  insertLayout,
  reorderLibrary,
  resetLibraryEntry,
  seedLayoutLibrary,
  updateLibraryEntry,
} from "../layouts/layoutLibrary.logic";
import {
  hourlyQuantityIds,
  isRequestedFromModel,
  setQuantityRegistry,
} from "../quantities/registry";

declare global {
  interface Window {
    pywebview?: {
      api?: {
        get_models: () => Promise<ModelMetadata[]>;
        get_quantity_registry?: () => Promise<unknown>;
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
        get_auto_forecast?: (
          location: Location,
          variables?: string[],
        ) => Promise<HarmonizedForecastResponse>;
        resolve_auto_chain?: (
          latitude: number,
          longitude: number,
          elevation?: number | null,
        ) => Promise<AutoChainInfo>;
        list_regions?: () => Promise<RegionSummary[]>;
        get_region_chains?: (regionId: string) => Promise<AutoChainInfo | null>;
        list_auto_chains?: () => Promise<AutoChainEntry[]>;
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
        copy_png_to_clipboard?: (pngBase64: string) => Promise<boolean>;
        move_cursor_to?: (
          screenX: number,
          screenY: number,
          devicePixelRatio: number,
        ) => Promise<boolean>;
        record_location_selection?: (
          location: Location,
        ) => Promise<{ success: boolean }>;
        get_most_used_locations?: (limit?: number | null) => Promise<Location[]>;
        get_user_timezone?: () => Promise<string>;
        get_settings?: () => Promise<AppSettings>;
        update_settings?: (
          changes: Partial<AppSettings>,
        ) => Promise<AppSettings>;
        get_layouts?: () => Promise<StoredLayout[]>;
        create_layout?: (
          name: string,
          layout?: unknown,
          position?: number,
        ) => Promise<StoredLayout>;
        duplicate_layout?: (id: string) => Promise<StoredLayout>;
        update_layout?: (
          id: string,
          changes: { name?: string; layout?: unknown },
        ) => Promise<StoredLayout>;
        reset_layout?: (id: string) => Promise<StoredLayout>;
        delete_layout?: (id: string) => Promise<{ success: boolean }>;
        reorder_layouts?: (ids: string[]) => Promise<StoredLayout[]>;
        get_data_dir?: () => Promise<DataDirInfo>;
        choose_data_dir?: () => Promise<string | null>;
        open_data_dir?: () => Promise<{ ok: boolean; error: string | null }>;
        change_data_dir?: (
          path: string,
          copyConfiguration: boolean,
          copyMeteogram: boolean,
        ) => Promise<{ data_dir: string; previous_data_dir: string }>;
        get_archive_stats?: () => Promise<ArchiveStats>;
        list_archived_forecasts?: (
          latitude: number,
          longitude: number,
          radiusKm?: number,
        ) => Promise<ArchivedFetchSummary[]>;
        get_historic_forecast?: (
          fetchId: number,
        ) => Promise<HistoricForecast | null>;
        delete_archive?: () => Promise<{ success: boolean }>;
      };
    };
  }
}

const SETTINGS_STORAGE_KEY = "graupel_settings_v1";
// v2: the fixed entry is "default" (#203); v1 libraries are reseeded.
const LAYOUTS_STORAGE_KEY = "graupel_layouts_v2";

export const FALLBACK_SETTINGS: AppSettings = {
  mode: "power",
  archive_enabled: false,
  archive_retention_days: 365,
};

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

    // Mock models list no optional capabilities (CAPE, CIN, LPI).
    const variables = hourlyQuantityIds().filter((id) =>
      isRequestedFromModel(id, []),
    );

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
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Loads the backend quantity registry; keeps the built-in copy when the
   * bridge is missing or answers with something unusable.
   */
  async loadQuantityRegistry(): Promise<boolean> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (!api?.get_quantity_registry) return false;
    try {
      return setQuantityRegistry(await api.get_quantity_registry());
    } catch (e) {
      console.error("Failed to load quantity registry from backend", e);
      return false;
    }
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

  /**
   * Main and cloud chain normal mode uses for a location (system.md §6.3).
   * Without a resolver bridge the global fallback chain is used.
   */
  async resolveAutoChain(location: Location): Promise<AutoChainInfo> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.resolve_auto_chain) {
      return await api.resolve_auto_chain(
        location.latitude,
        location.longitude,
        location.elevation ?? null,
      );
    }
    return FALLBACK_AUTO_CHAIN;
  }

  /** Auto chain regions (system.md §6.5); empty without a bridge. */
  async listRegions(): Promise<RegionSummary[]> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.list_regions) {
      return (await api.list_regions()) || [];
    }
    return [];
  }

  /** Chains without their own region (#198); empty without a bridge. */
  async listAutoChains(): Promise<AutoChainEntry[]> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.list_auto_chains) {
      return (await api.list_auto_chains()) || [];
    }
    return [];
  }

  /** A region's chains without a point (system.md §6.5); null if unknown. */
  async getRegionChains(regionId: string): Promise<AutoChainInfo | null> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.get_region_chains) {
      return await api.get_region_chains(regionId);
    }
    return null;
  }

  /**
   * Normal-mode forecast (system.md §3.3): the backend resolves the auto chain
   * itself and drops models without data; `config` (the resolved auto
   * configuration) is only used by the standalone mock.
   */
  async getAutoForecast(
    location: Location,
    config: MeteogramConfig,
  ): Promise<HarmonizedForecastResponse> {
    const requestId = ++this.currentRequestId;
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.get_auto_forecast) {
      const res = await api.get_auto_forecast(location);
      if (requestId !== this.currentRequestId) {
        throw new Error("STALE_REQUEST");
      }
      if (res?.user_timezone) {
        this.cachedUserTimezone = res.user_timezone;
      }
      return res;
    }
    if (api) {
      // Older bridge without auto chain support: stored-config forecast.
      return this.getForecast(location);
    }
    await new Promise((r) => setTimeout(r, 100));
    if (requestId !== this.currentRequestId) {
      throw new Error("STALE_REQUEST");
    }
    return {
      ...this.generateMockForecast(location, config),
      auto_chain: {
        ...FALLBACK_AUTO_CHAIN,
        main_model_chain: config.main_model_chain || config.model_chain,
        cloud_model_chain: config.cloud_model_chain || [],
      },
    };
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

  /**
   * Copy a PNG to the system clipboard. The browser Clipboard API runs first
   * (it must start inside the click, so it gets the pending image); when it
   * is unavailable or rejected, the Python bridge writes the clipboard.
   */
  async copyPngToClipboard(png: Promise<Blob>): Promise<boolean> {
    // Without a handler, a rejected render would surface as unhandled.
    png.catch(() => undefined);
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.write &&
      typeof ClipboardItem !== "undefined"
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": png }),
        ]);
        return true;
      } catch (err) {
        console.warn("Clipboard API rejected the PNG, trying bridge:", err);
      }
    }
    const copyViaBridge = window.pywebview?.api?.copy_png_to_clipboard;
    if (!copyViaBridge) return false;
    try {
      const bytes = new Uint8Array(await (await png).arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return (await copyViaBridge(btoa(binary))) ?? false;
    } catch (err) {
      console.warn("Copying the PNG via bridge failed:", err);
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

  /**
   * App settings. Without a settings bridge (older backend, standalone dev
   * build) the app runs in power mode, where nothing is hidden.
   */
  async getSettings(): Promise<AppSettings> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.get_settings) {
      return { ...FALLBACK_SETTINGS, ...(await api.get_settings()) };
    }
    return { ...FALLBACK_SETTINGS, ...this.readLocalSettings() };
  }

  /** Stores `changes`; rejects (and stores nothing) when the backend does. */
  async updateSettings(changes: Partial<AppSettings>): Promise<AppSettings> {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    if (api?.update_settings) {
      return { ...FALLBACK_SETTINGS, ...(await api.update_settings(changes)) };
    }
    const next = {
      ...FALLBACK_SETTINGS,
      ...this.readLocalSettings(),
      ...changes,
    };
    try {
      window.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("Failed to store settings locally:", e);
    }
    return next;
  }

  // --- Meteogram configurations (layout library, system.md §4.3, #168) ---
  // Without a bridge the library lives in localStorage and follows the
  // backend rules (`layoutLibrary.logic.ts`).

  private layoutBridge() {
    const api = this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
    return api?.get_layouts ? api : undefined;
  }

  private readLocalLayouts(): StoredLayout[] {
    try {
      const raw = window.localStorage?.getItem(LAYOUTS_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as StoredLayout[]) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to the seeded library
    }
    return seedLayoutLibrary();
  }

  private writeLocalLayouts(layouts: StoredLayout[]): StoredLayout[] {
    try {
      window.localStorage?.setItem(
        LAYOUTS_STORAGE_KEY,
        JSON.stringify(layouts),
      );
    } catch (e) {
      console.warn("Failed to store layouts locally:", e);
    }
    return layouts;
  }

  private localLayout(layouts: StoredLayout[], id: string): StoredLayout {
    const found = layouts.find((layout) => layout.id === id);
    if (!found) throw new Error(`Layout with id ${id} not found`);
    return found;
  }

  async getLayouts(): Promise<StoredLayout[]> {
    const api = this.layoutBridge();
    if (api?.get_layouts) return api.get_layouts();
    return this.readLocalLayouts();
  }

  async createLayout(
    name: string,
    layout?: unknown,
    position?: number,
  ): Promise<StoredLayout> {
    const api = this.layoutBridge();
    if (api?.create_layout) return api.create_layout(name, layout, position);
    if (!name.trim()) throw new Error("layout name must not be empty");
    const created = createLibraryEntry(
      `layout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      layout,
    );
    const layouts = insertLayout(this.readLocalLayouts(), created, position);
    this.writeLocalLayouts(layouts);
    return this.localLayout(layouts, created.id);
  }

  async duplicateLayout(id: string): Promise<StoredLayout> {
    const api = this.layoutBridge();
    if (api?.duplicate_layout) return api.duplicate_layout(id);
    const current = this.readLocalLayouts();
    const source = this.localLayout(current, id);
    const copy = duplicateLibraryEntry(
      `layout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source,
    );
    const layouts = insertLayout(current, copy, source.position + 1);
    this.writeLocalLayouts(layouts);
    return this.localLayout(layouts, copy.id);
  }

  async updateLayout(
    id: string,
    changes: { name?: string; layout?: unknown },
  ): Promise<StoredLayout> {
    const api = this.layoutBridge();
    if (api?.update_layout) return api.update_layout(id, changes);
    const current = this.readLocalLayouts();
    this.localLayout(current, id);
    const layouts = updateLibraryEntry(current, id, changes);
    this.writeLocalLayouts(layouts);
    return this.localLayout(layouts, id);
  }

  async resetLayout(id: string): Promise<StoredLayout> {
    const api = this.layoutBridge();
    if (api?.reset_layout) return api.reset_layout(id);
    const layouts = resetLibraryEntry(this.readLocalLayouts(), id);
    this.writeLocalLayouts(layouts);
    return this.localLayout(layouts, id);
  }

  async deleteLayout(id: string): Promise<boolean> {
    const api = this.layoutBridge();
    if (api?.delete_layout) return (await api.delete_layout(id)).success;
    const current = this.readLocalLayouts();
    if (!current.some((layout) => layout.id === id)) return false;
    const configs = await this.getConfigurations();
    const result = deleteLibraryEntry(current, configs, id);
    this.writeLocalLayouts(result.layouts);
    localStorage.setItem(this.storageKey, JSON.stringify(result.configs));
    return true;
  }

  // --- Data folder and forecast archive (Basic tab, system.md §8.2, §9.3) ---
  // Both exist only with the desktop bridge; the browser fallback has
  // neither a data folder nor an archive.

  private bridgeApi() {
    return this.isPywebviewAvailable() ? window.pywebview?.api : undefined;
  }

  async getDataDir(): Promise<DataDirInfo | null> {
    const api = this.bridgeApi();
    return api?.get_data_dir ? api.get_data_dir() : null;
  }

  /** Folder picked in the native dialog; null when cancelled. */
  async chooseDataDir(): Promise<string | null> {
    const api = this.bridgeApi();
    return api?.choose_data_dir ? api.choose_data_dir() : null;
  }

  /** Whether the bridge can open the data folder in a file manager (#197). */
  canOpenDataDir(): boolean {
    return Boolean(this.bridgeApi()?.open_data_dir);
  }

  /** Opens the current data folder in the system file manager. */
  async openDataDir(): Promise<void> {
    const api = this.bridgeApi();
    if (!api?.open_data_dir) {
      throw new Error("The data folder can only be opened in the desktop app");
    }
    const result = await api.open_data_dir();
    if (!result?.ok) {
      throw new Error(result?.error || "The data folder could not be opened");
    }
  }

  /** Creates a database with the chosen parts in `path` and switches to it. */
  async changeDataDir(path: string, parts: DataDirCopyParts): Promise<string> {
    const api = this.bridgeApi();
    if (!api?.change_data_dir) {
      throw new Error("The data folder can only be changed in the desktop app");
    }
    const result = await api.change_data_dir(
      path,
      parts.configuration,
      parts.meteogram,
    );
    return result.data_dir;
  }

  async getArchiveStats(): Promise<ArchiveStats | null> {
    const api = this.bridgeApi();
    return api?.get_archive_stats ? api.get_archive_stats() : null;
  }

  /** Archived fetches near a location, newest first; empty without a bridge. */
  async listArchivedForecasts(
    location: Location,
  ): Promise<ArchivedFetchSummary[]> {
    const api = this.bridgeApi();
    if (!api?.list_archived_forecasts) return [];
    return (
      (await api.list_archived_forecasts(
        location.latitude,
        location.longitude,
      )) || []
    );
  }

  /** One archived fetch as a forecast response (historic viewer, #144). */
  async getHistoricForecast(fetchId: number): Promise<HistoricForecast | null> {
    const api = this.bridgeApi();
    return api?.get_historic_forecast ? api.get_historic_forecast(fetchId) : null;
  }

  async deleteArchive(): Promise<void> {
    const api = this.bridgeApi();
    if (api?.delete_archive) await api.delete_archive();
  }

  async reorderLayouts(ids: string[]): Promise<StoredLayout[]> {
    const api = this.layoutBridge();
    if (api?.reorder_layouts) return api.reorder_layouts(ids);
    return this.writeLocalLayouts(reorderLibrary(this.readLocalLayouts(), ids));
  }

  private readLocalSettings(): Partial<AppSettings> {
    try {
      const raw = window.localStorage?.getItem(SETTINGS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    } catch {
      return {};
    }
  }

  /** Stored locations, most selected first; all of them without `limit`. */
  async getMostUsedLocations(limit?: number): Promise<Location[]> {
    try {
      if (
        this.isPywebviewAvailable() &&
        window.pywebview?.api?.get_most_used_locations
      ) {
        const locations =
          await window.pywebview.api.get_most_used_locations(limit ?? null);
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

  const lookupByModel = new Map<string, Map<number, Map<string, DataPoint>>>();
  for (const model of effectiveChain) {
    const byTime = new Map<number, Map<string, DataPoint>>();
    for (const point of (modelForecasts && modelForecasts[model.name]) || []) {
      if (!point || !point.timestamp) continue;
      const timeMs = normalizeTimestamp(point.timestamp);
      const byVariable = byTime.get(timeMs) || new Map<string, DataPoint>();
      byVariable.set(point.variable, point);
      byTime.set(timeMs, byVariable);
    }
    lookupByModel.set(model.name, byTime);
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

    // Each model only ever shows its own data inside its (capped) slice;
    // missing hours stay empty instead of borrowing another model's values.
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

  // Open-Meteo returns null rows after the end of a model run.
  const validProfileAt = (
    model: WeatherModel,
    timeMs: number,
  ): VerticalCloudProfile | undefined => {
    const profile =
      profileLookupByModel.get(model.name)?.get(timeMs) ||
      profileLookupByModel.get(model.id || model.name)?.get(timeMs);
    return profile?.levels?.some(
      (level) =>
        level.cloud_cover_percent !== null &&
        level.cloud_cover_percent !== undefined,
    )
      ? profile
      : undefined;
  };

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

    const matchingProf = primaryModel
      ? validProfileAt(primaryModel, currentDt)
      : undefined;
    if (primaryModel) {
      const cid = primaryModel.id || primaryModel.name;

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
