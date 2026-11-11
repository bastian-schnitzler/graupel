// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
export {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_NAMES,
  isLanguage,
  matchLanguage,
  toLocale,
  type Language,
} from "./languages.ts";
export { MESSAGES, createTranslate, translate, type MessageKey, type MessageParams, type Translate } from "./messages.ts";
export {
  LANGUAGE_STORAGE_KEY,
  browserLanguages,
  readStoredLanguage,
  resolveLanguage,
  storeLanguage,
  type LanguageSources,
} from "./resolve.ts";
export { meteogramI18n, type MeteogramI18n } from "./meteogram.ts";
export {
  I18nProvider,
  useI18n,
  useMeteogramI18n,
  useT,
  type I18nContextValue,
  type I18nProviderProps,
} from "./I18nProvider.tsx";
