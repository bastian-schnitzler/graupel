import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfigSidebar } from './ConfigSidebar';
import type { MeteogramConfig } from '../../types';

describe('ConfigSidebar Component', () => {
  const sampleConfigs: MeteogramConfig[] = [
    {
      id: 'cfg-1',
      name: 'Alpha Config',
      location: { name: 'Berlin', latitude: 52.52, longitude: 13.405, elevation: 34 },
      model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
    },
    {
      id: 'cfg-2',
      name: 'Beta Config',
      location: { name: 'Munich', latitude: 48.135, longitude: 11.582, elevation: 520 },
      model_chain: [{ name: 'GFS', max_forecast_horizon_hours: 384 }],
    },
  ];

  it('renders list of configurations and highlights active configuration', () => {
    const onSelect = vi.fn();
    render(
      <ConfigSidebar
        configs={sampleConfigs}
        activeConfigId="cfg-1"
        onSelectConfig={onSelect}
        onCreateConfig={vi.fn()}
        onDuplicateConfig={vi.fn()}
        onDeleteConfig={vi.fn()}
        onReorderConfigs={vi.fn()}
      />
    );

    expect(screen.getByText('Alpha Config')).toBeTruthy();
    expect(screen.getByText('Beta Config')).toBeTruthy();

    const items = screen.getAllByText(/Config/).map((el) => el.closest('.config-item-card'));
    expect(items[0]?.classList.contains('active')).toBe(true);
    expect(items[1]?.classList.contains('active')).toBe(false);

    const configList = document.querySelector('.config-list');
    expect(configList?.getAttribute('data-has-multiple')).toBe('true');

    fireEvent.click(screen.getByText('Beta Config'));
    expect(onSelect).toHaveBeenCalledWith(sampleConfigs[1]);
  });

  it('disables delete button and sets data-has-multiple to false when only 1 configuration exists', () => {
    render(
      <ConfigSidebar
        configs={[sampleConfigs[0]]}
        activeConfigId="cfg-1"
        onSelectConfig={vi.fn()}
        onCreateConfig={vi.fn()}
        onDuplicateConfig={vi.fn()}
        onDeleteConfig={vi.fn()}
        onReorderConfigs={vi.fn()}
      />
    );

    const configList = document.querySelector('.config-list');
    expect(configList?.getAttribute('data-has-multiple')).toBe('false');

    const deleteBtn = screen.getByRole('button', { name: /Delete selected configuration/i });
    expect(deleteBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables action buttons when multiple configurations exist and activeConfig is selected', () => {
    const onDelete = vi.fn();
    const onDuplicate = vi.fn();
    const onCreate = vi.fn();

    render(
      <ConfigSidebar
        configs={sampleConfigs}
        activeConfigId="cfg-1"
        onSelectConfig={vi.fn()}
        onCreateConfig={onCreate}
        onDuplicateConfig={onDuplicate}
        onDeleteConfig={onDelete}
        onReorderConfigs={vi.fn()}
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete selected configuration/i });
    const duplicateBtn = screen.getByRole('button', { name: /Duplicate selected configuration/i });
    const addBtn = screen.getByRole('button', { name: /Create new configuration/i });

    expect(deleteBtn.hasAttribute('disabled')).toBe(false);
    expect(duplicateBtn.hasAttribute('disabled')).toBe(false);
    expect(addBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalled();

    fireEvent.click(duplicateBtn);
    expect(onDuplicate).toHaveBeenCalled();

    fireEvent.click(addBtn);
    expect(onCreate).toHaveBeenCalled();
  });
});

