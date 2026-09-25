import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigView } from './ConfigView';
import { apiService, getNextConfigurationName, getDuplicateConfigurationName } from '../services/apiService';
import type { MeteogramConfig } from '../types';

describe('getNextConfigurationName Unit Tests', () => {
  it('generates New Configuration 1 when no configurations exist', () => {
    expect(getNextConfigurationName([])).toBe('New Configuration 1');
  });

  it('generates New Configuration 2 when New Configuration 1 exists ([1] -> 2)', () => {
    expect(getNextConfigurationName(['New Configuration 1'])).toBe('New Configuration 2');
  });

  it('generates New Configuration 1 when only New Configuration 2 exists ([2] -> 1)', () => {
    expect(getNextConfigurationName(['New Configuration 2'])).toBe('New Configuration 1');
  });

  it('fills lowest available gap ([1, 2, 4] -> 3)', () => {
    const existing = ['New Configuration 1', 'New Configuration 2', 'New Configuration 4'];
    expect(getNextConfigurationName(existing)).toBe('New Configuration 3');
  });

  it('increments to 5 when [1, 2, 3, 4] exist', () => {
    const existing = [
      'New Configuration 1',
      'New Configuration 2',
      'New Configuration 3',
      'New Configuration 4'
    ];
    expect(getNextConfigurationName(existing)).toBe('New Configuration 5');
  });

  it('ignores custom configuration names that do not match ^New Configuration (\\d+)$', () => {
    const existing = [
      'My New Configuration 2',
      'New Configuration Test',
      'New Configuration 2 copy',
      'New Configuration 2'
    ];
    // "New Configuration 2" consumes 2, so lowest unused is 1
    expect(getNextConfigurationName(existing)).toBe('New Configuration 1');
  });
});

describe('getDuplicateConfigurationName Unit Tests', () => {
  it('duplicates Name into Name 2', () => {
    expect(getDuplicateConfigurationName('European Medium Range', [])).toBe('European Medium Range 2');
  });

  it('duplicates Name 2 into Name 3', () => {
    expect(getDuplicateConfigurationName('European Medium Range 2', ['European Medium Range 2'])).toBe('European Medium Range 3');
  });

  it('duplicates Name 17 into Name 18', () => {
    expect(getDuplicateConfigurationName('Model Run 17', ['Model Run 17'])).toBe('Model Run 18');
  });

  it('skips existing collision (e.g. Name exists, Name 2 exists -> returns Name 3)', () => {
    const existing = ['Berlin Setup', 'Berlin Setup 2'];
    expect(getDuplicateConfigurationName('Berlin Setup', existing)).toBe('Berlin Setup 3');
  });

  it('never produces Copy of, (1), or Name 2 2', () => {
    const result = getDuplicateConfigurationName('Local Radar', []);
    expect(result).not.toContain('Copy');
    expect(result).not.toContain('(');
    expect(result).toBe('Local Radar 2');

    const result2 = getDuplicateConfigurationName('Local Radar 2', []);
    expect(result2).toBe('Local Radar 3');
    expect(result2).not.toBe('Local Radar 2 2');
  });
});

