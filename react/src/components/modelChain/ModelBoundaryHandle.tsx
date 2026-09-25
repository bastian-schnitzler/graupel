import React from 'react';
import type { ModelChainSegment } from './modelChainLayout';

interface ModelBoundaryHandleProps {
  boundaryIndex: number;
  leftSegment: ModelChainSegment;
  rightSegment: ModelChainSegment;
  isResizing: boolean;
  readOnly?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, index: number) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>, index: number) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, index: number) => void;
}

export const ModelBoundaryHandle: React.FC<ModelBoundaryHandleProps> = ({
  boundaryIndex,
  leftSegment,
  rightSegment,
  isResizing,
  readOnly = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown
}) => {
  if (readOnly) return null;

  const currentHorizon = leftSegment.endHour;

  return (
    <div
      className={`model-resize-handle ${isResizing ? 'active-resizing' : ''}`}
      role="separator"
      aria-label={`Resize boundary between ${leftSegment.model.name} and ${rightSegment.model.name}`}
      aria-orientation="vertical"
      aria-valuemin={leftSegment.minAllowedHorizon}
      aria-valuemax={leftSegment.maxAllowedHorizon}
      aria-valuenow={currentHorizon}
      aria-valuetext={`${currentHorizon} hours`}
      tabIndex={0}
      onPointerDown={(e) => onPointerDown(e, boundaryIndex)}
      onPointerMove={(e) => onPointerMove(e, boundaryIndex)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={(e) => onKeyDown(e, boundaryIndex)}
      title={`Drag to adjust ${leftSegment.model.name} / ${rightSegment.model.name} boundary; arrow keys adjust by 1 hour`}
    />
  );
};
