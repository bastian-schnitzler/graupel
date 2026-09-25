import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfigEditor } from './ConfigEditor';
import type { MeteogramConfig } from '../../types';

describe('ConfigEditor Component', () => {
  const sampleConfig: MeteogramConfig = {
    id: 'cfg-test',
    name: 'Short Range Test',
    location: { name: 'Berlin', latitude: 52.52, longitude: 13.405, elevation: 34 },
    model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
    cloud_model_chain: [{ name: 'ECMWF IFS 0.25°', max_forecast_horizon_hours: 120 }],
  };

  it('renders config name input and model chain sections', () => {
    const onNameChange = vi.fn();
    const onNameBlur = vi.fn();

    render(
      <ConfigEditor
        activeConfig={sampleConfig}
        availableModels={{}}
        cloudAvailableModels={{}}
        onNameChange={onNameChange}
        onNameBlur={onNameBlur}
        onMainModelChainChange={vi.fn()}
        onCloudModelChainChange={vi.fn()}
        onModelChainInstantCommit={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('e.g. European Short Range') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('Short Range Test');

    fireEvent.change(input, { target: { value: 'Updated Name' } });
    expect(onNameChange).toHaveBeenCalledWith('Updated Name');

    fireEvent.blur(input);
    expect(onNameBlur).toHaveBeenCalled();

    expect(screen.getByText('Main models')).toBeTruthy();
    expect(screen.getByText('Detailed cloud models')).toBeTruthy();
  });

  it('renders empty state when activeConfig is null', () => {
    render(
      <ConfigEditor
        activeConfig={null}
        availableModels={{}}
        cloudAvailableModels={{}}
        onNameChange={vi.fn()}
        onNameBlur={vi.fn()}
        onMainModelChainChange={vi.fn()}
        onCloudModelChainChange={vi.fn()}
        onModelChainInstantCommit={vi.fn()}
      />
    );

    expect(screen.getByText('Select a configuration to edit or create a new one.')).toBeTruthy();
  });
});

