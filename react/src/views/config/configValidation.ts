import type { MeteogramConfig, ModelMetadata } from '../../types';
import { isCloudCompatibleModel } from '../../services/apiService';

/**
 * Validates whether a configuration is valid and ready to be persisted to backend SQLite storage.
 * Checks name, location coordinates, main model chain monotonicity, and cloud chain monotonicity.
 */
export function isValidConfig(
  cfg: MeteogramConfig,
  availableModels: Record<string, ModelMetadata> = {},
): boolean {
  if (!cfg.name || cfg.name.trim().length === 0) return false;
  if (!cfg.location || !cfg.location.name || cfg.location.name.trim().length === 0) return false;
  if (isNaN(cfg.location.latitude) || cfg.location.latitude < -90 || cfg.location.latitude > 90) return false;
  if (isNaN(cfg.location.longitude) || cfg.location.longitude < -180 || cfg.location.longitude > 180) return false;

  const mainChain = cfg.main_model_chain || cfg.model_chain;
  if (!mainChain) return false;

  let lastHorizon = 0;
  for (const m of mainChain) {
    if (!m.name || m.max_forecast_horizon_hours < lastHorizon) return false;
    const meta = availableModels[m.name];
    if (meta && m.max_forecast_horizon_hours > meta.max_forecast_horizon_hours) return false;
    lastHorizon = m.max_forecast_horizon_hours;
  }

  if (cfg.cloud_model_chain && Array.isArray(cfg.cloud_model_chain)) {
    let lastCloudHorizon = 0;
    for (const m of cfg.cloud_model_chain) {
      if (!m.name || m.max_forecast_horizon_hours < lastCloudHorizon) return false;
      lastCloudHorizon = m.max_forecast_horizon_hours;
    }
  }

  return true;
}

/**
 * Filters the model catalogue for models supporting vertical cloud profiles
 * and clears their missing variables to avoid spurious warnings in cloud-specific editors.
 */
export function filterCloudCompatibleModels(
  availableModels: Record<string, ModelMetadata>,
): Record<string, ModelMetadata> {
  const res: Record<string, ModelMetadata> = {};
  Object.entries(availableModels).forEach(([k, m]) => {
    if (isCloudCompatibleModel(m)) {
      res[k] = {
        ...m,
        missing_variables: [],
      };
    }
  });
  return res;
}
