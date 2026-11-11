// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Place } from "../../../config/index.ts";

/**
 * What a map shows (REQ-659): its centre and zoom, the zoom in MapLibre levels (512 px tiles; Leaflet's 256 px tiles are
 * one level more for the same view). The other map takes it over when the user switches maps.
 */
export interface MapViewport {
  lat: number;
  lon: number;
  zoom: number;
}

/** Props of the lazily loaded map views. */
export interface MapViewProps {
  /** Place the map centres on and marks; a new place (a new object) moves the map and the marker there (REQ-641). */
  place: Place;
  /**
   * Centre and zoom the map opens with instead of the place's (REQ-659: those of the other map before the switch). Read
   * once, when the map is made.
   */
  viewport?: MapViewport | null;
  /** Where the marker starts when not on the place (REQ-659: a point picked in the other map). Read once. */
  marker?: Place;
  /** The map was moved or zoomed; the new centre and zoom (REQ-659). */
  onViewportChange?: (viewport: MapViewport) => void;
  /** A place was picked (single click); only maps that allow picking call it. */
  onSelect?: (place: Place) => void;
  /** A place was picked and confirmed at once (double click). */
  onConfirm?: (place: Place) => void;
  /**
   * The map does not load (REQ-771, `watchMapLoad`): it could not be created, its style (Maptoolkit) or all its first
   * tiles (OpenTopoMap) failed to load, or it has not loaded by the deadline. Single failing tiles do not count.
   */
  onError?: () => void;
  /** The map has loaded; an error reported before is over (REQ-771). */
  onLoad?: () => void;
}

// MapLibre zoom levels are logarithmic; mountains get a closer view.
export const HIGH_ELEVATION_ZOOM_DELTA = 4;
export function defaultMapZoom(baseZoom: number, elevation?: number | null): number {
  return (
    baseZoom + (elevation != null && Number.isFinite(elevation) && elevation > 1000 ? HIGH_ELEVATION_ZOOM_DELTA : 0)
  );
}
