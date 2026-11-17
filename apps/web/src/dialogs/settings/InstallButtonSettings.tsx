// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useT, type MessageKey } from "../../i18n/index.ts";
import { setHideInstallButton, useHideInstallButton } from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

/** Choices of the section, in this order: yes, no. */
const CHOICES: readonly { value: boolean; label: MessageKey }[] = [
  { value: true, label: "settings.installButton.yes" },
  { value: false, label: "settings.installButton.no" },
];

/**
 * Section "Hide the Install button" of the tab Design (REQ-809), on the website only: Yes hides the install button in
 * the header (desktop, tablet) and the entry in the phone's menu, No (the default) shows them. Chosen like the colour
 * mode; the page follows at once.
 */
export function InstallButtonSettings({ titleId }: SettingsSectionProps) {
  const t = useT();
  const hide = useHideInstallButton();
  return (
    <div className="settings__choices" role="radiogroup" aria-labelledby={titleId}>
      {CHOICES.map(({ value, label }) => (
        <label key={label} className="settings__choice">
          <input
            type="radio"
            name="graupel-hide-install-button"
            value={value ? "yes" : "no"}
            checked={hide === value}
            onChange={() => setHideInstallButton(value)}
          />
          {t(label)}
        </label>
      ))}
    </div>
  );
}
