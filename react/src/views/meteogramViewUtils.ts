import type {
  HarmonizedForecastResponse,
  WeatherModel,
  DataPoint,
  Location,
  DetailedCloudForecast,
  VerticalCloudTransition,
  MeteogramConfig,
} from "../types";
import {
  mergeForecastSegments,
  mergeVerticalCloudSegments,
} from "../services/apiService";
import {
  canonicalTimestamp,
  getBoundaryTimestamp,
  normalizeTimestamp,
} from "../utils/timeline";

export const FORECAST_VARIABLES = [
  "temperature",
  "apparent_temperature",
  "wind_speed",
  "wind_gusts",
  "wind_direction",
  "cloud_cover",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "cape",
  "convective_inhibition",
  "lightning_potential",
];

/**
 * Calculates the active timeline end timestamp constrained by the outermost
 * model's max forecast horizon and the backend's fetched timeline end.
 */
export function calculateActiveTimelineEnd(
  forecastStartTime?: string,
  modelChain?: WeatherModel[],
  timelineEnd?: string,
): string | undefined {
  if (!forecastStartTime || !modelChain || modelChain.length === 0) {
    return timelineEnd;
  }
  const activeEnd = getBoundaryTimestamp(
    forecastStartTime,
    modelChain[modelChain.length - 1].max_forecast_horizon_hours,
  );
  const fetchedEnd = timelineEnd ? normalizeTimestamp(timelineEnd) : activeEnd;
  return canonicalTimestamp(Math.min(activeEnd, fetchedEnd));
}

/**
 * Logs warnings in development mode for any model variable timeline gaps or coverage dropouts.
 */
export function logTimelineDiagnostics(
  diagnostics?: Record<string, any>,
): void {
  if (!diagnostics) return;
  Object.values(diagnostics).forEach((modelDiagnostic) => {
    Object.values(modelDiagnostic.variables).forEach((coverage: any) => {
      if (
        !coverage.complete &&
        ![
          "cape",
          "convective_inhibition",
          "lightning_potential",
          "weather_code",
        ].includes(coverage.variable)
      ) {
        console.warn(
          `${modelDiagnostic.model} / ${coverage.variable}: expected data through ` +
            `${coverage.expected_last_timestamp} before boundary ` +
            `${coverage.expected_end_exclusive}; received valid data through ` +
            `${coverage.last_valid_timestamp}`,
        );
      }
    });
  });
}

/**
 * Merges multi-model forecast segments according to the active model chain boundaries.
 */
export function resolveActiveCombinedForecast(
  forecastResponse: HarmonizedForecastResponse | null | undefined,
  activeModelChain: WeatherModel[],
  activeTimelineEnd?: string,
): DataPoint[] {
  if (!forecastResponse || !forecastResponse.model_forecasts) {
    return forecastResponse?.combined_forecast || [];
  }

  return mergeForecastSegments(
    activeModelChain,
    forecastResponse.model_forecasts,
    FORECAST_VARIABLES,
    forecastResponse.forecast_start_time,
    forecastResponse.timeline_start,
    activeTimelineEnd,
  );
}

/**
 * Merges detailed vertical cloud profiles across the active cloud model chain.
 */
export function resolveActiveVerticalCloudData(
  forecastResponse: HarmonizedForecastResponse | null | undefined,
  activeCloudModelChain: WeatherModel[],
  activeCombinedForecast: DataPoint[],
  selectedLocation: Location,
): {
  verticalCloudForecast?: DetailedCloudForecast | null;
  verticalCloudTransitions: VerticalCloudTransition[];
} {
  if (!forecastResponse || activeCloudModelChain.length === 0) {
    return {
      verticalCloudForecast: undefined,
      verticalCloudTransitions: [],
    };
  }

  if (forecastResponse.vertical_cloud_model_forecasts) {
    const timestamps = Array.from(
      new Set(activeCombinedForecast.map((p) => p.timestamp)),
    ).sort();

    return mergeVerticalCloudSegments(
      activeCloudModelChain,
      forecastResponse.vertical_cloud_model_forecasts,
      timestamps,
      forecastResponse.forecast_start_time,
      selectedLocation,
    );
  }

  return {
    verticalCloudForecast: forecastResponse.vertical_cloud_forecast,
    verticalCloudTransitions: forecastResponse.vertical_cloud_transitions || [],
  };
}

export const DEFAULT_MAIN_CHAIN: WeatherModel[] = [
  { name: "ICON-D2", max_forecast_horizon_hours: 48 },
  { name: "ICON-EU", max_forecast_horizon_hours: 120 },
  { name: "GFS", max_forecast_horizon_hours: 384 },
];

/**
 * Resolves the target main model chain prioritizing active display override
 * over config chains, with default fallback.
 */
export function resolveTargetModelChain(
  displayModelChain?: WeatherModel[],
  currentConfig?: MeteogramConfig | null,
): WeatherModel[] | undefined {
  return (
    displayModelChain ||
    currentConfig?.main_model_chain ||
    currentConfig?.model_chain
  );
}

/**
 * Resolves the target cloud model chain prioritizing active display override
 * over config cloud chain, with default fallback.
 */
export function resolveTargetCloudChain(
  displayCloudModelChain?: WeatherModel[],
  currentConfig?: MeteogramConfig | null,
  defaultCloudChain: WeatherModel[] = [],
): WeatherModel[] {
  if (displayCloudModelChain !== undefined) return displayCloudModelChain;
  if (currentConfig?.cloud_model_chain !== undefined)
    return currentConfig.cloud_model_chain;
  return defaultCloudChain;
}

/**
 * Calculates proportional scale factor for embedded meteogram chart to fit within
 * available vertical space without causing page-level vertical scrollbars.
 */
export function calculateMeteogramScale({
  availableHeight,
  naturalHeight,
}: {
  availableHeight: number;
  naturalHeight: number;
}): number {
  if (!availableHeight || availableHeight <= 0 || !naturalHeight || naturalHeight <= 0) {
    return 1;
  }
  if (availableHeight >= naturalHeight) {
    return 1;
  }
  return Math.min(1, Math.max(0.25, availableHeight / naturalHeight));
}
