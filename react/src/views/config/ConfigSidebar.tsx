import React, { useState, useRef } from "react";
import type { MeteogramConfig } from "../../types";
import { Trash2, Copy, GripVertical, MapPin } from "lucide-react";
import { resolveConfigDropTarget } from "./configSidebar.logic";

export interface ConfigSidebarProps {
  configs: MeteogramConfig[];
  activeConfigId: string | null;
  onSelectConfig: (config: MeteogramConfig) => void;
  onCreateConfig: () => void;
  onDuplicateConfig: () => void;
  onDeleteConfig: () => void;
  onReorderConfigs: (sourceIndex: number, targetIndex: number) => void;
}

export const ConfigSidebar: React.FC<ConfigSidebarProps> = ({
  configs,
  activeConfigId,
  onSelectConfig,
  onCreateConfig,
  onDuplicateConfig,
  onDeleteConfig,
  onReorderConfigs,
}) => {
  const draggedIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    draggedIdxRef.current = index;
    e.dataTransfer.setData("text/plain", index.toString());
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    draggedIdxRef.current = null;
    setDragOverIdx(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIdx(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex =
      draggedIdxRef.current ??
      parseInt(e.dataTransfer.getData("text/plain"), 10);
    draggedIdxRef.current = null;
    setDragOverIdx(null);

    const validTarget = resolveConfigDropTarget(
      sourceIndex,
      targetIndex,
      configs.length,
    );
    if (validTarget !== null) {
      onReorderConfigs(sourceIndex, validTarget);
    }
  };

  const hasActive = Boolean(activeConfigId);

  return (
    <div className="config-sidebar card">
      <div className="sidebar-header">
        <button
          type="button"
          className="btn btn-secondary btn-icon-only config-delete-btn"
          onClick={onDeleteConfig}
          disabled={configs.length <= 1 || !hasActive}
          aria-label="Delete selected configuration"
          title={
            configs.length <= 1
              ? "Cannot delete the last remaining configuration"
              : "Delete selected configuration"
          }
        >
          <Trash2 size={16} />
        </button>

        <div className="sidebar-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon-only config-duplicate-btn"
            onClick={onDuplicateConfig}
            disabled={!hasActive}
            aria-label="Duplicate selected configuration"
            title="Duplicate selected configuration"
          >
            <Copy size={16} />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm config-add-btn"
            onClick={onCreateConfig}
            aria-label="Create new configuration"
            title="Create new configuration"
          >
            +
          </button>
        </div>
      </div>

      <div
        className="config-list"
        data-has-multiple={configs.length >= 2}
        data-testid="config-list"
      >
        {configs.map((cfg, idx) => {
          const isSelected = activeConfigId === cfg.id;
          return (
            <div
              key={cfg.id || cfg.name}
              className={`config-item-card ${isSelected ? "active" : ""} ${dragOverIdx === idx ? "drag-over" : ""}`}
              onClick={() => onSelectConfig(cfg)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
            >
              <div className="config-item-content">
                <div
                  className="config-drag-handle"
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={(e) => e.stopPropagation()}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                >
                  <GripVertical size={16} />
                </div>
                <div className="config-item-text">
                  <div className="config-item-title">{cfg.name}</div>
                  <div className="config-item-sub">
                    <MapPin size={12} /> {cfg.location.name} &bull;{" "}
                    {(cfg.model_chain || cfg.main_model_chain || []).length}{" "}
                    models
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
