// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Geometry calculations for the vertical cloud profile background.
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

/** Altitude (km ASL) to y inside an area, 10 units headroom at the top. */
export function getCloudAltitudeY(
  geometry: { top: number; height: number },
  maxAltitudeKm: number,
  altKm: number,
): number {
  const usableHeight = geometry.height - 10;
  const clampedAlt = Math.max(0, Math.min(maxAltitudeKm, altKm));
  return (
    geometry.top +
    geometry.height -
    (clampedAlt / maxAltitudeKm) * usableHeight
  );
}
