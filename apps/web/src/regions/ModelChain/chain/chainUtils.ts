// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Chain helpers of the model chain block, on the weather models of `@graupel/download`: catalogue metadata and labels of chain models.
 */
import type { WeatherModel } from "@graupel/download";
import type { ModelMeta } from "../../../state/chain.ts";

export type { ModelMeta };

/** Model catalogue as the block uses it: catalogue id → model with the catalogue horizon. */
export type AvailableModels = Readonly<Record<string, ModelMeta>>;

function normalized(text: string | undefined | null): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[-_ ]+/g, " ")
    .trim();
}

/**
 * Metadata of a chain model from the catalogue: by id, then by name, then case-insensitive and with the legacy
 * alias GFS → GFS Seamless.
 */
export function getMetaForModel(model: WeatherModel, availableModels?: AvailableModels): ModelMeta | undefined {
  if (!availableModels) return undefined;
  if (model.id && availableModels[model.id]) return availableModels[model.id];
  if (model.name && availableModels[model.name]) return availableModels[model.name];
  const cleanId = (model.id ?? "").toLowerCase();
  const cleanName = normalized(model.name);
  return Object.values(availableModels).find((m) => {
    if (cleanId && m.id && m.id.toLowerCase() === cleanId) return true;
    const name = normalized(m.name);
    const id = normalized(m.id);
    if (name && name === cleanName) return true;
    if (id && id === cleanName) return true;
    return cleanName === "gfs" && (m.id === "gfs_seamless" || m.id === "ncep_gfs_seamless" || name === "gfs seamless");
  });
}

/** Metadata of a chain model, or the model itself when the catalogue does not know it. */
export function getModelMetadataWithFallback(model: WeatherModel, availableModels?: AvailableModels): ModelMeta {
  return getMetaForModel(model, availableModels) ?? { ...model };
}

/** Longest run of a model (catalogue horizon); without metadata the model's own end. */
export function capabilityOf(model: WeatherModel, availableModels?: AvailableModels): number {
  const meta = getMetaForModel(model, availableModels);
  return meta
    ? meta.max_forecast_horizon_hours || meta.max_forecast_hours || model.max_forecast_horizon_hours
    : model.max_forecast_horizon_hours;
}

/** Card label: the short catalogue name, else the name. */
export function modelLabel(model: WeatherModel): string {
  return model.short_name || model.name;
}
