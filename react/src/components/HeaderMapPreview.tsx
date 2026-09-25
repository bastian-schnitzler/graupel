import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Location } from "../types";
import { loadMaptoolkit } from "../maps/maptoolkit";
import {
  createHeaderMapOptions,
  updateHeaderMapCenter,
} from "./HeaderMapPreview.logic";

export function HeaderMapPreview({
  location,
  onOpen,
}: {
  location: Location;
  onOpen: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const latest = useRef({ location, onOpen });
  latest.current = { location, onOpen };
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let map: maplibregl.Map | undefined;
    let marker: maplibregl.Marker | undefined;
    let alive = true;
    try {
      const initial = latest.current.location;
      map = new maplibregl.Map(
        createHeaderMapOptions(container.current!, initial),
      );
      map.on("click", (event) => {
        event.originalEvent.stopPropagation();
        latest.current.onOpen();
      });
      map.on("load", () => {
        if (alive) setError(null);
      });
      map.on("error", () => {
        if (alive) setError("Map could not be loaded.");
      });
      loadMaptoolkit(map);
      marker = new maplibregl.Marker({ color: "#c026d3" })
        .setLngLat([initial.longitude, initial.latitude])
        .addTo(map);
      mapRef.current = map;
      markerRef.current = marker;
    } catch {
      setError("Map could not be initialized. WebGL is required.");
    }
    return () => {
      alive = false;
      marker?.remove();
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    updateHeaderMapCenter(
      mapRef.current,
      markerRef.current,
      location,
      latest.current.location.elevation,
    );
  }, [location.latitude, location.longitude]);

  return (
    <div className="header-map-preview">
      <div ref={container} className="header-maplibre-map" />
      {error && (
        <div className="header-map-status" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
