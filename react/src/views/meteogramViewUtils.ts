import type {
  HarmonizedForecastResponse,
  WeatherModel,
  DataPoint,
  Location,
  DetailedCloudForecast,
  VerticalCloudTransition,
  MeteogramConfig,
  ModelAvailability,
  ModelMetadata,
} from "../types";
import { getModelMeta } from "../components/modelChain/modelChainLayout";
import { missingDerivedSources } from "../quantities/derivedQuantities";
import {
  mergeForecastSegments,
  mergeVerticalCloudSegments,
} from "../services/apiService";
import {
  canonicalTimestamp,
  getBoundaryTimestamp,
  normalizeTimestamp,
} from "../utils/timeline";
import { hourlyQuantityIds, isOptionalQuantity } from "../quantities/registry";

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
      if (!coverage.complete && !isOptionalQuantity(coverage.variable)) {
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
    hourlyQuantityIds(),
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

/**
 * Moves each boundary to the hours the model's latest run delivers, so the
 * next model starts right there. Boundaries stay non-decreasing; models
 * without availability info keep their horizon.
 */
export function capChainToAvailability(
  chain: WeatherModel[],
  availability?: Record<string, ModelAvailability>,
): WeatherModel[] {
  if (!availability || Object.keys(availability).length === 0) return chain;
  let previous = 0;
  let changed = false;
  const capped = chain.map((model) => {
    let horizon = model.max_forecast_horizon_hours;
    const available = availability[model.name]?.available_hours;
    if (typeof available === "number") {
      horizon = Math.min(horizon, available);
    }
    horizon = Math.max(horizon, previous);
    previous = horizon;
    if (horizon === model.max_forecast_horizon_hours) return model;
    changed = true;
    return { ...model, max_forecast_horizon_hours: horizon };
  });
  return changed ? capped : chain;
}

/**
 * Applies a chain emitted by dragging the capped chain back to the requested
 * (uncapped) chain: only boundaries the user moved change, all others keep
 * their requested horizon so a later, longer run can extend them again.
 */
export function mergeDraggedChain(
  requested: WeatherModel[],
  capped: WeatherModel[],
  dragged: WeatherModel[],
): WeatherModel[] {
  if (requested.length !== dragged.length || capped.length !== dragged.length) {
    return dragged;
  }
  return dragged.map((model, idx) =>
    model.max_forecast_horizon_hours === capped[idx].max_forecast_horizon_hours
      ? requested[idx]
      : model,
  );
}

/**
 * Metadata for the Meteogram View chain cards: "Max" and the drag limit show
 * the hours the latest run delivers, and the run time is attached.
 */
export function applyAvailabilityToMetadata(
  availableModels: Record<string, ModelMetadata>,
  chain: WeatherModel[],
  availability?: Record<string, ModelAvailability>,
  forecastStartTime?: string | null,
): Record<string, ModelMetadata> {
  if (!availability || Object.keys(availability).length === 0) {
    return availableModels;
  }
  const result = { ...availableModels };
  const displayedChain = capChainToAvailability(chain, availability);
  chain.forEach((model, idx) => {
    const info = availability[model.name];
    if (!info) return;
    const meta = getModelMeta(model, availableModels);
    const capability =
      meta?.max_forecast_horizon_hours ||
      meta?.max_forecast_hours ||
      model.max_forecast_horizon_hours;
    const available =
      typeof info.available_hours === "number"
        ? Math.min(capability, info.available_hours)
        : capability;
    const overridden: ModelMetadata = {
      ...(meta || { name: model.name }),
      max_forecast_horizon_hours: available,
      max_forecast_hours: available,
      last_run_init_time: info.last_run_init_time ?? null,
      data_end_run_init_time: info.data_end_run_init_time ?? null,
      horizon_info: {
        catalogue_hours: capability,
        available_hours: available,
        limited_by_run:
          typeof info.available_hours === "number" &&
          info.available_hours < capability,
        forecast_start_time: forecastStartTime ?? null,
        run_segments: info.run_segments ?? [],
        run_init_time: info.last_run_init_time ?? null,
        run_availability_time: info.last_run_availability_time ?? null,
        slice_start_hours:
          idx > 0 ? displayedChain[idx - 1].max_forecast_horizon_hours : 0,
        slice_end_hours: displayedChain[idx].max_forecast_horizon_hours,
        ensemble: info.ensemble ?? null,
        probability_valid_until: info.probability_valid_until ?? null,
      },
    };
    result[model.name] = overridden;
    if (model.id) result[model.id] = overridden;
  });
  return result;
}

/**
 * Metadata for the Meteogram View chain cards with the sources of drawn
 * derived quantities each model delivers no data for (card warning).
 */
export function applyMissingSourcesToMetadata(
  availableModels: Record<string, ModelMetadata>,
  chain: WeatherModel[],
  drawnQuantities: Set<string>,
  modelForecasts?: Record<string, DataPoint[]>,
): Record<string, ModelMetadata> {
  if (!modelForecasts) return availableModels;
  let result = availableModels;
  chain.forEach((model) => {
    const missing = missingDerivedSources(
      drawnQuantities,
      modelForecasts[model.name],
    );
    if (missing.length === 0) return;
    if (result === availableModels) result = { ...availableModels };
    const meta = getModelMeta(model, availableModels);
    const withWarning: ModelMetadata = {
      ...(meta || model),
      missing_sources: missing,
    };
    result[model.name] = withWarning;
    if (model.id) result[model.id] = withWarning;
  });
  return result;
}
