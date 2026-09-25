import { describe, it, expect } from 'vitest';
import {
  getMetaForModel,
  getModelMetadataWithFallback,
  validateModelChain,
  getUnselectedModelKeys,
  filterAndSortAvailableModels,
  reorderAndAdjustModelChain,
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
