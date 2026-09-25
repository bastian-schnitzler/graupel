import type { ModelMetadata } from "../../types";
import type { ModelChainSegment } from "./modelChainLayout";
import {
  Info,
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface ModelSegmentProps {
  segment: ModelChainSegment;
  meta: ModelMetadata;
  color: string;
  readOnly?: boolean;
  allowReorder?: boolean;
  allowDelete?: boolean;
  canDelete?: boolean;
  showTotalHours?: boolean;
  showMissingVariables?: boolean;
  isCloudChain?: boolean;
  isDragged?: boolean;
  isHovered?: boolean;
  isCollapsed?: boolean;
  isLastSegment?: boolean;
  hasCollapseBtn?: boolean;
  onToggleCollapse?: () => void;
  borderLabel?: string;
  activeTooltip: string | null;
  onToggleTooltip: (modelName: string) => void;
  onDelete?: (index: number) => void;
  onDragStart?: (event: React.DragEvent, index: number) => void;
  onDragOver?: (event: React.DragEvent, index: number) => void;
  onDrop?: (event: React.DragEvent, index: number) => void;
}

export const ModelSegment: React.FC<ModelSegmentProps> = ({
  segment,
  meta,
  color,
  readOnly = false,
  allowReorder = true,
  allowDelete = true,
  canDelete = false,
  showTotalHours = true,
  showMissingVariables,
  isCloudChain = false,
  isDragged = false,
  isHovered = false,
  isCollapsed = false,
  isLastSegment = false,
  hasCollapseBtn = false,
  onToggleCollapse,
  borderLabel,
  activeTooltip,
  onToggleTooltip,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
}) => {
  const { model, index, startHour, endHour, duration } = segment;
  const maxCapable =
    meta.max_forecast_horizon_hours ||
    meta.max_forecast_hours ||
    model.max_forecast_horizon_hours;
  const resolution =
    meta.spatial_resolution_km || meta.spatial_resolution
      ? `${meta.spatial_resolution_km || meta.spatial_resolution}km`
      : "N/A";
  const tempRes =
    meta.temporal_resolution_hours || meta.temporal_resolution
      ? `${meta.temporal_resolution_hours || meta.temporal_resolution}h`
      : "1h";

  const isDraggable = !readOnly && allowReorder;
  const shouldShowMissingVars = showMissingVariables ?? !isCloudChain;

  if (isCollapsed) {
    return (
      <div
        data-testid={`model-card-${model.name}`}
        className={`model-card model-card-collapsed ${isDragged ? "dragging" : ""} ${isHovered ? "drag-hover" : ""}`}
        style={{
          borderTop: `0.1875rem solid ${color}`,
          width: "100%",
          boxSizing: "border-box",
          ...(isLastSegment && hasCollapseBtn
            ? { paddingRight: "1.75rem" }
            : {}),
        }}
        title={`${model.name}: ${startHour}h to ${endHour}h (${duration} hours)`}
      >
        <span className="model-name-collapsed">{model.name}</span>
        {isLastSegment && hasCollapseBtn && onToggleCollapse && (
          <button
            type="button"
            className="model-chain-collapse-btn"
            onClick={onToggleCollapse}
            title="Expand model chain"
            aria-label="Expand model chain"
            data-testid={`collapse-btn-${borderLabel?.toLowerCase() || "chain"}`}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={`model-card-${model.name}`}
      className={`model-card ${isDragged ? "dragging" : ""} ${isHovered ? "drag-hover" : ""}`}
      draggable={isDraggable}
      onDragStart={(e) => isDraggable && onDragStart && onDragStart(e, index)}
      onDragOver={(e) => isDraggable && onDragOver && onDragOver(e, index)}
      onDrop={(e) => isDraggable && onDrop && onDrop(e, index)}
      style={{
        borderTop: `0.25rem solid ${color}`,
        width: "100%",
        boxSizing: "border-box",
      }}
      title={`${model.name}: ${startHour}h to ${endHour}h (${duration} hours)`}
    >
      <div
        className="model-card-top"
        style={
          isLastSegment && hasCollapseBtn
            ? { paddingRight: "1.75rem" }
            : undefined
        }
      >
        {!readOnly && allowReorder && (
          <GripVertical className="drag-handle" size={16} />
        )}
        <span className="model-name-title">{model.name}</span>

        <div className="tooltip-container">
          <button
            type="button"
            className="icon-btn info-btn"
            onClick={() => onToggleTooltip(model.name)}
            title="View model details"
          >
            <Info size={15} />
          </button>
          {activeTooltip === model.name && (
            <div className="tooltip-content">
              <strong>{meta.name}</strong>
              {meta.provider && (
                <p>
                  <strong>Provider:</strong> {meta.provider}
                </p>
              )}
              {(meta.region || meta.geographical_coverage) && (
                <p>
                  <strong>Coverage:</strong>{" "}
                  {meta.region || meta.geographical_coverage}
                </p>
              )}
              <div className="tooltip-meta">
                <span>
                  <strong>Spatial:</strong> {resolution}
                </span>
                <span>
                  <strong>Temporal:</strong> {tempRes}
                </span>
                <span>
                  <strong>Max Horizon:</strong> {maxCapable}h
                </span>
              </div>
            </div>
          )}
        </div>

        {!readOnly && allowDelete && canDelete && onDelete && (
          <button
            type="button"
            className="icon-btn delete-btn"
            onClick={() => onDelete(index)}
            title="Remove model from chain"
            aria-label={`Remove ${model.name} from model chain`}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {isLastSegment && hasCollapseBtn && onToggleCollapse && (
        <button
          type="button"
          className="model-chain-collapse-btn"
          onClick={onToggleCollapse}
          title="Collapse model chain"
          aria-label="Collapse model chain"
          data-testid={`collapse-btn-${borderLabel?.toLowerCase() || "chain"}`}
        >
          <ChevronDown size={14} />
        </button>
      )}

      <div className="model-card-body">
        <div
          className="range-badge"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {startHour}h — {endHour}h
          {showTotalHours ? ` (${duration}h total)` : ""}
        </div>
        <div className="meta-specs">
          <span>Res: {resolution}</span>
          <span>Max: {maxCapable}h</span>
        </div>
        {shouldShowMissingVars &&
          meta.missing_variables &&
          meta.missing_variables.length > 0 && (
            <div
              className="missing-vars"
              style={{
                color: "#f59e0b",
                fontSize: "0.75rem",
                marginTop: "0.25rem",
              }}
            >
              ⚠ no {meta.missing_variables.join(", ")}
            </div>
          )}
        {shouldShowMissingVars && (model.unavailable || meta.unavailable) && (
          <div
            className="unavailable"
            style={{
              color: "#ef4444",
              fontSize: "0.75rem",
              marginTop: "0.25rem",
              fontWeight: "bold",
            }}
          >
            UNAVAILABLE
          </div>
        )}
      </div>
    </div>
  );
};
