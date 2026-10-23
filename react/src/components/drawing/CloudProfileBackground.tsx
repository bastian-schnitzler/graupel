import React from "react";
import type { VerticalCloudLevel } from "../../types";
import type { ResolvedBackground } from "../../layouts/types";
import { canonicalTimestamp } from "../../utils/timeline";
import { DrawingArea } from "./DrawingArea";
import type { AreaGeometry } from "./chartGeometry";
import type { ChartAreaContext } from "./ChartArea";
import { getTextTransform } from "./meteogramLayout";
import {
  calculateCloudCellGeometry,
  getCloudAltitudeY,
} from "./cloudProfile.logic";

export interface CloudTransitionX {
  x: number;
  timestampMs: number;
  to_model: string;
}

const ALTITUDE_STEPS_KM = [12, 9, 6, 3, 0];

export interface CloudProfileBackgroundProps {
  geometry: AreaGeometry;
  background: ResolvedBackground;
  /** Profiles exist; without them only the cloud-chain markers are drawn. */
  hasData: boolean;
  context: ChartAreaContext;
  clipId: string;
}

/**
 * Vertical cloud profile behind an area's series, with the cloud-chain
 * boundary markers and the altitude scale on the right.
 */
export const CloudProfileBackground: React.FC<CloudProfileBackgroundProps> = ({
  geometry,
  background,
  hasData,
  context,
  clipId,
}) => {
  const { top, height, bottom } = geometry;
  const { maxAltitudeKm } = background;
  const {
    paddingLeft,
    paddingRight,
    svgWidth,
    timestamps,
    timeline,
    vcloudMap,
    draggedCloudX,
    cloudTransitionXs,
  } = context;
  const getAltitudeY = (altKm: number) =>
    getCloudAltitudeY(geometry, maxAltitudeKm, altKm);
  const altitudeSteps = ALTITUDE_STEPS_KM.filter((km) => km <= maxAltitudeKm);

  return (
    <>
      {hasData &&
        background.altitudeLabels &&
        altitudeSteps.map((altKm) => {
          const y = getAltitudeY(altKm);
          return (
            <text
              key={`vcloud-alt-label-${altKm}`}
              x={svgWidth - paddingRight + 8}
              y={y + 3}
              transform={getTextTransform(
                svgWidth - paddingRight + 8,
                y + 3,
                context.pixelLayout.textScaleX,
              )}
              fill="#64748b"
              fontSize="8"
              textAnchor="start"
              data-testid={`cloud-altitude-label-${altKm}`}
            >
              {altKm} km
            </text>
          );
        })}

      {hasData && (
      <DrawingArea
        className="cloud-profile-layer"
        testId="cloud-profile-layer"
        clipId={clipId}
        bounds={{
          top,
          height,
          left: paddingLeft,
          width: svgWidth - paddingLeft - paddingRight,
        }}
      >
        {altitudeSteps.map((altKm) => {
          const y = getAltitudeY(altKm);
          return (
            <line
              key={`vcloud-alt-line-${altKm}`}
              x1={paddingLeft}
              y1={y}
              x2={svgWidth - paddingRight}
              y2={y}
              stroke="#f1f5f9"
              strokeDasharray="2 3"
            />
          );
        })}

        {timestamps.map((ts, idx) => {
          const cell = timeline.intervalToGeometry(ts);
          if (!cell) return null;
          const { x, width: cellWidth } = cell;
          const profile = vcloudMap.get(ts);

          if (!profile || !profile.levels || profile.levels.length === 0) {
            return (
              <rect
                key={`vcloud-missing-${idx}`}
                x={x}
                y={top + 10}
                width={cellWidth}
                height={height - 10}
                fill="#f8fafc"
                opacity="0.5"
              />
            );
          }

          const levels: VerticalCloudLevel[] = profile.levels || [];
          return (
            <g key={`vcloud-col-${idx}`}>
              {levels.map((lvl: VerticalCloudLevel, lIdx: number) => {
                const cc = lvl.cloud_cover_percent;
                if (cc === null || cc === undefined || cc <= 0) return null;

                const altM = lvl.altitude_m_asl ?? 0;
                const altKm = altM / 1000.0;
                if (altKm > maxAltitudeKm) return null;

                const nextLvl = levels[lIdx + 1];
                const nextAltKm = nextLvl?.altitude_m_asl
                  ? nextLvl.altitude_m_asl / 1000.0
                  : altKm + 0.6;

                const { y, height: cellHeight, opacity } =
                  calculateCloudCellGeometry(
                    cc,
                    altKm,
                    nextAltKm,
                    maxAltitudeKm,
                    getAltitudeY,
                  );

                return (
                  <rect
                    key={`vcloud-cell-${idx}-${lIdx}`}
                    x={x}
                    y={y}
                    width={cellWidth}
                    height={cellHeight}
                    fill="#334155"
                    opacity={opacity}
                    data-testid="vertical-cloud-cell"
                    data-timestamp={canonicalTimestamp(ts)}
                    data-cloud-cover={cc}
                  />
                );
              })}
            </g>
          );
        })}
      </DrawingArea>
      )}

      {/* INTERACTIVE DRAG INDICATOR: CLOUD MODEL BOUNDARY */}
      {draggedCloudX !== null && (
        <g
          className="vcloud-drag-boundary-indicator"
          data-testid="vcloud-drag-boundary-indicator"
          clipPath={`url(#${clipId})`}
        >
          <line
            x1={draggedCloudX}
            y1={top}
            x2={draggedCloudX}
            y2={bottom}
            stroke="#8b5cf6"
            strokeWidth="1.5"
            strokeDasharray="2 2"
            data-testid="cloud-boundary-drag-line"
            data-timestamp={canonicalTimestamp(
              timeline.xToTimestamp(draggedCloudX),
            )}
          />
        </g>
      )}

      {cloudTransitionXs.map((transition) => (
        <line
          key={`cloud-transition-${transition.timestampMs}-${transition.to_model}`}
          x1={transition.x}
          y1={top}
          x2={transition.x}
          y2={bottom}
          stroke="#8b5cf6"
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity="0.7"
          clipPath={`url(#${clipId})`}
          data-testid="cloud-model-boundary-line"
          data-timestamp={canonicalTimestamp(transition.timestampMs)}
        />
      ))}
    </>
  );
};
