import React from "react";
import { createPortal } from "react-dom";
import type { DataPoint, Location } from "../../types";

import {
  getCardinalDirection,
  formatTooltipHeaderDate,
  getExtraTooltipQuantities,
} from "./chartTooltip.logic";
import { getQuantity } from "../../quantities/registry";

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
  accumulatedSnowfall?: number | null;
  lpiValue?: number | null;
  /** e.g. "Run 06.10. 08:00 + 144h" for the hovered model value. */
  runInfo?: string | null;
  /** Quantities of the layout; rows of other quantities are left out. */
  quantities?: Set<string>;
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
  accumulatedSnowfall,
  lpiValue,
  runInfo,
  quantities,
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

  const has = (quantity: string) => !quantities || quantities.has(quantity);
  const showTemperature = has("temperature") || has("apparent_temperature");
  const showWind =
    has("wind_speed") || has("wind_gusts") || has("wind_direction");
  const showPrecipitation =
    has("precipitation_probability") || has("precipitation");
  const showConvective =
    has("cape") || has("convective_inhibition") || lpiValue != null;
  const extraQuantities = getExtraTooltipQuantities(quantities);
  // Snow group: in snowfall hours, or wherever snow lies.
  const showSnowfall =
    has("snowfall") && (hoverData["snowfall"]?.value ?? 0) > 0;
  const showSnowDepth =
    has("snow_depth") && (hoverData["snow_depth"]?.value ?? 0) > 0;

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
        {runInfo && (
          <div
            className="tooltip-run-info"
            data-testid="tooltip-run-info"
            style={{ fontWeight: 400, fontSize: "0.85em", opacity: 0.8 }}
          >
            {runInfo}
          </div>
        )}
      </div>
      <div className="tooltip-grid">
        {has("temperature") && (
          <div className="tooltip-row">
            <span className="label">Temperature:</span>
            <span className="val temp">
              {hoverData["temperature"]?.value ?? "-"} °C
            </span>
          </div>
        )}
        {has("apparent_temperature") &&
          hoverData["apparent_temperature"]?.value !== undefined &&
          hoverData["apparent_temperature"]?.value !== null && (
            <div className="tooltip-row">
              <span className="label">Apparent Temp:</span>
              <span className="val temp" style={{ color: "#b45309" }}>
                {hoverData["apparent_temperature"]?.value} °C
              </span>
            </div>
          )}
        {showTemperature && (
          <div className="tooltip-group-divider" data-testid="tooltip-divider-temperature" />
        )}
        {has("wind_speed") && (
          <div className="tooltip-row">
            <span className="label">Wind Speed:</span>
            <span className="val wind">
              {hoverData["wind_speed"]?.value ?? "-"} km/h
            </span>
          </div>
        )}
        {has("wind_gusts") && (
          <div className="tooltip-row">
            <span className="label">Wind Gusts:</span>
            <span className="val gust">
              {hoverData["wind_gusts"]?.value ?? "-"} km/h
            </span>
          </div>
        )}
        {has("wind_direction") && (
          <div className="tooltip-row">
            <span className="label">Direction:</span>
            <span className="val dir">
              {getCardinalDirection(hoverData["wind_direction"]?.value ?? null)}
            </span>
          </div>
        )}
        {showWind && (
          <div className="tooltip-group-divider" data-testid="tooltip-divider-wind" />
        )}
        {has("precipitation_probability") && (
          <div className="tooltip-row">
            <span className="label">Precip. Prob:</span>
            <span className="val prob">
              {hoverData["precipitation_probability"]?.value ?? "-"} %
            </span>
          </div>
        )}
        {has("precipitation") && (
          <div className="tooltip-row">
            <span className="label">Precipitation:</span>
            <span className="val precip">
              {hoverData["precipitation"]?.value ?? "-"} mm
            </span>
          </div>
        )}
        {has("precipitation") && accumulatedPrecip !== null && (
          <div className="tooltip-row" data-testid="accumulated-precip-row">
            <span className="label">Accumulated:</span>
            <span className="val precip" data-testid="accumulated-precip-val">
              {parseFloat(accumulatedPrecip.toFixed(2))} mm
            </span>
          </div>
        )}
        {showPrecipitation && (
          <div className="tooltip-group-divider" data-testid="tooltip-divider-precipitation" />
        )}
        {(showSnowfall || showSnowDepth) && (
          <>
            {showSnowfall && (
              <div className="tooltip-row" data-testid="snowfall-row">
                <span className="label">Snowfall:</span>
                <span className="val">{hoverData["snowfall"].value} cm</span>
              </div>
            )}
            {has("snow_depth") && hoverData["snow_depth"]?.value != null && (
              <div className="tooltip-row" data-testid="snow-depth-row">
                <span className="label">Snow depth:</span>
                <span className="val">{hoverData["snow_depth"].value} m</span>
              </div>
            )}
            {accumulatedSnowfall != null && (
              <div className="tooltip-row" data-testid="accumulated-snowfall-row">
                <span className="label">Accumulated Snowfall:</span>
                <span className="val" data-testid="accumulated-snowfall-val">
                  {parseFloat(accumulatedSnowfall.toFixed(2))} cm
                </span>
              </div>
            )}
            <div className="tooltip-group-divider" data-testid="tooltip-divider-snow" />
          </>
        )}
        {(["cape", "convective_inhibition"] as const).filter(has).map((variable) => (
          <div className="tooltip-row" key={variable}>
            <span className="label">
              {variable === "cape" ? "CAPE:" : "CIN:"}
            </span>
            <span
              className={`val ${variable === "cape" ? "cape" : "cin"}`}
              data-testid={`tooltip-val-${variable}`}
            >
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
        {showConvective && extraQuantities.length > 0 && (
          <div className="tooltip-group-divider" data-testid="tooltip-divider-convective" />
        )}
        {extraQuantities.map((quantity) => {
          const definition = getQuantity(quantity);
          const value = hoverData[quantity]?.value;
          return (
            <div
              className="tooltip-row"
              key={quantity}
              data-testid={`tooltip-row-${quantity}`}
            >
              <span className="label">{definition?.label ?? quantity}:</span>
              <span className="val">
                {value ?? "-"} {definition?.unit ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
};
