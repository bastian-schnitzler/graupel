import { describe, it, expect } from 'vitest';
import {
  getMetaForModel,
  getModelMetadataWithFallback,
  validateModelChain,
  getUnselectedModelKeys,
  filterAndSortAvailableModels,
  reorderAndAdjustModelChain,
  tryAddModelToChain,
} from './modelChainBuilderUtils';
import type { WeatherModel, ModelMetadata } from '../../types';

describe('modelChainBuilderUtils', () => {
  const mockModels: Record<string, ModelMetadata> = {
    icon_d2: {
      id: 'icon_d2',
      name: 'ICON-D2',
      max_forecast_horizon_hours: 48,
      description: 'DWD high-res',
    },
    icon_eu: {
      id: 'icon_eu',
      name: 'ICON-EU',
      max_forecast_horizon_hours: 120,
      description: 'DWD Europe',
    },
    gfs_seamless: {
      id: 'gfs_seamless',
      name: 'GFS Seamless',
      max_forecast_horizon_hours: 384,
      description: 'NOAA GFS',
    },
  };

  it('resolves metadata for canonical and legacy alias model names', () => {
    expect(getMetaForModel({ name: 'ICON-D2', max_forecast_horizon_hours: 48 }, mockModels)?.id).toBe('icon_d2');
    expect(getMetaForModel({ name: 'GFS', max_forecast_horizon_hours: 384 }, mockModels)?.id).toBe('gfs_seamless');
    expect(getModelMetadataWithFallback({ name: 'Unknown', max_forecast_horizon_hours: 24 }).name).toBe('Unknown');
  });

  it('validates model chain monotonicity and capability bounds', () => {
    const validChain: WeatherModel[] = [
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
    ];
    expect(validateModelChain(validChain, mockModels)).toHaveLength(0);

    const nonMonotonic: WeatherModel[] = [
      { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
    ];
    const errors = validateModelChain(nonMonotonic, mockModels);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('must be greater than or equal to previous');
  });

  it('identifies unselected models and filters by search term', () => {
    const chain: WeatherModel[] = [{ name: 'ICON-D2', id: 'icon_d2', max_forecast_horizon_hours: 48 }];
    const unselected = getUnselectedModelKeys(chain, mockModels);
    expect(unselected).toContain('icon_eu');
    expect(unselected).toContain('gfs_seamless');
    expect(unselected).not.toContain('icon_d2');

    const filtered = filterAndSortAvailableModels(unselected, mockModels, 'europe');
    expect(filtered).toEqual(['icon_eu']);
  });

  it('reorders and adjusts model chains correctly', () => {
    const chain: WeatherModel[] = [
      { name: 'ICON-D2', id: 'icon_d2', max_forecast_horizon_hours: 24 },
      { name: 'ICON-EU', id: 'icon_eu', max_forecast_horizon_hours: 72 },
      { name: 'GFS Seamless', id: 'gfs_seamless', max_forecast_horizon_hours: 120 },
    ];
    // Move GFS Seamless from index 2 to index 1
    const reordered = reorderAndAdjustModelChain(chain, 2, 1, mockModels);
    expect(reordered[0].name).toBe('ICON-D2');
    expect(reordered[1].name).toBe('GFS Seamless');
    expect(reordered[2].name).toBe('ICON-EU');
    expect(reordered[0].max_forecast_horizon_hours).toBe(24);
    expect(reordered[1].max_forecast_horizon_hours).toBe(120);
    expect(reordered[2].max_forecast_horizon_hours).toBe(120);
  });
});

describe('tryAddModelToChain (spec §16.11, #38)', () => {
  const meta = (id: string, cap: number): ModelMetadata => ({
    id,
    name: id,
    max_forecast_horizon_hours: cap,
  });
  const catalogue: Record<string, ModelMetadata> = {
    CH1: meta('CH1', 33),
    CH2: meta('CH2', 120),
    CH2b: meta('CH2b', 120),
    B: meta('B', 120),
    C: meta('C', 240),
    D: meta('D', 360),
    X180: meta('X180', 180),
    X360: meta('X360', 360),
  };
  const chain = (...items: [string, number][]): WeatherModel[] =>
    items.map(([id, h]) => ({ id, name: id, max_forecast_horizon_hours: h }));
  const ends = (models: WeatherModel[] = []) =>
    models.map((m) => [m.id, m.max_forecast_horizon_hours]);
  const add = (models: WeatherModel[], key: string) =>
    tryAddModelToChain(models, key, catalogue);

  const valid = (models: WeatherModel[]) => {
    const hours = models.map((m) => m.max_forecast_horizon_hours);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));
    for (const m of models) {
      expect(m.max_forecast_horizon_hours).toBeLessThanOrEqual(
        catalogue[m.id!].max_forecast_horizon_hours,
      );
    }
  };

  it('inserts a shorter model first and keeps the chain end', () => {
    // ICON-CH2 (cap 120h, H 50h) + ICON-CH1 (33h) -> 0-33h, 33-50h.
    const result = add(chain(['CH2', 50]), 'CH1');
    expect(result.success).toBe(true);
    expect(ends(result.newChain)).toEqual([['CH1', 33], ['CH2', 50]]);
    valid(result.newChain!);
  });

  it('inserts between models by capability', () => {
    const base = chain(['B', 120], ['C', 240], ['D', 360]);
    expect(ends(add(base, 'X180').newChain)).toEqual([
      ['B', 120], ['X180', 180], ['C', 240], ['D', 360],
    ]);
    expect(ends(add(base, 'CH1').newChain)).toEqual([
      ['CH1', 33], ['B', 120], ['C', 240], ['D', 360],
    ]);
    // 120h + 360h, add 180h: in between.
    expect(ends(add(chain(['B', 120], ['D', 360]), 'X180').newChain)).toEqual([
      ['B', 120], ['X180', 180], ['D', 360],
    ]);
  });

  it('clamps the new boundary to its neighbours', () => {
    // C ends at 150h (dragged): the 180h model gets at most 150h.
    const result = add(chain(['B', 100], ['C', 150]), 'X180');
    expect(ends(result.newChain)).toEqual([['B', 100], ['X180', 150], ['C', 150]]);
    valid(result.newChain!);
    // B ends at 20h (dragged): CH1 (33h) before it gets 0-20h, B 0h.
    expect(ends(add(chain(['B', 20]), 'CH1').newChain)).toEqual([
      ['CH1', 20], ['B', 20],
    ]);
  });

  it('appends a longer model with its capability', () => {
    expect(ends(add(chain(['CH1', 33], ['B', 120]), 'D').newChain)).toEqual([
      ['CH1', 33], ['B', 120], ['D', 360],
    ]);
  });

  it('handles an empty and a one-model chain', () => {
    expect(ends(add([], 'C').newChain)).toEqual([['C', 240]]);
    expect(ends(add(chain(['C', 240]), 'B').newChain)).toEqual([['B', 120], ['C', 240]]);
    expect(ends(add(chain(['C', 240]), 'D').newChain)).toEqual([['C', 240], ['D', 360]]);
  });

  it('rejects an equal capability and leaves the chain unchanged', () => {
    const base = chain(['CH2', 50]);
    const result = add(base, 'CH2b');
    expect(result).toEqual({
      success: false,
      error: 'CH2b and CH2 have the same horizon (120h).',
    });
    expect(ends(base)).toEqual([['CH2', 50]]);
    expect(add(chain(['D', 300]), 'X360').success).toBe(false);
  });
});
