import React from "react";
import { canonicalTimestamp } from "../../utils/timeline";
import { getTextTransform } from "./meteogramLayout";

export interface DayGroupRenderItem {
  dayKey: string;
  firstX: number;
  rightX: number;
  blockWidth: number;
  isEven: boolean;
  isBoundaryVisible: boolean;
  boundaryX: number;
  dateLabel: string;
  weekdayLabel: string;
}

export interface NoonPositionItem {
  dayKey: string;
  x: number;
}

export interface ModelSegmentItem {
  modelName?: string;
  name?: string;
  startX: number;
  endX?: number;
}

export interface TimelineOverlayProps {
  dayGroups: DayGroupRenderItem[];
  noonPositions: NoonPositionItem[];
  modelSegments: ModelSegmentItem[];
  dayHeaderTop: number;
  dayHeaderBottom: number;
  dayHeaderHeight: number;
  tempBottom: number;
  combinedPlotTop: number;
  combinedPlotBottom: number;
  combinedPlotHeight: number;
  windTop: number;
  windBottom: number;
  windHeight: number;
  convectiveTop: number;
  convectiveBottom: number;
  convectiveHalfHeight: number;
  outerLeftX: number;
  outerRightX: number;
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  modelHeaderBoxBottom: number;
  hasDetailedCloud: boolean;
  locElevationKm: number;
  groundY: number;
  graphWidth: number;
  locationName?: string;
  timeline: {
    xToTimestamp: (x: number) => number;
  };
  separatorStroke?: string;
  separatorStrokeWidth?: number;
  separatorOpacity?: number;
  textScaleX?: number;
}

