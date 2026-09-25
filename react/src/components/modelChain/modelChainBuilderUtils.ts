import type { WeatherModel, ModelMetadata } from "../../types";

/**
 * Resolves metadata for a given model from the available model catalogue,
 * performing case-insensitive ID, name, and legacy alias lookups (e.g. GFS -> GFS Seamless).
 */
export function getMetaForModel(
  model: WeatherModel,
  availableModels?: Record<string, ModelMetadata>,
): ModelMetadata | undefined {
  if (!availableModels) return undefined;
  if (model.id && availableModels[model.id]) {
    return availableModels[model.id];
  }
  if (model.name && availableModels[model.name]) {
    return availableModels[model.name];
  }
  const cleanId = (model.id || "").toLowerCase();
  const cleanName = (model.name || "")
    .toLowerCase()
    .replace(/[-_ ]+/g, " ")
    .trim();

  return Object.values(availableModels).find((m) => {
    if (cleanId && m.id && m.id.toLowerCase() === cleanId) return true;
    const mNameNorm = (m.name || "")
      .toLowerCase()
      .replace(/[-_ ]+/g, " ")
      .trim();
    const mIdNorm = (m.id || "")
      .toLowerCase()
      .replace(/[-_ ]+/g, " ")
      .trim();
    if (mNameNorm && mNameNorm === cleanName) return true;
    if (mIdNorm && mIdNorm === cleanName) return true;
    if (
      cleanName === "gfs" &&
      (m.id === "gfs_seamless" || mNameNorm === "gfs seamless")
    )
      return true;
    return false;
  });
}

/**
 * Resolves model metadata, falling back to a sensible default object if not found.
 */
export function getModelMetadataWithFallback(
  model: WeatherModel,
  availableModels?: Record<string, ModelMetadata>,
): ModelMetadata {
  const meta = getMetaForModel(model, availableModels);
  return (
    meta || {
      name: model.name,
      max_forecast_horizon_hours: model.max_forecast_horizon_hours,
      description: "Weather model",
    }
  );
}

/**
 * Validates a forecast model chain for horizon monotonicity, model availability, and capability limits.
 */
export function validateModelChain(
  chain: WeatherModel[],
  availableModels?: Record<string, ModelMetadata>,
  showMissingVariables: boolean = true,
): string[] {
  const errors: string[] = [];
  if (chain.length === 0) return errors;

  let lastHorizon = 0;
  chain.forEach((model) => {
    const meta = getMetaForModel(model, availableModels);
    const maxPossible = meta
      ? meta.max_forecast_horizon_hours ||
        meta.max_forecast_hours ||
        model.max_forecast_horizon_hours
      : model.max_forecast_horizon_hours;

    if (
      showMissingVariables &&
      (model.unavailable || (meta && meta.unavailable))
    ) {
      errors.push(`Model ${model.name} is currently unavailable.`);
    }

    if (model.max_forecast_horizon_hours < lastHorizon) {
      errors.push(
        `Transition horizon for ${model.name} (${model.max_forecast_horizon_hours}h) must be greater than or equal to previous transition (${lastHorizon}h).`,
      );
    }
    if (model.max_forecast_horizon_hours > maxPossible) {
      errors.push(
        `Transition for ${model.name} (${model.max_forecast_horizon_hours}h) exceeds model max supported horizon (${maxPossible}h).`,
      );
    }
    lastHorizon = model.max_forecast_horizon_hours;
  });

  return errors;
}

/**
 * Identifies available model keys that are not yet selected in the current chain,
 * filtering out duplicates by canonical ID and normalized name.
 */
