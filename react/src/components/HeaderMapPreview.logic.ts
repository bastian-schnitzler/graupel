import type { MapOptions } from "maplibre-gl";
import type { Location } from "../types";
import { defaultMapZoom } from "../maps/defaultZoom";
import { MAP_ATTRIBUTION_OPTIONS } from "../maps/maptoolkit";

export function createHeaderMapOptions(
  container: HTMLElement,
  initial: Location,
): MapOptions {
  return {
    container,
    center: [initial.longitude, initial.latitude],
    zoom: defaultMapZoom(8, initial.elevation),
    interactive: false,
    attributionControl: MAP_ATTRIBUTION_OPTIONS,
  };
}

export function updateHeaderMapCenter(
  map: {
    jumpTo: (options: { center: [number, number]; zoom: number }) => void;
  } | null,
  marker: { setLngLat: (coords: [number, number]) => void } | null,
  location: Location,
  elevation?: number,
) {
  map?.jumpTo({
    center: [location.longitude, location.latitude],
    zoom: defaultMapZoom(8, elevation),
  });
  marker?.setLngLat([location.longitude, location.latitude]);
}
