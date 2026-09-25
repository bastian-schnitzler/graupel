import { describe, it, expect } from 'vitest';
import { buildFullscreenDetailRows } from './meteogramDetails';
import type { DataPoint } from '../types';

describe('meteogramDetails', () => {
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

