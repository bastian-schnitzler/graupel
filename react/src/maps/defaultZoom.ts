// MapLibre zoom levels are logarithmic. Apply once when establishing a view.
export const HIGH_ELEVATION_ZOOM_DELTA = 4;
export function defaultMapZoom(baseZoom: number, elevation?: number | null): number {
  return baseZoom + (elevation != null && Number.isFinite(elevation) && elevation > 1000
    ? HIGH_ELEVATION_ZOOM_DELTA : 0);
}
