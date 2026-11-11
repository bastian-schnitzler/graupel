// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useT } from "../../i18n/index.ts";
import { cloudChainChoice, useChainCardsVisible, weatherChainChoice } from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

/**
 * Model chain section of the settings popup (REQ-445, REQ-503): one switch for the weather and one for the cloud chain
 * card (each stored; without an own choice config.json applies). The website has no edit mode for the chains
 * (REQ-480); the boundaries are moved in the cards themselves (REQ-481).
 */
export function ModelChainSettings({ titleId }: SettingsSectionProps) {
  const t = useT();
  const cards = useChainCardsVisible();
  return (
    <div className="settings__group settings__model-chain" role="group" aria-labelledby={titleId}>
      <label className="settings__choice">
        <input
          type="checkbox"
          checked={cards.weather}
          onChange={(event) => weatherChainChoice.set(event.currentTarget.checked)}
        />
        {t("settings.modelChain.showWeather")}
      </label>
      <label className="settings__choice">
        <input
          type="checkbox"
          checked={cards.cloud}
          onChange={(event) => cloudChainChoice.set(event.currentTarget.checked)}
        />
        {t("settings.modelChain.showCloud")}
      </label>
      <p className="settings__text">{t("settings.modelChain.text")}</p>
    </div>
  );
}
