// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { ModelInfo, WeatherModel } from "./types";

const normalizeName = (value: string | undefined) =>
  (value || "").toLowerCase().replace(/[-_ ]+/g, " ").trim();

/**
 * Catalogue entry of a chain model: by id, by name, then by a normalized
 * name or id ("ICON-D2" matches "icon_d2").
 */
export function getMetaForModel(
  model: WeatherModel,
  availableModels?: Record<string, ModelInfo>,
): ModelInfo | undefined {
  if (!availableModels) return undefined;
  if (model.id && availableModels[model.id]) {
    return availableModels[model.id];
  }
  if (model.name && availableModels[model.name]) {
    return availableModels[model.name];
  }
  const cleanId = (model.id || "").toLowerCase();
  const cleanName = normalizeName(model.name);

  return Object.values(availableModels).find((m) => {
    if (cleanId && m.id && m.id.toLowerCase() === cleanId) return true;
    const mNameNorm = normalizeName(m.name);
    const mIdNorm = normalizeName(m.id);
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
