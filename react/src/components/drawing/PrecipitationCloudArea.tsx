import React from "react";
import type { VerticalCloudLevel, VerticalCloudProfile } from "../../types";
import { CloudLightning, CloudHail } from "lucide-react";
import { canonicalTimestamp } from "../../utils/timeline";
import type { MeteogramLayout, MeteogramRenderMode } from "../MeteogramChart";
import { getTextTransform } from "./meteogramLayout";
import type { IconSlot } from "../../utils/thunderstormIcons";
import { DrawingArea } from "./DrawingArea";
import {
  calculateCloudCellGeometry,
  calculatePrecipBarGeometry,
} from "./precipitationCloudArea.logic";

export type ThunderstormIcon = IconSlot & { code: number };

export interface CloudTransitionX {
  x: number;
  timestampMs: number;
  to_model: string;
}

export interface PrecipitationCloudAreaProps {
  paddingLeft: number;
  paddingRight: number;
  svgWidth: number;
  combinedPlotTop: number;
  combinedPlotHeight: number;
  combinedPlotBottom: number;
  hasDetailedCloud: boolean;
  maxAltitudeKm: number;
  combinedClipId: string;
  probabilityClipId: string;
  timestamps: number[];
  timeline: {
    intervalToGeometry: (ts: number) => { x: number; width: number } | null;
    xToTimestamp: (x: number) => number;
  };
  vcloudMap: Map<number, VerticalCloudProfile>;
  getAltitudeY: (altKm: number) => number;
  draggedCloudX: number | null;
  cloudTransitionXs: CloudTransitionX[];
  precipValues: (number | null)[];
  precipAxisMax: number;
  precipitationProbabilityPath: string;
  thunderstormIcons: ThunderstormIcon[];
  layout: MeteogramLayout;
  instance: MeteogramRenderMode;
  getX: (ts: number) => number;
}

