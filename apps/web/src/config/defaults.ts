// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { GraupelConfig, HosterInfo, HostingProvider, ImprintConfig, Place } from "./types.ts";

/** Built-in default place, also the fallback of `startLocation: "gps"` without favorites. */
export const DEFAULT_PLACE: Place = { name: "Mont Blanc", lat: 45.8326, lon: 6.8652, elevation: 4806 };

/** Time zone of the built-in default place (REQ-733). */
export const DEFAULT_TIME_ZONE = "Europe/Paris";

/** Defaults used for every field config.json leaves out or gets wrong. */
export const DEFAULT_CONFIG: GraupelConfig = {
  startLocation: DEFAULT_PLACE,
  modelChain: true,
  showWeatherChain: false,
  showCloudChain: false,
  modelHeaders: true,
  imageModelHeaders: false,
  daySlider: { enabled: true, days: "all" },
  favorites: { enabled: true, presets: [] },
  map: "opentopomap",
  languages: ["en", "de", "fr", "it", "sl", "cs", "nl", "da"],
  defaultLanguage: "en",
  timeZone: DEFAULT_TIME_ZONE,
  legal: { hosting: "github-pages", imprint: {}, privacy: { swissNotice: false } },
};

/**
 * Contact details of each known hosting provider (REQ-430, REQ-710), used for `legal.imprint.hoster: true`.
 * ALL-INKL: imprint at https://all-inkl.com/en/legal-notice (checked 2026-11-10).
 */
export const HOSTERS: Readonly<Record<HostingProvider, HosterInfo>> = {
  "github-pages": {
    name: "GitHub, Inc.",
    address: ["88 Colin P. Kelly Jr. Street", "San Francisco, CA 94107", "USA"],
    phone: "+1 877 448 4820",
  },
  "all-inkl": {
    name: "ALL-INKL.COM – Neue Medien Münnich",
    address: ["Hauptstraße 68", "02742 Friedersdorf", "Germany"],
    phone: "+49 35872 353-10",
  },
};

/** Hosting provider without `legal.hosting` (GitHub Pages). */
export const DEFAULT_HOSTER: HosterInfo = HOSTERS["github-pages"];

/**
 * The hosting provider to show in the imprint, or `undefined` when none is configured: `hoster: true` names the
 * provider that serves the site (`legal.hosting`), explicit details are shown as given.
 */
export function imprintHoster(imprint: ImprintConfig, hosting: HostingProvider = "github-pages"): HosterInfo | undefined {
  if (imprint.hoster === true) return HOSTERS[hosting];
  return imprint.hoster || undefined;
}
