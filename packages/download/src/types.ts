// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Data types of the download library. Field names are in snake case, like
 * the JSON of the forecast response. All timestamps are UTC
 * instants in ISO 8601 with a trailing "Z".
 */

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
  /** Short catalogue name of the model, e.g. "ICON-D2". */
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
  /** Attribution of the data (Open-Meteo, CC BY 4.0). */
  attribution?: DataAttributionResponse;
}

/**
 * Location-based chains. On a forecast response the chains are
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
  /** Main chain models without current data and the models that took their slices (REQ-767). */
  replaced_models?: { model: string; replacement: string }[];
}

/**
 * A resolved chain without its own region: a
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

/** Auto chain region without geometry. */
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

/**
 * One model of a stitched chain, in the shape of the meteogram's chain
 * entries (`MeteogramChainModel` of `@graupel/meteogram`).
 */
export interface ChainModelResult {
  /** Model name as used in `DataPoint.model`. */
  model: string;
  /** Catalogue / Open-Meteo id, e.g. "icon_d2". */
  id?: string;
  shortName?: string | null;
  /** End of the model's slice in hours after `timeline.now`, capped to its latest run. */
  sliceEndHours: number;
  /** Configured end of the slice before capping. */
  configuredHours: number;
  /** Runs the model's hours come from, newest first. */
  runSegments?: RunSegment[];
  /** Variables the catalogue lists for the model. */
  supportedVariables?: string[];
  /**
   * The chain model this one stands in for because that one delivers no current data (REQ-767): it took that model's
   * slice. Missing for a model of the chain as configured.
   */
  replaces?: ReplacedModel;
}

/** A main chain model without current data that another model replaced (REQ-767). */
export interface ReplacedModel {
  /** Model name as configured in the chain. */
  model: string;
  /** Catalogue / Open-Meteo id. */
  id?: string;
  shortName?: string | null;
}

/**
 * Attribution of the weather data. Open-Meteo data are licensed under
 * CC BY 4.0: whoever displays them shows the text with the link and names the
 * license and the changes (harmonized and combined from several models).
 */
export interface DataAttribution {
  /** "Weather data by Open-Meteo.com". */
  text: string;
  /** Link of the source, https://open-meteo.com/. */
  url: string;
  /** "CC BY 4.0". */
  license: string;
  /** https://creativecommons.org/licenses/by/4.0/ */
  licenseUrl: string;
  /** Note on the changes made to the data. */
  modifications: string;
}

/** `DataAttribution` in the snake-case shape of `HarmonizedForecastResponse`. */
export interface DataAttributionResponse {
  text: string;
  url: string;
  license: string;
  license_url: string;
  modifications: string;
}

/** Result of `downloadChain`; all timestamps are UTC ISO instants with "Z". */
export interface ForecastResult {
  location: Location;
  /** IANA time zone that defines "yesterday 00:00" (the timeline start). */
  timezone: string;
  /** Visible range: `start` = yesterday 00:00 local, `now` = forecast start (full hour), `end` exclusive. */
  timeline: { start: string; now: string; end: string };
  /** Stitched main chain (models with an empty slice left out). */
  chain: ChainModelResult[];
  /** Stitched cloud chain (empty without cloud chain). */
  cloudChain: ChainModelResult[];
  /** Stitched hourly values: each hour and quantity from the model owning the hour; gaps stay null. */
  combined: DataPoint[];
  /** Each model's own harmonized series over its whole fetched window. */
  byModel: Record<string, DataPoint[]>;
  /** Stitched vertical cloud profile, null without cloud chain. */
  cloud: DetailedCloudForecast | null;
  /** Each cloud model's own profiles, by model name. */
  cloudByModel: Record<string, DetailedCloudForecast>;
  cloudTransitions: VerticalCloudTransition[];
  sunPhases: SunPeriod[];
  /** Run availability per main model name. */
  availability: Record<string, ModelAvailability>;
  /** Run availability per cloud model name. */
  cloudAvailability: Record<string, ModelAvailability>;
  /** Run segments per main model name (empty when switched off). */
  runSegments: Record<string, RunSegment[]>;
  /** Coverage of each requested quantity per main model. */
  diagnostics: Record<string, ModelTimelineDiagnostics>;
  /** Only with `auto`: the resolved chains as actually stitched. */
  autoChain?: AutoChainInfo;
  /** Raw series as received (after the `nan` repair), per model and variable. */
  raw: RawForecastData[];
  /** Errors of models that failed, by model name (their slices stay empty). */
  errors: Record<string, unknown>;
  /** Non-fatal problems (gaps, failed metadata, failed sun times, …). */
  warnings: string[];
  /** UTC instant the result was generated. */
  generatedAt: string;
  /** Attribution of the data (Open-Meteo, CC BY 4.0); show it wherever the data are displayed. */
  attribution: DataAttribution;
}
