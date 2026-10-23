export interface Location {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  elevation?: number;
  timezone?: string;
}

export interface WeatherModel {
  name: string;
  /** Catalogue nickname for the orange model header (system.md §16.7). */
  short_name?: string | null;
  max_forecast_horizon_hours: number;
  max_forecast_hours?: number;
  id?: string;
  provider?: string;
  region?: string;
  spatial_resolution?: number;
  spatial_resolution_km?: number;
  temporal_resolution?: number;
  temporal_resolution_hours?: number;
  supported_variables?: string[];
  missing_variables?: string[];
  geographical_coverage?: string;
  active?: boolean;
  unavailable?: boolean;
  description?: string;
  supports_vertical_cloud_profile?: boolean;
  supports_pressure_level_cloud_cover?: boolean;
  supports_geopotential_height?: boolean;
  pressure_levels_hpa?: number[];
}

export interface ModelMetadata extends WeatherModel {
  description?: string;
  /** Meteogram View only: start of the model's latest run (UTC instant). */
  last_run_init_time?: string | null;
  /** Meteogram View only: older run delivering the end of mixed series. */
  data_end_run_init_time?: string | null;
  /** Meteogram View only: what the "Max" horizon is derived from. */
  horizon_info?: ModelHorizonInfo;
  /**
   * Meteogram View only: sources of drawn derived quantities (system.md §5.1) the
   * model delivers no data for.
   */
  missing_sources?: string[];
}

/** Inputs explaining a model's available horizon in Meteogram View. */
export interface ModelHorizonInfo {
  /** Catalogue horizon: length of the model's longest run. */
  catalogue_hours: number;
  /** Hours delivered from `forecast_start_time` (the "Max" value). */
  available_hours: number;
  /** False when the data reaches the fetched window end. */
  limited_by_run: boolean;
  forecast_start_time?: string | null;
  /** Runs the series is composed of, newest first. */
  run_segments: RunSegment[];
  /** Start of the newest main run and when it became available. */
  run_init_time?: string | null;
  run_availability_time?: string | null;
  /** Hours from now where this model's displayed slice starts and ends. */
  slice_start_hours?: number;
  slice_end_hours?: number;
  ensemble?: EnsembleRunInfo | null;
  probability_valid_until?: string | null;
}

export interface MeteogramConfig {
  id?: string;
  name: string;
  location: Location;
  model_chain: WeatherModel[];
  main_model_chain?: WeatherModel[];
  mainModelChain?: WeatherModel[];
  cloud_model_chain?: WeatherModel[];
  cloudModelChain?: WeatherModel[];
  position?: number;
  /** Meteogram configuration (layout) id; null = global layout (system.md §4.3). */
  layout_id?: string | null;
  /** Display name of the location, e.g. "INSB"; null = place name (§16.12). */
  location_name_override?: string | null;
}

export interface DataPoint {
  timestamp: string;
  value: number | null;
  unit: string;
  variable: string;
  model: string;
}

export interface RawForecastData {
  model_name: string;
  fetch_time: string;
  forecast_run_time?: string | null;
  timestamps: string[];
  values: (number | null)[];
  unit: string;
  variable: string;
  max_horizon_hours: number;
}

export interface VerticalCloudLevel {
  pressure_hpa: number;
  altitude_m_asl?: number | null;
  cloud_cover_percent?: number | null;
}

export interface VerticalCloudProfile {
  timestamp: string;
  source_model_id: string;
  source_model_name?: string | null;
  source_run?: string | null;
  levels: VerticalCloudLevel[];
}

export interface DetailedCloudForecast {
  location: Location;
  profiles: VerticalCloudProfile[];
}

export interface VerticalCloudTransition {
  timestamp: string;
  from_model: string;
  to_model: string;
}

export interface SunPeriod {
  day: string;
  sunrise: string;
  sunset: string;
}

export interface VariableTimelineCoverage {
  variable: string;
  sample_count: number;
  valid_sample_count: number;
  first_timestamp?: string | null;
  last_timestamp?: string | null;
  first_valid_timestamp?: string | null;
  last_valid_timestamp?: string | null;
  expected_start: string;
  expected_end_exclusive: string;
  expected_last_timestamp?: string | null;
  complete: boolean;
  spacing_anomalies: Array<Record<string, unknown>>;
}

export interface ModelTimelineDiagnostics {
  model: string;
  expected_start: string;
  expected_end_exclusive: string;
  variables: Record<string, VariableTimelineCoverage>;
}

export interface HarmonizedForecastResponse {
  combined_forecast: DataPoint[];
  model_forecasts: Record<string, DataPoint[]>;
  raw_data?: RawForecastData[];
  vertical_cloud_forecast?: DetailedCloudForecast | null;
  vertical_cloud_transitions?: VerticalCloudTransition[];
  vertical_cloud_model_forecasts?: Record<string, DetailedCloudForecast>;
  sun_phases?: SunPeriod[];
  forecast_start_time?: string;
  timeline_start?: string;
  timeline_end?: string;
  user_timezone?: string;
  timeline_diagnostics?: Record<string, ModelTimelineDiagnostics>;
  model_availability?: Record<string, ModelAvailability>;
  cloud_model_availability?: Record<string, ModelAvailability>;
  /** UTC instant the forecast was generated. */
  generated_at?: string;
  /** Only on auto chain (normal mode) forecasts. */
  auto_chain?: AutoChainInfo | null;
}

