// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Types of the runtime configuration (config.json, REQ-427); they mirror config.schema.json. */

import type { Language } from "../i18n/languages.ts";

/** Language codes offered by the website (REQ-423, DEC-020); defined with the translations. */
export { LANGUAGES, type Language } from "../i18n/languages.ts";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Metres above sea level. */
  elevation?: number;
}

/**
 * `"gps"`: the current position; the page asks for it at start (DEC-107), until it is there (or when it is not
 * allowed) the first favorite preset or the built-in default place is shown (see `startPlace`). A place: shown at
 * start.
 */
export type StartLocation = "gps" | Place;

export interface DaySliderConfig {
  enabled: boolean;
  /** Number of days the slider offers, or every day of the forecast. */
  days: number | "all";
}

export interface FavoritesConfig {
  /** Show the favorites tab. */
  enabled: boolean;
  /** Favorites the user starts with; empty on every domain (REQ-708). */
  presets: Place[];
}

/** OpenTopoMap tiles with Leaflet, or the Maptoolkit topo map with MapLibre (DEC-022). */
export type MapProvider = "opentopomap" | "maptoolkit";

/** Imprint data of the domain (REQ-430, DEC-023); every field is optional. */
export interface ImprintConfig {
  /** Fixed label of the imprint link (e.g. "Impressum"); without it the translated label is used. */
  label?: string;
  name?: string;
  residence?: string;
  /** Postal address, one entry per line. */
  address?: string[];
  email?: string;
  /**
   * Hosting provider as contact: `true` for the provider of `legal.hosting` (`HOSTERS`), or explicit details, which
   * stay the same whichever target serves the site (DEC-086).
   */
  hoster?: boolean | HosterInfo;
}

/** Contact details of the hosting provider (e.g. for the French "Mentions légales"). */
export interface HosterInfo {
  name: string;
  /** Postal address, one entry per line. */
  address?: string[];
  phone?: string;
  email?: string;
  url?: string;
}

/**
 * Controller named in the privacy policy instead of the imprint operator (DEC-028): name and email only, no address.
 * Lets a domain with an anonymous imprint (e.g. .fr) still name the controller as Art. 13 GDPR requires.
 */
export interface PrivacyController {
  name: string;
  email?: string;
}

/** Settings of the privacy policy (REQ-432). */
export interface PrivacyConfig {
  /** Overrides the controller taken from `legal.imprint`; the imprint itself is unchanged. */
  controller?: PrivacyController;
  /** Show the section for Switzerland (revDSG, EDÖB); only on .ch (DEC-029). */
  swissNotice: boolean;
}

/**
 * Known hosting providers (REQ-710): the one that actually serves the site, named in the Hosting section of the privacy
 * policy. The domains use ALL-INKL, the preview on GitHub Pages uses GitHub Pages.
 */
export const HOSTING_PROVIDERS = ["github-pages", "all-inkl"] as const;
export type HostingProvider = (typeof HOSTING_PROVIDERS)[number];

export interface LegalConfig {
  /** Provider that serves the site (REQ-710); default `"github-pages"`. */
  hosting: HostingProvider;
  imprint: ImprintConfig;
  privacy: PrivacyConfig;
}

/** The complete configuration after merging config.json with the defaults. */
export interface GraupelConfig {
  startLocation: StartLocation;
  /** Offer the model chain cards at all; `false` leaves out both cards and their settings section. */
  modelChain: boolean;
  /** Show the weather chain card without an own choice in the settings (REQ-503). */
  showWeatherChain: boolean;
  /** Show the cloud chain card without an own choice in the settings (REQ-503). */
  showCloudChain: boolean;
  modelHeaders: boolean;
  /**
   * Currently without effect, kept for later (REQ-539, DEC-094): the copied, saved or shared picture of the meteogram
   * follows the model headers on screen. Default false.
   */
  imageModelHeaders: boolean;
  daySlider: DaySliderConfig;
  favorites: FavoritesConfig;
  map: MapProvider;
  languages: Language[];
  defaultLanguage: Language;
  /**
   * IANA time zone of the domain's default place (REQ-733), e.g. "Europe/Vienna": the model info shows the run times in
   * it when the device's time zone cannot be determined.
   */
  timeZone: string;
  /** Domain in short form (e.g. "graupel.eu") for the meteogram footer (REQ-464); see `siteDomain`. */
  domain?: string;
  legal: LegalConfig;
}
