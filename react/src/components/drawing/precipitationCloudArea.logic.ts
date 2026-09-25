/**
 * Companion logic and geometry calculations for PrecipitationCloudArea.
 */

export interface CloudCellGeometry {
  y: number;
  height: number;
  opacity: number;
}

/**
 * Calculates SVG vertical position, cell height, and opacity for a vertical cloud level.
 */
export function calculateCloudCellGeometry(
  cloudCoverPercent: number,
  altKm: number,
  nextAltKm: number,
  maxAltitudeKm: number,
  getAltitudeY: (altKm: number) => number,
): CloudCellGeometry {
  const topKm = Math.min(maxAltitudeKm, Math.max(altKm, nextAltKm));
  const bottomY = getAltitudeY(altKm);
  const topY = getAltitudeY(topKm);
  const height = Math.max(1.5, Math.abs(bottomY - topY));
  const y = Math.min(topY, bottomY);
  const opacity = Math.min(0.95, Math.max(0.1, cloudCoverPercent / 100.0));
  return { y, height, opacity };
}

export interface PrecipBarGeometry {
  y: number;
  height: number;
}

/**
 * Calculates SVG vertical position and bar height for an hourly precipitation column.
 */
export function calculatePrecipBarGeometry(
  value: number,
  precipAxisMax: number,
  combinedPlotBottom: number,
  combinedPlotHeight: number,
): PrecipBarGeometry {
  const usableHeight = combinedPlotHeight - 10;
  const height = Math.max(1.5, (value / precipAxisMax) * usableHeight);
  const y = combinedPlotBottom - height;
  return { y, height };
}
