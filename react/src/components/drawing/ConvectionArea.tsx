import React from "react";
import { canonicalTimestamp } from "../../utils/timeline";
import { DrawingArea } from "./DrawingArea";
import { calculateConvectiveBarGeometry } from "../../utils/meteogramConvective";
import { getTextTransform } from "./meteogramLayout";

export interface LpiSegment {
  path: string;
  model: string;
}

export interface ConvectionAreaProps {
  paddingLeft: number;
  outerLeftX: number;
  outerRightX: number;
  convectiveTop: number;
  convectiveZero: number;
  convectiveBottom: number;
  convectiveHalfHeight: number;
  capeMax: number;
  cinMax: number;
  convectiveClipId: string;
  lpiClipId: string;
  timestamps: number[];
  timeline: {
    intervalToGeometry: (ts: number) => { x: number; width: number } | null;
  };
  capeValues: (number | null)[];
  cinValues: (number | null)[];
  lpiSegments: LpiSegment[];
  textScaleX?: number;
}

export const ConvectionArea: React.FC<ConvectionAreaProps> = ({
  paddingLeft,
  outerLeftX,
  outerRightX,
  convectiveTop,
  convectiveZero,
  convectiveBottom,
  convectiveHalfHeight,
  capeMax,
  cinMax,
  convectiveClipId,
  lpiClipId,
  timestamps,
  timeline,
  capeValues,
  cinValues,
  lpiSegments,
  textScaleX = 1,
}) => {
  return (
    <g className="panel panel-convective" data-testid="panel-convective">
      <text
        x={paddingLeft - 8}
        y={convectiveTop + 12}
        transform={getTextTransform(
          paddingLeft - 8,
          convectiveTop + 12,
          textScaleX,
        )}
        fill="#b45309"
        fontSize="8"
        textAnchor="end"
      >
        {capeMax} J/kg
      </text>
      <text
        x={paddingLeft + 4}
        y={convectiveTop + 12}
        transform={getTextTransform(
          paddingLeft + 4,
          convectiveTop + 12,
          textScaleX,
        )}
        fill="#b45309"
        fontSize="9"
      >
        CAPE
      </text>
      <text
        x={paddingLeft - 8}
        y={convectiveZero + 3}
        transform={getTextTransform(
          paddingLeft - 8,
          convectiveZero + 3,
          textScaleX,
        )}
        fill="#334155"
        fontSize="9"
        textAnchor="end"
      >
        0 J/kg
      </text>
      <text
        x={paddingLeft - 8}
        y={convectiveBottom - 3}
        transform={getTextTransform(
          paddingLeft - 8,
          convectiveBottom - 3,
          textScaleX,
        )}
        fill="#0369a1"
        fontSize="8"
        textAnchor="end"
      >
        −{cinMax} J/kg
      </text>
      <text
        x={paddingLeft + 4}
        y={convectiveBottom - 3}
        transform={getTextTransform(
          paddingLeft + 4,
          convectiveBottom - 3,
          textScaleX,
        )}
        fill="#0369a1"
        fontSize="9"
      >
        CIN
      </text>

      <DrawingArea
        clipId={convectiveClipId}
        bounds={{
          top: convectiveTop,
          height: convectiveBottom - convectiveTop,
          left: outerLeftX,
          width: outerRightX - outerLeftX,
        }}
      >
        {(["cape", "convective_inhibition"] as const).map((variable) =>
          (variable === "cape" ? capeValues : cinValues).map((value, index) => {
            if (value === null || value === 0) return null;
            const geometry = timeline.intervalToGeometry(timestamps[index]);
            if (!geometry) return null;
            const isCape = variable === "cape";
            const { y, height, fill } = calculateConvectiveBarGeometry(
              value,
              isCape,
              capeMax,
              cinMax,
              convectiveZero,
              convectiveHalfHeight,
            );

            return (
              <rect
                key={`${variable}-${index}`}
                x={geometry.x}
                width={geometry.width}
                y={y}
                height={height}
                fill={fill}
                opacity="0.75"
                data-testid={isCape ? "cape-bar" : "cin-bar"}
                data-zero-y={convectiveZero}
                data-timestamp={canonicalTimestamp(timestamps[index])}
              />
            );
          }),
        )}
      </DrawingArea>

      <line
        x1={outerLeftX}
        x2={outerRightX}
        y1={convectiveZero}
        y2={convectiveZero}
        stroke="#334155"
        strokeWidth="1.5"
        data-testid="convective-zero-line"
      />

      {lpiSegments.length > 0 && (
        <g data-testid="lpi-layer">
          <text
            x={outerRightX + 4}
            y={convectiveTop + 9}
            transform={getTextTransform(
              outerRightX + 4,
              convectiveTop + 9,
              textScaleX,
            )}
            fill="#7c3aed"
            fontSize="7"
          >
            LPI
          </text>
          <text
            x={outerRightX + 4}
            y={convectiveTop + 18}
            transform={getTextTransform(
              outerRightX + 4,
              convectiveTop + 18,
              textScaleX,
            )}
            fill="#7c3aed"
            fontSize="7"
          >
            30 J/kg
          </text>
          <text
            x={outerRightX + 4}
            y={convectiveZero - 2}
            transform={getTextTransform(
              outerRightX + 4,
              convectiveZero - 2,
              textScaleX,
            )}
            fill="#7c3aed"
            fontSize="7"
          >
            0
          </text>
          {lpiSegments.map((segment, index) => (
            <path
              key={index}
              d={segment.path}
              fill="none"
              stroke="#7c3aed"
              strokeWidth="1.5"
              clipPath={`url(#${lpiClipId})`}
              data-testid="lpi-path"
              data-model={segment.model}
              data-scale-min="0"
              data-scale-max="30"
              data-scale-top={convectiveTop}
              data-scale-bottom={convectiveZero}
            />
          ))}
        </g>
      )}
    </g>
  );
};
