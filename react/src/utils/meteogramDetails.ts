import type { DataPoint } from '../types';
import { getCardinalDirection } from '../components/drawing/ChartTooltip';
import { getZonedDateParts } from './timeline';

export interface FullscreenDetailItem {
  label: string;
  value: string;
  testId: string;
  color?: string;
}

interface BuildFullscreenDetailRowsParams {
  hoverTimestamp: number | null;
  hoverData: Record<string, DataPoint> | null;
  accumulatedPrecip: number | null;
  resolvedTimezone: string;
}

/**
 * Builds the two-row metric grid for the fullscreen meteogram details panel.
 */
export function buildFullscreenDetailRows({
  hoverTimestamp,
  hoverData,
  accumulatedPrecip,
  resolvedTimezone,
}: BuildFullscreenDetailRowsParams): FullscreenDetailItem[][] {
  const targetTs = hoverTimestamp !== null ? hoverTimestamp : null;
  const targetData = hoverData;
  const targetAccPrecip = hoverTimestamp !== null ? accumulatedPrecip : null;

  const placeholder = '—';
  const dateStr = targetTs
    ? (() => {
        const dateObj = new Date(targetTs);
        const dateParts = getZonedDateParts(targetTs, resolvedTimezone);
        return `${dateObj.toLocaleDateString('en-US', {
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
    { label: 'Time', value: dateStr, testId: 'fullscreen-detail-time' },
    {
      label: 'Temperature',
      value:
        tempVal !== undefined && tempVal !== null
          ? `${tempVal} °C`
          : placeholder,
      color: '#e11d48',
      testId: 'fullscreen-detail-temp',
    },
    {
      label: 'Feels like',
      value:
        apparentVal !== undefined && apparentVal !== null
          ? `${apparentVal} °C`
          : placeholder,
      color: '#b45309',
      testId: 'fullscreen-detail-apparent-temp',
    },
    {
      label: 'Wind Speed',
      value:
        windVal !== undefined && windVal !== null
          ? `${windVal} km/h`
          : placeholder,
      color: '#0284c7',
      testId: 'fullscreen-detail-wind',
    },
    {
      label: 'Gusts',
      value:
        gustVal !== undefined && gustVal !== null
          ? `${gustVal} km/h`
          : placeholder,
      color: '#d97706',
      testId: 'fullscreen-detail-gusts',
    },
  ];

  const row2: FullscreenDetailItem[] = [
    {
      label: 'Direction',
      value:
        dirVal !== undefined && dirVal !== null
          ? getCardinalDirection(dirVal)
          : placeholder,
      color: '#0284c7',
      testId: 'fullscreen-detail-direction',
    },
    {
      label: 'Precip. Prob.',
      value:
        probVal !== undefined && probVal !== null
          ? `${probVal} %`
          : placeholder,
      color: '#7c3aed',
      testId: 'fullscreen-detail-prob',
    },
    {
      label: 'Precipitation',
      value:
        precipVal !== undefined && precipVal !== null
          ? `${precipVal} mm`
          : placeholder,
      color: '#2563eb',
      testId: 'fullscreen-detail-precip',
    },
    {
      label: 'Accumulated',
      value:
        targetAccPrecip !== null && targetAccPrecip !== undefined
          ? `${parseFloat(targetAccPrecip.toFixed(2))} mm`
          : placeholder,
      color: '#2563eb',
      testId: 'fullscreen-detail-accumulated-precip',
    },
  ];

  return [
    [
      row1[0],
      row1[1],
      row2[2],
      row2[0],
      row1[3],
      {
        label: 'CAPE',
        value:
          targetData?.['cape']?.value != null
            ? `${targetData['cape'].value} J/kg`
            : placeholder,
        testId: 'fullscreen-detail-cape',
      },
    ],
    [
      { label: '', value: '', testId: 'fullscreen-detail-empty' },
      row1[2],
      row2[3],
      row2[1],
      row1[4],
      {
        label: 'CIN',
        value:
          targetData?.['convective_inhibition']?.value != null
            ? `${-Math.abs(targetData['convective_inhibition'].value!)} J/kg`
            : placeholder,
        testId: 'fullscreen-detail-cin',
      },
    ],
  ];
}

