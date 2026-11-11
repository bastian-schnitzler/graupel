// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useId } from "react";
import { useT } from "../../i18n/index.ts";
import { daySliderChoice, daysChoice, useDaySlider, type DayCount } from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

/** Day counts offered when the day slider is off; the forecast covers up to 16 days. */
const DAY_COUNTS: readonly number[] = Array.from({ length: 16 }, (_, index) => index + 1);

/**
 * Day slider section of the settings popup, in the tab Start (REQ-686): the day slider on or off and, with the slider
 * off, how many days the meteogram shows or all of them (REQ-473). Each shows the value that applies (own choice, else
 * config.json); changing it stores the choice and the page follows at once. The day count stays in place, greyed out
 * while the slider is on, so the popup keeps its height (REQ-500).
 */
export function DaySliderSettings({ titleId }: SettingsSectionProps) {
  const t = useT();
  const daysId = useId();
  const daySlider = useDaySlider();
  const counts = typeof daySlider.days === "number" && !DAY_COUNTS.includes(daySlider.days)
    ? [...DAY_COUNTS, daySlider.days].sort((a, b) => a - b)
    : DAY_COUNTS;
  return (
    <div className="settings__group" role="group" aria-labelledby={titleId}>
      <label className="settings__choice">
        <input
          type="checkbox"
          checked={daySlider.enabled}
          onChange={(event) => daySliderChoice.set(event.currentTarget.checked)}
        />
        {t("settings.meteogram.daySlider")}
      </label>
      <div className="settings__field" aria-disabled={daySlider.enabled || undefined}>
        <label htmlFor={daysId}>{t("settings.meteogram.days")}</label>
        <select
          id={daysId}
          className="settings__select"
          disabled={daySlider.enabled}
          value={String(daySlider.days)}
          onChange={(event) => {
            const { value } = event.currentTarget;
            daysChoice.set(value === "all" ? "all" : (Number(value) as DayCount));
          }}
        >
          <option value="all">{t("settings.meteogram.days.all")}</option>
          {counts.map((count) => (
            <option key={count} value={String(count)}>
              {count}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
