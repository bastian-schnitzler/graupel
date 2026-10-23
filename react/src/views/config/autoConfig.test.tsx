import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigView } from '../ConfigView';
import { apiService } from '../../services/apiService';
import type {
  AutoChainEntry,
  AutoChainInfo,
  MeteogramConfig,
  RegionSummary,
} from '../../types';
import { createAutoConfigurationPayload } from './configFactories';
import {
  CHAIN_PREFIX,
  FROM_LOCATION,
  groupAutoChains,
  groupRegions,
} from './autoConfigDialog.logic';

const munich = { name: 'Munich', latitude: 48.137, longitude: 11.576 };

const germanyInfo: AutoChainInfo = {
  region_id: 'germany',
  region_name: 'Germany',
  resolution_reason: 'region',
  main_model_chain: [
    { id: 'icon_d2', name: 'DWD ICON-D2', short_name: 'ICON-D2', max_forecast_horizon_hours: 48, provider: 'DWD' },
    { id: 'icon_eu', name: 'DWD ICON-EU', max_forecast_horizon_hours: 120 },
    { id: 'ecmwf_ifs', name: 'ECMWF IFS', max_forecast_horizon_hours: 360 },
  ],
  cloud_model_chain: [
    { id: 'icon_d2', name: 'DWD ICON-D2', max_forecast_horizon_hours: 48 },
    { id: 'ecmwf_ifs025', name: 'ECMWF IFS 0.25°', max_forecast_horizon_hours: 360 },
  ],
};

const region = (id: string, name: string, group: string): RegionSummary => ({
  id,
  name,
  group,
  priority: 20,
  main_chain_ids: [],
  cloud_chain_ids: [],
});

