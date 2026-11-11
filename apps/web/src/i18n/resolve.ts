// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Choice of the language: user choice (stored) > browser languages > fallback language of the domain > English.
 */
import { DEFAULT_LANGUAGE, isLanguage, matchLanguage, type Language } from "./languages.ts";

/** `localStorage` key of the language the user chose. */
export const LANGUAGE_STORAGE_KEY = "graupel.language";

export interface LanguageSources {
  /** Language the user chose (stored), if any. */
  stored?: string | null;
  /** Browser languages in order of preference (`navigator.languages`). */
  browserLanguages?: readonly string[];
  /** Fallback language of the domain (config). */
  fallback?: Language | null;
  /** Languages the domain offers; stored and browser languages outside them are skipped. Default: all. */
  available?: readonly Language[] | null;
}

export function resolveLanguage({ stored, browserLanguages = [], fallback, available }: LanguageSources): Language {
  const offered = (language: Language | null): language is Language =>
    language !== null && (!available?.length || available.includes(language));
  if (isLanguage(stored) && offered(stored)) return stored;
  for (const tag of browserLanguages) {
    const language = matchLanguage(tag);
    if (offered(language)) return language;
  }
  return fallback ?? DEFAULT_LANGUAGE;
}

/** Browser languages, empty where unavailable. */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/** Stored user choice, or null (also when storage is unavailable). */
export function readStoredLanguage(): Language | null {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stores the user choice; null removes it. Fails silently when storage is unavailable. */
export function storeLanguage(language: Language | null): void {
  try {
    if (language) window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    else window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the choice applies to this visit only.
  }
}