describe('ConfigView Autosave & Persistence Unit Tests', () => {
  const mockConfig: MeteogramConfig = {
    id: 'cfg-1',
    name: 'Initial Config',
    location: {
      name: 'Berlin',
      latitude: 52.52,
      longitude: 13.405,
      country: 'Germany'
    },
    model_chain: [
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { name: 'GFS', max_forecast_horizon_hours: 384 }
    ]
  };

  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();

    vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([mockConfig]);
    vi.spyOn(apiService, 'getModels').mockResolvedValue([
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
      { name: 'GFS', max_forecast_horizon_hours: 384 }
    ] as any);
  });

  it('renders without Save Configuration button, removes Edit Configuration heading, and notifies onSaveStatusChange', async () => {
    const statusSpy = vi.fn();
    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} onSaveStatusChange={statusSpy} />);

    await waitFor(() => {
      expect(screen.getByText('Configuration Name')).toBeTruthy();
    });

    expect(screen.queryByText('Edit Configuration')).toBeNull();
    await waitFor(() => {
      expect(statusSpy).toHaveBeenCalledWith('saved', null);
    });
  });

  it('creates new config with persistent ID immediately on New Config click', async () => {
    const createdConfig: MeteogramConfig = {
      id: 'cfg-new-123',
      name: 'New Configuration 1',
      location: { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
      model_chain: [
        { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
        { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
        { name: 'GFS', max_forecast_horizon_hours: 384 }
      ]
    };

    const createSpy = vi.spyOn(apiService, 'createConfiguration').mockResolvedValue(createdConfig);
    const selectSpy = vi.fn();

    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={selectSpy} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create new configuration/i })).toBeTruthy();
    });

    const newBtn = screen.getByRole('button', { name: /Create new configuration/i });
    await act(async () => {
      fireEvent.click(newBtn);
    });

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Configuration 1'
        }),
        expect.anything()
      );
      expect(screen.getByText('New Configuration 1')).toBeTruthy();
      expect(selectSpy).toHaveBeenCalledWith(createdConfig);
    });
  });

  it('removes Saved Configurations heading, renders button with only +, and removes six-dot drag handles', async () => {
    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Configuration Name')).toBeTruthy();
    });

    // 3.1 Heading "Saved Configurations" is removed
    expect(screen.queryByText('Saved Configurations')).toBeNull();

    // 3.2 Create button has accessible label and visible text +
    const newBtn = screen.getByRole('button', { name: /Create new configuration/i });
    expect(newBtn).toBeTruthy();
    expect(newBtn.textContent?.trim()).toBe('+');

    // 4. Six-dot drag handles are removed and cards are not draggable
    expect(document.querySelector('.drag-handle')).toBeNull();
    const modelCard = screen.getByTestId('model-card-ICON-D2');
    expect(modelCard.getAttribute('draggable')).toBe('false');
  });

  it('debounces rapid typing when renaming configuration', async () => {
    const saveSpy = vi.spyOn(apiService, 'saveConfiguration').mockResolvedValue({
      ...mockConfig,
      name: 'Alpine High Res'
    });

    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. European Short Range')).toBeTruthy();
    });

    const nameInput = screen.getByPlaceholderText('e.g. European Short Range');

    // Rapid typing
    fireEvent.change(nameInput, { target: { value: 'A' } });
    fireEvent.change(nameInput, { target: { value: 'Al' } });
    fireEvent.change(nameInput, { target: { value: 'Alpine High Res' } });

    // Instantly after typing, save should not have been called 3 times
    expect(saveSpy).not.toHaveBeenCalled();

    // After debounce delay, save should be called once with final value
    await waitFor(
      () => {
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'cfg-1',
            name: 'Alpine High Res'
          })
        );
      },
      { timeout: 1000 }
    );
  });

  it('does not save configuration while moving model boundary slider until mouse is released', async () => {
    const saveSpy = vi.spyOn(apiService, 'saveConfiguration').mockResolvedValue(mockConfig);

    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Configuration Name')).toBeTruthy();
    });

    const resizeHandle = screen.getByRole('separator');
    expect(resizeHandle).toBeTruthy();

    // Start moving the boundary slider (pointer down and move)
    fireEvent.pointerDown(resizeHandle, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(resizeHandle, { pointerId: 1, clientX: 340 });

    // Wait longer than former 400ms debounce
    await new Promise((r) => setTimeout(r, 500));

    // While dragging and mouse is not released, autosave must NOT be called
    expect(saveSpy).not.toHaveBeenCalled();

    // Now release the mouse (pointer up)
    fireEvent.pointerUp(resizeHandle, { pointerId: 1, clientX: 340 });

    // Releasing mouse triggers immediate autosave
    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('does not render duplicate location, latitude, or longitude inputs inside Edit Configuration card', async () => {
    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Configuration Name')).toBeTruthy();
    });

    expect(screen.queryByPlaceholderText('Latitude')).toBeNull();
    expect(screen.queryByPlaceholderText('Longitude')).toBeNull();
    expect(screen.queryByPlaceholderText('Location Name')).toBeNull();
    expect(screen.queryByText('Default Location')).toBeNull();
  });

  it('handles save errors gracefully with unobtrusive feedback', async () => {
    vi.spyOn(apiService, 'saveConfiguration').mockRejectedValue(new Error('Network error'));
    const statusSpy = vi.fn();

    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={vi.fn()} onSaveStatusChange={statusSpy} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. European Short Range')).toBeTruthy();
    });

    const nameInput = screen.getByPlaceholderText('e.g. European Short Range');
    fireEvent.change(nameInput, { target: { value: 'Error Test Name' } });

    await waitFor(
      () => {
        expect(statusSpy).toHaveBeenCalledWith('error', 'Could not save configuration. Retrying...');
      },
      { timeout: 1500 }
    );

    // Current edited state in UI should be preserved
    expect((nameInput as HTMLInputElement).value).toBe('Error Test Name');
  });

  it('persists model chain deletion immediately and model remains absent after config refetch/reload', async () => {
    const configWithThreeModels: MeteogramConfig = {
      id: 'cfg-3models',
      name: 'Three Model Chain Config',
      location: { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
      model_chain: [
        { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
        { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
        { name: 'GFS', max_forecast_horizon_hours: 384 }
      ]
    };

    let persistedConfig = { ...configWithThreeModels };

    vi.spyOn(apiService, 'getConfigurations').mockImplementation(async () => [persistedConfig]);
    const saveSpy = vi.spyOn(apiService, 'saveConfiguration').mockImplementation(async (cfg) => {
      persistedConfig = { ...cfg };
      return persistedConfig;
    });

    const { rerender } = render(<ConfigView selectedConfigId="cfg-3models" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('ICON-D2')).toBeTruthy();
      expect(screen.getByText('ICON-EU')).toBeTruthy();
      expect(screen.getByText('GFS')).toBeTruthy();
    });

    // Delete the middle model (ICON-EU)
    const deleteIcon = screen.getByLabelText('Remove ICON-EU from model chain');
    await act(async () => {
      fireEvent.click(deleteIcon);
    });

    // Verify only 2 remain immediately in UI
    await waitFor(() => {
      expect(screen.queryByText('ICON-EU')).toBeNull();
      expect(screen.getByText('ICON-D2')).toBeTruthy();
      expect(screen.getByText('GFS')).toBeTruthy();
    });

    // Verify backend save was called with only 2 models
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cfg-3models',
        model_chain: [
          { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
          { name: 'GFS', max_forecast_horizon_hours: 384 }
        ]
      })
    );

    // Verify persisted state in mock backend contains exactly 2 models
    expect(persistedConfig.model_chain).toHaveLength(2);
    expect(persistedConfig.model_chain.map((m) => m.name)).toEqual(['ICON-D2', 'GFS']);

    // Simulate page/config reload or re-fetch from backend
    rerender(<ConfigView selectedConfigId="cfg-3models" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText('ICON-EU')).toBeNull();
      expect(screen.getByText('ICON-D2')).toBeTruthy();
      expect(screen.getByText('GFS')).toBeTruthy();
    });
  });

  it('deletes configuration cleanly and selects remaining config', async () => {
    const deleteSpy = vi.spyOn(apiService, 'deleteConfiguration').mockResolvedValue(true);
    const config2: MeteogramConfig = {
      id: 'cfg-2',
      name: 'Second Config',
      location: { name: 'Munich', latitude: 48.13, longitude: 11.58 },
      model_chain: [{ name: 'GFS', max_forecast_horizon_hours: 384 }]
    };

    vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([mockConfig, config2]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const selectSpy = vi.fn();

    render(<ConfigView selectedConfigId="cfg-1" onSelectConfig={selectSpy} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete selected configuration/i })).toBeTruthy();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete selected configuration/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('cfg-1');
      expect(screen.getByText('Second Config')).toBeTruthy();
    });
  });
});

