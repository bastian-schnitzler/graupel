// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { DataPoint } from './types';
import { getCardinalDirection } from "./tooltip";
import { DEFAULT_LOCALE, resolveMeteogramTexts, type MeteogramTexts } from "./texts";
import { LIGHT_THEME, type MeteogramTheme } from "./theme";
import { getZonedDateParts } from "./timeline";

export interface FullscreenDetailItem {
  label: string;
  value: string;
  testId: string;
  color?: string;
  /**
   * The value's curve is drawn dashed (apparent temperature, wind gusts:
   * same colour as their partner); show the colour symbol dashed too.
   */
  dashed?: boolean;
}

interface BuildFullscreenDetailRowsParams {
  hoverTimestamp: number | null;
  hoverData: Record<string, DataPoint> | null;
  accumulatedPrecip: number | null;
  resolvedTimezone: string;
  /** Quantities of the layout; columns without any of them are dropped. */
  quantities?: Set<string>;
  /** Value colours (`theme.details`); default `light`. */
  theme?: MeteogramTheme;
  /** Locale of the date (default `en-US`). */
  locale?: string;
  /** Labels (default English). */
  texts?: Partial<MeteogramTexts>;
}

/**
 * Builds the two-row metric grid for the fullscreen meteogram details panel.
 */
export function buildFullscreenDetailRows({
  hoverTimestamp,
  hoverData,
  accumulatedPrecip,
  resolvedTimezone,
  quantities,
  theme = LIGHT_THEME,
  locale = DEFAULT_LOCALE,
  texts: customTexts,
}: BuildFullscreenDetailRowsParams): FullscreenDetailItem[][] {
  const texts = resolveMeteogramTexts(customTexts);
  const colors = theme.details;
  const targetTs = hoverTimestamp !== null ? hoverTimestamp : null;
  const targetData = hoverData;
  const targetAccPrecip = hoverTimestamp !== null ? accumulatedPrecip : null;

  const placeholder = '—';
  // A whole date in the style of the locale, as Intl formats it, with the
  // period after a weekday where the locale writes one (REQ-668).
  const dateStr = targetTs
    ? (() => {
        const dateObj = new Date(targetTs);
        const dateParts = getZonedDateParts(targetTs, resolvedTimezone);
        return `${dateObj.toLocaleDateString(locale, {
          weekday: 'short',
          month: 'numeric',
          day: 'numeric',
          timeZone: resolvedTimezone,
        })} — ${dateParts.hour}:${dateParts.minute}`;
      })()
    : placeholder;

  const tempVal = targetData?.['temperature']?.value;
  const apparentVal = targetData?.['apparent_temperature']?.value;
  const windVal = targetData?.['wind_speed']?.value;
  const gustVal = targetData?.['wind_gusts']?.value;
  const dirVal = targetData?.['wind_direction']?.value;
  const precipVal = targetData?.['precipitation']?.value;
  const probVal = targetData?.['precipitation_probability']?.value;

  const row1: FullscreenDetailItem[] = [
    { label: texts.time, value: dateStr, testId: 'fullscreen-detail-time' },
    {
      label: texts.temperature,
      value:
        tempVal !== undefined && tempVal !== null
          ? `${tempVal} °C`
          : placeholder,
      color: colors['temperature'],
      testId: 'fullscreen-detail-temp',
    },
    {
      label: texts.feelsLike,
      value:
        apparentVal !== undefined && apparentVal !== null
          ? `${apparentVal} °C`
          : placeholder,
      color: colors['apparent_temperature'],
      dashed: true,
      testId: 'fullscreen-detail-apparent-temp',
    },
    {
      label: texts.windSpeed,
      value:
        windVal !== undefined && windVal !== null
          ? `${windVal} km/h`
          : placeholder,
      color: colors['wind_speed'],
      testId: 'fullscreen-detail-wind',
    },
    {
      label: texts.gusts,
      value:
        gustVal !== undefined && gustVal !== null
          ? `${gustVal} km/h`
          : placeholder,
      color: colors['wind_gusts'],
      dashed: true,
      testId: 'fullscreen-detail-gusts',
    },
  ];

  const row2: FullscreenDetailItem[] = [
    {
      label: texts.direction,
      value:
        dirVal !== undefined && dirVal !== null
          ? getCardinalDirection(dirVal)
          : placeholder,
      color: colors['wind_direction'],
      testId: 'fullscreen-detail-direction',
    },
    {
      label: texts.precipitationProbability,
      value:
        probVal !== undefined && probVal !== null
          ? `${probVal} %`
          : placeholder,
      color: colors['precipitation_probability'],
      testId: 'fullscreen-detail-prob',
    },
    {
      label: texts.precipitation,
      value:
        precipVal !== undefined && precipVal !== null
          ? `${precipVal} mm`
          : placeholder,
      color: colors['precipitation'],
      testId: 'fullscreen-detail-precip',
    },
    {
      label: texts.accumulated,
      value:
        targetAccPrecip !== null && targetAccPrecip !== undefined
          ? `${parseFloat(targetAccPrecip.toFixed(2))} mm`
          : placeholder,
      color: colors['precipitation'],
      testId: 'fullscreen-detail-accumulated-precip',
    },
  ];

  const columns: {
    top: FullscreenDetailItem;
    bottom: FullscreenDetailItem;
    quantities: (string | null)[];
  }[] = [
    {
      top: row1[0]!,
      bottom: { label: '', value: '', testId: 'fullscreen-detail-empty' },
      quantities: [null, null],
    },
    { top: row1[1]!, bottom: row1[2]!, quantities: ['temperature', 'apparent_temperature'] },
    { top: row2[2]!, bottom: row2[3]!, quantities: ['precipitation', 'precipitation'] },
    { top: row2[0]!, bottom: row2[1]!, quantities: ['wind_direction', 'precipitation_probability'] },
    { top: row1[3]!, bottom: row1[4]!, quantities: ['wind_speed', 'wind_gusts'] },
    {
      top: {
        label: texts.cape,
        value:
          targetData?.['cape']?.value != null
            ? `${targetData['cape'].value} J/kg`
            : placeholder,
        testId: 'fullscreen-detail-cape',
      },
      bottom: {
        label: texts.cin,
        value:
          targetData?.['convective_inhibition']?.value != null
            ? `${-Math.abs(targetData['convective_inhibition'].value!)} J/kg`
            : placeholder,
        testId: 'fullscreen-detail-cin',
      },
      quantities: ['cape', 'convective_inhibition'],
    },
  ];

  // Without a layout every column is shown (time column always).
  const shown = (quantity: string | null) =>
    quantity === null || !quantities || quantities.has(quantity);
  const visible = columns.filter(({ quantities: ids }) =>
    ids.every((id) => id === null) ? true : ids.some(shown),
  );
  const cell = (item: FullscreenDetailItem, quantity: string | null) =>
    shown(quantity)
      ? item
      : { label: '', value: '', testId: `${item.testId}-empty` };

  return [
    visible.map((column) => cell(column.top, column.quantities[0] ?? null)),
    visible.map((column) => cell(column.bottom, column.quantities[1] ?? null)),
  ];
}