describe('createAutoConfigurationPayload', () => {
  it('copies both chains as stored chain entries at the location', () => {
    const payload = createAutoConfigurationPayload([], munich, germanyInfo);
    expect(payload.name).toBe('Germany');
    expect(payload.location).toEqual(munich);
    expect(payload.location).not.toBe(munich);
    expect(payload.main_model_chain).toEqual([
      { id: 'icon_d2', name: 'DWD ICON-D2', short_name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { id: 'icon_eu', name: 'DWD ICON-EU', max_forecast_horizon_hours: 120 },
      { id: 'ecmwf_ifs', name: 'ECMWF IFS', max_forecast_horizon_hours: 360 },
    ]);
    expect(payload.model_chain).toEqual(payload.main_model_chain);
    expect(payload.cloud_model_chain?.map((m) => m.id)).toEqual(['icon_d2', 'ecmwf_ifs025']);
  });

  it('numbers a taken name and falls back to the location name', () => {
    const existing = [{ name: 'germany', location: munich, model_chain: [] }] as MeteogramConfig[];
    expect(createAutoConfigurationPayload(existing, munich, germanyInfo).name).toBe('Germany 2');
    const global = { ...germanyInfo, region_id: null, region_name: null, resolution_reason: 'global_fallback' };
    expect(createAutoConfigurationPayload([], munich, global).name).toBe('Munich');
  });
});

describe('groupRegions', () => {
  it('keeps group order and sorts regions by name', () => {
    const groups = groupRegions([
      region('northern_alps', 'Northern Alps', 'Europe'),
      region('usa', 'USA', 'North America'),
      region('austria', 'Austria', 'Europe'),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Europe', 'North America']);
    expect(groups[0].regions.map((r) => r.id)).toEqual(['austria', 'northern_alps']);
  });
});

const model = (id: string, short_name: string, hours = 360) => ({
  id,
  name: id,
  short_name,
  max_forecast_horizon_hours: hours,
});

const chainEntry = (
  id: string,
  group: string,
  main: [string, string][],
  cloud: [string, string][],
  origin: string,
  area_km2: number,
): AutoChainEntry => ({
  id,
  group,
  name: main.map(([, short]) => short).join(' → '),
  region_name: main.map(([, short]) => short).join(' → '),
  origin,
  regions: [],
  area_km2,
  resolution_reason: 'domain_fallback',
  main_model_chain: main.map(([mid, short]) => model(mid, short)),
  cloud_model_chain: cloud.map(([mid, short]) => model(mid, short)),
});

const IFS: [string, string] = ['ecmwf_ifs', 'IFS'];
const IFS025: [string, string] = ['ecmwf_ifs025', 'IFS 0.25'];
const autoChains: AutoChainEntry[] = [
  chainEntry('ifs', 'Global', [IFS], [IFS025], 'rest of the world', 300),
  chainEntry('arpege', 'Europe', [['arpege', 'ARPEGE'], IFS], [['arpege', 'ARPEGE'], IFS025], 'regional models', 20),
  chainEntry('rdps', 'Intercontinental', [['rdps', 'RDPS'], IFS], [['rdps', 'RDPS'], IFS025], 'USA, Canada', 25),
  chainEntry('hrrr', 'North America', [['hrrr', 'HRRR'], IFS], [['hrrr', 'HRRR'], IFS025], 'regional models', 9),
  chainEntry('hd-a', 'Europe', [['hd', 'AROME HD'], IFS], [['eu', 'ICON-EU'], IFS025], 'regional models (at sea)', 5),
  chainEntry('hd-b', 'Europe', [['hd', 'AROME HD'], IFS], [['uk', 'UKMO UK'], IFS025], 'regional models (at sea)', 4),
];

describe('groupAutoChains (#198)', () => {
  it('orders Intercontinental, other chains per continent, then Global', () => {
    const groups = groupAutoChains(autoChains);
    expect(groups.map((g) => g.group)).toEqual([
      'Intercontinental',
      'Other chains · Europe',
      'Other chains · North America',
      'Global (IFS only)',
    ]);
    expect(groups[1].entries.map((e) => e.label)).toEqual([
      'ARPEGE → IFS · regional models',
      // Same main chain: the clouds tell them apart.
      'AROME HD → IFS (clouds: ICON-EU → IFS 0.25) · regional models (at sea)',
      'AROME HD → IFS (clouds: UKMO UK → IFS 0.25) · regional models (at sea)',
    ]);
    expect(groups[0].entries[0]).toEqual({
      value: `${CHAIN_PREFIX}rdps`,
      label: 'RDPS → IFS · USA, Canada',
      title: 'Clouds: RDPS → IFS 0.25',
    });
  });
});

describe('ConfigView start from auto configuration', () => {
  const existing: MeteogramConfig = {
    id: 'cfg-1',
    name: 'Alps',
    location: { name: 'Innsbruck', latitude: 47.26, longitude: 11.39 },
    model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
  };

  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
    vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([existing]);
    vi.spyOn(apiService, 'getModels').mockResolvedValue([]);
    vi.spyOn(apiService, 'listRegions').mockResolvedValue([
      region('germany', 'Germany', 'Europe'),
      region('usa', 'USA', 'North America'),
    ]);
    vi.spyOn(apiService, 'listAutoChains').mockResolvedValue(autoChains);
  });

  it('creates a configuration from a chain without a region (#198)', async () => {
    const regionChains = vi.spyOn(apiService, 'getRegionChains');
    const resolve = vi.spyOn(apiService, 'resolveAutoChain').mockResolvedValue(germanyInfo);
    const create = vi
      .spyOn(apiService, 'createConfiguration')
      .mockImplementation(async (cfg) => ({ ...cfg, id: 'cfg-new' }));
    render(
      <ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} currentLocation={munich} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start from auto configuration' }));
    const select = (await screen.findByRole('combobox', { name: 'Region' })) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'RDPS → IFS · USA, Canada' });
    const labels = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(labels).toEqual([
      'Europe',
      'North America',
      'Intercontinental',
      'Other chains · Europe',
      'Other chains · North America',
      'Global (IFS only)',
    ]);
    fireEvent.change(select, { target: { value: `${CHAIN_PREFIX}rdps` } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const [payload] = create.mock.calls[0];
    expect(payload.name).toBe('RDPS → IFS');
    expect(payload.location).toEqual(munich);
    expect(payload.main_model_chain?.map((m) => m.id)).toEqual(['rdps', 'ecmwf_ifs']);
    expect(payload.cloud_model_chain?.map((m) => m.id)).toEqual(['rdps', 'ecmwf_ifs025']);
    // The entry carries its chains: nothing is resolved again.
    expect(regionChains).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalledWith(munich);
  });

  it('shows the region the configuration location resolves to', async () => {
    const resolve = vi.spyOn(apiService, 'resolveAutoChain').mockResolvedValue({
      ...germanyInfo,
      region_id: 'eastern_alps',
      region_name: 'Eastern Alps',
    });
    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} />);
    const info = await screen.findByTestId('config-auto-region');
    expect(info.textContent).toBe('Auto region at Innsbruck: Eastern Alps');
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 47.26, longitude: 11.39 }),
    );
  });

  it('creates a configuration from a region at the current location', async () => {
    vi.spyOn(apiService, 'resolveAutoChain').mockResolvedValue(germanyInfo);
    const regionChains = vi.spyOn(apiService, 'getRegionChains').mockResolvedValue({
      ...germanyInfo,
      region_id: 'usa',
      region_name: 'USA',
    });
    const create = vi
      .spyOn(apiService, 'createConfiguration')
      .mockImplementation(async (cfg) => ({ ...cfg, id: 'cfg-new' }));
    const onSelect = vi.fn();
    render(
      <ConfigView selectedConfigId="cfg-1" onSelectConfig={onSelect} currentLocation={munich} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start from auto configuration' }));
    const select = (await screen.findByRole('combobox', { name: 'Region' })) as HTMLSelectElement;
    expect(select.value).toBe(FROM_LOCATION);
    expect(screen.getByRole('option', { name: 'From current location (Munich)' })).toBeTruthy();
    await screen.findByRole('option', { name: 'USA' });
    fireEvent.change(select, { target: { value: 'usa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(regionChains).toHaveBeenCalledWith('usa');
    const [payload, index] = create.mock.calls[0];
    expect(payload.name).toBe('USA');
    expect(payload.location).toEqual(munich);
    expect(index).toBe(1);
    await waitFor(() => expect(screen.queryByTestId('auto-config-dialog')).toBeNull());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'cfg-new' }));
    expect(screen.getByText('USA')).toBeTruthy();
  });

  it('resolves the current location for "from current location"', async () => {
    const resolve = vi.spyOn(apiService, 'resolveAutoChain').mockResolvedValue(germanyInfo);
    const create = vi
      .spyOn(apiService, 'createConfiguration')
      .mockImplementation(async (cfg) => ({ ...cfg, id: 'cfg-new' }));
    render(
      <ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} currentLocation={munich} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start from auto configuration' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(resolve).toHaveBeenCalledWith(munich);
    expect(create.mock.calls[0][0].name).toBe('Germany');
  });

  it('cancels with Escape and reports a failed creation', async () => {
    vi.spyOn(apiService, 'resolveAutoChain').mockResolvedValue(germanyInfo);
    vi.spyOn(apiService, 'createConfiguration').mockRejectedValue(new Error('db'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} currentLocation={munich} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start from auto configuration' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not create the configuration.');
    fireEvent.keyDown(screen.getByTestId('auto-config-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('auto-config-dialog')).toBeNull();
  });
});
