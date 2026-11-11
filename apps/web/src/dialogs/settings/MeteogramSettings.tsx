// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import {
  DEW_POINT_MODES,
  RELATIVE_HUMIDITY_MODES,
  type DewPointMode,
  type RelativeHumidityMode,
} from "@graupel/meteogram";
import { useId } from "react";
import { useT, type MessageKey } from "../../i18n/index.ts";
import {
  setDewPoint,
  setLegend,
  setRelativeHumidity,
  setScaleToVisibleRange,
  useDewPoint,
  useLegend,
  useRelativeHumidity,
  useScaleToVisibleRange,
} from "../../state/index.ts";
import type { SettingsSectionProps } from "./sections.tsx";

const DEW_POINT_LABELS: Readonly<Record<DewPointMode, MessageKey>> = {
  auto: "settings.meteogram.dewPoint.auto",
  on: "settings.meteogram.dewPoint.on",
  off: "settings.meteogram.dewPoint.off",
};

const RELATIVE_HUMIDITY_LABELS: Readonly<Record<RelativeHumidityMode, MessageKey>> = {
  on: "settings.meteogram.relativeHumidity.on",
  off: "settings.meteogram.relativeHumidity.off",
};

/** Choices of the axes when zoomed (REQ-656), in this order. */
const SCALE_TO_VISIBLE_RANGE_CHOICES: readonly { value: boolean; label: MessageKey }[] = [
  { value: true, label: "settings.meteogram.scaleToVisibleRange.on" },
  { value: false, label: "settings.meteogram.scaleToVisibleRange.off" },
];

/**
 * Meteogram section of the settings popup, in the tab Meteogram (REQ-686), in this order: the legend on or off
 * (REQ-639: its X switches it off, here it comes back); whether the axes adapt when zoomed (REQ-656): On or Off, On
 * without a choice, with a hint that it concerns precipitation and wind; the dew point (REQ-593): Auto, On or Off (Off
 * without a choice, REQ-621), chosen like the colour mode, with a hint that explains Auto; directly below it the
 * relative humidity (REQ-650): On or Off, Off without a choice. Each shows the value that applies; changing it stores
 * the choice and the page follows at once. The model headers moved to the tab Models, the day slider to the tab Start.
 */
export function MeteogramSettings({ titleId }: SettingsSectionProps) {
  const t = useT();
  const dewPointId = useId();
  const dewPointHintId = useId();
  const relativeHumidityId = useId();
  const scaleId = useId();
  const scaleHintId = useId();
  const legend = useLegend();
  const dewPoint = useDewPoint();
  const relativeHumidity = useRelativeHumidity();
  const scaleToVisibleRange = useScaleToVisibleRange();
  return (
    <div className="settings__group" role="group" aria-labelledby={titleId}>
      <label className="settings__choice">
        <input type="checkbox" checked={legend} onChange={(event) => setLegend(event.currentTarget.checked)} />
        {t("settings.meteogram.legend")}
      </label>
      <div className="settings__field">
        <span id={scaleId}>{t("settings.meteogram.scaleToVisibleRange")}</span>
        <div className="settings__choices" role="radiogroup" aria-labelledby={scaleId} aria-describedby={scaleHintId}>
          {SCALE_TO_VISIBLE_RANGE_CHOICES.map(({ value, label }) => (
            <label key={label} className="settings__choice">
              <input
                type="radio"
                name="graupel-scale-to-visible-range"
                value={value ? "on" : "off"}
                checked={scaleToVisibleRange === value}
                onChange={() => setScaleToVisibleRange(value)}
              />
              {t(label)}
            </label>
          ))}
        </div>
      </div>
      <p className="settings__hint" id={scaleHintId}>
        {t("settings.meteogram.scaleToVisibleRange.hint")}
      </p>
      <div className="settings__field">
        <span id={dewPointId}>{t("settings.meteogram.dewPoint")}</span>
        <div
          className="settings__choices"
          role="radiogroup"
          aria-labelledby={dewPointId}
          aria-describedby={dewPointHintId}
        >
          {DEW_POINT_MODES.map((mode) => (
            <label key={mode} className="settings__choice">
              <input
                type="radio"
                name="graupel-dew-point"
                value={mode}
                checked={dewPoint === mode}
                onChange={() => setDewPoint(mode)}
              />
              {t(DEW_POINT_LABELS[mode])}
            </label>
          ))}
        </div>
      </div>
      <p className="settings__hint" id={dewPointHintId}>
        {t("settings.meteogram.dewPoint.hint")}
      </p>
      <div className="settings__field">
        <span id={relativeHumidityId}>{t("settings.meteogram.relativeHumidity")}</span>
        <div className="settings__choices" role="radiogroup" aria-labelledby={relativeHumidityId}>
          {RELATIVE_HUMIDITY_MODES.map((mode) => (
            <label key={mode} className="settings__choice">
              <input
                type="radio"
                name="graupel-relative-humidity"
                value={mode}
                checked={relativeHumidity === mode}
                onChange={() => setRelativeHumidity(mode)}
              />
              {t(RELATIVE_HUMIDITY_LABELS[mode])}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
