import React, { useState } from 'react';
import type {
  Location,
  MeteogramConfig,
  ModelMetadata,
  StoredLayout,
  WeatherModel,
} from '../../types';
import { ModelChainBuilder } from '../../components/ModelChainBuilder';
import { LocationSelector } from '../../components/LocationSelector';
import { getLocationDisplayName } from '../../utils/configLocation';
import { Edit3, LayoutDashboard, MapPin, Pencil } from 'lucide-react';

export interface ConfigEditorProps {
  activeConfig: MeteogramConfig | null;
  availableModels: Record<string, ModelMetadata>;
  cloudAvailableModels: Record<string, ModelMetadata>;
  onNameChange: (newName: string) => void;
  onNameBlur: () => void;
  onMainModelChainChange: (newChain: WeatherModel[], instant?: boolean) => void;
  onCloudModelChainChange: (newChain: WeatherModel[], instant?: boolean) => void;
  onModelChainInstantCommit: () => void;
  /** Auto chain region of the configuration's location (info only, §6.5). */
  autoRegionLabel?: string;
  /** Meteogram configurations (layout library) to choose from (#199). */
  layouts?: StoredLayout[];
  /** New `layout_id` (null = the Default entry, #203). */
  onLayoutChange?: (layoutId: string | null) => void;
  /** New place for the configuration; clears the display name (#175). */
  onLocationChange?: (location: Location) => void;
  /** New display name of the location; empty = place name. */
  onLocationNameOverrideChange?: (name: string) => void;
  onLocationNameOverrideBlur?: () => void;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({
  activeConfig,
  availableModels,
  cloudAvailableModels,
  onNameChange,
  onNameBlur,
  onMainModelChainChange,
  onCloudModelChainChange,
  onModelChainInstantCommit,
  autoRegionLabel,
  layouts = [],
  onLayoutChange,
  onLocationChange,
  onLocationNameOverrideChange,
  onLocationNameOverrideBlur,
}) => {
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  return (
    <div className="config-editor-main">
      {activeConfig ? (
        <div className="editor-card card">
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="form-group">
              <label className="form-label">
                <Edit3 size={14} /> Configuration Name
              </label>
              <input
                type="text"
                value={activeConfig.name}
                onChange={(e) => onNameChange(e.target.value)}
                onBlur={onNameBlur}
                className="text-input"
                placeholder="e.g. European Short Range"
              />
            </div>
            {onLocationChange && (
              <div className="form-group" data-testid="config-location-group">
                <label className="form-label">
                  <MapPin size={14} /> Location
                </label>
                <div className="config-location-row">
                  <LocationSelector
                    location={activeConfig.location}
                    displayName={getLocationDisplayName(activeConfig)}
                    onChange={onLocationChange}
                    currentView="config"
                    showMap={false}
                    placeholder="Search configuration location..."
                    ariaLabel="Configuration location"
                  />
                  {onLocationNameOverrideChange && (
                    <button
                      type="button"
                      className={`btn btn-secondary config-location-name-btn${editingDisplayName ? ' active' : ''}`}
                      onClick={() => setEditingDisplayName((open) => !open)}
                      aria-pressed={editingDisplayName}
                      aria-label="Edit location display name"
                      title="Display name for this location, e.g. INSB for Innsbruck"
                      data-testid="config-location-name-btn"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
                {editingDisplayName && onLocationNameOverrideChange && (
                  <input
                    type="text"
                    className="text-input config-location-name-input"
                    value={activeConfig.location_name_override ?? ''}
                    onChange={(e) => onLocationNameOverrideChange(e.target.value)}
                    onBlur={onLocationNameOverrideBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault();
                        setEditingDisplayName(false);
                        onLocationNameOverrideBlur?.();
                      }
                    }}
                    placeholder={activeConfig.location.name}
                    aria-label="Location display name"
                    data-testid="config-location-name-input"
                    autoFocus
                  />
                )}
                {autoRegionLabel && (
                  <p className="settings-note config-auto-region" data-testid="config-auto-region">
                    Auto region at {activeConfig.location.name}: {autoRegionLabel}
                  </p>
                )}
              </div>
            )}
            {onLayoutChange && (
              <div className="form-group">
                <label className="form-label" htmlFor="config-layout-select">
                  <LayoutDashboard size={14} /> Meteogram layout
                </label>
                <select
                  id="config-layout-select"
                  className="select-input"
                  value={activeConfig.layout_id ?? ""}
                  onChange={(e) => onLayoutChange(e.target.value || null)}
                  data-testid="config-layout-select"
                >
                  {/* The fixed entry is the default: chosen by null. */}
                  <option value="">
                    {layouts.find((layout) => layout.fixed)?.name ?? "Default"}
                  </option>
                  {layouts
                    .filter((layout) => !layout.fixed)
                    .map((layout) => (
                      <option key={layout.id} value={layout.id}>
                        {layout.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <div
            className="model-chains-editor"
          >
            <div className="model-chain-section main-model-chain-section">
              <ModelChainBuilder
                title="Main models"
                modelChain={activeConfig.main_model_chain || activeConfig.model_chain || []}
                onChange={onMainModelChainChange}
                onDragEnd={onModelChainInstantCommit}
                onResizeEnd={onModelChainInstantCommit}
                availableModels={availableModels}
                allowReorder={false}
              />
            </div>

            <div className="model-chain-section cloud-model-chain-section">
              <ModelChainBuilder
                title="Detailed cloud models"
                testIdPrefix="cloud-"
                emptyMessage="No cloud models configured. The detailed cloud profile panel will be omitted."
                modelChain={activeConfig.cloud_model_chain || []}
                onChange={onCloudModelChainChange}
                onDragEnd={onModelChainInstantCommit}
                onResizeEnd={onModelChainInstantCommit}
                availableModels={cloudAvailableModels}
                allowReorder={false}
                isCloudChain={true}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="card empty-state">
          <p>Select a configuration to edit or create a new one.</p>
        </div>
      )}
    </div>
  );
};

