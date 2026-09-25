import React from "react";
import { createPortal } from "react-dom";
import type { DataPoint, Location } from "../../types";

import {
  getCardinalDirection,
  formatTooltipHeaderDate,
} from "./chartTooltip.logic";

export { getCardinalDirection };

export interface ChartTooltipProps {
  isFullscreen: boolean;
  isFullscreenMapOpen?: boolean;
  hoverData?: Record<string, DataPoint> | null;
  hoverX: number | null;
  hoverDateObj: Date | null;
  hoverDateParts: { hour: string; minute: string } | null;
  popupPos: { top: number; left: number } | null;
  popupRef: React.RefObject<HTMLDivElement | null>;
  hoverTimestamp: number | null;
  location?: Location;
  userTimezone?: string;
  accumulatedPrecip: number | null;
  lpiValue?: number | null;
}

export const ChartTooltip: React.FC<ChartTooltipProps> = ({
  isFullscreen,
  isFullscreenMapOpen = false,
  hoverData,
  hoverX,
  hoverDateObj,
  hoverDateParts,
  popupPos,
  popupRef,
  hoverTimestamp,
  location,
  userTimezone,
  accumulatedPrecip,
  lpiValue,
}) => {
  if (
    isFullscreen ||
    isFullscreenMapOpen ||
    !hoverData ||
    hoverX === null ||
    !hoverDateObj ||
    !hoverDateParts ||
    !popupPos ||
    !hoverTimestamp
  ) {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      className="hover-unified-tooltip"
      style={{
        position: "fixed",
        top: `${popupPos.top}px`,
        left: `${popupPos.left}px`,
        zIndex: 9999,
        transform: "none",
        margin: 0,
      }}
    >
      <div className="tooltip-header">
        <strong>
          {formatTooltipHeaderDate(hoverDateObj, userTimezone || location)} —{" "}
          {hoverDateParts.hour}:{hoverDateParts.minute}
        </strong>
      </div>

      <div className="tooltip-section-title">
        {hoverData["temperature"]?.model ||
          hoverData["wind_speed"]?.model ||
          "N/A"}
      </div>
      <div className="tooltip-grid">
        <div className="tooltip-row">
          <span className="label">Temperature:</span>
          <span className="val temp">
            {hoverData["temperature"]?.value ?? "-"} °C
          </span>
        </div>
        {hoverData["apparent_temperature"]?.value !== undefined &&
          hoverData["apparent_temperature"]?.value !== null && (
            <div className="tooltip-row">
              <span className="label">Apparent Temp:</span>
              <span className="val temp" style={{ color: "#b45309" }}>
                {hoverData["apparent_temperature"]?.value} °C
              </span>
            </div>
          )}
        <div className="tooltip-row">
          <span className="label">Wind Speed:</span>
          <span className="val wind">
            {hoverData["wind_speed"]?.value ?? "-"} km/h
          </span>
        </div>
        <div className="tooltip-row">
          <span className="label">Wind Gusts:</span>
          <span className="val gust">
            {hoverData["wind_gusts"]?.value ?? "-"} km/h
          </span>
        </div>
        <div className="tooltip-row">
          <span className="label">Direction:</span>
          <span className="val dir">
            {getCardinalDirection(hoverData["wind_direction"]?.value ?? null)}
          </span>
        </div>
        <div className="tooltip-row">
          <span className="label">Precip. Prob:</span>
          <span className="val prob">
            {hoverData["precipitation_probability"]?.value ?? "-"} %
          </span>
        </div>
        <div className="tooltip-row">
          <span className="label">Precipitation:</span>
          <span className="val precip">
            {hoverData["precipitation"]?.value ?? "-"} mm
          </span>
        </div>
        {(["cape", "convective_inhibition"] as const).map((variable) => (
          <div className="tooltip-row" key={variable}>
            <span className="label">
              {variable === "cape" ? "CAPE:" : "CIN:"}
            </span>
            <span className="val">
              {hoverData[variable]?.value != null
                ? variable === "cape"
                  ? hoverData[variable].value
                  : -Math.abs(hoverData[variable].value!)
                : "—"}{" "}
              J/kg
            </span>
          </div>
        ))}
        {lpiValue != null && (
          <div className="tooltip-row" data-testid="tooltip-lpi">
            <span className="label">LPI:</span>
            <span className="val">{lpiValue} J/kg</span>
          </div>
        )}
        {accumulatedPrecip !== null && (
          <div className="tooltip-row" data-testid="accumulated-precip-row">
            <span className="label">Accumulated:</span>
            <span className="val precip" data-testid="accumulated-precip-val">
              {parseFloat(accumulatedPrecip.toFixed(2))} mm
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