/**
 * Location-based chains (system.md §6.3). On a forecast response the chains are
 * the ones actually stitched: models without data are already dropped.
 */
export interface AutoChainInfo {
  region_id?: string | null;
  region_name?: string | null;
  resolution_reason: "region" | "domain_fallback" | "global_fallback" | string;
  main_model_chain: WeatherModel[];
  cloud_model_chain: WeatherModel[];
  dropped_models?: string[];
  dropped_cloud_models?: string[];
}

/**
 * A resolved chain without its own region (`list_auto_chains`, #198): a
 * region chain filtered by coverage, the domain fallback or IFS only.
 */
export interface AutoChainEntry extends AutoChainInfo {
  id: string;
  /** "Intercontinental", a continent, or "Global". */
  group: string;
  /** Main chain short names, e.g. "RDPS → IFS HRES". */
  name: string;
  /** Where the resolver picks it, e.g. "USA" or "regional models". */
  origin: string;
  regions: string[];
  area_km2?: number;
}

/** Auto chain region without geometry (`list_regions`, system.md §6.2). */
export interface RegionSummary {
  id: string;
  name: string;
  priority: number;
  group?: string | null;
  area_km2?: number;
  chains_from?: string | null;
  main_chain_ids: string[];
  cloud_chain_ids: string[];
}

/**
 * Hours a model's latest run really delivers from `forecast_start_time`.
 * `available_hours: null` means the model is not limited by its run.
 */
export interface ModelAvailability {
  model: string;
  model_id?: string | null;
  chain: "main" | "cloud";
  available_hours?: number | null;
  valid_until?: string | null;
  last_run_init_time?: string | null;
  last_run_availability_time?: string | null;
  /** Set only when Open-Meteo mixes runs: the older run delivering the end. */
  data_end_run_init_time?: string | null;
  /** Runs the series is composed of, newest first. */
  run_segments?: RunSegment[];
  /** Ensemble behind `precipitation_probability` (main chain only). */
  ensemble?: EnsembleRunInfo | null;
  /** Exclusive end of the last valid precipitation probability sample. */
  probability_valid_until?: string | null;
}

/** Newest ensemble run as published in the ensemble's `meta.json`. */
export interface EnsembleRunInfo {
  model_id: string;
  run_init_time?: string | null;
  run_availability_time?: string | null;
  /** Exclusive end of the newest ensemble run's data. */
  data_end_time?: string | null;
  update_interval_hours?: number | null;
}

/** Hours of a model series that come from one run (open ends are null). */
export interface RunSegment {
  run_init_time: string;
  valid_from?: string | null;
  valid_until?: string | null;
  /** Length of the run itself (last sample - init). */
  run_length_hours?: number | null;
}

/** User mode (system.md §3): normal hides configuration and model chains. */
export type AppMode = "normal" | "power";

/** App settings (system.md §8.1), stored by the backend in SQLite. */
export interface AppSettings {
  mode: AppMode;
  archive_enabled: boolean;
  archive_retention_days: number | null;
}

/** Current data folder (system.md §8.2). */
export interface DataDirInfo {
  data_dir: string;
  default_data_dir: string;
  is_default: boolean;
}

/** Parts of the data copied into a new data folder (system.md §8.2). */
export interface DataDirCopyParts {
  configuration: boolean;
  meteogram: boolean;
}

/** Size of the forecast archive (system.md §9.3). */
export interface ArchiveStats {
  fetches: number;
  bytes: number;
}

/** Configuration version an archived fetch used (system.md §9.5, Q9). */
export interface ArchivedConfigVersion {
  version_id: number;
  name: string;
  valid_from: string;
  valid_to: string | null;
}

/** One archived forecast fetch (historic viewer, system.md §10). */
export interface ArchivedFetchSummary {
  id: number;
  fetched_at: string;
  latitude: number;
  longitude: number;
  location: Location;
  mode: AppMode;
  region_id: string | null;
  chain: { main: WeatherModel[]; cloud: WeatherModel[] };
  layout_id: string | null;
  config_id: string | null;
  config_version_id: number | null;
  config_version: ArchivedConfigVersion | null;
}

/** An archived fetch rebuilt as a forecast response (#144). */
export interface HistoricForecast {
  fetch: ArchivedFetchSummary;
  forecast: HarmonizedForecastResponse;
}

/** Stored meteogram configuration (layout library, system.md §4.3). */
export interface StoredLayout {
  id: string;
  name: string;
  position: number;
  /** Built-in layout the entry was seeded from (reset target), else null. */
  builtin_id: string | null;
  /** True for the Normal mode entry: not renamable, not deletable. */
  fixed: boolean;
  /** Stored layout JSON; validated again when drawn. */
  layout: unknown;
  /** Set when the stored layout no longer validates. */
  error: string | null;
}
