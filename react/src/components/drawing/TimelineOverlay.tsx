import React from "react";
import { canonicalTimestamp } from "../../utils/timeline";
import { getTextTransform } from "./meteogramLayout";
import { DAY_HEADER_FONT_SIZE } from "./chartGeometry";

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

/** Vertical band of one drawing area (top/bottom in viewBox units). */
export interface OverlayArea {
  name: string;
  top: number;
  bottom: number;
}

export interface TerrainMaskItem {
  groundY: number;
  bottom: number;
  elevationKm: number;
}

export interface TimelineOverlayProps {
  dayGroups: DayGroupRenderItem[];
  noonPositions: NoonPositionItem[];
  modelSegments: ModelSegmentItem[];
  dayHeaderTop: number;
  dayHeaderBottom: number;
  dayHeaderHeight: number;
  /** Drawing areas from top to bottom (at least one). */
  areas: OverlayArea[];
  outerLeftX: number;
  outerRightX: number;
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  modelHeaderBoxBottom: number;
  /** Dashed model boundaries (layout `showModelHeaders`). */
  showModelBoundaries?: boolean;
  /** Day label cells and texts (layout `showDayHeader`). */
  showDayHeader?: boolean;
  terrainMask?: TerrainMaskItem | null;
  graphWidth: number;
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
  areas,
  outerLeftX,
  outerRightX,
  paddingLeft,
  paddingRight,
  svgWidth,
  modelHeaderBoxBottom,
  showModelBoundaries = true,
  showDayHeader = true,
  terrainMask,
  graphWidth,
  timeline,
  separatorStroke = "#cbd5e1",
  separatorStrokeWidth = 1.2,
  separatorOpacity = 1,
  textScaleX = 1,
}) => {
  const firstArea = areas[0];
  const plotBottom = areas[areas.length - 1]?.bottom ?? dayHeaderBottom;
  // The first area joins the day header: its day separators and right edge
  // start at the header top, its tint and noon lines at the header bottom.
  const tintBands = areas.map((area, index) =>
    index === 0
      ? { name: area.name, top: dayHeaderBottom, bottom: area.bottom }
      : area,
  );
  const separatorBands = areas.map((area, index) =>
    index === 0
      ? { name: area.name, top: dayHeaderTop, bottom: area.bottom }
      : area,
  );
  const borders = [
    { y: dayHeaderTop, edge: "date-header-top" },
    ...areas.flatMap((area, index) =>
      index === 0
        ? [{ y: area.bottom, edge: `${area.name}-bottom` }]
        : [
            { y: area.top, edge: `${area.name}-top` },
            { y: area.bottom, edge: `${area.name}-bottom` },
          ],
    ),
  ];

  return (
    <>
      {/* Day Groups, Background alternating tint, and Day Labels */}
      {dayGroups.map((group) => {
        return (
          <g key={group.dayKey} className="day-group-block">
            {group.isEven ? (
              <>
                {tintBands.map((band) => (
                  <rect
                    key={band.name}
                    x={group.firstX}
                    y={band.top}
                    width={group.blockWidth}
                    height={band.bottom - band.top}
                    fill="rgba(0, 0, 0, 0.03)"
                  />
                ))}
              </>
            ) : (
              firstArea && (
                <rect
                  x={group.firstX}
                  y={dayHeaderBottom}
                  width={group.blockWidth}
                  height={firstArea.bottom - dayHeaderBottom}
                  fill="transparent"
                />
              )
            )}

            {showDayHeader && (
              <rect
                x={group.firstX}
                y={dayHeaderTop}
                width={group.blockWidth}
                height={dayHeaderHeight}
                fill="#f1f5f9"
                data-testid="day-label-cell"
              />
            )}

            {/* Day-boundary lines stopping at white separators */}
            {group.isBoundaryVisible && (
              <>
                {separatorBands.map((band) => (
                  <line
                    key={band.name}
                    x1={group.boundaryX}
                    y1={band.top}
                    x2={group.boundaryX}
                    y2={band.bottom}
                    stroke={separatorStroke}
                    strokeWidth={separatorStrokeWidth}
                    opacity={separatorOpacity}
                    className="chart-separator-line"
                    data-testid="day-separator-line"
                  />
                ))}
              </>
            )}

            {showDayHeader && (
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
                      : DAY_HEADER_FONT_SIZE
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
            )}
          </g>
        );
      })}

      {/* Noon Dotted Grid Lines (12:00 local time per day) */}
      {noonPositions.map((noon) => (
        <g key={`noon-grid-${noon.dayKey}`} className="noon-grid-group">
          {tintBands.map((band) => (
            <line
              key={band.name}
              x1={noon.x}
              y1={band.top}
              x2={noon.x}
              y2={band.bottom}
              stroke="#e2e8f0"
              strokeDasharray="2 3"
              className="chart-separator-line"
              data-testid="noon-grid-line"
            />
          ))}
        </g>
      ))}

      {/* Shared grey grid borders */}
      <g className="chart-area-separator-borders">
        {borders.map(({ y, edge }) => (
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

        {separatorBands.map(({ top, bottom, name }) => (
          <line
            key={name}
            x1={outerRightX}
            y1={top}
            x2={outerRightX}
            y2={bottom}
            stroke={separatorStroke}
            strokeWidth={separatorStrokeWidth}
            opacity={separatorOpacity}
            className="chart-separator-line"
            data-testid="outer-right-day-separator-line"
            data-area={name}
          />
        ))}
      </g>

      {/* Terrain/Elevation overlay */}
      {terrainMask && terrainMask.elevationKm > 0 && (
        <g className="terrain-mask-group" data-testid="terrain-mask">
          <rect
            x={paddingLeft}
            y={terrainMask.groundY}
            width={graphWidth}
            height={terrainMask.bottom - terrainMask.groundY}
            fill="#f1f5f9"
            opacity="0.8"
          />
          <line
            x1={paddingLeft}
            y1={terrainMask.groundY}
            x2={svgWidth - paddingRight}
            y2={terrainMask.groundY}
            stroke="#64748b"
            strokeWidth="1.2"
            strokeDasharray="3 2"
          />
          <text
            x={svgWidth - paddingRight - 4}
            y={terrainMask.groundY - 3}
            transform={getTextTransform(
              svgWidth - paddingRight - 4,
              terrainMask.groundY - 3,
              textScaleX,
            )}
            fill="#475569"
            fontSize="7.5"
            fontWeight="700"
            textAnchor="end"
            data-testid="terrain-mask-label"
          >
            {Math.round(terrainMask.elevationKm * 1000)} m
          </text>
        </g>
      )}

      {/* Model Transition Boundary Lines */}
      {showModelBoundaries &&
        modelSegments.slice(1).map((seg, idx) => {
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
                y2={plotBottom}
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
