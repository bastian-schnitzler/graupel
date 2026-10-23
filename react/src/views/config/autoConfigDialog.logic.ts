import type { AutoChainEntry, RegionSummary } from "../../types";

/** Select value of the "from current location" entry. */
export const FROM_LOCATION = "__location__";
/** Select values of chain entries (#198): prefix + entry id. */
export const CHAIN_PREFIX = "chain:";

export interface RegionGroup {
  group: string;
  regions: RegionSummary[];
}

/**
 * Regions grouped for the drop-down: groups in `list_regions` order
 * (alpine regions first, so Europe leads), regions by name within a group.
 */
export function groupRegions(regions: RegionSummary[]): RegionGroup[] {
  const groups = new Map<string, RegionSummary[]>();
  for (const region of regions) {
    const key = region.group || "Other";
    const list = groups.get(key);
    if (list) list.push(region);
    else groups.set(key, [region]);
  }
  return [...groups].map(([group, list]) => ({
    group,
    regions: [...list].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export interface AutoChainGroup {
  group: string;
  entries: { value: string; label: string; title: string }[];
}

const CONTINENT_ORDER = ["Europe", "North America", "Asia"];

const chainNames = (entry: AutoChainEntry, key: "cloud_model_chain") =>
  (entry[key] || []).map((m) => m.short_name || m.name).join(" → ");

/**
 * Chain entries for the drop-down after the regions (#198): Intercontinental,
 * "Other chains · <continent>", then "Global (IFS only)"; largest area first
 * within a group. Entries with the same main chain also name their clouds.
 */
export function groupAutoChains(entries: AutoChainEntry[]): AutoChainGroup[] {
  const nameCount = new Map<string, number>();
  for (const entry of entries) {
    nameCount.set(entry.name, (nameCount.get(entry.name) ?? 0) + 1);
  }
  const groupLabel = (group: string) =>
    group === "Intercontinental"
      ? "Intercontinental"
      : group === "Global"
        ? "Global (IFS only)"
        : `Other chains · ${group}`;
  const rank = (group: string) =>
    group === "Intercontinental"
      ? -1
      : group === "Global"
        ? 99
        : CONTINENT_ORDER.indexOf(group) === -1
          ? 50
          : CONTINENT_ORDER.indexOf(group);
  const groups = new Map<string, AutoChainEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.group);
    if (list) list.push(entry);
    else groups.set(entry.group, [entry]);
  }
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([group, list]) => ({
      group: groupLabel(group),
      entries: [...list]
        .sort((a, b) => (b.area_km2 ?? 0) - (a.area_km2 ?? 0))
        .map((entry) => {
          const clouds = chainNames(entry, "cloud_model_chain");
          const name =
            (nameCount.get(entry.name) ?? 0) > 1
              ? `${entry.name} (clouds: ${clouds})`
              : entry.name;
          return {
            value: `${CHAIN_PREFIX}${entry.id}`,
            label: `${name} · ${entry.origin}`,
            title: `Clouds: ${clouds}`,
          };
        }),
    }));
}
