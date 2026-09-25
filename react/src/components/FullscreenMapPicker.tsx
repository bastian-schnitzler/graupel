import { defaultMapZoom } from "../maps/defaultZoom";
import { useEffect, useRef, useState } from "react";
import maplibregl, {
  type MapGeoJSONFeature,
  type SymbolLayerSpecification,
  type MapMouseEvent,
} from "maplibre-gl";
import {
  loadMaptoolkit,
  MAP_ATTRIBUTION_OPTIONS,
  handleMapAttributionClick,
} from "../maps/maptoolkit";
export { MAPTOOLKIT_STYLE } from "../maps/maptoolkit";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Location } from "../types";
import { apiService } from "../services/apiService";
import {
  sources,
  featureLocation,
  highlightedPaint,
  buildCustomLocation,
  getFeatureKey,
  applyLayerHighlights,
} from "./FullscreenMapPicker.logic";

export { featureLocation, highlightedPaint };

export function FullscreenMapPicker({
  initialLocation,
  onAccept,
  onCancel,
}: {
  initialLocation: Location;
  onAccept: (l: Location) => void;
  onCancel: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pending = useRef({ ...initialLocation });
  const callbacks = useRef({ onAccept });
  callbacks.current = { onAccept };
  const acceptRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  useEffect(() => {
    let alive = true,
      revision = 0,
      acceptToken = 0;
    let selected: MapGeoJSONFeature | null = null,
      hovered: MapGeoJSONFeature | null = null;
    let layers: SymbolLayerSpecification[] = [];
    let map: maplibregl.Map | undefined, marker: maplibregl.Marker | undefined;
    const accept = async () => {
      const token = ++acceptToken;
      setAccepting(true);
      const version = revision,
        candidate = { ...pending.current };
      if (candidate.elevation == null) {
        try {
          candidate.elevation = await apiService.getElevationForCoords(
            candidate.latitude,
            candidate.longitude,
          );
        } catch {
          /* Leave missing height unavailable. */
        }
      }
      if (!alive || token !== acceptToken) return;
      setAccepting(false);
      if (version === revision) callbacks.current.onAccept(candidate);
    };
    acceptRef.current = () => {
      void accept();
    };
    try {
      map = new maplibregl.Map({
        container: container.current!,
        center: [initialLocation.longitude, initialLocation.latitude],
        zoom: defaultMapZoom(10, initialLocation.elevation),
        doubleClickZoom: false,
        attributionControl: MAP_ATTRIBUTION_OPTIONS,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      loadMaptoolkit(map);
      marker = new maplibregl.Marker({ color: "#c026d3" })
        .setLngLat([initialLocation.longitude, initialLocation.latitude])
        .addTo(map);
      const highlight = () => {
        if (map) applyLayerHighlights(map, layers, selected, hovered);
      };
      map.on("load", () => {
        layers = (map!.getStyle().layers ?? []).filter(
          (l): l is SymbolLayerSpecification =>
            l.type === "symbol" &&
            !!l.layout?.["text-field"] &&
            sources.has(l["source-layer"] ?? ""),
        );
        if (alive) setStatus(null);
      });
      const hit = (e: MapMouseEvent) =>
        layers.length
          ? (map!
              .queryRenderedFeatures(e.point, {
                layers: layers.map((l) => l.id),
              })
              .find((f) => featureLocation(f)) ?? null)
          : null;
      const choose = (e: MapMouseEvent) => {
        selected = hit(e);
        hovered = selected;
        pending.current =
          (selected && featureLocation(selected)) ||
          buildCustomLocation(e.lngLat);
        revision++;
        marker!.setLngLat([
          pending.current.longitude,
          pending.current.latitude,
        ]);
        highlight();
      };
      map.on("mousemove", (e) => {
        const next = hit(e);
        if (getFeatureKey(next) === getFeatureKey(hovered)) return;
        hovered = next;
        map!.getCanvas().style.cursor = hovered ? "pointer" : "";
        highlight();
      });
      map.on("mouseout", () => {
        hovered = null;
        map!.getCanvas().style.cursor = "";
        highlight();
      });
      map.on("click", choose);
      map.on("dblclick", (e) => {
        e.preventDefault();
        choose(e);
        void accept();
      });
      map.on("error", () => {
        if (alive) setStatus("Map could not be loaded. Check your connection.");
      });
    } catch {
      setStatus("Map could not be initialized. WebGL is required.");
    }
    return () => {
      alive = false;
      marker?.remove();
      map?.remove();
    };
  }, [initialLocation]);
  return (
    <div
      className="fullscreen-map-picker"
      onClickCapture={handleMapAttributionClick}
    >
      <div ref={container} className="fullscreen-maplibre-map" />
      {status && (
        <div className="fullscreen-map-status" role="status">
          {status}
        </div>
      )}
      <div className="fullscreen-map-actions">
        <button
          type="button"
          className="fullscreen-map-btn fullscreen-map-btn-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="fullscreen-map-btn fullscreen-map-btn-ok"
          disabled={accepting}
          onClick={() => acceptRef.current()}
        >
          OK
        </button>
      </div>
    </div>
  );
}
