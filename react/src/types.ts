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
}
