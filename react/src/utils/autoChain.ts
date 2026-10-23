import type {
  AutoChainInfo,
  HarmonizedForecastResponse,
  Location,
  MeteogramConfig,
  WeatherModel,
} from "../types";

/** Id of the pseudo configuration normal mode draws (system.md §3.3). */
export const AUTO_CONFIG_ID = "__auto__";

/** Chain used without a backend resolver (standalone browser build). */
export const FALLBACK_AUTO_CHAIN: AutoChainInfo = {
  region_id: null,
  region_name: null,
  resolution_reason: "global_fallback",
  main_model_chain: [
    {
      name: "ECMWF IFS",
      id: "ecmwf_ifs",
      short_name: "IFS",
      max_forecast_horizon_hours: 360,
    },
  ],
  cloud_model_chain: [
    {
      name: "ECMWF IFS 0.25°",
      id: "ecmwf_ifs025",
      short_name: "IFS",
      max_forecast_horizon_hours: 360,
    },
  ],
};

const copyChain = (chain: WeatherModel[] | undefined): WeatherModel[] =>
  (chain || []).map((m) => ({ ...m }));

/** Pseudo configuration for the auto chain of a location. */
export function buildAutoConfig(
  location: Location,
  info: AutoChainInfo,
): MeteogramConfig {
  const main = copyChain(info.main_model_chain);
  return {
    id: AUTO_CONFIG_ID,
    name: info.region_name || "Auto",
    location,
    model_chain: main,
    main_model_chain: main,
    cloud_model_chain: copyChain(info.cloud_model_chain),
  };
}

/**
 * The auto configuration with the chains the response really used, so the
 * frontend stitches without the dropped models. Without a matching response
 * the resolved chains stay.
 */
export function withResponseChains(
  config: MeteogramConfig,
  response: HarmonizedForecastResponse | null,
): MeteogramConfig {
  const used = response?.auto_chain;
  if (!used) return config;
  const main = copyChain(used.main_model_chain);
  return {
    ...config,
    model_chain: main,
    main_model_chain: main,
    cloud_model_chain: copyChain(used.cloud_model_chain),
  };
}

const REASON_LABELS: Record<string, string> = {
  domain_fallback: "Regional models",
  global_fallback: "Global",
};

/** Region a location resolves to, e.g. "Northern Alps" or "Global". */
export function formatAutoRegion(info: AutoChainInfo | null): string {
  if (!info) return "";
  return info.region_name || REASON_LABELS[info.resolution_reason] || "Auto";
}

/** Header text, e.g. "Northern Alps · ICON-D2 → ICON-EU → IFS" (Q5). */
export function formatAutoChainLabel(info: AutoChainInfo | null): string {
  if (!info) return "";
  const region = formatAutoRegion(info);
  const chain = (info.main_model_chain || [])
    .map((m) => m.short_name || m.name)
    .join(" → ");
  return chain ? `${region} · ${chain}` : region;
}

const sameModels = (
  a: WeatherModel[] | undefined,
  b: WeatherModel[] | undefined,
): boolean => {
  const left = a || [];
  const right = b || [];
  return (
    left.length === right.length &&
    left.every((model, index) => {
      const other = right[index];
      return model.id && other.id
        ? model.id === other.id
        : model.name.toLowerCase() === other.name.toLowerCase();
    })
  );
};

/**
 * Stored configuration with the same main and cloud models as the auto
 * chain (horizons ignored, so dragged or edited boundaries still match).
 */
export function findMatchingConfig(
  info: AutoChainInfo | null,
  configs: MeteogramConfig[],
): MeteogramConfig | null {
  if (!info) return null;
  return (
    configs.find(
      (config) =>
        sameModels(
          config.main_model_chain || config.model_chain,
          info.main_model_chain,
        ) && sameModels(config.cloud_model_chain, info.cloud_model_chain),
    ) || null
  );
}

/**
 * Power-mode dropdown entry for the auto chain (system.md §16.4), e.g.
 * "Auto · Ostalpen" (matching stored configuration) or "Auto · Northern Alps".
 */
export function formatAutoEntryLabel(
  info: AutoChainInfo | null,
  configs: MeteogramConfig[],
): string {
  const name = findMatchingConfig(info, configs)?.name || formatAutoRegion(info);
  return name ? `Auto · ${name}` : "Auto";
}

/** Model ids (or names) of both chains, to notice a changed auto chain. */
export function autoChainSignature(config: MeteogramConfig | null): string {
  const ids = (chain: WeatherModel[] | undefined) =>
    (chain || []).map((m) => m.id || m.name).join(",");
  return config
    ? `${ids(config.main_model_chain || config.model_chain)}|${ids(config.cloud_model_chain)}`
    : "";
}
