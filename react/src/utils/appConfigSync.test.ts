import { describe, it, expect } from 'vitest';
import type { Location, MeteogramConfig } from '../types';
import {
  getForecastSnapshotKey,
  createConfigSnapshots,
  getChangedConfigIds,
  pruneEphemeralChains,
  pruneModifiedChainsAgainstSnapshot,
  shouldRefetchForecastOnTabSwitch,
} from './appConfigSync';

describe('appConfigSync', () => {
  const mockLocation: Location = {
    name: 'Berlin',
    latitude: 52.52,
    longitude: 13.405,
  };

  const mockConfig: MeteogramConfig = {
    id: 'cfg-1',
    name: 'Default Config',
    location: mockLocation,
    model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
    main_model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
    cloud_model_chain: [{ name: 'ECMWF IFS', max_forecast_horizon_hours: 120 }],
  };

  describe('getForecastSnapshotKey', () => {
    it('returns coordinates string when config is null', () => {
      const key = getForecastSnapshotKey(mockLocation, null);
      expect(key).toBe('52.5200,13.4050');
    });

    it('returns full composite key when config is present', () => {
      const key = getForecastSnapshotKey(mockLocation, mockConfig);
      expect(key).toContain('52.5200,13.4050');
      expect(key).toContain('cfg-1');
      expect(key).toContain('ICON-D2:48');
      expect(key).toContain('ECMWF IFS:120');
    });
  });

  describe('createConfigSnapshots and getChangedConfigIds', () => {
    it('detects no changes when configs are identical', () => {
      const snapshots = createConfigSnapshots([mockConfig]);
      const changed = getChangedConfigIds(snapshots, [mockConfig]);
      expect(changed.size).toBe(0);
    });

    it('detects updated configs', () => {
      const snapshots = createConfigSnapshots([mockConfig]);
      const updatedConfig: MeteogramConfig = {
        ...mockConfig,
        name: 'Updated Name',
      };
      const changed = getChangedConfigIds(snapshots, [updatedConfig]);
      expect(changed.has('cfg-1')).toBe(true);
    });

    it('detects deleted configs', () => {
      const snapshots = createConfigSnapshots([mockConfig]);
      const changed = getChangedConfigIds(snapshots, []);
      expect(changed.has('cfg-1')).toBe(true);
    });

    it('detects newly added configs', () => {
      const snapshots = createConfigSnapshots([mockConfig]);
      const newConfig: MeteogramConfig = {
        id: 'cfg-2',
        name: 'New Config',
        location: mockLocation,
        model_chain: [],
      };
      const changed = getChangedConfigIds(snapshots, [mockConfig, newConfig]);
      expect(changed.has('cfg-2')).toBe(true);
    });
  });

  describe('pruneEphemeralChains', () => {
    it('removes chains matching changed config IDs', () => {
      const prev = {
        'cfg-1': [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
        'cfg-2': [{ name: 'GFS', max_forecast_horizon_hours: 120 }],
      };
      const pruned = pruneEphemeralChains(prev, new Set(['cfg-1']));
      expect(pruned['cfg-1']).toBeUndefined();
      expect(pruned['cfg-2']).toBeDefined();
    });

    it('returns original reference if no changes exist', () => {
      const prev = { 'cfg-1': [] };
      const pruned = pruneEphemeralChains(prev, new Set());
      expect(pruned).toBe(prev);
    });
  });

  describe('pruneModifiedChainsAgainstSnapshot', () => {
    it('prunes chain if stored config differs from snapshot', () => {
      const snapshots = { 'cfg-1': JSON.stringify(mockConfig) };
      const modifiedConfig = { ...mockConfig, name: 'Changed' };
      const prev = { 'cfg-1': [] };

      const pruned = pruneModifiedChainsAgainstSnapshot(prev, [modifiedConfig], snapshots);
      expect(pruned['cfg-1']).toBeUndefined();
    });
  });

  describe('shouldRefetchForecastOnTabSwitch', () => {
    it('returns true if active config was modified', () => {
      const result = shouldRefetchForecastOnTabSwitch({
        currentConfigId: 'cfg-1',
        leavingConfigId: 'cfg-1',
        changedConfigIds: new Set(['cfg-1']),
        currentKey: 'key-a',
        lastLoadedKey: 'key-a',
      });
      expect(result).toBe(true);
    });

    it('returns true if different config was selected', () => {
      const result = shouldRefetchForecastOnTabSwitch({
        currentConfigId: 'cfg-2',
        leavingConfigId: 'cfg-1',
        changedConfigIds: new Set(),
        currentKey: 'key-a',
        lastLoadedKey: 'key-a',
      });
      expect(result).toBe(true);
    });

    it('returns true if location or snapshot changed', () => {
      const result = shouldRefetchForecastOnTabSwitch({
        currentConfigId: 'cfg-1',
        leavingConfigId: 'cfg-1',
        changedConfigIds: new Set(),
        currentKey: 'key-b',
        lastLoadedKey: 'key-a',
      });
      expect(result).toBe(true);
    });

    it('returns false if nothing changed', () => {
      const result = shouldRefetchForecastOnTabSwitch({
        currentConfigId: 'cfg-1',
        leavingConfigId: 'cfg-1',
        changedConfigIds: new Set(),
        currentKey: 'key-a',
        lastLoadedKey: 'key-a',
      });
      expect(result).toBe(false);
    });
  });
});

