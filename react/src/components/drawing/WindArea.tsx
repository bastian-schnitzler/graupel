import React from "react";
import type { MeteogramLayout, MeteogramRenderMode } from "../MeteogramChart";
import { WIND_ICON_RADIUS_PX } from "../MeteogramChart";
import { DrawingArea } from "./DrawingArea";
import { getTextTransform } from "./meteogramLayout";

export interface WindIconItem {
  id: string;
  x: number;
  timestamp: string;
  arrowAngle: number;
  dir: number | null;
}

export interface WindAreaProps {
  paddingLeft: number;
  windTop: number;
  windHeight: number;
  windBottom: number;
  maxWind: number;
  windClipId: string;
  windSpeedPath: string;
  windGustsPath: string;
  windIcons: WindIconItem[];
  layout: MeteogramLayout;
  instance: MeteogramRenderMode;
}

export const WindArea: React.FC<WindAreaProps> = ({
  paddingLeft,
  windTop,
  windHeight: _windHeight,
  windBottom,
  maxWind,
  windClipId,
  windSpeedPath,
  windGustsPath,
  windIcons,
  layout,
  instance,
}) => {
  return (
    <g className="panel panel-wind">
      <text
        x={paddingLeft - 8}
        y={windTop + 14}
        transform={getTextTransform(
          paddingLeft - 8,
          windTop + 14,
          layout.textScaleX,
        )}
        fill="#475569"
        fontSize="9"
        textAnchor="end"
      >
        {maxWind} km/h
      </text>
      <text
        x={paddingLeft - 8}
        y={windBottom - 2}
        transform={getTextTransform(
          paddingLeft - 8,
          windBottom - 2,
          layout.textScaleX,
        )}
        fill="#475569"
        fontSize="9"
        textAnchor="end"
      >
        0 km/h
      </text>

      <DrawingArea
        bounds={{
          top: windTop,
          height: windBottom - windTop,
          left: paddingLeft,
          width: 0,
        }}
        clipId={windClipId}
        className="wind-plot-area"
        testId="wind-plot-area"
      >
        <path
          d={windGustsPath}
          fill="none"
          stroke="#d97706"
          strokeWidth="1.5"
          strokeDasharray="4 2"
          clipPath={`url(#${windClipId})`}
          data-testid="wind-gusts-path"
        />

        <path
          d={windSpeedPath}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="2"
          strokeLinecap="round"
          clipPath={`url(#${windClipId})`}
          data-testid="wind-speed-path"
        />

        {windIcons.map((icon) => {
          const arrowY = windTop + 14;

          return (
            <g
              key={icon.id}
              transform={`translate(${icon.x}, ${arrowY})`}
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
          );
        })}
      </DrawingArea>
    </g>
  );
};
