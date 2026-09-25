import React from "react";
import { DrawingArea } from "./DrawingArea";
import { calculateFreezingZeroY } from "./meteogramPaths";
import { getTextTransform } from "./meteogramLayout";

export interface DailyExtremePoint {
  x: number;
  y: number;
  text: string;
  visible: boolean;
}

export interface DailyExtremeItem {
  dayKey: string;
  max: DailyExtremePoint;
  min: DailyExtremePoint;
}

export interface TemperatureAreaProps {
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  tempTop: number;
  tempHeight: number;
  minTemp: number;
  maxTemp: number;
  temperatureClipId: string;
  apparentTempPath: string;
  tempPath: string;
  dailyExtremes: DailyExtremeItem[];
  separatorStroke?: string;
  separatorStrokeWidth?: number;
  separatorOpacity?: number;
  textScaleX?: number;
}

export const TemperatureArea: React.FC<TemperatureAreaProps> = ({
  paddingLeft,
  paddingRight,
  svgWidth,
  tempTop,
  tempHeight,
  minTemp,
  maxTemp,
  temperatureClipId,
  apparentTempPath,
  tempPath,
  dailyExtremes,
  separatorStroke = "#cbd5e1",
  separatorStrokeWidth = 1.2,
  separatorOpacity = 1,
  textScaleX = 1,
}) => {
  return (
    <g className="panel panel-temperature">
      <text
        x={paddingLeft - 8}
        y={tempTop + 14}
        transform={getTextTransform(paddingLeft - 8, tempTop + 14, textScaleX)}
        fill="#475569"
        fontSize="9"
        textAnchor="end"
      >
        {maxTemp}°
      </text>
      <text
        x={paddingLeft - 8}
        y={tempTop + tempHeight - 6}
        transform={getTextTransform(
          paddingLeft - 8,
          tempTop + tempHeight - 6,
          textScaleX,
        )}
        fill="#475569"
        fontSize="9"
        textAnchor="end"
      >
        {minTemp}°
      </text>

      <DrawingArea
        bounds={{
          top: tempTop,
          height: tempHeight,
          left: paddingLeft,
          width: svgWidth - paddingLeft - paddingRight,
        }}
        clipId={temperatureClipId}
        className="temperature-plot-area"
        testId="temperature-plot-area"
      >
        {minTemp <= 0 &&
          maxTemp >= 0 &&
          (() => {
            const zeroY = calculateFreezingZeroY(
              tempTop,
              tempHeight,
              minTemp,
              maxTemp,
            );
            return (
              <g
                key="freezing-reference-group"
                className="freezing-reference-group"
              >
                <line
                  x1={paddingLeft}
                  y1={zeroY}
                  x2={svgWidth - paddingRight}
                  y2={zeroY}
                  stroke={separatorStroke}
                  strokeWidth={separatorStrokeWidth}
                  opacity={separatorOpacity}
                  clipPath={`url(#${temperatureClipId})`}
                  data-testid="freezing-line"
                />
              </g>
            );
          })()}

        {/* Apparent Temperature Curve (Brown) */}
        <path
          d={apparentTempPath}
          fill="none"
          stroke="#92400e"
          strokeWidth="2"
          strokeLinecap="round"
          clipPath={`url(#${temperatureClipId})`}
          data-testid="apparent-temperature-path"
        />

        {/* Normal Temperature Curve */}
        <path
          d={tempPath}
          fill="none"
          stroke="#f43f5e"
          strokeWidth="2.5"
          strokeLinecap="round"
          clipPath={`url(#${temperatureClipId})`}
          data-testid="temperature-path"
        />

        {/* Daily Min and Max Temperature Labels */}
        {dailyExtremes.map((item) => (
          <g
            key={`daily-temp-${item.dayKey}`}
            className="daily-temp-extremes"
            pointerEvents="none"
          >
            {item.max.visible && (
              <text
                x={item.max.x}
                y={item.max.y}
                transform={getTextTransform(item.max.x, item.max.y, textScaleX)}
                fill="#e11d48"
                stroke="#ffffff"
                strokeWidth="3"
                paintOrder="stroke"
                strokeLinejoin="round"
                fontSize="9.5"
                fontWeight="700"
                textAnchor="middle"
                data-testid="daily-max-temp"
              >
                {item.max.text}
              </text>
            )}
            {item.min.visible && (
              <text
                x={item.min.x}
                y={item.min.y}
                transform={getTextTransform(item.min.x, item.min.y, textScaleX)}
                fill="#0284c7"
                stroke="#ffffff"
                strokeWidth="3"
                paintOrder="stroke"
                strokeLinejoin="round"
                fontSize="9.5"
                fontWeight="700"
                textAnchor="middle"
                data-testid="daily-min-temp"
              >
                {item.min.text}
              </text>
            )}
          </g>
        ))}
      </DrawingArea>
    </g>
  );
};
