// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Facts of the privacy policy (REQ-432) that do not depend on the language. The texts are in the translation files
 * under `privacy.*`.
 *
 * Sources, checked on 2026-10-26, ALL-INKL on 2026-11-10 (re-check before publishing; see apps/web/README.md):
 * - ALL-INKL data privacy information: controller ALL-INKL.COM - Neue Medien Münnich, Hauptstraße 68, 02742
 *   Friedersdorf; web server log files (IP address, time of access, requested file, status, data volume, referrer) are
 *   deleted after seven days at the latest, longer in individual cases such as an attack:
 *   https://all-inkl.com/en/privacy-policy
 * - ALL-INKL data centres, all in Dresden, customer data stored only in Germany:
 *   https://all-inkl.com/en/about-us/datacenter
 * - GitHub Pages logs visitor IP addresses for security purposes:
 *   https://docs.github.com/en/articles/about-github-pages
 * - GitHub General Privacy Statement (effective 27 April 2026): GitHub certifies to the EU-U.S. Data Privacy Framework,
 *   the UK Extension and the Swiss-U.S. DPF:
 *   https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
 * - Microsoft DPF entities (last updated September 2026): GitHub maintains its own certification:
 *   https://www.microsoft.com/en-us/privacy/microsoft-data-privacy-framework-covered-entities
 * - DPF participant list (needs JavaScript, not checked automatically): https://www.dataprivacyframework.gov/list
 * - Open-Meteo terms and privacy: OpenMeteo GmbH, Bürglen (UR), Switzerland; API server logs may contain coordinates
 *   and IP addresses, deleted after 90 days; no cookies: https://open-meteo.com/en/terms
 * - Maptoolkit privacy: Toursprung GmbH, Vienna; truncated IP addresses, logs at most 15 days, hosted in the EU,
 *   Cloudflare CDN with standard contractual clauses: https://www.maptoolkit.org/privacy
 * - OpenTopoMap (no separate privacy policy found): https://opentopomap.org/about
 */
import type { HostingProvider, MapProvider } from "../../config/index.ts";
import type { MessageKey } from "../../i18n/index.ts";

/** Date of the current version of the privacy policy (ISO date), shown as "Last updated". */
export const PRIVACY_UPDATED = "2026-11-10";

export interface PrivacyLink {
  label: MessageKey;
  href: string;
}

/** Hosting section of each provider (REQ-710): title, paragraphs (the legal basis follows) and links. */
export const HOSTING: Readonly<
  Record<HostingProvider, { title: MessageKey; paragraphs: readonly MessageKey[]; swiss: MessageKey; links: readonly PrivacyLink[] }>
> = {
  "github-pages": {
    title: "privacy.hosting.githubPages.title",
    paragraphs: ["privacy.hosting.githubPages.text", "privacy.hosting.githubPages.transfer"],
    swiss: "privacy.switzerland.githubPages",
    links: [
      {
        label: "privacy.hosting.githubPages.link",
        href: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
      },
      { label: "privacy.hosting.githubPages.dpfLink", href: "https://www.dataprivacyframework.gov/list" },
    ],
  },
  "all-inkl": {
    title: "privacy.hosting.allInkl.title",
    paragraphs: ["privacy.hosting.allInkl.text", "privacy.hosting.allInkl.retention"],
    swiss: "privacy.switzerland.allInkl",
    links: [{ label: "privacy.hosting.allInkl.link", href: "https://all-inkl.com/en/privacy-policy" }],
  },
};

export const OPEN_METEO_LINKS: readonly PrivacyLink[] = [
  { label: "privacy.weather.link", href: "https://open-meteo.com/en/terms" },
];

/** Description and link of each map provider; all are shown, whichever is chosen (REQ-493). */
export const MAP_PROVIDERS: Readonly<Record<MapProvider, { text: MessageKey; links: readonly PrivacyLink[] }>> = {
  opentopomap: {
    text: "privacy.map.opentopomap",
    links: [{ label: "privacy.map.opentopomapLink", href: "https://opentopomap.org/about" }],
  },
  maptoolkit: {
    text: "privacy.map.maptoolkit",
    links: [{ label: "privacy.map.maptoolkitLink", href: "https://www.maptoolkit.org/privacy" }],
  },
};
