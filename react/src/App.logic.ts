import type { Location, MeteogramConfig } from "./types";
import { getForecastSnapshotKey } from "./utils/appConfigSync";

export const DEFAULT_LOCATION: Location = {
  name: "Offenbach am Main",
  latitude: 50.0956,
  longitude: 8.7761,
  elevation: 98,
};

export interface AppBootResult {
  selectedConfig: MeteogramConfig | null;
  targetLoc: Location | null;
  fetchConfigId?: string;
  snapshotKey: string;
  shouldFetch: boolean;
}

/**
 * Resolves startup configuration and forecast parameters on app boot.
 */
export function resolveAppBoot(list: MeteogramConfig[]): AppBootResult {
  const runnableList = list.filter(
    (c) => c.model_chain && c.model_chain.length > 0,
  );
  if (runnableList.length > 0) {
    const startupConfig = runnableList[0];
    const targetLoc = startupConfig.location || DEFAULT_LOCATION;
    const snapshotKey = getForecastSnapshotKey(targetLoc, startupConfig);
    return {
      selectedConfig: startupConfig,
      targetLoc,
      fetchConfigId: startupConfig.id,
      snapshotKey,
      shouldFetch: true,
    };
  }

  const defaultSelected = list[0] || null;
  return {
    selectedConfig: defaultSelected,
    targetLoc: null,
    fetchConfigId: undefined,
    snapshotKey: "",
    shouldFetch: false,
  };
}

/**
 * Merges a saved configuration response with user edits, preserving elevation if missing in response.
 */
export function mergeSavedConfigLocation(
  saved: MeteogramConfig,
  updatedConfig: MeteogramConfig,
): MeteogramConfig {
  return {
    ...saved,
    location: {
      ...updatedConfig.location,
      ...saved.location,
      elevation: saved.location?.elevation ?? updatedConfig.location?.elevation,
    },
  };
}

/**
 * Filters configurations that contain at least one weather model.
 */
export function filterMeteogramConfigs(
  configs: MeteogramConfig[],
): MeteogramConfig[] {
  return configs.filter((c) => c.model_chain && c.model_chain.length > 0);
}

/**
 * Resolves state updates when location changes from the header in either tab.
 */
export function resolveHeaderLocationChange(
  activeTab: "meteogram" | "config",
  selectedConfig: MeteogramConfig | null,
  newLoc: Location,
): {
  updatedConfigToSave?: MeteogramConfig;
  sessionLocationOverride?: Location;
  fetchForecastArgs?: { loc: Location; configId?: string };
} {
  if (activeTab === "config") {
    if (!selectedConfig) return {};
    const updated = {
      ...selectedConfig,
      location: newLoc,
    };
    return {
      updatedConfigToSave: updated,
    };
  }
  return {
    sessionLocationOverride: newLoc,
    fetchForecastArgs: { loc: newLoc, configId: selectedConfig?.id },
  };
}
