import type {
  AutoChainInfo,
  Location,
  MeteogramConfig,
  WeatherModel,
} from "../../types";
import {
  getNextConfigurationName,
  getDuplicateConfigurationName,
} from "../../services/apiService";
import { DEFAULT_CLOUD_MODEL_CHAIN } from "../../models/openMeteoModels";

const DEFAULT_NEW_LOCATION: Location = {
  name: "Berlin",
  latitude: 52.52,
  longitude: 13.405,
  country: "Germany",
};

const DEFAULT_MAIN_MODEL_CHAIN = [
  { name: "ICON-D2", max_forecast_horizon_hours: 48 },
  { name: "ICON-EU", max_forecast_horizon_hours: 120 },
  { name: "GFS Seamless", max_forecast_horizon_hours: 384 },
];

/**
 * Calculates the target insertion index for a new or duplicated configuration in the list.
 */
export function calculateInsertIndex(
  configs: MeteogramConfig[],
  activeConfigId?: string,
): number {
  if (!activeConfigId) return configs.length;
  const currentIdx = configs.findIndex((c) => c.id === activeConfigId);
  return currentIdx >= 0 ? currentIdx + 1 : configs.length;
}

/**
 * Builds a default configuration payload when creating a new configuration.
 */
export function createNewConfigurationPayload(
  configs: MeteogramConfig[],
  sourceLocation?: Location,
): MeteogramConfig {
  const newName = getNextConfigurationName(configs);
  const location = sourceLocation
    ? { ...sourceLocation }
    : { ...DEFAULT_NEW_LOCATION };

  return {
    name: newName,
    location,
    model_chain: DEFAULT_MAIN_MODEL_CHAIN.map((m) => ({ ...m })),
    main_model_chain: DEFAULT_MAIN_MODEL_CHAIN.map((m) => ({ ...m })),
    cloud_model_chain: DEFAULT_CLOUD_MODEL_CHAIN.map((m) => ({ ...m })),
  };
}

/**
 * Builds a duplicated configuration payload cloned from an active configuration.
 */
export function createDuplicateConfigurationPayload(
  activeConfig: MeteogramConfig,
  configs: MeteogramConfig[],
): MeteogramConfig {
  const newName = getDuplicateConfigurationName(activeConfig.name, configs);
  const sourceChain =
    activeConfig.main_model_chain || activeConfig.model_chain || [];
  const sourceCloudChain = activeConfig.cloud_model_chain || [];

  return {
    name: newName,
    location: { ...activeConfig.location },
    model_chain: sourceChain.map((m) => ({ ...m })),
    main_model_chain: sourceChain.map((m) => ({ ...m })),
    cloud_model_chain: sourceCloudChain.map((m) => ({ ...m })),
  };
}

/** Chain entries as the chain builder stores them (catalogue id + horizon). */
const toStoredChain = (chain: WeatherModel[] | undefined): WeatherModel[] =>
  (chain || []).map((m) => ({
    ...(m.id ? { id: m.id } : {}),
    name: m.name,
    ...(m.short_name ? { short_name: m.short_name } : {}),
    max_forecast_horizon_hours: m.max_forecast_horizon_hours,
  }));

/**
 * New configuration from an auto chain (system.md §6.5): the region's (or the
 * location's) main and cloud chain at `location`. Named after the region,
 * else `fallbackName`, numbered when the name is taken.
 */
export function createAutoConfigurationPayload(
  configs: MeteogramConfig[],
  location: Location,
  info: AutoChainInfo,
  fallbackName?: string,
): MeteogramConfig {
  const base =
    info.region_name?.trim() || fallbackName?.trim() || location.name || "Auto";
  const taken = configs.some(
    (c) => c.name.trim().toLowerCase() === base.toLowerCase(),
  );
  const main = toStoredChain(info.main_model_chain);
  return {
    name: taken ? getDuplicateConfigurationName(base, configs) : base,
    location: { ...location },
    model_chain: main,
    main_model_chain: main.map((m) => ({ ...m })),
    cloud_model_chain: toStoredChain(info.cloud_model_chain),
  };
}

/**
 * Builds a dictionary lookup for models by their canonical id or name.
 */
export function buildModelMap(
  models: Array<{ id?: string; name?: string }>,
): Record<string, any> {
  const modelMap: Record<string, any> = {};
  models.forEach((m) => {
    const canonicalKey = m.id || m.name;
    if (canonicalKey) {
      modelMap[canonicalKey] = m;
    }
  });
  return modelMap;
}

/**
 * Finds the initial active configuration matching selectedConfigId, or the first available.
 */
export function findInitialActiveConfig(
  configs: MeteogramConfig[],
  selectedConfigId: string | null,
): MeteogramConfig | null {
  let current = configs.find((c) => c.id === selectedConfigId);
  if (!current && configs.length > 0) {
    current = configs[0];
  }
  return current ?? null;
}

/**
 * Determines the next configuration to select after a configuration is deleted.
 */
export function getNextActiveConfigAfterDelete(
  remainingConfigs: MeteogramConfig[],
  deletedIdx: number,
): MeteogramConfig | null {
  if (remainingConfigs.length === 0) return null;
  const nextIdx = Math.min(deletedIdx, remainingConfigs.length - 1);
  return remainingConfigs[nextIdx];
}

/**
 * Reorders a configuration array moving an item from sourceIndex to targetIndex.
 */
export function reorderConfigurationsList(
  configs: MeteogramConfig[],
  sourceIndex: number,
  targetIndex: number,
): MeteogramConfig[] {
  const reordered = [...configs];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}
