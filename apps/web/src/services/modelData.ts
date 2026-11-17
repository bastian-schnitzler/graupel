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

/**
 * Time limit of the regions request, body included (REQ-861): a request that hangs fails, so that the next try of the
 * forecast fetches anew instead of waiting for the same request forever. The document (about 0.5 MB, less compressed)
 * takes some 10 s at 400 kbit/s; 30 s stays below the time limit of a whole load (`LOAD_TIMEOUT_MS`).
 */
export const REGIONS_TIMEOUT_MS = 30_000;

/**
 * Fetches and parses `regions.geojson`; rejects on HTTP errors, on a document without features and when it takes
 * longer than `timeoutMs` (REQ-861).
 */
export async function fetchRegions(
  fetchImpl: typeof fetch = fetch,
  url: string = REGIONS_URL,
  timeoutMs: number = REGIONS_TIMEOUT_MS,
): Promise<ResolverData["regions"]> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Loading the model regions timed out", "TimeoutError")),
    timeoutMs,
  );
  let text: string;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
    text = await response.text();
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Loading the model regions failed (${response.status})`);
  const regions = JSON.parse(text) as unknown;
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
