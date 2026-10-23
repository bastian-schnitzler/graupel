import type {
  HarmonizedForecastResponse,
  Location,
  MeteogramConfig,
} from "../types";
import { AUTO_CONFIG_ID } from "./autoChain";

/**
 * In-memory session cache of fetched forecasts (system.md §16.13, #177).
 * Lives as long as the program; no size limit, no expiry, never persisted.
 */
export type ForecastCache = Map<string, HarmonizedForecastResponse>;

function chainKey(chain: MeteogramConfig["model_chain"] | undefined): string {
  return (chain || [])
    .map((m) => `${m.name}:${m.max_forecast_horizon_hours}`)
    .join("|");
}

/**
 * Cache key: location (4-decimal rounding, as `location_history`) plus the
 * main and cloud chain content. Configuration id, name, display name and
 * layout are left out, since they never change the fetched data. Auto chain
 * forecasts get their own keys: they drop models without data (system.md §3.3).
 */
export function getForecastCacheKey(
  loc: Location,
  config: MeteogramConfig | null,
): string {
  const locKey = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
  const main = config?.main_model_chain || config?.model_chain;
  const kind = config?.id === AUTO_CONFIG_ID ? "auto_" : "";
  return `${kind}${locKey}_main_${chainKey(main)}_cloud_${chainKey(config?.cloud_model_chain)}`;
}
