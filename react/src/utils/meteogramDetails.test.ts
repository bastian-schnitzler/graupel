import { describe, it, expect } from 'vitest';
import { buildFullscreenDetailRows } from './meteogramDetails';
import type { DataPoint } from '../types';

describe('meteogramDetails', () => {
  it('keeps the original fullscreen fields when snow data is present', () => {
    const point = (variable: string, value: number, unit: string): DataPoint => ({
      timestamp: '2026-09-16T12:00:00Z', value, unit, variable, model: 'ICON',
    });
    const hoverData = {
      precipitation: point('precipitation', 2, 'mm'),
      snowfall: point('snowfall', 1.5, 'cm'),
      snow_depth: point('snow_depth', 0.2, 'm'),
    };
    const params = { hoverTimestamp: Date.parse('2026-09-16T12:00:00Z'), hoverData, accumulatedPrecip: 4, resolvedTimezone: 'UTC' };
    const snowy = buildFullscreenDetailRows(params).flat();
    expect(snowy.find((item) => item.label === 'Accumulated')?.value).toBe('4 mm');
    expect(snowy.length).toBe(12);
    expect(buildFullscreenDetailRows(params).flat().some((item) => item.label === 'Snowfall' || item.label === 'Snow depth')).toBe(false);
  });

  it('builds two rows of formatted metric pairs', () => {
    const hoverData: Record<string, DataPoint> = {
      temperature: { timestamp: '2026-09-16T12:00:00Z', value: 18.5, unit: '°C', variable: 'temperature', model: 'ICON' },
      wind_speed: { timestamp: '2026-09-16T12:00:00Z', value: 25, unit: 'km/h', variable: 'wind_speed', model: 'ICON' },
      precipitation: { timestamp: '2026-09-16T12:00:00Z', value: 2.1, unit: 'mm', variable: 'precipitation', model: 'ICON' },
    };

    const rows = buildFullscreenDetailRows({
      hoverTimestamp: Date.parse('2026-09-16T12:00:00Z'),
      hoverData,
      accumulatedPrecip: 5.4,
      resolvedTimezone: 'UTC',
    });

    expect(rows.length).toBe(2);
    expect(rows[0].some((item) => item.label === 'Temperature' && item.value === '18.5 °C')).toBe(true);
    expect(rows[0].some((item) => item.label === 'Precipitation' && item.value === '2.1 mm')).toBe(true);
    expect(rows[1].some((item) => item.label === 'Accumulated' && item.value === '5.4 mm')).toBe(true);
  });
});
