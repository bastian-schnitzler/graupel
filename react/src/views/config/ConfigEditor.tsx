import React from 'react';
import type { MeteogramConfig, WeatherModel, ModelMetadata } from '../../types';
import { ModelChainBuilder } from '../../components/ModelChainBuilder';
import { Edit3 } from 'lucide-react';

export interface ConfigEditorProps {
  activeConfig: MeteogramConfig | null;
  availableModels: Record<string, ModelMetadata>;
  cloudAvailableModels: Record<string, ModelMetadata>;
  onNameChange: (newName: string) => void;
  onNameBlur: () => void;
  onMainModelChainChange: (newChain: WeatherModel[], instant?: boolean) => void;
  onCloudModelChainChange: (newChain: WeatherModel[], instant?: boolean) => void;
  onModelChainInstantCommit: () => void;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({
  activeConfig,
  availableModels,
  cloudAvailableModels,
  onNameChange,
  onNameBlur,
  onMainModelChainChange,
  onCloudModelChainChange,
  onModelChainInstantCommit
}) => {
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