export function getUnselectedModelKeys(
  modelChain: WeatherModel[],
  availableModels?: Record<string, ModelMetadata>,
): string[] {
  const seenCanonicalKeys = new Set<string>();
  const keys: string[] = [];

  const selectedIds = new Set(
    modelChain.map((m) => (m.id || "").toLowerCase()).filter(Boolean),
  );
  const selectedNames = new Set(modelChain.map((m) => m.name.toLowerCase()));

  if (!availableModels) return keys;

  Object.keys(availableModels).forEach((key) => {
    const meta = availableModels[key];
    if (!meta) return;

    const canonicalId = (meta.id || key).toLowerCase();
    const nameKey = (meta.name || "").toLowerCase();

    if (selectedIds.has(canonicalId) || selectedNames.has(nameKey)) {
      return;
    }

    if (seenCanonicalKeys.has(canonicalId) || seenCanonicalKeys.has(nameKey)) {
      return;
    }

    seenCanonicalKeys.add(canonicalId);
    seenCanonicalKeys.add(nameKey);
    keys.push(key);
  });

  return keys;
}

/**
 * Filters available models based on search term and sorts them alphabetically.
 */
export function filterAndSortAvailableModels(
  modelKeys: string[],
  availableModels: Record<string, ModelMetadata>,
  searchTerm: string,
): string[] {
  const term = searchTerm.toLowerCase().trim();
  const filtered = modelKeys.filter((key) => {
    const meta = availableModels[key];
    if (!meta) return false;
    if (!term) return true;
    return (
      (meta.name && meta.name.toLowerCase().includes(term)) ||
      (meta.id && meta.id.toLowerCase().includes(term)) ||
      (meta.description && meta.description.toLowerCase().includes(term))
    );
  });

  return filtered.sort((a, b) => {
    const nameA = availableModels[a]?.name || a;
    const nameB = availableModels[b]?.name || b;
    return nameA.localeCompare(nameB);
  });
}

/**
 * Reorders a model chain after a drag-and-drop event and progressively adjusts
 * forecast horizons so that each subsequent model satisfies monotonicity.
 */
export function reorderAndAdjustModelChain(
  modelChain: WeatherModel[],
  sourceIndex: number,
  targetIndex: number,
  availableModels?: Record<string, ModelMetadata>,
): WeatherModel[] {
  const newChain = [...modelChain];
  const [moved] = newChain.splice(sourceIndex, 1);
  newChain.splice(targetIndex, 0, moved);

  let currentLast = 0;
  return newChain.map((m) => {
    const meta = getMetaForModel(m, availableModels);
    const maxCapable = meta
      ? meta.max_forecast_horizon_hours ||
        meta.max_forecast_hours ||
        m.max_forecast_horizon_hours
      : m.max_forecast_horizon_hours;
    let newH = Math.min(
      maxCapable,
      Math.max(currentLast + 1, m.max_forecast_horizon_hours),
    );
    if (newH <= currentLast) {
      newH = Math.min(maxCapable, currentLast + 12);
    }
    currentLast = newH;
    return { ...m, max_forecast_horizon_hours: newH };
  });
}

export interface AddModelResult {
  success: boolean;
  error?: string;
  newChain?: WeatherModel[];
}

/**
 * Validates capability and appends a newly selected model to the end of a model chain.
 */
export function tryAddModelToChain(
  modelChain: WeatherModel[],
  modelKey: string,
  availableModels: Record<string, ModelMetadata>,
): AddModelResult {
  const meta = availableModels[modelKey];
  if (!meta) return { success: false };

  const maxHorizon =
    meta.max_forecast_horizon_hours || meta.max_forecast_hours || 24;
  const lastHorizon =
    modelChain.length > 0
      ? modelChain[modelChain.length - 1].max_forecast_horizon_hours
      : 0;

  if (maxHorizon <= lastHorizon) {
    return {
      success: false,
      error: `Model ${meta.name} max horizon (${maxHorizon}h) is <= current last transition (${lastHorizon}h).`,
    };
  }

  const newChain = [
    ...modelChain,
    { name: meta.name, id: meta.id, max_forecast_horizon_hours: maxHorizon },
  ];
  return { success: true, newChain };
}
