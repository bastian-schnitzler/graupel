// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ImprintConfig } from "../config/index.ts";
import type { MessageKey, Translate } from "../i18n/index.ts";

/** Tabs of the info popup (REQ-434), in display order. */
export const INFO_TABS = ["about", "imprint", "privacy"] as const;

export type InfoTab = (typeof INFO_TABS)[number];

export function isInfoTab(value: unknown): value is InfoTab {
  return typeof value === "string" && (INFO_TABS as readonly string[]).includes(value);
}

/**
 * Translated label of each tab; the imprint label can be fixed per domain (`legal.imprint.label`). The privacy tab
 * names the full privacy policy (REQ-484); the footer keeps its shorter link text.
 */
export const INFO_TAB_LABELS: Readonly<Record<InfoTab, MessageKey>> = {
  about: "info.tab.about",
  imprint: "info.tab.imprint",
  privacy: "privacy.title",
};

/** Label of a tab, also the accessible name of its panel: the imprint uses `legal.imprint.label` when the domain fixes one. */
export function infoTabLabel(id: InfoTab, imprint: ImprintConfig, t: Translate): string {
  return id === "imprint" && imprint.label ? imprint.label : t(INFO_TAB_LABELS[id]);
}
