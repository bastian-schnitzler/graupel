import type {
  ArchivedConfigVersion,
  ArchivedFetchSummary,
  HarmonizedForecastResponse,
  MeteogramConfig,
} from "../types";
import { formatModelRunTime } from "../components/modelChain/modelChainBuilderUtils";
import { getQuantity } from "../quantities/registry";

/** Id prefix of the pseudo configuration a historic fetch is drawn with. */
export const HISTORIC_CONFIG_PREFIX = "historic-";

const CLOUD_PROFILE = "vertical_cloud_profile";

/** Badge text: `historic: fetched 21.10. 08:00` (local time). */
export function formatHistoricBadge(
  fetchedAt: string,
  timeZone?: string,
): string {
  return `historic: fetched ${formatModelRunTime(fetchedAt, timeZone) ?? "?"}`;
}

/** Main chain of a fetch: short names joined by arrows. */
export function formatArchivedChain(fetch: ArchivedFetchSummary): string {
  return (fetch.chain.main ?? [])
    .map((model) => model.short_name || model.name)
    .join(" → ");
}

/**
 * Configuration version of a fetch (Q9): name and validity, e.g.
 * `Alpen · 18.10. 12:00 – now`.
 */
export function formatConfigVersion(
  version: ArchivedConfigVersion | null,
  timeZone?: string,
): string | null {
  if (!version) return null;
  const from = formatModelRunTime(version.valid_from, timeZone) ?? "?";
  const to = version.valid_to
    ? (formatModelRunTime(version.valid_to, timeZone) ?? "?")
    : "now";
  return `${version.name} · ${from} – ${to}`;
}

/** Pseudo configuration drawing a fetch with its own chains. */
export function buildHistoricConfig(
  fetch: ArchivedFetchSummary,
): MeteogramConfig {
  const main = fetch.chain.main ?? [];
  return {
    id: `${HISTORIC_CONFIG_PREFIX}${fetch.id}`,
    name: fetch.config_version?.name ?? "Archived forecast",
    location: fetch.location,
    model_chain: main,
    main_model_chain: main,
    cloud_model_chain: fetch.chain.cloud ?? [],
    layout_id: fetch.layout_id,
  };
}

/**
 * Quantities the current layout uses but the archived fetch does not hold
 * (system.md §10): they render as gaps and are listed in a notice. Derived
 * quantities count as present through their sources; the cloud profile is
 * only expected when the fetch had a cloud chain.
 */
export function findMissingQuantities(
  layoutQuantities: Iterable<string>,
  forecast: HarmonizedForecastResponse,
  hasCloudChain = true,
): string[] {
  const present = new Set<string>();
  Object.values(forecast.model_forecasts ?? {}).forEach((points) =>
    points.forEach((point) => {
      if (point.value !== null) present.add(point.variable);
    }),
  );
  if (
    Object.values(forecast.vertical_cloud_model_forecasts ?? {}).some(
      (clouds) => clouds.profiles.length > 0,
    )
  ) {
    present.add(CLOUD_PROFILE);
  }
  return Array.from(layoutQuantities).filter((id) => {
    if (present.has(id)) return false;
    if (id === CLOUD_PROFILE && !hasCloudChain) return false;
    return getQuantity(id)?.source !== "derived";
  });
}
