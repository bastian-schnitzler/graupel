// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useConfig } from "../config/index.ts";
import { LANGUAGES, LANGUAGE_NAMES, isLanguage, useI18n, type Language } from "../i18n/index.ts";

export interface LanguageSelectProps {
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Called after a language was chosen (e.g. to close the phone's footer menu, REQ-575). */
  onSelect?: (language: Language) => void;
}

/**
 * Picks the page language among the languages the domain offers (`config.languages`); each language is named
 * in itself, in the fixed order of `LANGUAGES` (English first, REQ-534). The choice is stored (`setLanguage`). Renders
 * nothing when the domain offers a single language.
 */
export function LanguageSelect({ onSelect, ...props }: LanguageSelectProps) {
  const { languages } = useConfig();
  const { language, setLanguage } = useI18n();
  if (languages.length < 2) return null;
  return (
    <select
      {...props}
      value={language}
      onChange={(event) => {
        const next = event.target.value;
        if (!isLanguage(next)) return;
        setLanguage(next);
        onSelect?.(next);
      }}
    >
      {LANGUAGES.filter((code) => languages.includes(code)).map((code) => (
        <option key={code} value={code} lang={code}>
          {LANGUAGE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}
