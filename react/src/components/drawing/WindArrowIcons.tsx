import React from "react";
import {
  WIND_ICON_RADIUS_PX,
  type MeteogramLayout,
  type MeteogramRenderMode,
} from "./meteogramLayout";

export interface WindIconItem {
  id: string;
  x: number;
  timestamp: string;
  arrowAngle: number;
  dir: number | null;
}

export interface WindArrowIconsProps {
  icons: WindIconItem[];
  /** Vertical center of the icon row. */
  y: number;
  layout: MeteogramLayout;
  instance: MeteogramRenderMode;
}

/** Wind-direction arrows in fixed-size circles, pointing where wind blows. */
export const WindArrowIcons: React.FC<WindArrowIconsProps> = ({
  icons,
  y,
  layout,
  instance,
}) => (
  <>
    {icons.map((icon) => (
      <g
        key={icon.id}
        transform={`translate(${icon.x}, ${y})`}
        data-testid="wind-arrow-group"
        data-timestamp={icon.timestamp}
        data-center-x={icon.x}
      >
        <g
          transform={`scale(${layout.windIconScaleX} ${layout.windIconScaleY})`}
          data-testid="wind-icon-glyph"
          data-render-mode={instance}
          data-rendered-width={layout.renderedWidth}
          data-rendered-height={layout.renderedHeight}
        >
          <circle
            cx="0"
            cy="0"
            r={WIND_ICON_RADIUS_PX}
            fill="#f1f5f9"
            stroke="#cbd5e1"
            strokeWidth="0.9"
          />
          <g
            transform={`rotate(${icon.arrowAngle})`}
            data-testid="wind-arrow"
            data-direction={icon.dir ?? undefined}
            data-arrow-angle={icon.arrowAngle}
          >
            <line
              x1="0"
              y1="4.5"
              x2="0"
              y2="-4.5"
              stroke="#0284c7"
              strokeWidth="1.62"
            />
            <polygon points="0,-6.3 -2.7,-1.8 2.7,-1.8" fill="#0284c7" />
          </g>
        </g>
      </g>
    ))}
  </>
);
