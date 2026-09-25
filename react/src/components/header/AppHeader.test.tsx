import { maplibreMock } from '../../test/maplibreMock';
vi.mock('maplibre-gl', () => maplibreMock);
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppHeader } from './AppHeader';
import type { Location, MeteogramConfig } from '../../types';

describe('AppHeader Component', () => {
  const dummyLocation: Location = {
    name: 'Offenbach am Main',
    latitude: 50.0956,
    longitude: 8.7761,
    elevation: 98,
  };

  const sampleConfigs: MeteogramConfig[] = [
    {
      id: 'cfg-1',
      name: 'Default Config',
      location: dummyLocation,
      model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
    },
    {
      id: 'cfg-2',
      name: 'Secondary Config',
      location: dummyLocation,
      model_chain: [{ name: 'GFS', max_forecast_horizon_hours: 384 }],
    },
  ];

  it('renders brand title and tabs', () => {
    const onTabChange = vi.fn();
    render(
      <AppHeader
        activeTab="meteogram"
        onTabChange={onTabChange}
        selectedConfig={sampleConfigs[0]}
        meteogramConfigs={sampleConfigs}
        onSelectConfig={vi.fn()}
        configSaveStatus={null}
        configSaveError={null}
        location={dummyLocation}
        onLocationChange={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Graupel');
    expect(screen.getByText('Graupel')).toBeTruthy();
    expect(screen.getByAltText('Graupel cloud')).toBeTruthy();
    const meteoTab = screen.getByRole('button', { name: 'Meteo' });
    const configTab = screen.getByRole('button', { name: 'Config' });

    expect(meteoTab.classList.contains('active')).toBe(true);
    expect(configTab.classList.contains('active')).toBe(false);

    fireEvent.click(configTab);
    expect(onTabChange).toHaveBeenCalledWith('config');
  });

  it('renders config dropdown in meteogram view and fires onSelectConfig', () => {
    const onSelectConfig = vi.fn();
    render(
      <AppHeader
        activeTab="meteogram"
        onTabChange={vi.fn()}
        selectedConfig={sampleConfigs[0]}
        meteogramConfigs={sampleConfigs}
        onSelectConfig={onSelectConfig}
        configSaveStatus={null}
        configSaveError={null}
        location={dummyLocation}
        onLocationChange={vi.fn()}
      />
    );

    const dropdown = screen.getByRole('combobox');
    expect(dropdown).toBeTruthy();
    fireEvent.change(dropdown, { target: { value: 'cfg-2' } });

    expect(onSelectConfig).toHaveBeenCalledWith(sampleConfigs[1]);
  });

  it('displays save error badge in config view when saveStatus is error', () => {
    render(
      <AppHeader
        activeTab="config"
        onTabChange={vi.fn()}
        selectedConfig={sampleConfigs[0]}
        meteogramConfigs={sampleConfigs}
        onSelectConfig={vi.fn()}
        configSaveStatus="error"
        configSaveError="Database locked"
        location={dummyLocation}
        onLocationChange={vi.fn()}
      />
    );

    const errorBadge = screen.getByTestId('config-save-error');
    expect(errorBadge).toBeTruthy();
    expect(errorBadge.textContent).toContain('Database locked');
  });

  it('does not display save error badge in meteogram view even if status is error', () => {
    render(
      <AppHeader
        activeTab="meteogram"
        onTabChange={vi.fn()}
        selectedConfig={sampleConfigs[0]}
        meteogramConfigs={sampleConfigs}
        onSelectConfig={vi.fn()}
        configSaveStatus="error"
        configSaveError="Database locked"
        location={dummyLocation}
        onLocationChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId('config-save-error')).toBeNull();
  });

  it('renders model-chain reset button in meteogram view and fires onResetModelChainBoundaries', () => {
    const onReset = vi.fn();
    render(
      <AppHeader
        activeTab="meteogram"
        onTabChange={vi.fn()}
        selectedConfig={sampleConfigs[0]}
        meteogramConfigs={sampleConfigs}
        onSelectConfig={vi.fn()}
        configSaveStatus={null}
        configSaveError={null}
        location={dummyLocation}
        onLocationChange={vi.fn()}
        onResetModelChainBoundaries={onReset}
      />
    );

    const resetBtn = screen.getByRole('button', {
      name: 'Reset model-chain boundaries to configuration defaults',
    });
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('disables model-chain reset button when no configuration is selected', () => {
    render(
      <AppHeader
        activeTab="meteogram"
        onTabChange={vi.fn()}
        selectedConfig={null}
        meteogramConfigs={[]}
        onSelectConfig={vi.fn()}
        configSaveStatus={null}
        configSaveError={null}
        location={dummyLocation}
        onLocationChange={vi.fn()}
        onResetModelChainBoundaries={vi.fn()}
      />
    );

    const resetBtn = screen.getByRole('button', {
      name: 'Reset model-chain boundaries to configuration defaults',
    });
    expect(resetBtn.hasAttribute('disabled')).toBe(true);
  });
});
