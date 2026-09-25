import React, { useState } from "react";
import type { WeatherModel, ModelMetadata } from "../../types";
import { AVAILABLE_MODELS_METADATA } from "../../models/openMeteoModels";
import { removeModelFromChain } from "../../services/apiService";
import { getModelMetadataWithFallback } from "./modelChainBuilderUtils";
import { useModelChainLayout } from "./useModelChainLayout";
import { ModelSegment } from "./ModelSegment";
import { ModelBoundaryHandle } from "./ModelBoundaryHandle";

interface ModelChainProps {
  modelChain: WeatherModel[];
  onChange: (newChain: WeatherModel[], instant?: boolean) => void;
  availableModels?: Record<string, ModelMetadata>;
  readOnly?: boolean;
  allowReorder?: boolean;
  allowDelete?: boolean;
  showTotalHours?: boolean;
  showMissingVariables?: boolean;
  isCloudChain?: boolean;
  onResizeEnd?: () => void;
  onDragEnd?: () => void;
  onBoundaryDrag?: (
    isDragging: boolean,
    boundaryIndex?: number,
    boundaryHour?: number,
  ) => void;
  borderLabel?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

import { MODEL_COLORS, resolveModelDrop } from "./modelChain.logic";

export { MODEL_COLORS };

export const ModelChain: React.FC<ModelChainProps> = ({
  modelChain,
  onChange,
  availableModels = AVAILABLE_MODELS_METADATA,
  readOnly = false,
  allowReorder = true,
  allowDelete = true,
  showTotalHours = true,
  showMissingVariables,
  isCloudChain = false,
  onResizeEnd,
  onDragEnd,
  onBoundaryDrag,
  borderLabel,
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const {
    containerRef,
    segments,
    resizingBoundaryIdx,
    handlePointerDownBoundary,
    handlePointerMoveBoundary,
    handlePointerUpBoundary,
    handleKeyDownBoundary,
  } = useModelChainLayout({
    modelChain,
    onChange,
    availableModels,
    readOnly,
    onResizeEnd,
    onBoundaryDrag,
  });

  const getMetaForModel = (model: WeatherModel): ModelMetadata =>
    getModelMetadataWithFallback(model, availableModels);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (readOnly) return;
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (readOnly || draggedIdx === null) return;
    e.preventDefault();
    setHoverIdx(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setHoverIdx(null);
    resolveModelDrop({
      draggedIdx,
      targetIndex,
      readOnly,
      modelChain,
      availableModels,
      onChange,
      onDragEnd,
    });
    setDraggedIdx(null);
  };

  const handleRemoveModel = (index: number) => {
    if (readOnly) return;
    const newChain = removeModelFromChain(modelChain, index);
    onChange(newChain, true);
  };

  const toggleTooltip = (modelName: string) => {
    setActiveTooltip((prev) => (prev === modelName ? null : modelName));
  };

  return (
    <div
      className={`horizontal-chain-container ${borderLabel ? "has-border-label" : ""} ${isCollapsed ? "is-collapsed" : ""}`}
      ref={containerRef}
      aria-label={`Model chain scaled across baseline proportions`}
      style={{ display: "flex", position: "relative", width: "100%" }}
    >
      {borderLabel && (
        <div
          className="model-chain-vertical-label"
          data-testid={`border-label-${borderLabel.toLowerCase()}`}
          aria-hidden="true"
        >
          {borderLabel}
        </div>
      )}
      {segments.map((segment, idx) => {
        const meta = getMetaForModel(segment.model);
        const color = MODEL_COLORS[segment.model.name] || "#6366f1";
        const isNextBoundaryResizing = resizingBoundaryIdx === idx;
        const nextSegment = segments[idx + 1];

        return (
          <React.Fragment key={`${segment.model.name}-${idx}`}>
            <div
              style={{
                position: "relative",
                width: `${segment.widthPct}%`,
                flexBasis: `${segment.widthPct}%`,
                minWidth: 0,
              }}
            >
              <ModelSegment
                segment={segment}
                meta={meta}
                color={color}
                readOnly={readOnly}
                allowReorder={allowReorder}
                allowDelete={allowDelete}
                canDelete={!readOnly && allowDelete}
                showTotalHours={showTotalHours}
                showMissingVariables={showMissingVariables}
                isCloudChain={isCloudChain}
                isDragged={draggedIdx === idx}
                isHovered={hoverIdx === idx}
                isCollapsed={isCollapsed}
                isLastSegment={idx === segments.length - 1}
                hasCollapseBtn={Boolean(collapsible && onToggleCollapse)}
                onToggleCollapse={onToggleCollapse}
                borderLabel={borderLabel}
                activeTooltip={activeTooltip}
                onToggleTooltip={toggleTooltip}
                onDelete={handleRemoveModel}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
              {nextSegment && (
                <ModelBoundaryHandle
                  boundaryIndex={idx}
                  leftSegment={segment}
                  rightSegment={nextSegment}
                  isResizing={isNextBoundaryResizing}
                  readOnly={readOnly}
                  onPointerDown={handlePointerDownBoundary}
                  onPointerMove={handlePointerMoveBoundary}
                  onPointerUp={handlePointerUpBoundary}
                  onKeyDown={handleKeyDownBoundary}
                />
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
