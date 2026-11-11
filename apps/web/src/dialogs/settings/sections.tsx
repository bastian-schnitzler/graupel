// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ComponentType } from "react";
import type { GraupelConfig } from "../../config/index.ts";
import type { MessageKey } from "../../i18n/index.ts";
import type { AppMode } from "../../state/index.ts";
import { ArchiveSettings } from "./ArchiveSettings.tsx";
import { ColorModeSettings } from "./ColorModeSettings.tsx";
import { DaySliderSettings } from "./DaySliderSettings.tsx";
import { MapProviderSettings } from "./MapProviderSettings.tsx";
import { MeteogramSettings } from "./MeteogramSettings.tsx";
import { ModelChainSettings } from "./ModelChainSettings.tsx";
import { ModelHeadersSettings } from "./ModelHeadersSettings.tsx";
import { StartLocationSettings } from "./StartLocationSettings.tsx";

export interface SettingsSectionProps {
  /** Id of the section heading, for `aria-labelledby` of the section's control. */
  titleId: string;
}

/** What decides which tabs and sections the settings popup shows: the domain and how the page runs (REQ-686). */
export interface SettingsEnvironment {
  config: GraupelConfig;
  appMode: AppMode;
}

/** One section of the settings popup: a heading and its controls. */
export interface SettingsSection {
  id: string;
  title: MessageKey;
  Component: ComponentType<SettingsSectionProps>;
  /** Whether the section applies (e.g. to the domain); shown when left out. */
  available?: (environment: SettingsEnvironment) => boolean;
}

/** The tabs of the settings popup (REQ-686), in display order. */
export const SETTINGS_TAB_IDS = ["design", "start", "models", "meteogram", "archive"] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === "string" && (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

/** One tab of the settings popup: its label and its sections. */
export interface SettingsTab {
  id: SettingsTabId;
  label: MessageKey;
  sections: readonly SettingsSection[];
  /** Whether the tab is shown; shown when left out. A tab without any available section is never shown. */
  available?: (environment: SettingsEnvironment) => boolean;
}

/**
 * Tabs of the settings popup with their sections, in display order (REQ-686): Design (colour mode, map), Start (start
 * place, day slider with the days shown), Models (weather and cloud chain, model headers), Meteogram (legend, axes when
 * zoomed, dew point, relative humidity) and, only in the installed app, Archive (days the history keeps; on a phone the
 * history slider). A later setting adds a section to its tab with its own component. The language is chosen in the
 * header only (REQ-468); export and import are buttons in the heading row (REQ-469).
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  {
    id: "design",
    label: "settings.tab.design",
    sections: [
      { id: "colorMode", title: "settings.colorMode", Component: ColorModeSettings },
      { id: "map", title: "settings.map", Component: MapProviderSettings },
    ],
  },
  {
    id: "start",
    label: "settings.tab.start",
    sections: [
      { id: "startLocation", title: "settings.startLocation", Component: StartLocationSettings },
      { id: "daySlider", title: "settings.daySlider", Component: DaySliderSettings },
    ],
  },
  {
    id: "models",
    label: "settings.tab.models",
    sections: [
      {
        id: "modelChain",
        title: "settings.modelChain",
        Component: ModelChainSettings,
        available: ({ config }) => config.modelChain,
      },
      { id: "modelHeaders", title: "settings.modelHeaders", Component: ModelHeadersSettings },
    ],
  },
  {
    id: "meteogram",
    label: "settings.tab.meteogram",
    sections: [{ id: "meteogram", title: "settings.meteogram", Component: MeteogramSettings }],
  },
  {
    id: "archive",
    label: "settings.tab.archive",
    sections: [{ id: "history", title: "history.title", Component: ArchiveSettings }],
    available: ({ appMode }) => appMode === "installed",
  },
];

/** A tab as the popup shows it: only its available sections. */
export interface ShownSettingsTab {
  tab: SettingsTab;
  sections: readonly SettingsSection[];
}

/**
 * The tabs the popup shows in an environment, each with its available sections: a tab that is not available (Archive
 * outside the installed app) or has no available section is left out.
 */
export function shownSettingsTabs(
  environment: SettingsEnvironment,
  tabs: readonly SettingsTab[] = SETTINGS_TABS,
): ShownSettingsTab[] {
  return tabs
    .filter((tab) => tab.available?.(environment) ?? true)
    .map((tab) => ({ tab, sections: tab.sections.filter((section) => section.available?.(environment) ?? true) }))
    .filter(({ sections }) => sections.length > 0);
}