export const PrecipitationCloudArea: React.FC<PrecipitationCloudAreaProps> = ({
  paddingLeft,
  paddingRight,
  svgWidth,
  combinedPlotTop,
  combinedPlotHeight,
  combinedPlotBottom,
  hasDetailedCloud,
  maxAltitudeKm,
  combinedClipId,
  probabilityClipId,
  timestamps,
  timeline,
  vcloudMap,
  getAltitudeY,
  draggedCloudX,
  cloudTransitionXs,
  precipValues,
  precipAxisMax,
  precipitationProbabilityPath,
  thunderstormIcons,
  layout,
  instance,
  getX,
}) => {
  return (
    <g
      className="panel panel-combined-precip-clouds"
      data-testid="panel-combined-precip-clouds"
    >
      {/* LAYER 1 (BACKGROUND): DETAILED VERTICAL CLOUD PROFILE */}
      {hasDetailedCloud && (
        <DrawingArea
          className="cloud-profile-layer"
          testId="cloud-profile-layer"
          clipId={combinedClipId}
          bounds={{
            top: combinedPlotTop,
            height: combinedPlotHeight,
            left: paddingLeft,
            width: svgWidth - paddingLeft - paddingRight,
          }}
        >
          {[12, 9, 6, 3, 0].map((altKm) => {
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
            const geometry = timeline.intervalToGeometry(ts);
            if (!geometry) return null;
            const { x, width: cellWidth } = geometry;
            const profile = vcloudMap.get(ts);

            if (!profile || !profile.levels || profile.levels.length === 0) {
              return (
                <rect
                  key={`vcloud-missing-${idx}`}
                  x={x}
                  y={combinedPlotTop + 10}
                  width={cellWidth}
                  height={combinedPlotHeight - 10}
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

                  const { y, height, opacity } = calculateCloudCellGeometry(
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
                      height={height}
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
          clipPath={`url(#${combinedClipId})`}
        >
          <line
            x1={draggedCloudX}
            y1={combinedPlotTop}
            x2={draggedCloudX}
            y2={combinedPlotBottom}
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
          y1={combinedPlotTop}
          x2={transition.x}
          y2={combinedPlotBottom}
          stroke="#8b5cf6"
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity="0.7"
          clipPath={`url(#${combinedClipId})`}
          data-testid="cloud-model-boundary-line"
          data-timestamp={canonicalTimestamp(transition.timestampMs)}
        />
      ))}

      {/* LAYER 2 (MIDDLE): PRECIPITATION COLUMNS */}
      <g
        className="precipitation-bars-layer"
        data-testid="precipitation-bars-layer"
        clipPath={`url(#${combinedClipId})`}
      >
        {precipValues.map((val, idx) => {
          if (val === null || val <= 0) return null;
          const geometry = timeline.intervalToGeometry(timestamps[idx]);
          if (!geometry) return null;
          const { x, width: barWidth } = geometry;
          const { y, height: barHeight } = calculatePrecipBarGeometry(
            val,
            precipAxisMax,
            combinedPlotBottom,
            combinedPlotHeight,
          );

          return (
            <rect
              key={`precip-bar-${idx}`}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill="#2563eb"
              opacity="0.85"
              data-testid="precip-bar"
              data-timestamp={canonicalTimestamp(timestamps[idx])}
            />
          );
        })}
      </g>

      {/* LAYER 3 (FOREGROUND): PRECIPITATION PROBABILITY */}
      <g
        className="precipitation-probability-layer"
        data-testid="precipitation-probability-layer"
        clipPath={`url(#${probabilityClipId})`}
      >
        <path
          d={precipitationProbabilityPath}
          fill="none"
          stroke="#7c3aed"
          strokeWidth="1.2"
          clipPath={`url(#${probabilityClipId})`}
          data-testid="precip-probability-path"
          data-scale-top={combinedPlotTop}
          data-scale-bottom={combinedPlotBottom}
        />
      </g>

      <g
        data-testid="thunderstorm-layer"
        pointerEvents="none"
        clipPath={`url(#${probabilityClipId})`}
      >
        {thunderstormIcons.map((icon) => (
          <g
            key={icon.id}
            data-testid="thunderstorm-icon"
            data-weather-code={icon.code}
            data-interval-start={canonicalTimestamp(icon.start)}
            data-interval-end={canonicalTimestamp(icon.end)}
            data-center-x={getX(icon.center)}
            data-render-mode={instance}
            transform={`translate(${getX(icon.center)}, ${combinedPlotTop + 11 * layout.windIconScaleY})`}
          >
            <g
              transform={`scale(${layout.windIconScaleX} ${layout.windIconScaleY})`}
            >
              <circle r="8" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.6" />
              <CloudLightning
                x={-7}
                y={-7}
                width={14}
                height={14}
                color="#7c3aed"
                strokeWidth={1.8}
              />
              {icon.code !== 95 && (
                <CloudHail
                  x={-7}
                  y={-7}
                  width={14}
                  height={14}
                  color="#7c3aed"
                  strokeWidth={icon.code === 99 ? 2.4 : 1.4}
                />
              )}
            </g>
          </g>
        ))}
      </g>

      {/* LAYER 4 (AXES & LABELS) */}
      {/* Precipitation Scale on Left */}
      <text
        x={paddingLeft - 8}
        y={combinedPlotTop + 14}
        transform={getTextTransform(
          paddingLeft - 8,
          combinedPlotTop + 14,
          layout.textScaleX,
        )}
        fill="#334155"
        fontSize="9"
        textAnchor="end"
      >
        {precipAxisMax < 1
          ? precipAxisMax.toFixed(2)
          : precipAxisMax.toFixed(1)}{" "}
        mm
      </text>
      <text
        x={paddingLeft - 8}
        y={combinedPlotBottom - 2}
        transform={getTextTransform(
          paddingLeft - 8,
          combinedPlotBottom - 2,
          layout.textScaleX,
        )}
        fill="#334155"
        fontSize="9"
        textAnchor="end"
      >
        0 mm
      </text>

      {/* Cloud Altitude Scale on Right (only when detailed clouds exist) */}
      {hasDetailedCloud &&
        [12, 9, 6, 3, 0].map((altKm) => {
          const y = getAltitudeY(altKm);
          return (
            <text
              key={`vcloud-alt-label-${altKm}`}
              x={svgWidth - paddingRight + 8}
              y={y + 3}
              transform={getTextTransform(
                svgWidth - paddingRight + 8,
                y + 3,
                layout.textScaleX,
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
    </g>
  );
};
