// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * One model chain as its own card (REQ-482): a row of model cards whose widths follow the hours of each model,
 * with a vertical label on the left. The boundaries between the
 * models can be moved (REQ-481), with the keys also while the mouse is over one (REQ-657); a double-click or double-tap
 * puts one back (REQ-498).
 */
import type { WeatherModel } from "@graupel/download";
import { Fragment, useCallback, useState } from "react";
import type { HourSpan } from "../../../state/chain.ts";
import { useChainShades, type ChainKind } from "../../../state/chainColors.ts";
import { getModelMetadataWithFallback, type AvailableModels } from "./chainUtils.ts";
import { ModelBoundaryHandle } from "./ModelBoundaryHandle.tsx";
import { ModelSegment } from "./ModelSegment.tsx";
import { useModelChainLayout } from "./useModelChainLayout.ts";

export interface ModelChainRowProps {
  modelChain: WeatherModel[];
  /** Catalogue entries, for the labels and the info popovers. */
  availableModels: AvailableModels;
  /** How far each model's boundary can be moved (default `availableModels`); see `boundaryLimits`. */
  limits?: AvailableModels;
  /** The chain with a moved boundary, once per move (pointer released, key let go). */
  onCommit?: (chain: WeatherModel[]) => void;
  /** Puts boundary `index` back to its original position (double-click or double-tap, REQ-498). */
  onReset?: (index: number) => void;
  /** The chain while a boundary is dragged, at every hour step; `null` when the drag ends (REQ-504). */
  onPreview?: (chain: WeatherModel[] | null) => void;
  showTotalHours?: boolean;
  /**
   * Time spans of the delivered data by model name (REQ-448), shown instead of the planned slices (a model left out:
   * no data). Left out, and while a boundary is moved: the planned slices.
   */
  spans?: Readonly<Record<string, HourSpan>>;
  /** Vertical label on the left border, e.g. "Weather". */
  borderLabel?: string;
  /** Accessible name of the row. */
  label?: string;
  testIdPrefix?: string;
  /** Which chain the row shows; picks the colour ramp of its cards (REQ-443). Default `main`. */
  kind?: ChainKind;
  /** Shown instead of the cards when the chain is empty. */
  emptyMessage?: string;
}

export function ModelChainRow({
  modelChain,
  availableModels,
  limits = availableModels,
  onCommit,
  onReset,
  onPreview,
  showTotalHours = true,
  spans,
  borderLabel,
  label,
  testIdPrefix = "",
  kind = "main",
  emptyMessage,
}: ModelChainRowProps) {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const toggleTooltip = useCallback((key: string) => setActiveTooltip((prev) => (prev === key ? null : key)), []);
  const {
    containerRef,
    segments,
    moving,
    resizingBoundaryIdx,
    handlePointerDownBoundary,
    handlePointerMoveBoundary,
    handlePointerUpBoundary,
    handleKeyDownBoundary,
    handleKeyUpBoundary,
    handlePointerEnterBoundary,
    handlePointerLeaveBoundary,
    handleDoubleClickBoundary,
  } = useModelChainLayout({
    modelChain,
    availableModels: limits,
    onCommit,
    onReset,
    onPreview,
  });
  const shades = useChainShades(segments.length, kind);
  const shownSpans = moving ? undefined : spans;

  return (
    <div
      className={`model-chain-row${borderLabel ? " model-chain-row--labelled" : ""}`}
      ref={containerRef}
      role="group"
      aria-label={label ?? borderLabel}
      data-chain={kind}
      data-testid={`${testIdPrefix}model-chain-card`}
    >
      {borderLabel && (
        <div className="model-chain-row__label" data-testid={`${testIdPrefix}border-label`} aria-hidden="true">
          {borderLabel}
        </div>
      )}
      {segments.length === 0 && (
        <p className="model-chain-row__empty" data-testid={`${testIdPrefix}empty-model-chain`}>
          {emptyMessage}
        </p>
      )}
      {segments.map((segment, idx) => {
        const nextSegment = segments[idx + 1];
        return (
          <Fragment key={`${segment.model.id ?? segment.model.name}-${idx}`}>
            <div className="model-chain-row__cell" style={{ width: `${segment.widthPct}%`, flexBasis: `${segment.widthPct}%` }}>
              <ModelSegment
                segment={segment}
                meta={getModelMetadataWithFallback(segment.model, availableModels)}
                shade={shades[idx]!}
                showTotalHours={showTotalHours}
                {...(shownSpans ? { delivered: shownSpans[segment.model.name] ?? null } : {})}
                testIdPrefix={testIdPrefix}
                activeTooltip={activeTooltip}
                onToggleTooltip={toggleTooltip}
                kind={kind}
              />
              {nextSegment && (
                <ModelBoundaryHandle
                  boundaryIndex={idx}
                  leftSegment={segment}
                  rightSegment={nextSegment}
                  isResizing={resizingBoundaryIdx === idx}
                  testIdPrefix={testIdPrefix}
                  onPointerDown={handlePointerDownBoundary}
                  onPointerMove={handlePointerMoveBoundary}
                  onPointerUp={handlePointerUpBoundary}
                  onKeyDown={handleKeyDownBoundary}
                  onKeyUp={handleKeyUpBoundary}
                  onPointerEnter={handlePointerEnterBoundary}
                  onPointerLeave={handlePointerLeaveBoundary}
                  onDoubleClick={handleDoubleClickBoundary}
                />
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
