// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Boundary between two cards (REQ-481): a slider over the hour at which the
 * right model takes over. Dragged with mouse, pen or finger; arrow keys move it by an hour (12 with Shift or
 * Page Up/Down), Home and End to its limits, with the focus or while the mouse is over it (REQ-657). A double-click (a double-tap on phones) puts it back to its original
 * position (REQ-498).
 */
import type { KeyboardEvent, PointerEvent } from "react";
import { useT } from "../../../i18n/index.ts";
import { modelLabel } from "./chainUtils.ts";
import type { ModelChainSegment } from "./modelChainLayout.ts";

interface ModelBoundaryHandleProps {
  boundaryIndex: number;
  leftSegment: ModelChainSegment;
  rightSegment: ModelChainSegment;
  isResizing: boolean;
  /** Prefix of the test id, e.g. "cloud-". */
  testIdPrefix?: string;
  onPointerDown: (event: PointerEvent<HTMLDivElement>, index: number) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>, index: number) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onKeyUp: () => void;
  /** The mouse came over the boundary: it takes the keys without the focus (REQ-657). */
  onPointerEnter: (event: PointerEvent<HTMLDivElement>, index: number) => void;
  onPointerLeave: (index: number) => void;
  onDoubleClick: (index: number) => void;
}

export function ModelBoundaryHandle({
  boundaryIndex,
  leftSegment,
  rightSegment,
  isResizing,
  testIdPrefix = "",
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  onKeyUp,
  onPointerEnter,
  onPointerLeave,
  onDoubleClick,
}: ModelBoundaryHandleProps) {
  const t = useT();
  const hours = leftSegment.endHour;
  const names = { left: modelLabel(leftSegment.model), right: modelLabel(rightSegment.model) };
  return (
    <div
      className={`model-resize-handle${isResizing ? " active-resizing" : ""}`}
      role="slider"
      aria-label={t("modelChain.boundary", names)}
      aria-orientation="horizontal"
      aria-valuemin={leftSegment.minAllowedHorizon}
      aria-valuemax={leftSegment.maxAllowedHorizon}
      aria-valuenow={hours}
      aria-valuetext={t("modelChain.boundaryValue", { ...names, hours })}
      tabIndex={0}
      data-testid={`${testIdPrefix}boundary-${boundaryIndex}`}
      onPointerDown={(e) => onPointerDown(e, boundaryIndex)}
      onPointerMove={(e) => onPointerMove(e, boundaryIndex)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={(e) => onKeyDown(e, boundaryIndex)}
      onKeyUp={onKeyUp}
      onPointerEnter={(e) => onPointerEnter(e, boundaryIndex)}
      onPointerLeave={() => onPointerLeave(boundaryIndex)}
      onBlur={onKeyUp}
      onDoubleClick={() => onDoubleClick(boundaryIndex)}
      title={t("modelChain.boundaryHint")}
    />
  );
}
