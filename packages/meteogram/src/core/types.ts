// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Data types the calculation functions work on. They follow the forecast
 * format of the download library (one `DataPoint` per hour, quantity and
 * model); the meteogram input format builds on them.
 */

/** Place the forecast belongs to. */
export interface Location {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  elevation?: number;
  timezone?: string;
}

/** One value of one quantity of one model at one hour (UTC timestamp). */
export interface DataPoint {
  timestamp: string;
  value: number | null;
  unit: string;
  variable: string;
  model: string;
}

/**
 * A model of a model chain. `max_forecast_horizon_hours` is the end of the
 * model's slice in hours from the forecast start.
 */
export interface WeatherModel {
  name: string;
  id?: string;
  /** Catalogue nickname for the model header. */
  short_name?: string | null;
  max_forecast_horizon_hours: number;
  /** Quantities the model delivers (optional quantities such as LPI). */
  supported_variables?: string[];
}

/** Catalogue entry of a model, looked up by id or name. */
export type ModelInfo = Partial<WeatherModel>;

/** Hours of a model series that come from one run (open ends are null). */
export interface RunSegment {
  run_init_time: string;
  valid_from?: string | null;
  valid_until?: string | null;
  /** Length of the run itself (last sample - init). */
  run_length_hours?: number | null;
}

/** Sunrise and sunset of one local day. */
export interface SunPeriod {
  day: string;
  sunrise: string;
  sunset: string;
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

/** Hand-over between two models of the cloud chain. */
export interface VerticalCloudTransition {
  timestamp: string;
  from_model: string;
  to_model: string;
}
