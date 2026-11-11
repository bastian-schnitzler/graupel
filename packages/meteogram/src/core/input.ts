// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Input format of the meteogram (`MeteogramInput`, DEC-012). The download
 * library delivers a matching result; the meteogram only reads it.
 */
import type {
  DataPoint,
  DetailedCloudForecast,
  Location,
  RunSegment,
  SunPeriod,
  VerticalCloudTransition,
  WeatherModel,
} from "./types";

/** One model of the stitched model chain. */
export interface MeteogramChainModel {
  /** Model name as used in `DataPoint.model`. */
  model: string;
  /** Catalogue id (e.g. "icon_d2"). */
  id?: string;
  /** Short name for narrow model headers (e.g. "D2"). */
  shortName?: string | null;
  /**
   * End of the model's slice in hours after `timeline.now` (the forecast
   * start); the slice starts where the previous model's slice ends.
   */
  sliceEndHours: number;
  /** Runs the model's hours come from (newest first); headers split per run. */
  runSegments?: RunSegment[];
  /** Optional quantities the model delivers (e.g. "lightning_potential"). */
  supportedVariables?: string[];
}

export interface MeteogramInput {
  location?: Location | null;
  /** IANA time zone of the day header and labels; "auto" or missing: the location's, else UTC. */
  timezone?: string;
  /**
   * Displayed range (UTC ISO). `start`/`end` default to the first data hour
   * and the end of the last one; `now` is the forecast start the model slices
   * are counted from (default: `start`).
   */
  timeline?: { start?: string; end?: string; now?: string };
  chain: MeteogramChainModel[];
  /** Stitched hourly values of the chain. */
  series: DataPoint[];
  /** Raw values per model; axis extremes cover them, so moving model boundaries does not shift an axis. */
  modelSeries?: Record<string, DataPoint[]>;
  /** Vertical cloud profile (background of an area with a `vertical_cloud_profile` background). */
  cloudProfile?: DetailedCloudForecast | null;
  /** Hand-overs of the cloud chain. */
  cloudTransitions?: VerticalCloudTransition[];
  sunPhases?: SunPeriod[];
  /** UTC instant the forecast was generated (location label, PNG time line). */
  generatedAt?: string;
}

/** Chain models in the shape of the calculation functions. */
export function chainToWeatherModels(chain: MeteogramChainModel[]): WeatherModel[] {
  return chain.map((entry) => {
    const model: WeatherModel = {
      name: entry.model,
      max_forecast_horizon_hours: entry.sliceEndHours,
    };
    if (entry.id !== undefined) model.id = entry.id;
    if (entry.shortName !== undefined) model.short_name = entry.shortName;
    if (entry.supportedVariables !== undefined) {
      model.supported_variables = entry.supportedVariables;
    }
    return model;
  });
}

/** Run segments per model name. */
export function chainRunSegments(
  chain: MeteogramChainModel[],
): Record<string, RunSegment[] | undefined> {
  return Object.fromEntries(chain.map((entry) => [entry.model, entry.runSegments]));
}
