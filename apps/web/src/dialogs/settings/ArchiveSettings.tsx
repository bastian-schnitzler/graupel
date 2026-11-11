// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useId } from "react";
import { useT, type Translate } from "../../i18n/index.ts";
import {
  ARCHIVE_DAYS_OPTIONS,
  isArchiveDays,
  setArchiveDays,
  setHistorySlider,
  useArchiveDays,
  useHistorySlider,
  type ArchiveDays,
} from "../../state/index.ts";
import { usePhone } from "../../state/phoneLandscape.ts";
import type { SettingsSectionProps } from "./sections.tsx";

/** Text of a choice of the archive's days: "Unlimited" or "90 days". */
export function archiveDaysLabel(days: ArchiveDays, t: Translate): string {
  return days === "unlimited" ? t("settings.archive.days.unlimited") : t("settings.archive.days.count", { count: days });
}

/**
 * History section of the settings popup, in the tab Archive that only the installed app shows (REQ-686): how many days
 * the archive keeps its fetches (REQ-684; unlimited without an own choice, else 365, 90, 14 or 5 days; a shorter choice
 * deletes the older fetches at once), with its hint. On a phone below it the switch for the history slider (off without
 * an own choice; the slider itself follows with REQ-685), with its hint.
 */
export function ArchiveSettings({ titleId }: SettingsSectionProps) {
  const t = useT();
  const daysId = useId();
  const daysHintId = useId();
  const sliderHintId = useId();
  const days = useArchiveDays();
  const historySlider = useHistorySlider();
  const phone = usePhone();
  return (
    <div className="settings__group" role="group" aria-labelledby={titleId}>
      <div className="settings__field">
        <label htmlFor={daysId}>{t("settings.archive.days")}</label>
        <select
          id={daysId}
          className="settings__select"
          aria-describedby={daysHintId}
          value={String(days)}
          onChange={(event) => {
            const { value } = event.currentTarget;
            const next = value === "unlimited" ? value : Number(value);
            if (isArchiveDays(next)) setArchiveDays(next);
          }}
        >
          {ARCHIVE_DAYS_OPTIONS.map((option) => (
            <option key={option} value={String(option)}>
              {archiveDaysLabel(option, t)}
            </option>
          ))}
        </select>
      </div>
      <p className="settings__hint" id={daysHintId}>
        {t("settings.archive.days.hint")}
      </p>
      {phone && (
        <>
          <label className="settings__choice">
            <input
              type="checkbox"
              checked={historySlider}
              aria-describedby={sliderHintId}
              onChange={(event) => setHistorySlider(event.currentTarget.checked)}
            />
            {t("settings.archive.historySlider")}
          </label>
          <p className="settings__hint" id={sliderHintId}>
            {t("settings.archive.historySlider.hint")}
          </p>
        </>
      )}
    </div>
  );
}
