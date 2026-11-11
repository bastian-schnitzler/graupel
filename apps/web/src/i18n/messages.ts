// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Translation tables (one JSON per language, English keys) and the translation function. */
import cs from "./cs.json";
import da from "./da.json";
import de from "./de.json";
import en from "./en.json";
import fr from "./fr.json";
import it from "./it.json";
import nl from "./nl.json";
import sl from "./sl.json";
import type { Language } from "./languages.ts";

/** Keys of the texts; English is the reference with every key. */
export type MessageKey = keyof typeof en;

export type Messages = Readonly<Partial<Record<string, string>>>;

export const MESSAGES: Readonly<Record<Language, Messages>> = { de, en, fr, it, sl, cs, nl, da };

const ENGLISH: Readonly<Record<MessageKey, string>> = en;

/** Values inserted for `{name}` placeholders. */
export type MessageParams = Readonly<Record<string, string | number>>;

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/** Text of a key in a language; missing or empty texts fall back to English. */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const text = MESSAGES[language][key] || ENGLISH[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** Translation function bound to a language. */
export function createTranslate(language: Language): Translate {
  return (key, params) => translate(language, key, params);
}
