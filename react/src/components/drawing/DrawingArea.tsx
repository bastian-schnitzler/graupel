import React from "react";
import type { DrawingAreaProps } from "./drawingTypes";

export interface ExtendedDrawingAreaProps extends DrawingAreaProps {
  renderClipDef?: boolean;
}

export const DrawingArea: React.FC<ExtendedDrawingAreaProps> = ({
  bounds,
  clipId,
  renderClipDef = false,
  className,
  testId,
  showSeparator = false,
  separatorY,
  separatorStroke = "#e2e8f0",
  separatorStrokeWidth = 1,
  separatorOpacity = 1,
  separatorDashArray,
  separatorLeft,
  separatorRight,
  children,
}) => {
  const lineY =
    separatorY !== undefined ? separatorY : bounds.top + bounds.height;
  const x1 = separatorLeft !== undefined ? separatorLeft : bounds.left;
  const x2 =
    separatorRight !== undefined ? separatorRight : bounds.left + bounds.width;

  return (
    <>
      {clipId && renderClipDef && (
        <defs>
          <clipPath id={clipId}>
            <rect
              x={bounds.left}
              y={bounds.top}
              width={bounds.width}
              height={bounds.height}
            />
          </clipPath>
        </defs>
      )}
      <g
        className={className}
        data-testid={testId}
        clipPath={clipId ? `url(#${clipId})` : undefined}
      >
        {children}
      </g>
      {showSeparator && (
        <line
          x1={x1}
          y1={lineY}
          x2={x2}
          y2={lineY}
          stroke={separatorStroke}
          strokeWidth={separatorStrokeWidth}
          opacity={separatorOpacity}
          strokeDasharray={separatorDashArray}
          data-testid="panel-separator-line"
        />
      )}
    </>
  );
};
