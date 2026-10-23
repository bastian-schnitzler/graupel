import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type {
  AxisRange,
  AxisSide,
  ChartLayout,
  LayoutAxis,
  LayoutSeries,
  LocationLabelPosition,
  SeriesAxis,
} from "../../layouts/types";
import {
  addArea,
  addSeries,
  getSeriesQuantities,
  getSeriesStyles,
  moveArea,
  moveSeries,
  removeArea,
  removeSeries,
  setCloudProfile,
  setLayoutToggle,
  setLocationLabel,
  updateArea,
  updateAxis,
  updateSeries,
  type LayoutToggle,
} from "../../layouts/layoutEditor.logic";
import { getSeriesColor } from "../../layouts/seriesPresets";

export interface LayoutEditorProps {
  layout: ChartLayout;
  onChange: (layout: ChartLayout) => void;
}

const TOGGLES: { key: LayoutToggle; label: string }[] = [
  { key: "showModelHeaders", label: "Model headers and boundaries (normal mode; always on in power mode)" },
  { key: "showDayHeader", label: "Day header" },
  { key: "showDaylight", label: "Daylight background" },
  { key: "showCreatedTimestamp", label: "Creation time in the location label" },
];

const AXIS_SIDES: AxisSide[] = ["left", "right"];
const AXIS_RANGES: { value: AxisRange; label: string }[] = [
  { value: "auto", label: "Auto (all models)" },
  { value: "zero-based", label: "From zero" },
  { value: "fixed", label: "Fixed" },
];
const SERIES_AXES: SeriesAxis[] = ["left", "right", "hidden"];

/** Number field; empty or non-numeric input reads as null. */
function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    className="btn btn-secondary btn-icon-only layout-editor-icon-btn"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
  >
    {children}
  </button>
);

