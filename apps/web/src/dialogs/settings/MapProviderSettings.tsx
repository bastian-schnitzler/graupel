// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { MAP_PROVIDERS, MAP_PROVIDER_NAMES, useMapProvider, useMapProviderChoice } from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

/**
 * Map section of the settings popup (REQ-467): OpenTopoMap or Maptoolkit. The effective provider is checked (own
 * choice, else config.json); choosing one stores it and the next map opens with it.
 */
export function MapProviderSettings({ titleId }: SettingsSectionProps) {
  const provider = useMapProvider();
  const [, setChoice] = useMapProviderChoice();
  return (
    <div className="settings__choices" role="radiogroup" aria-labelledby={titleId}>
      {MAP_PROVIDERS.map((option) => (
        <label key={option} className="settings__choice">
          <input
            type="radio"
            name="graupel-map-provider"
            value={option}
            checked={provider === option}
            onChange={() => setChoice(option)}
          />
          {MAP_PROVIDER_NAMES[option]}
        </label>
      ))}
    </div>
  );
}
