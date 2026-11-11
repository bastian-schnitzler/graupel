// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { COLOR_MODES, useColorMode, type ColorMode } from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

const LABELS: Readonly<Record<ColorMode, MessageKey>> = {
  system: "settings.colorMode.system",
  light: "settings.colorMode.light",
  dark: "settings.colorMode.dark",
};

/** Colour mode section of the settings popup (REQ-426): system, light or dark, applied at once. */
export function ColorModeSettings({ titleId }: SettingsSectionProps) {
  const { t } = useI18n();
  const [mode, setMode] = useColorMode();
  return (
    <div className="settings__choices" role="radiogroup" aria-labelledby={titleId}>
      {COLOR_MODES.map((option) => (
        <label key={option} className="settings__choice">
          <input
            type="radio"
            name="graupel-color-mode"
            value={option}
            checked={mode === option}
            onChange={() => setMode(option)}
          />
          {t(LABELS[option])}
        </label>
      ))}
    </div>
  );
}
