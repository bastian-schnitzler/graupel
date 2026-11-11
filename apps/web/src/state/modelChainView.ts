// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Whether the two model chain cards are shown (REQ-445, REQ-503): the weather and the cloud card are switched on and
 * off separately in the settings popup. Each choice is kept in `localStorage` like the other display settings
 * (`storedChoice`) and goes into the settings export; without an own choice `showWeatherChain` / `showCloudChain`
 * from config.json applies (both hidden by default). `modelChain: false` in config.json leaves out both cards and the
 * settings section. Hiding a card is display only: the chains are still loaded and fed to the meteogram. The website
 * has no edit mode for the chains (REQ-480).
 */
import { useConfig, type GraupelConfig } from "../config/index.ts";
import { decodeBoolean, encodeBoolean, storedChoice } from "./storedChoice.ts";

/** `localStorage` key of the choice to show the weather chain card. */
export const WEATHER_CHAIN_STORAGE_KEY = "graupel.showWeatherChain";
/** `localStorage` key of the choice to show the cloud chain card. */
export const CLOUD_CHAIN_STORAGE_KEY = "graupel.showCloudChain";
/** Key of the single choice before REQ-503 (only `"true"` was stored); moved to both keys by `migrateModelChainChoice`. */
export const LEGACY_MODEL_CHAIN_STORAGE_KEY = "graupel.showModelChain";

export const weatherChainChoice = storedChoice<boolean>(WEATHER_CHAIN_STORAGE_KEY, decodeBoolean, encodeBoolean);
export const cloudChainChoice = storedChoice<boolean>(CLOUD_CHAIN_STORAGE_KEY, decodeBoolean, encodeBoolean);

/** Which chain cards are shown. */
export interface ChainCardsVisible {
  weather: boolean;
  cloud: boolean;
}

/**
 * Moves a stored choice of the single switch (before REQ-503) to both new switches, unless they already have an own
 * choice, and removes the old key. Called once at start; storage errors leave everything as it is.
 */
export function migrateModelChainChoice(): void {
  try {
    const legacy = decodeBoolean(window.localStorage.getItem(LEGACY_MODEL_CHAIN_STORAGE_KEY) ?? "");
    if (legacy !== null) {
      for (const choice of [weatherChainChoice, cloudChainChoice]) if (choice.read() === null) choice.set(legacy);
    }
    window.localStorage.removeItem(LEGACY_MODEL_CHAIN_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: nothing to move.
  }
}

/**
 * Cards that apply: none with `modelChain: false`, otherwise per card the own choice, else `showWeatherChain` /
 * `showCloudChain` from config.json.
 */
export function effectiveChainCards(
  weather: boolean | null,
  cloud: boolean | null,
  config: Pick<GraupelConfig, "modelChain" | "showWeatherChain" | "showCloudChain">,
): ChainCardsVisible {
  if (!config.modelChain) return { weather: false, cloud: false };
  return { weather: weather ?? config.showWeatherChain, cloud: cloud ?? config.showCloudChain };
}

/** Chain cards shown on this page (see `effectiveChainCards`). */
export function useChainCardsVisible(): ChainCardsVisible {
  const [weather] = weatherChainChoice.use();
  const [cloud] = cloudChainChoice.use();
  const config = useConfig();
  return effectiveChainCards(weather, cloud, config);
}

/** Sets both switches at once (a settings file from before REQ-503, tests); `null` removes both own choices. */
export function setModelChainVisible(value: boolean | null): void {
  weatherChainChoice.set(value);
  cloudChainChoice.set(value);
}

/** Forgets choices kept for this visit only (tests). */
export function resetModelChainView(): void {
  weatherChainChoice.reset();
  cloudChainChoice.reset();
}
