import { describe, it, expect } from 'vitest';
import {
  calculateConvectiveExtremes,
  isLpiSupportedByModel,
  buildLpiSegments,
} from './meteogramConvective';
import type { DataPoint, WeatherModel } from '../types';

describe('meteogramConvective', () => {
  it('calculates capeMax and cinMax with 10% ceiling', () => {
    const data: DataPoint[] = [
      { timestamp: '2026-09-16T00:00:00Z', value: 1000, unit: 'J/kg', variable: 'cape', model: 'ICON-D2' },
      { timestamp: '2026-09-16T00:00:00Z', value: -150, unit: 'J/kg', variable: 'convective_inhibition', model: 'ICON-D2' },
    ];
    const { capeMax, cinMax } = calculateConvectiveExtremes(undefined, data);
    expect(capeMax).toBe(1100);
    expect(cinMax).toBe(165);
  });

  it('checks whether a model supports LPI', () => {
    const chain: WeatherModel[] = [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }];
    const availableModels = {
      'icon-d2': {
        name: 'ICON-D2',
        supported_variables: ['lightning_potential'],
      },
    };
    expect(isLpiSupportedByModel('ICON-D2', chain, availableModels)).toBe(true);
    expect(isLpiSupportedByModel('GFS', chain, availableModels)).toBe(false);
  });

  it('builds segmented LPI SVG paths', () => {
    const ts = 1000000;
    const timestamps = [ts];
    const timeMap = new Map<number, Record<string, DataPoint>>();
    timeMap.set(ts, {
      lightning_potential: {
        timestamp: '2026-09-16T00:00:00Z',
        value: 15,
        unit: 'J/kg',
        variable: 'lightning_potential',
        model: 'ICON-D2',
      },
    });
    const chain: WeatherModel[] = [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }];
    const availableModels = {
      'icon-d2': { name: 'ICON-D2', supported_variables: ['lightning_potential'] },
    };

    const segments = buildLpiSegments(
      timestamps,
      timeMap,
      chain,
      availableModels,
      500,
      65,
      (t) => t / 1000,
      ts + 3600000,
    );

    expect(segments.length).toBe(1);
    expect(segments[0].model).toBe('ICON-D2');
    expect(segments[0].path).toContain('M 1000');
  });
});