export const TimelineOverlay: React.FC<TimelineOverlayProps> = ({
  dayGroups,
  noonPositions,
  modelSegments,
  dayHeaderTop,
  dayHeaderBottom,
  dayHeaderHeight,
  tempBottom,
  combinedPlotTop,
  combinedPlotBottom,
  combinedPlotHeight,
  windTop,
  windBottom,
  windHeight,
  convectiveTop,
  convectiveBottom,
  convectiveHalfHeight,
  outerLeftX,
  outerRightX,
  paddingLeft,
  paddingRight,
  svgWidth,
  modelHeaderBoxBottom,
  hasDetailedCloud,
  locElevationKm,
  groundY,
  graphWidth,
  locationName,
  timeline,
  separatorStroke = "#cbd5e1",
  separatorStrokeWidth = 1.2,
  separatorOpacity = 1,
  textScaleX = 1,
}) => {
  return (
    <>
      {/* Day Groups, Background alternating tint, and Day Labels */}
      {dayGroups.map((group) => {
        return (
          <g key={group.dayKey} className="day-group-block">
            {group.isEven ? (
              <>
                <rect
                  x={group.firstX}
                  y={dayHeaderBottom}
                  width={group.blockWidth}
                  height={tempBottom - dayHeaderBottom}
                  fill="rgba(0, 0, 0, 0.03)"
                />
                <rect
                  x={group.firstX}
                  y={combinedPlotTop}
                  width={group.blockWidth}
                  height={combinedPlotHeight}
                  fill="rgba(0, 0, 0, 0.03)"
                />
                <rect
                  x={group.firstX}
                  y={windTop}
                  width={group.blockWidth}
                  height={windHeight}
                  fill="rgba(0, 0, 0, 0.03)"
                />
                <rect
                  x={group.firstX}
                  y={convectiveTop}
                  width={group.blockWidth}
                  height={convectiveHalfHeight * 2}
                  fill="rgba(0, 0, 0, 0.03)"
                />
              </>
            ) : (
              <rect
                x={group.firstX}
                y={dayHeaderBottom}
                width={group.blockWidth}
                height={tempBottom - dayHeaderBottom}
                fill="transparent"
              />
            )}

            <rect
              x={group.firstX}
              y={dayHeaderTop}
              width={group.blockWidth}
              height={dayHeaderHeight}
              fill="#f1f5f9"
              data-testid="day-label-cell"
            />

            {/* Day-boundary lines stopping at white separators */}
            {group.isBoundaryVisible && (
              <>
                {/* Area 1: Date header down through temperature area */}
                <line
                  x1={group.boundaryX}
                  y1={dayHeaderTop}
                  x2={group.boundaryX}
                  y2={tempBottom}
                  stroke={separatorStroke}
                  strokeWidth={separatorStrokeWidth}
                  opacity={separatorOpacity}
                  className="chart-separator-line"
                  data-testid="day-separator-line"
                />
                {/* Area 2: Precipitation / cloud area */}
                <line
                  x1={group.boundaryX}
                  y1={combinedPlotTop}
                  x2={group.boundaryX}
                  y2={combinedPlotBottom}
                  stroke={separatorStroke}
                  strokeWidth={separatorStrokeWidth}
                  opacity={separatorOpacity}
                  className="chart-separator-line"
                  data-testid="day-separator-line"
                />
                {/* Area 3: Wind area */}
                <line
                  x1={group.boundaryX}
                  y1={windTop}
                  x2={group.boundaryX}
                  y2={windBottom}
                  stroke={separatorStroke}
                  strokeWidth={separatorStrokeWidth}
                  opacity={separatorOpacity}
                  className="chart-separator-line"
                  data-testid="day-separator-line"
                />
                <line
                  x1={group.boundaryX}
                  y1={convectiveTop}
                  x2={group.boundaryX}
                  y2={convectiveBottom}
                  stroke={separatorStroke}
                  strokeWidth={separatorStrokeWidth}
                  opacity={separatorOpacity}
                  className="chart-separator-line"
                  data-testid="day-separator-line"
                />
              </>
            )}

            <text
              x={group.firstX + group.blockWidth / 2}
              y={dayHeaderTop + 15}
              transform={getTextTransform(
                group.firstX + group.blockWidth / 2,
                dayHeaderTop + 15,
                textScaleX,
              )}
              fill="#0f172a"
              fontSize={
                group.blockWidth < 45
                  ? "8"
                  : group.blockWidth < 65
                    ? "9.5"
                    : "11"
              }
              fontWeight="700"
              textAnchor="middle"
            >
              {group.blockWidth < 38
                ? group.dateLabel.split(".")[0]
                : group.blockWidth < 55
                  ? `${group.weekdayLabel} ${group.dateLabel.split(".")[0]}`
                  : `${group.weekdayLabel} ${group.dateLabel}`}
            </text>
          </g>
        );
      })}

      {/* Noon Dotted Grid Lines (12:00 local time per day) */}
      {noonPositions.map((noon) => (
        <g key={`noon-grid-${noon.dayKey}`} className="noon-grid-group">
          <line
            x1={noon.x}
            y1={dayHeaderBottom}
            x2={noon.x}
            y2={tempBottom}
            stroke="#e2e8f0"
            strokeDasharray="2 3"
            className="chart-separator-line"
            data-testid="noon-grid-line"
          />
          <line
            x1={noon.x}
            y1={combinedPlotTop}
            x2={noon.x}
            y2={combinedPlotBottom}
            stroke="#e2e8f0"
            strokeDasharray="2 3"
            className="chart-separator-line"
            data-testid="noon-grid-line"
          />
          <line
            x1={noon.x}
            y1={windTop}
            x2={noon.x}
            y2={windBottom}
            stroke="#e2e8f0"
            strokeDasharray="2 3"
            className="chart-separator-line"
            data-testid="noon-grid-line"
          />
          <line
            x1={noon.x}
            y1={convectiveTop}
            x2={noon.x}
            y2={convectiveBottom}
            stroke="#e2e8f0"
            strokeDasharray="2 3"
            className="chart-separator-line"
            data-testid="noon-grid-line"
          />
        </g>
      ))}

      {/* Shared grey grid borders */}
      <g className="chart-area-separator-borders">
        {[
          { y: dayHeaderTop, edge: "date-header-top" },
          { y: tempBottom, edge: "temperature-bottom" },
          { y: combinedPlotTop, edge: "precipitation-top" },
          { y: combinedPlotBottom, edge: "precipitation-bottom" },
          { y: windTop, edge: "wind-top" },
          { y: windBottom, edge: "wind-bottom" },
          { y: convectiveTop, edge: "convective-top" },
          { y: convectiveBottom, edge: "convective-bottom" },
        ].map(({ y, edge }) => (
          <line
            key={edge}
            x1={outerLeftX}
            y1={y}
            x2={outerRightX}
            y2={y}
            stroke={separatorStroke}
            strokeWidth={separatorStrokeWidth}
            opacity={separatorOpacity}
            className="chart-separator-line"
            data-testid="chart-area-horizontal-border"
            data-edge={edge}
          />
        ))}

        {[
          { y1: dayHeaderTop, y2: tempBottom, area: "temperature" },
          {
            y1: combinedPlotTop,
            y2: combinedPlotBottom,
            area: "precipitation",
          },
          { y1: windTop, y2: windBottom, area: "wind" },
          { y1: convectiveTop, y2: convectiveBottom, area: "convective" },
        ].map(({ y1, y2, area }) => (
          <line
            key={area}
            x1={outerRightX}
            y1={y1}
            x2={outerRightX}
            y2={y2}
            stroke={separatorStroke}
            strokeWidth={separatorStrokeWidth}
            opacity={separatorOpacity}
            className="chart-separator-line"
            data-testid="outer-right-day-separator-line"
            data-area={area}
          />
        ))}
      </g>

      {/* Terrain/Elevation overlay */}
      {hasDetailedCloud && locElevationKm > 0 && (
        <g className="terrain-mask-group" data-testid="terrain-mask">
          <rect
            x={paddingLeft}
            y={groundY}
            width={graphWidth}
            height={combinedPlotBottom - groundY}
            fill="#f1f5f9"
            opacity="0.8"
          />
          <line
            x1={paddingLeft}
            y1={groundY}
            x2={svgWidth - paddingRight}
            y2={groundY}
            stroke="#64748b"
            strokeWidth="1.2"
            strokeDasharray="3 2"
          />
          <text
            x={svgWidth - paddingRight - 4}
            y={groundY - 3}
            transform={getTextTransform(
              svgWidth - paddingRight - 4,
              groundY - 3,
              textScaleX,
            )}
            fill="#475569"
            fontSize="7.5"
            fontWeight="700"
            textAnchor="end"
            data-testid="terrain-mask-label"
          >
            {locElevationKm.toFixed(1)} km — {locationName || "Local Ground"}
          </text>
        </g>
      )}

      {/* Model Transition Boundary Lines */}
      {modelSegments.slice(1).map((seg, idx) => {
        if (
          seg.startX <= paddingLeft + 1 ||
          seg.startX >= svgWidth - paddingRight - 1
        ) {
          return null;
        }
        return (
          <g key={`model-boundary-${idx}`} className="model-boundary-group">
            <line
              x1={seg.startX}
              y1={modelHeaderBoxBottom}
              x2={seg.startX}
              y2={convectiveBottom}
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              data-testid="model-boundary-line"
              data-timestamp={canonicalTimestamp(
                timeline.xToTimestamp(seg.startX),
              )}
            />
          </g>
        );
      })}
    </>
  );
};
