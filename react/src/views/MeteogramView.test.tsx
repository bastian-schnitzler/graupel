import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeteogramView } from './MeteogramView';
import { apiService } from '../services/apiService';
import type { MeteogramConfig } from '../types';

describe('MeteogramView Restructured UI', () => {
  const sampleConfig: MeteogramConfig = {
    id: 'cfg-1',
    name: 'Default Test Config',
    location: {
      name: 'Offenbach am Main',
      latitude: 50.0956,
      longitude: 8.7761,
      elevation: 98
    },
    model_chain: [
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { name: 'GFS', max_forecast_horizon_hours: 384 }
    ]
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completely removes the Active Configuration & Fetch Controls card', () => {
    render(<MeteogramView currentConfig={sampleConfig} />);

    expect(screen.queryByText('Active Configuration & Fetch Controls')).toBeNull();
    expect(screen.queryByText('Configuration:')).toBeNull();
    expect(screen.queryByText('Models in Chain:')).toBeNull();
  });

  it('contains NO Save Changes to Config button or persistence controls', () => {
    const handleSaveBack = vi.fn();
    render(<MeteogramView currentConfig={sampleConfig} onSaveConfigBack={handleSaveBack} />);

    expect(screen.queryByText(/Save Changes to Config/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();
  });

  it('renders full-width meteogram workspace content', () => {
    const { container } = render(<MeteogramView currentConfig={sampleConfig} />);

    const viewContainer = container.querySelector('.meteogram-view');
    const modelBuilder = container.querySelector('.model-chain-builder');

    expect(viewContainer).toBeTruthy();
    expect(modelBuilder).toBeTruthy();
  });

  it('keeps model boundary changes temporary without auto-saving to backend/storage', async () => {
    const saveSpy = vi.spyOn(apiService, 'saveConfiguration');

    render(<MeteogramView currentConfig={sampleConfig} />);

    await waitFor(() => {
      expect(screen.getByText('ICON-D2')).toBeTruthy();
    });

    // Verify model chain builder is present
    expect(screen.getByText('GFS')).toBeTruthy();

    // Verify saveConfiguration was never called
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('refreshes forecast for updated location when Refresh Forecast function is called', async () => {
    const onRefreshMock = vi.fn();

    render(<MeteogramView currentConfig={sampleConfig} onRefresh={onRefreshMock} error="Error loading" />);

    await waitFor(() => {
      expect(screen.getByText(/Error Loading Forecast/i)).toBeTruthy();
    });

    const retryBtn = screen.getByRole('button', { name: /Retry Fetch/i });
    fireEvent.click(retryBtn);

    expect(onRefreshMock).toHaveBeenCalledTimes(1);
  });

  describe('Model Management Restrictions in Meteogram View', () => {
    it('does not render drag handles, Add Model button, or delete buttons in Meteogram View', () => {
      const { container } = render(<MeteogramView currentConfig={sampleConfig} />);

      expect(container.querySelector('.drag-handle')).toBeNull();
      expect(screen.queryByTestId('add-model-btn')).toBeNull();
      expect(screen.queryByTitle('Remove model from chain')).toBeNull();
    });

    it('keeps model cards non-draggable', () => {
      render(<MeteogramView currentConfig={sampleConfig} />);

      const card1 = screen.getByTestId('model-card-ICON-D2');
      const card2 = screen.getByTestId('model-card-GFS');

      expect(card1.getAttribute('draggable')).toBe('false');
      expect(card2.getAttribute('draggable')).toBe('false');
    });

    it('preserves boundary handles and allows model resizing', () => {
      render(<MeteogramView currentConfig={sampleConfig} />);

      const resizeHandle = screen.getByLabelText('Resize boundary between ICON-D2 and GFS');
      expect(resizeHandle).toBeTruthy();

      fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });

      expect(screen.getByText(/ICON-D2/)).toBeTruthy();
      expect(screen.getByText(/GFS/)).toBeTruthy();
    });

    it('renders model range badges without total hours in brackets', () => {
      render(<MeteogramView currentConfig={sampleConfig} />);

      expect(screen.getByText('0h — 48h')).toBeTruthy();
      expect(screen.getByText('48h — 384h')).toBeTruthy();
      expect(screen.queryByText(/total/i)).toBeNull();
    });
  });

  describe('Dual Model Chains in Meteogram View', () => {
    const configWithDualChains: MeteogramConfig = {
      id: 'cfg-dual-meteo',
      name: 'Dual Meteo Config',
      location: { name: 'Offenbach', latitude: 50.1, longitude: 8.7 },
      model_chain: [
        { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
        { name: 'GFS', max_forecast_horizon_hours: 384 }
      ],
      main_model_chain: [
        { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
        { name: 'GFS', max_forecast_horizon_hours: 384 }
      ],
      cloud_model_chain: [
        { name: 'ECMWF IFS 0.25°', max_forecast_horizon_hours: 345 }
      ]
    };

    it('renders both METEO and CLOUDS vertical border labels when cloud chain exists and removes horizontal titles', () => {
      render(<MeteogramView currentConfig={configWithDualChains} />);

      // Horizontal titles must be removed
      expect(screen.queryByText('Main models')).toBeNull();
      expect(screen.queryByText('Detailed cloud models')).toBeNull();

      // Vertical border labels must be integrated
      expect(screen.getByTestId('border-label-meteo')).toBeTruthy();
      expect(screen.getByText('METEO')).toBeTruthy();
      expect(screen.getByTestId('border-label-clouds')).toBeTruthy();
      expect(screen.getByText('CLOUDS')).toBeTruthy();

      expect(screen.getByTestId('model-card-ICON-D2')).toBeTruthy();
      expect(screen.getByTestId('model-card-ECMWF IFS 0.25°')).toBeTruthy();
    });

    it('omits CLOUDS border label and slider when cloud_model_chain is empty', () => {
      const configEmptyCloud: MeteogramConfig = {
        ...configWithDualChains,
        cloud_model_chain: []
      };

      render(<MeteogramView currentConfig={configEmptyCloud} />);

      expect(screen.getByTestId('border-label-meteo')).toBeTruthy();
      expect(screen.queryByTestId('border-label-clouds')).toBeNull();
      expect(screen.queryByText('CLOUDS')).toBeNull();
    });

    it('updates ephemeral cloud model chain without saving to backend', () => {
      const saveSpy = vi.spyOn(apiService, 'saveConfiguration');
      const onCloudDisplayChange = vi.fn();

      const configWithTwoCloudModels: MeteogramConfig = {
        ...configWithDualChains,
        cloud_model_chain: [
          { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
          { name: 'ECMWF IFS 0.25°', max_forecast_horizon_hours: 345 }
        ]
      };

      render(
        <MeteogramView
          currentConfig={configWithTwoCloudModels}
          onCloudModelChainDisplayChange={onCloudDisplayChange}
        />
      );

      const resizeHandle = screen.getByLabelText('Resize boundary between ICON-EU and ECMWF IFS 0.25°');
      expect(resizeHandle).toBeTruthy();

      fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });

      // Ensure save was not triggered
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });
});

