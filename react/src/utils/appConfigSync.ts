import type { Location, MeteogramConfig } from '../types';

/**
 * Computes a unique string snapshot key for the forecast inputs (location + configuration).
 * Used to detect whether a refetch is needed.
 */
export function getForecastSnapshotKey(
  loc: Location,
  config: MeteogramConfig | null,
): string {
  if (!config) {
    return `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
  }
  const mainChain = config.main_model_chain || config.model_chain || [];
  const chainKey = mainChain
    .map((m) => `${m.name}:${m.max_forecast_horizon_hours}`)
    .join('|');
  const cloudChain = config.cloud_model_chain || [];
  const cloudKey = cloudChain
    .map((m) => `${m.name}:${m.max_forecast_horizon_hours}`)
    .join('|');
  const locKey = `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`;
  return `${locKey}_${config.id || ''}_${config.name || ''}_${chainKey}_cloud_${cloudKey}`;
}

/**
 * Creates a mapping of config ID (or name) to serialized JSON string for change tracking.
 */
export function createConfigSnapshots(
  configs: MeteogramConfig[],
): Record<string, string> {
  const snaps: Record<string, string> = {};
  for (const cfg of configs) {
    const id = cfg.id || cfg.name;
    if (id) {
      snaps[id] = JSON.stringify(cfg);
    }
  }
  return snaps;
}

/**
 * Identifies configuration IDs that were created, updated, or deleted
 * compared to a previously captured snapshot map.
 */
export function getChangedConfigIds(
  prevSnapshots: Record<string, string>,
  currentConfigs: MeteogramConfig[],
): Set<string> {
  const changedConfigIds = new Set<string>();

  for (const cfg of currentConfigs) {
    const id = cfg.id || cfg.name;
    if (!id) continue;
    const prevSnap = prevSnapshots[id];
    const currSnap = JSON.stringify(cfg);
    if (!prevSnap || prevSnap !== currSnap) {
      changedConfigIds.add(id);
    }
  }

  for (const prevId of Object.keys(prevSnapshots)) {
    if (!currentConfigs.some((c) => (c.id || c.name) === prevId)) {
      changedConfigIds.add(prevId);
    }
  }

  return changedConfigIds;
}

/**
 * Prunes ephemeral display chain entries for configuration IDs that have changed.
 */
export function pruneEphemeralChains<T>(
  prevChains: Record<string, T>,
  changedConfigIds: Set<string>,
): Record<string, T> {
  if (changedConfigIds.size === 0) return prevChains;
  let hasChange = false;
  const next = { ...prevChains };
  for (const id of changedConfigIds) {
    if (next[id]) {
      delete next[id];
      hasChange = true;
    }
  }
  return hasChange ? next : prevChains;
}

/**
 * Prunes ephemeral display chains whose stored config changed relative to a snapshot.
 */
export function pruneModifiedChainsAgainstSnapshot<T>(
  prevChains: Record<string, T>,
  currentConfigs: MeteogramConfig[],
  snapshots: Record<string, string>,
): Record<string, T> {
  const nextChains = { ...prevChains };
  let modified = false;
  for (const cfg of currentConfigs) {
    const id = cfg.id || cfg.name;
    if (!id) continue;
    const snap = snapshots[id];
    if (snap && snap !== JSON.stringify(cfg) && nextChains[id]) {
      delete nextChains[id];
      modified = true;
    }
  }
  return modified ? nextChains : prevChains;
}

interface ShouldRefetchParams {
  currentConfigId?: string;
  leavingConfigId: string | null;
  changedConfigIds: Set<string>;
  currentKey: string;
  lastLoadedKey: string;
}

/**
 * Checks whether forecast data should be re-fetched upon navigating back to Meteogram View.
 */
export function shouldRefetchForecastOnTabSwitch({
  currentConfigId,
  leavingConfigId,
  changedConfigIds,
  currentKey,
  lastLoadedKey,
}: ShouldRefetchParams): boolean {
  const wasActiveConfigChanged = Boolean(
    currentConfigId && changedConfigIds.has(currentConfigId),
  );
  const wasDifferentConfigSelected = currentConfigId !== leavingConfigId;
  const locationOrSnapshotChanged = currentKey !== lastLoadedKey;

  return wasActiveConfigChanged || wasDifferentConfigSelected || locationOrSnapshotChanged;
}

