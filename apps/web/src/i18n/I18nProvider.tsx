// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANGUAGE, toLocale, type Language } from "./languages.ts";
import { createTranslate, type Translate } from "./messages.ts";
import { meteogramI18n, type MeteogramI18n } from "./meteogram.ts";
import { browserLanguages, readStoredLanguage, resolveLanguage, storeLanguage } from "./resolve.ts";

export interface I18nContextValue {
  /** Active language. */
  language: Language;
  /** BCP-47 locale of the active language. */
  locale: string;
  /** Translation function of the active language. */
  t: Translate;
  /** Switches the language and stores it as the user's choice; null forgets the choice. */
  setLanguage: (language: Language | null) => void;
}

function staticValue(language: Language): I18nContextValue {
  return { language, locale: toLocale(language), t: createTranslate(language), setLanguage: () => {} };
}

// Without a provider (e.g. a region rendered alone in a test) the texts are English.
const I18nContext = createContext<I18nContextValue>(staticValue(DEFAULT_LANGUAGE));

export interface I18nProviderProps {
  /** Languages the domain offers (config); a stored choice or browser language outside them is ignored. */
  languages?: readonly Language[];
  /** Fallback language of the domain (config), used when neither a stored choice nor a browser language fits. */
  fallbackLanguage?: Language;
  /** Browser languages; defaults to `navigator.languages`. */
  browserLanguages?: readonly string[];
  children?: ReactNode;
}

/** Provides the active language: stored choice > browser language > domain fallback > English. */
export function I18nProvider({
  languages,
  fallbackLanguage,
  browserLanguages: browser,
  children,
}: I18nProviderProps) {
  const [choice, setChoice] = useState<Language | null>(readStoredLanguage);
  const language = resolveLanguage({
    stored: choice,
    browserLanguages: browser ?? browserLanguages(),
    fallback: fallbackLanguage ?? null,
    available: languages,
  });

  const setLanguage = useCallback((next: Language | null) => {
    storeLanguage(next);
    setChoice(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({ ...staticValue(language), setLanguage }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Active language, locale, translation function and `setLanguage`. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** Translation function of the active language. */
export function useT(): Translate {
  return useContext(I18nContext).t;
}

/** `locale`, `texts` and `tooltipTexts` for the meteogram in the active language. */
export function useMeteogramI18n(): MeteogramI18n {
  const { language } = useContext(I18nContext);
  return useMemo(() => meteogramI18n(language), [language]);
}
