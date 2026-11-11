// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Language options of the meteogram (`locale`, `texts`, `tooltipTexts` of @graupel/meteogram). */
import type { MeteogramTexts, MeteogramTooltipTexts } from "@graupel/meteogram";
import { toLocale, type Language } from "./languages.ts";
import { translate, type MessageKey } from "./messages.ts";

// Texts of the convection area and its tooltip rows, which the website does not draw (REQ-447): the meteogram's
// English defaults stay unused.
type ConvectiveText = "cape" | "cin";
type ConvectiveTooltipText = ConvectiveText | "lpi";

export interface MeteogramI18n {
  locale: string;
  texts: Omit<MeteogramTexts, ConvectiveText>;
  tooltipTexts: Omit<MeteogramTooltipTexts, ConvectiveTooltipText>;
  /** The tooltip with short labels, for the narrow side card of the full-screen view on a phone (REQ-557). */
  shortTooltipTexts: Omit<MeteogramTooltipTexts, ConvectiveTooltipText>;
}

const TEXT_KEYS: Readonly<Record<Exclude<keyof MeteogramTexts, ConvectiveText>, MessageKey>> = {
  emptyState: "meteogram.emptyState",
  time: "meteogram.time",
  temperature: "meteogram.temperature",
  feelsLike: "meteogram.feelsLike",
  windSpeed: "meteogram.windSpeed",
  gusts: "meteogram.gusts",
  direction: "meteogram.direction",
  precipitationProbability: "meteogram.precipitationProbability",
  precipitation: "meteogram.precipitation",
  accumulated: "meteogram.accumulated",
};

/** Tooltip labels; `meteogram.tooltipLabel` adds the language's colon ("{label}:", French "{label} :"). */
const TOOLTIP_LABEL_KEYS: Readonly<
  Record<Exclude<keyof MeteogramTooltipTexts, "noModel" | ConvectiveTooltipText>, MessageKey>
> = {
  temperature: "meteogram.temperature",
  apparentTemperature: "meteogram.feelsLike",
  // Rows of the dew point, its spread and the relative humidity, while they are drawn (REQ-671, REQ-676).
  dewPoint: "meteogram.dewPoint",
  dewPointSpread: "meteogram.dewPointSpread",
  relativeHumidity: "meteogram.relativeHumidity",
  windSpeed: "meteogram.windSpeed",
  windGusts: "meteogram.gusts",
  windDirection: "meteogram.direction",
  precipitationProbability: "meteogram.precipitationProbability",
  precipitation: "meteogram.precipitation",
  accumulated: "meteogram.accumulated",
  snowfall: "meteogram.snowfall",
  snowDepth: "meteogram.snowDepth",
  accumulatedSnowfall: "meteogram.accumulatedSnowfall",
};

/** Short tooltip labels (REQ-557); the others are short already. */
const SHORT_TOOLTIP_LABEL_KEYS: Readonly<Partial<Record<keyof typeof TOOLTIP_LABEL_KEYS, MessageKey>>> = {
  dewPoint: "meteogram.tooltipShort.dewPoint",
  dewPointSpread: "meteogram.tooltipShort.dewPointSpread",
  relativeHumidity: "meteogram.tooltipShort.relativeHumidity",
  windSpeed: "meteogram.tooltipShort.windSpeed",
  precipitationProbability: "meteogram.tooltipShort.precipitationProbability",
  precipitation: "meteogram.tooltipShort.precipitation",
  snowfall: "meteogram.tooltipShort.snowfall",
  snowDepth: "meteogram.tooltipShort.snowDepth",
  accumulatedSnowfall: "meteogram.tooltipShort.accumulatedSnowfall",
};

function mapKeys<K extends string>(keys: Readonly<Record<K, MessageKey>>, text: (key: MessageKey) => string) {
  return Object.fromEntries(Object.entries<MessageKey>(keys).map(([name, key]) => [name, text(key)])) as Record<
    K,
    string
  >;
}

/** Meteogram options for a language. */
export function meteogramI18n(language: Language): MeteogramI18n {
  const t = (key: MessageKey) => translate(language, key);
  const label = (key: MessageKey) => translate(language, "meteogram.tooltipLabel", { label: t(key) });
  const tooltipTexts = { ...mapKeys(TOOLTIP_LABEL_KEYS, label), noModel: t("meteogram.noModel") };
  return {
    locale: toLocale(language),
    texts: mapKeys(TEXT_KEYS, t),
    tooltipTexts,
    shortTooltipTexts: { ...tooltipTexts, ...mapKeys(SHORT_TOOLTIP_LABEL_KEYS as Record<string, MessageKey>, label) },
  };
}
