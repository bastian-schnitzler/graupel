// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Languages of the website (REQ-423, DEC-020) and their locales. */

export const LANGUAGES = ["en", "de", "fr", "it", "sl", "cs", "nl", "da"] as const;

export type Language = (typeof LANGUAGES)[number];

/** Language used when nothing else applies, and for missing keys. */
export const DEFAULT_LANGUAGE: Language = "en";

/** Name of each language in itself, for a language picker. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
  it: "Italiano",
  sl: "Slovenščina",
  cs: "Čeština",
  nl: "Nederlands",
  da: "Dansk",
};

const LOCALES: Readonly<Record<Language, string>> = {
  de: "de-DE",
  en: "en-GB",
  fr: "fr-FR",
  it: "it-IT",
  sl: "sl-SI",
  cs: "cs-CZ",
  nl: "nl-NL",
  da: "da-DK",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** BCP-47 locale for dates and numbers (e.g. the meteogram's `locale` option). */
export function toLocale(language: Language): string {
  return LOCALES[language];
}

/** Supported language of a BCP-47 tag by its primary subtag ("de-AT" → "de"), or null. */
export function matchLanguage(tag: string): Language | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLanguage(primary) ? primary : null;
}
