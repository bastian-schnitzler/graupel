// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Documents of @graupel/model-data for the tests (`.geojson` is no JSON module, so all are read from disk).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CatalogueModel, ModelCatalogue, QuantitiesDocument, ResolverData } from "../src/index";

const require = createRequire(import.meta.url);

function load<T>(file: string): T {
  return JSON.parse(readFileSync(require.resolve(`@graupel/model-data/${file}`), "utf8")) as T;
}

export const catalogue = load<ModelCatalogue>("model_catalogue.json");
export const registry = load<QuantitiesDocument>("quantities.json");
export const resolverData: ResolverData = {
  catalogue,
  domains: load("model_domains.json"),
  regions: load("regions.geojson"),
};
export const resolverCases = load<{
  cases: {
    name: string;
    lat: number;
    lon: number;
    region_id: string | null;
    resolution_reason: string;
    main_chain_ids: string[];
    cloud_chain_ids: string[];
  }[];
}>("resolver_cases.json");

/**
 * An optional catalogued quantity for the tests of the gating by `supported_variables`. The registry has none since
 * CAPE, CIN and LPI were dropped (REQ-453); ICON-D2 lists this one, ICON-EU does not.
 */
export const GATED = "gated_index";
export const gatedRegistry: QuantitiesDocument = {
  ...registry,
  quantities: [
    ...registry.quantities,
    {
      id: GATED,
      label: "Gated",
      unit: "J/kg",
      kind: "point",
      source: "hourly",
      api_name: GATED,
      aliases: ["gix"],
      optional: true,
      catalogued: true,
      always_fetch: false,
      unit_from_api: false,
      retry_without: false,
      ensemble: false,
      allowed_styles: ["line", "tooltip"],
      requires: [],
      downloadable: true,
      color: null,
    },
  ],
};
const catalogueModels: readonly CatalogueModel[] = "models" in catalogue ? catalogue.models : catalogue;
export const gatedCatalogue: ModelCatalogue = {
  models: catalogueModels.map((model) =>
    model.id === "icon_d2" ? { ...model, supported_variables: [...(model.supported_variables ?? []), GATED] } : model,
  ),
};
