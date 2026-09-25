import React from 'react';
import type { WeatherModel, ModelMetadata } from '../../types';
import { ModelChainBuilder } from '../ModelChainBuilder';

export interface MeteogramModelChainsProps {
  activeModelChain: WeatherModel[];
  activeCloudModelChain: WeatherModel[];
  availableModels: Record<string, ModelMetadata>;
  onModelChainChange: (newChain: WeatherModel[]) => void;
  onModelChainResizeEnd: () => void;
  onCloudModelChainChange: (newChain: WeatherModel[]) => void;
  onCloudModelChainResizeEnd: () => void;
  onCloudBoundaryDrag: (isDragging: boolean, boundaryIndex?: number, boundaryHour?: number) => void;
  isMainChainCollapsed?: boolean;
  onToggleMainChainCollapse?: () => void;
  isCloudChainCollapsed?: boolean;
  onToggleCloudChainCollapse?: () => void;
}

export const MeteogramModelChains: React.FC<MeteogramModelChainsProps> = ({
  activeModelChain,
  activeCloudModelChain,
  availableModels,
  onModelChainChange,
  onModelChainResizeEnd,
  onCloudModelChainChange,
  onCloudModelChainResizeEnd,
  onCloudBoundaryDrag,
  isMainChainCollapsed = false,
  onToggleMainChainCollapse,
  isCloudChainCollapsed = false,
  onToggleCloudChainCollapse,
}) => {
  return (
    <div
      className="model-chains-container"
    >
      <ModelChainBuilder
        borderLabel="METEO"
        modelChain={activeModelChain}
        onChange={onModelChainChange}
        onResizeEnd={onModelChainResizeEnd}
        availableModels={availableModels}
        readOnly={false}
        allowReorder={false}
        allowAdd={false}
        allowDelete={false}
        showTotalHours={false}
        showMissingVariables={false}
        collapsible={true}
        isCollapsed={isMainChainCollapsed}
        onToggleCollapse={onToggleMainChainCollapse}
      />

      {activeCloudModelChain.length > 0 && (
        <ModelChainBuilder
          borderLabel="CLOUDS"
          testIdPrefix="cloud-"
          modelChain={activeCloudModelChain}
          onChange={onCloudModelChainChange}
          onResizeEnd={onCloudModelChainResizeEnd}
          onBoundaryDrag={onCloudBoundaryDrag}
          availableModels={availableModels}
          readOnly={false}
          allowReorder={false}
          allowAdd={false}
          allowDelete={false}
          showTotalHours={false}
          isCloudChain={true}
          showMissingVariables={false}
          collapsible={true}
          isCollapsed={isCloudChainCollapsed}
          onToggleCollapse={onToggleCloudChainCollapse}
        />
      )}
    </div>
  );
};

