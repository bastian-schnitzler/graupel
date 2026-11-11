// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useT } from "../../i18n/index.ts";
import { modelHeadersChoice, useModelHeaders } from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

/**
 * Model headers section of the settings popup, in the tab Models (REQ-686): the model headers of the meteogram on or
 * off (REQ-472), the own choice, else config.json; the page follows at once.
 */
export function ModelHeadersSettings({ titleId }: SettingsSectionProps) {
  const t = useT();
  const modelHeaders = useModelHeaders();
  return (
    <div className="settings__group" role="group" aria-labelledby={titleId}>
      <label className="settings__choice">
        <input
          type="checkbox"
          checked={modelHeaders}
          onChange={(event) => modelHeadersChoice.set(event.currentTarget.checked)}
        />
        {t("settings.meteogram.modelHeaders")}
      </label>
    </div>
  );
}