describe('Configuration List Toolbar, Duplication & Drag-and-Drop Reordering', () => {
  const configA: MeteogramConfig = {
    id: 'cfg-a',
    name: 'Config Alpha',
    location: { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
    model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }]
  };
  const configB: MeteogramConfig = {
    id: 'cfg-b',
    name: 'Config Beta',
    location: { name: 'Hamburg', latitude: 53.55, longitude: 9.99 },
    model_chain: [{ name: 'GFS', max_forecast_horizon_hours: 384 }]
  };
  const configC: MeteogramConfig = {
    id: 'cfg-c',
    name: 'Config Gamma',
    location: { name: 'Munich', latitude: 48.13, longitude: 11.58 },
    model_chain: [{ name: 'ICON-EU', max_forecast_horizon_hours: 120 }]
  };

  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();

    vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([configA, configB, configC]);
    vi.spyOn(apiService, 'getModels').mockResolvedValue([]);
  });

  it('renders toolbar layout: Delete icon button on far left, Duplicate and + on far right', async () => {
    render(<ConfigView selectedConfigId="cfg-a" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Config Alpha')).toBeTruthy();
    });

    const sidebarHeader = document.querySelector('.sidebar-header');
    expect(sidebarHeader).toBeTruthy();

    const deleteBtn = screen.getByRole('button', { name: /Delete selected configuration/i });
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.classList.contains('config-delete-btn')).toBe(true);

    const actionsContainer = sidebarHeader?.querySelector('.sidebar-header-actions');
    expect(actionsContainer).toBeTruthy();

    const dupBtn = screen.getByRole('button', { name: /Duplicate selected configuration/i });
    const addBtn = screen.getByRole('button', { name: /Create new configuration/i });

    expect(dupBtn).toBeTruthy();
    expect(addBtn).toBeTruthy();

    // Verify Duplicate button is immediately left of + in actions container
    const actionButtons = actionsContainer?.querySelectorAll('button');
    expect(actionButtons?.[0]).toBe(dupBtn);
    expect(actionButtons?.[1]).toBe(addBtn);

    // Duplicate button must contain no text ("Duplicate"), only the icon
    expect(dupBtn.textContent?.trim()).toBe('');
    expect(dupBtn.classList.contains('btn-icon-only')).toBe(true);

    // Delete button must NOT exist in the editor header (which itself is removed)
    const editorHeader = document.querySelector('.editor-header');
    expect(editorHeader).toBeNull();
  });

  it('disables delete button when only 1 configuration exists', async () => {
    vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([configA]);

    render(<ConfigView selectedConfigId="cfg-a" onSelectConfig={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Config Alpha')).toBeTruthy();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete selected configuration/i }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });

  it('duplicates selected configuration, inserts directly after source, and selects it', async () => {
    const duplicatedConfig: MeteogramConfig = {
      id: 'cfg-dup-1',
      name: 'Config Alpha 2',
      location: { ...configA.location },
      model_chain: [...configA.model_chain]
    };

    const createSpy = vi.spyOn(apiService, 'createConfiguration').mockResolvedValue(duplicatedConfig);
    const selectSpy = vi.fn();
    const updatedSpy = vi.fn();

    render(
      <ConfigView
        selectedConfigId="cfg-a"
        onSelectConfig={selectSpy}
        onConfigsUpdated={updatedSpy}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Config Alpha')).toBeTruthy();
    });

    const dupBtn = screen.getByRole('button', { name: /Duplicate selected configuration/i });
    await act(async () => {
      fireEvent.click(dupBtn);
    });

    await waitFor(() => {
      // Called with deep copy and inserted after source index (index 0 -> insert index 1)
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Config Alpha 2',
          location: expect.objectContaining({ name: 'Berlin' })
        }),
        1
      );
      expect(selectSpy).toHaveBeenCalledWith(duplicatedConfig);
      expect(screen.getByText('Config Alpha 2')).toBeTruthy();
      expect(updatedSpy).toHaveBeenCalled();
    });
  });

  it('deletes middle configuration and selects neighbor at same index', async () => {
    const deleteSpy = vi.spyOn(apiService, 'deleteConfiguration').mockResolvedValue(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const selectSpy = vi.fn();

    // Start with configB (index 1) selected
    render(
      <ConfigView
        selectedConfigId="cfg-b"
        onSelectConfig={selectSpy}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Config Beta')).toBeTruthy();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete selected configuration/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('cfg-b');
      // Index 1 was deleted, so item originally at index 2 (Config Gamma) is now at index 1 and selected
      expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'cfg-c', name: 'Config Gamma' }));
    });
  });

  it('renders dedicated drag handle on each card and persists reordering on drop', async () => {
    const reorderSpy = vi.spyOn(apiService, 'reorderConfigurations').mockResolvedValue([configB, configA, configC]);
    const updatedSpy = vi.fn();

    render(
      <ConfigView
        selectedConfigId="cfg-a"
        onSelectConfig={vi.fn()}
        onConfigsUpdated={updatedSpy}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Config Alpha')).toBeTruthy();
    });

    const dragHandles = document.querySelectorAll('.config-drag-handle');
    expect(dragHandles.length).toBe(3);

    const cards = document.querySelectorAll('.config-item-card');
    expect(cards.length).toBe(3);

    // Drag from handle of card 0 to card 1
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue('0'),
      effectAllowed: 'none',
      dropEffect: 'none'
    };

    fireEvent.dragStart(dragHandles[0], { dataTransfer });
    fireEvent.dragOver(cards[1], { dataTransfer });
    fireEvent.drop(cards[1], { dataTransfer });

    await waitFor(() => {
      expect(reorderSpy).toHaveBeenCalledWith(['cfg-b', 'cfg-a', 'cfg-c']);
      expect(updatedSpy).toHaveBeenCalled();
    });
  });

  it('preserves total hours in brackets on model cards in configuration view', async () => {
    const configWithModels: MeteogramConfig = {
      id: 'cfg-test',
      name: 'Config with Models',
      position: 0,
      location: { name: 'Berlin', latitude: 52.52, longitude: 13.405, elevation: 34 },
      model_chain: [
        { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
        { name: 'GFS', max_forecast_horizon_hours: 120 }
      ]
    };

    vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([configWithModels]);

    render(<ConfigView selectedConfigId="cfg-test" onSelectConfig={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('0h — 48h (48h total)')).toBeTruthy();
      expect(screen.getByText('48h — 120h (72h total)')).toBeTruthy();
    });
  });

  describe('Dual Model Chains in ConfigView', () => {
    it('renders both Main models and Detailed cloud models sections independently', async () => {
      const dualConfig: MeteogramConfig = {
        id: 'cfg-dual',
        name: 'Dual Chain Config',
        position: 0,
        location: { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
        model_chain: [
          { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
          { name: 'GFS', max_forecast_horizon_hours: 120 }
        ],
        main_model_chain: [
          { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
          { name: 'GFS', max_forecast_horizon_hours: 120 }
        ],
        cloud_model_chain: [
          { name: 'ECMWF IFS 0.25°', max_forecast_horizon_hours: 345 }
        ]
      };

      vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([dualConfig]);

      render(<ConfigView selectedConfigId="cfg-dual" onSelectConfig={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Main models')).toBeTruthy();
        expect(screen.getByText('Detailed cloud models')).toBeTruthy();
      });

      // Main chain model card
      expect(screen.getByTestId('model-card-ICON-D2')).toBeTruthy();
      // Cloud chain model card
      expect(screen.getByTestId('model-card-ECMWF IFS 0.25°')).toBeTruthy();
    });

    it('filters cloud model dropdown to only models with vertical clouds and at least 10 pressure levels', async () => {
      const dualConfig: MeteogramConfig = {
        id: 'cfg-cloud-filter',
        name: 'Filter Test',
        position: 0,
        location: { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
        model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
        main_model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
        cloud_model_chain: []
      };

      vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([dualConfig]);
      vi.spyOn(apiService, 'getModels').mockResolvedValue([
        {
          id: 'ecmwf_ifs025',
          name: 'ECMWF IFS 0.25°',
          max_forecast_horizon_hours: 345,
          supports_vertical_cloud_profile: true,
          pressure_levels_hpa: [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100, 70, 50] // 13 levels >= 10
        },
        {
          id: 'icon_2i',
          name: 'ItaliaMeteo ICON-2I',
          max_forecast_horizon_hours: 48,
          supports_vertical_cloud_profile: true,
          pressure_levels_hpa: [1000, 925, 850, 700, 500, 250] // 6 levels < 10
        },
        {
          id: 'icon_ch1',
          name: 'ICON-CH1',
          max_forecast_horizon_hours: 33,
          supports_vertical_cloud_profile: false,
          pressure_levels_hpa: [] // 0 levels
        },
        {
          id: 'gfs_seamless',
          name: 'GFS',
          max_forecast_horizon_hours: 384,
          supports_vertical_cloud_profile: true,
          pressure_levels_hpa: [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 70, 50, 30, 20, 10] // 26 levels >= 10
        }
      ] as any);

      render(<ConfigView selectedConfigId="cfg-cloud-filter" onSelectConfig={() => {}} />);

      await waitFor(() => {
        expect(screen.getByTestId('cloud-add-model-btn')).toBeTruthy();
      });

      // Open the cloud add model dropdown
      fireEvent.click(screen.getByTestId('cloud-add-model-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('cloud-model-dropdown-list')).toBeTruthy();
      });

      // ECMWF IFS and GFS must be present in the cloud dropdown
      expect(screen.getByTestId('cloud-add-model-item-ECMWF IFS 0.25°')).toBeTruthy();
      expect(screen.getByTestId('cloud-add-model-item-GFS')).toBeTruthy();

      // ItaliaMeteo ICON-2I (< 10 levels) and ICON-CH1 (no vertical clouds) must be excluded
      expect(screen.queryByTestId('cloud-add-model-item-ItaliaMeteo ICON-2I')).toBeNull();
      expect(screen.queryByTestId('cloud-add-model-item-ICON-CH1')).toBeNull();
    });

    it('persists changes to cloud_model_chain independently of main_model_chain', async () => {
      const initialConfig: MeteogramConfig = {
        id: 'cfg-save-cloud',
        name: 'Save Cloud Test',
        position: 0,
        location: { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
        model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
        main_model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
        cloud_model_chain: [{ name: 'ECMWF IFS 0.25°', max_forecast_horizon_hours: 345 }]
      };

      vi.spyOn(apiService, 'getConfigurations').mockResolvedValue([initialConfig]);
      const saveSpy = vi.spyOn(apiService, 'saveConfiguration').mockResolvedValue(initialConfig);

      render(<ConfigView selectedConfigId="cfg-save-cloud" onSelectConfig={() => {}} />);

      await waitFor(() => {
        expect(screen.getByTestId('model-card-ECMWF IFS 0.25°')).toBeTruthy();
      });

      // Delete the cloud model
      const removeBtn = screen.getByLabelText('Remove ECMWF IFS 0.25° from model chain');
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'cfg-save-cloud',
            main_model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
            cloud_model_chain: []
          })
        );
      });
    });

    it('does not show missing variables warning for models in cloud_model_chain', async () => {
      vi.mocked(apiService.getConfigurations).mockResolvedValueOnce([
        {
          id: 'cfg-cloud-missing-vars',
          name: 'Cloud Missing Vars Test',
          location: { name: 'Paris', latitude: 48.85, longitude: 2.35 },
          model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
          main_model_chain: [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }],
          cloud_model_chain: [{ name: 'AROME France', max_forecast_horizon_hours: 46 }]
        }
      ] as any);

      vi.mocked(apiService.getModels).mockResolvedValueOnce([
        {
          id: 'icon_d2',
          name: 'ICON-D2',
          max_forecast_horizon_hours: 48,
          missing_variables: []
        },
        {
          id: 'arome_france',
          name: 'AROME France',
          max_forecast_horizon_hours: 46,
          supports_vertical_cloud_profile: true,
          pressure_levels_hpa: [1000, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 70, 50],
          missing_variables: ['precipitation_probability']
        }
      ] as any);

      render(<ConfigView selectedConfigId="cfg-cloud-missing-vars" onSelectConfig={() => {}} />);

      await waitFor(() => {
        expect(screen.getByTestId('model-card-AROME France')).toBeTruthy();
      });

      expect(screen.queryByText((content) => content.includes('Missing: precipitation_probability'))).toBeNull();
    });
  });
});
