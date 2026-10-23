import { useLayoutEffect, useRef } from "react";
import type { ModelMetadata } from "../../types";
import type { ModelChainSegment } from "./modelChainLayout";
import { formatModelRunTime } from "./modelChainBuilderUtils";
import {
  describeModelHorizon,
  describeModelRuns,
  displayedRunInitTimes,
  type ModelRunLine,
} from "./modelInfo.logic";
import {
  Info,
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const POPOVER_MARGIN_PX = 8;

/**
 * Info popover centred below its button, shifted horizontally so it stays
 * inside the window whenever the window is wide enough.
 */
const ModelInfoPopover: React.FC<{
  wide: boolean;
  children: React.ReactNode;
}> = ({ wide, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      el.style.transform = "translateX(-50%)";
      const rect = el.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      let shift = 0;
      if (rect.right > viewportWidth - POPOVER_MARGIN_PX) {
        shift = viewportWidth - POPOVER_MARGIN_PX - rect.right;
      }
      // The left edge wins when the window is narrower than the popover.
      if (rect.left + shift < POPOVER_MARGIN_PX) {
        shift = POPOVER_MARGIN_PX - rect.left;
      }
      el.style.transform = `translateX(calc(-50% + ${shift}px))`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  return (
    <div
      ref={ref}
      className={`tooltip-content${wide ? " tooltip-content-wide" : ""}`}
      data-testid="model-info-popover"
    >
      {children}
    </div>
  );
};

const RunLines: React.FC<{
  title: string;
  lines: ModelRunLine[];
  testId: string;
}> = ({ title, lines, testId }) => (
  <div className="tooltip-runs" data-testid={testId}>
    <div className="tooltip-runs-title">{title}</div>
    {lines.map((line, idx) => (
      <div key={`${line.run}-${idx}`} className="tooltip-run-line">
        {idx > 0 ? "+ " : ""}
        <strong>{line.run}</strong>
        {line.detail ? ` · ${line.detail}` : ""}
      </div>
    ))}
  </div>
);

/**
 * Info popover body: name (provider, coverage), the main and ensemble runs
 * (Meteogram View), key/value specs, then the horizon explanations.
 */
const ModelInfoContent: React.FC<{
  meta: ModelMetadata;
  resolution: string;
  tempRes: string;
  maxCapable: number;
}> = ({ meta, resolution, tempRes, maxCapable }) => {
  const info = meta.horizon_info;
  const runs = info ? describeModelRuns(info) : null;
  const subtitle = [meta.provider, meta.region || meta.geographical_coverage]
    .filter(Boolean)
    .join(", ");
  const specs: [string, string][] = [
    ["Spatial", resolution],
    ["Temporal", tempRes],
    ...(info
      ? ([
          ["Catalogue horizon", `${info.catalogue_hours}h`],
          ["Max (from now)", `${maxCapable}h`],
        ] as [string, string][])
      : ([["Max horizon", `${maxCapable}h`]] as [string, string][])),
  ];
  if (info?.probability_valid_until) {
    specs.push([
      "Probability until",
      formatModelRunTime(info.probability_valid_until) ?? "?",
    ]);
  }

  return (
    <>
      <div className="tooltip-title">
        <strong>{meta.name}</strong>
        {subtitle ? ` (${subtitle})` : ""}
      </div>
      {runs && runs.main.length > 0 && (
        <RunLines title="Main run" lines={runs.main} testId="model-main-runs" />
      )}
      {runs?.ensemble && (
        <RunLines
          title={`Ensemble run (${runs.ensemble.modelId})`}
          lines={runs.ensemble.lines}
          testId="model-ensemble-runs"
        />
      )}
      <dl className="tooltip-specs">
        {specs.map(([key, value]) => (
          <div key={key} className="tooltip-spec">
            <dt>{key}:</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {info && (
        <div className="tooltip-horizon-info" data-testid="model-horizon-info">
          {describeModelHorizon(info).map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      )}
    </>
  );
};

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

  // Open-Meteo mixes runs: the end of the series comes from an older run.
  // Meteogram View lists only the runs whose part its slice displays.
  const runInits = meta.horizon_info?.run_segments.length
    ? displayedRunInitTimes(meta.horizon_info)
    : [meta.last_run_init_time, meta.data_end_run_init_time];
  const [runTime, ...olderRunTimes] = runInits
    .map((init) => formatModelRunTime(init))
    .filter((time): time is string => Boolean(time));
  const endRunTime = olderRunTimes.join(" + ");
  // Meteogram View: usable hours of the current run(s) / catalogue horizon.
  const maxLabel = meta.horizon_info
    ? `${maxCapable}/${meta.horizon_info.catalogue_hours}h`
    : `${maxCapable}h`;
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
            <ModelInfoPopover wide={Boolean(meta.horizon_info)}>
              <ModelInfoContent
                meta={meta}
                resolution={resolution}
                tempRes={tempRes}
                maxCapable={maxCapable}
              />
            </ModelInfoPopover>
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
          {runTime && (
            <span
              className="model-run-time"
              title={
                endRunTime
                  ? "Runs in this series (local time): the latest run, then the older run delivering the remaining hours"
                  : "Start of the latest model run (local time)"
              }
            >
              Run: {runTime}
              {endRunTime ? ` + ${endRunTime}` : ""}
            </span>
          )}
          <span data-testid="model-card-max">Max: {maxLabel}</span>
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
        {meta.missing_sources && meta.missing_sources.length > 0 && (
          <div
            className="missing-vars"
            data-testid={`missing-sources-${model.name}`}
            title="The meteogram draws a quantity derived from these, so its bars stay empty for this model"
            style={{
              color: "#f59e0b",
              fontSize: "0.75rem",
              marginTop: "0.25rem",
            }}
          >
            ⚠ no {meta.missing_sources.join(", ")}
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
