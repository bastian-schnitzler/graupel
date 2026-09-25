import type { ReactNode } from "react";

export interface PanelBounds {
  top: number;
  height: number;
  left: number;
  width: number;
}

export interface DrawingAreaProps {
  bounds: PanelBounds;
  clipId?: string;
  className?: string;
  testId?: string;
  showSeparator?: boolean;
  separatorY?: number;
  separatorStroke?: string;
  separatorStrokeWidth?: number | string;
  separatorOpacity?: number | string;
  separatorDashArray?: string;
  separatorLeft?: number;
  separatorRight?: number;
  children: ReactNode;
}