const AxisEditor: React.FC<{
  areaId: string;
  side: AxisSide;
  axis: LayoutAxis | null;
  onChange: (patch: Partial<LayoutAxis> | null) => void;
}> = ({ areaId, side, axis, onChange }) => {
  const prefix = `${areaId} ${side} axis`;
  return (
    <div
      className="layout-editor-axis"
      data-testid={`layout-axis-${areaId}-${side}`}
    >
      <label className="layout-editor-check">
        <input
          type="checkbox"
          checked={axis !== null}
          aria-label={`${prefix} shown`}
          onChange={(e) => onChange(e.target.checked ? {} : null)}
        />
        {side === "left" ? "Left axis" : "Right axis"}
      </label>
      {axis && (
        <div className="layout-editor-fields">
          <select
            className="select-input"
            aria-label={`${prefix} quantity`}
            value={axis.quantity ?? ""}
            onChange={(e) => onChange({ quantity: e.target.value || null })}
          >
            <option value="">(no quantity)</option>
            {getSeriesQuantities().map((quantity) => (
              <option key={quantity.id} value={quantity.id}>
                {quantity.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="text-input layout-editor-short"
            aria-label={`${prefix} label`}
            placeholder="Unit"
            value={axis.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value || null })}
          />
          <select
            className="select-input"
            aria-label={`${prefix} range`}
            value={axis.range ?? "auto"}
            onChange={(e) => onChange({ range: e.target.value as AxisRange })}
          >
            {AXIS_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
          {axis.range === "fixed" && (
            <>
              <input
                type="number"
                className="text-input layout-editor-short"
                aria-label={`${prefix} minimum`}
                value={axis.min ?? ""}
                onChange={(e) => onChange({ min: parseNumber(e.target.value) })}
              />
              <input
                type="number"
                className="text-input layout-editor-short"
                aria-label={`${prefix} maximum`}
                value={axis.max ?? ""}
                onChange={(e) => onChange({ max: parseNumber(e.target.value) })}
              />
            </>
          )}
          <label className="layout-editor-check">
            <input
              type="checkbox"
              checked={axis.showLabels ?? true}
              aria-label={`${prefix} labels`}
              onChange={(e) => onChange({ showLabels: e.target.checked })}
            />
            Labels
          </label>
          <label className="layout-editor-check">
            <input
              type="checkbox"
              checked={axis.zeroLine ?? false}
              aria-label={`${prefix} zero line`}
              onChange={(e) => onChange({ zeroLine: e.target.checked })}
            />
            Zero line
          </label>
        </div>
      )}
    </div>
  );
};

const SeriesEditor: React.FC<{
  areaId: string;
  index: number;
  count: number;
  series: LayoutSeries;
  onChange: (patch: Partial<LayoutSeries>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}> = ({ areaId, index, count, series, onChange, onMove, onRemove }) => {
  const prefix = `${areaId} series ${index + 1}`;
  const styles = getSeriesStyles(series.quantity);
  return (
    <div
      className="layout-editor-series"
      data-testid={`layout-series-${areaId}-${index}`}
    >
      <input
        type="checkbox"
        checked={series.enabled ?? true}
        aria-label={`${prefix} shown`}
        title="Shown"
        onChange={(e) => onChange({ enabled: e.target.checked })}
      />
      <select
        className="select-input"
        aria-label={`${prefix} quantity`}
        value={series.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
      >
        {getSeriesQuantities().map((quantity) => (
          <option key={quantity.id} value={quantity.id}>
            {quantity.label}
          </option>
        ))}
      </select>
      <select
        className="select-input"
        aria-label={`${prefix} style`}
        value={series.style}
        onChange={(e) => onChange({ style: e.target.value })}
      >
        {/* Keep an illegal stored style visible; validation names it. */}
        {!styles.includes(series.style) && (
          <option value={series.style}>{series.style}</option>
        )}
        {styles.map((style) => (
          <option key={style} value={style}>
            {style}
          </option>
        ))}
      </select>
      <select
        className="select-input"
        aria-label={`${prefix} axis`}
        value={series.axis ?? "left"}
        onChange={(e) => onChange({ axis: e.target.value as SeriesAxis })}
      >
        {SERIES_AXES.map((axis) => (
          <option key={axis} value={axis}>
            {axis === "hidden" ? "own scale" : `${axis} axis`}
          </option>
        ))}
      </select>
      <input
        type="color"
        className="layout-editor-color"
        aria-label={`${prefix} color`}
        value={getSeriesColor(series.quantity, series.color ?? null)}
        onChange={(e) => onChange({ color: e.target.value })}
      />
      {series.style === "line" && (
        <label className="layout-editor-check">
          <input
            type="checkbox"
            checked={series.extremeLabels ?? false}
            aria-label={`${prefix} daily min/max`}
            onChange={(e) => onChange({ extremeLabels: e.target.checked })}
          />
          Min/max
        </label>
      )}
      <div className="layout-editor-row-actions">
        <IconButton
          label={`Move ${prefix} up`}
          onClick={() => onMove(-1)}
          disabled={index === 0}
        >
          <ArrowUp size={14} />
        </IconButton>
        <IconButton
          label={`Move ${prefix} down`}
          onClick={() => onMove(1)}
          disabled={index === count - 1}
        >
          <ArrowDown size={14} />
        </IconButton>
        <IconButton label={`Remove ${prefix}`} onClick={onRemove}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  );
};

/**
 * Area and series editor of one meteogram configuration (system.md §4.3, §7,
 * #142). Controlled: every change hands a new layout to `onChange`.
 */
export const LayoutEditor: React.FC<LayoutEditorProps> = ({
  layout,
  onChange,
}) => {
  const areaCount = layout.areas.length;
  return (
    <div className="layout-editor" data-testid="layout-editor">
      <h3 className="layout-section-title">Chart</h3>
      <div className="layout-editor-options">
        {TOGGLES.map((toggle) => (
          <label key={toggle.key} className="layout-editor-check">
            <input
              type="checkbox"
              checked={layout[toggle.key] ?? true}
              onChange={(e) =>
                onChange(setLayoutToggle(layout, toggle.key, e.target.checked))
              }
            />
            {toggle.label}
          </label>
        ))}
        <label className="layout-editor-check">
          Location label
          <select
            className="select-input"
            value={layout.showLocationLabel ?? "bottom"}
            onChange={(e) =>
              onChange(
                setLocationLabel(
                  layout,
                  e.target.value as LocationLabelPosition,
                ),
              )
            }
          >
            <option value="top">above the chart</option>
            <option value="bottom">below the chart</option>
            <option value="none">hidden</option>
          </select>
        </label>
      </div>

      <h3 className="layout-section-title">Areas</h3>
      {layout.areas.map((area, areaIndex) => {
        const series = area.series ?? [];
        const background = area.background;
        return (
          <section
            key={area.id}
            className="layout-editor-area"
            data-testid={`layout-area-${area.id}`}
            aria-label={`Area ${area.id}`}
          >
            <div className="layout-editor-area-header">
              <label className="layout-editor-check layout-editor-area-title">
                <input
                  type="checkbox"
                  checked={area.enabled ?? true}
                  aria-label={`${area.id} shown`}
                  onChange={(e) =>
                    onChange(
                      updateArea(layout, areaIndex, {
                        enabled: e.target.checked,
                      }),
                    )
                  }
                />
                {area.id}
              </label>
              <label className="layout-editor-check">
                Height
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  className="text-input layout-editor-short"
                  aria-label={`${area.id} height`}
                  value={area.heightWeight ?? 1}
                  onChange={(e) =>
                    onChange(
                      updateArea(layout, areaIndex, {
                        // Empty input: 0, which validation rejects.
                        heightWeight: parseNumber(e.target.value) ?? 0,
                      }),
                    )
                  }
                />
              </label>
              <label className="layout-editor-check">
                <input
                  type="checkbox"
                  checked={Boolean(background && background.enabled !== false)}
                  aria-label={`${area.id} cloud profile`}
                  onChange={(e) =>
                    onChange(
                      setCloudProfile(layout, areaIndex, e.target.checked),
                    )
                  }
                />
                Cloud profile
              </label>
              <label className="layout-editor-check">
                <input
                  type="checkbox"
                  checked={area.sunTimes ?? false}
                  aria-label={`${area.id} sunrise and sunset times`}
                  onChange={(e) =>
                    onChange(
                      updateArea(layout, areaIndex, {
                        sunTimes: e.target.checked,
                      }),
                    )
                  }
                />
                Sun times
              </label>
              <div className="layout-editor-row-actions">
                <IconButton
                  label={`Move area ${area.id} up`}
                  onClick={() => onChange(moveArea(layout, areaIndex, -1))}
                  disabled={areaIndex === 0}
                >
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton
                  label={`Move area ${area.id} down`}
                  onClick={() => onChange(moveArea(layout, areaIndex, 1))}
                  disabled={areaIndex === areaCount - 1}
                >
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton
                  label={`Remove area ${area.id}`}
                  onClick={() => onChange(removeArea(layout, areaIndex))}
                  disabled={areaCount === 1}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
            {AXIS_SIDES.map((side) => (
              <AxisEditor
                key={side}
                areaId={area.id}
                side={side}
                axis={area.axes?.[side] ?? null}
                onChange={(patch) =>
                  onChange(updateAxis(layout, areaIndex, side, patch))
                }
              />
            ))}
            <div className="layout-editor-series-list">
              {series.map((entry, seriesIndex) => (
                <SeriesEditor
                  key={seriesIndex}
                  areaId={area.id}
                  index={seriesIndex}
                  count={series.length}
                  series={entry}
                  onChange={(patch) =>
                    onChange(
                      updateSeries(layout, areaIndex, seriesIndex, patch),
                    )
                  }
                  onMove={(delta) =>
                    onChange(moveSeries(layout, areaIndex, seriesIndex, delta))
                  }
                  onRemove={() =>
                    onChange(removeSeries(layout, areaIndex, seriesIndex))
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm layout-editor-add"
              onClick={() => onChange(addSeries(layout, areaIndex))}
            >
              <Plus size={14} /> Add series to {area.id}
            </button>
          </section>
        );
      })}
      <button
        type="button"
        className="btn btn-secondary btn-sm layout-editor-add"
        onClick={() => onChange(addArea(layout))}
      >
        <Plus size={14} /> Add area
      </button>
    </div>
  );
};
