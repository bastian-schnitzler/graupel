// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Documents of `@graupel/model-data` for the auto chain resolver (REQ-435) and `downloadChain` (REQ-436).
 * Catalogue, quantity registry and domains are bundled as JSON; `regions.geojson` (about 0.5 MB) is no JSON module
 * (DL system.md): it is shipped as an asset next to the page, fetched from its URL on first use and parsed.
 */
import type { DownloadData, ModelCatalogue, QuantitiesDocument, ResolverData } from "@graupel/download";
import catalogueJson from "@graupel/model-data/model_catalogue.json";
import domainsJson from "@graupel/model-data/model_domains.json";
import registryJson from "@graupel/model-data/quantities.json";
import regionsUrl from "@graupel/model-data/regions.geojson?url";

export const catalogue = catalogueJson as unknown as ModelCatalogue;
export const registry = registryJson as unknown as QuantitiesDocument;
export const domains = domainsJson as unknown as ResolverData["domains"];

/** Asset URL of `regions.geojson` (relative to the page after the build). */
export const REGIONS_URL: string = regionsUrl;

/** All documents: what `downloadChain` needs for `auto: true` and what the resolver needs. */
export type ModelData = Required<DownloadData>;

/** Fetches and parses `regions.geojson`; rejects on HTTP errors and on a document without features. */
export async function fetchRegions(
  fetchImpl: typeof fetch = fetch,
  url: string = REGIONS_URL,
): Promise<ResolverData["regions"]> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Loading the model regions failed (${response.status})`);
  const regions = JSON.parse(await response.text()) as unknown;
  if (typeof regions !== "object" || regions === null || !Array.isArray((regions as { features?: unknown }).features)) {
    throw new Error("Loading the model regions failed (no features)");
  }
  return regions as ResolverData["regions"];
}

let regionsPromise: Promise<ResolverData["regions"]> | null = null;

/** All documents; the regions are fetched once per page (again after a failure). */
export function loadModelData(): Promise<ModelData> {
  if (!regionsPromise) {
    regionsPromise = fetchRegions().catch((error: unknown) => {
      regionsPromise = null;
      throw error;
    });
  }
  return regionsPromise.then((regions) => ({ catalogue, registry, domains, regions }));
}

/** Forgets the fetched regions, so that the next `loadModelData()` fetches again (tests with their own `fetch`). */
export function resetModelData(): void {
  regionsPromise = null;
}
