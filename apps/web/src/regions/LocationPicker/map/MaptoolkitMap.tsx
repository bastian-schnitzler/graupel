// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Maptoolkit hiking map with MapLibre (DEC-022): click a label or any point to pick it, double click to
 * pick and confirm. Loaded lazily when the map opens. The map always
 * points north (REQ-511): no rotation or tilt by mouse, touch or keyboard, and no compass button. A new `place` moves
 * the map and the marker there (REQ-641). After a switch from OpenTopoMap it opens with that map's centre, zoom and
 * marker (REQ-659). Only a map that does not load reports an error (REQ-771, `watchMapLoad`): no WebGL, no style, or no
 * complete first picture by the deadline; a single tile, glyph or sprite that fails does not.
 */
import { MaptoolkitLogoControl } from "@maptoolkit/maplibre-gl-logo";
import maplibregl, {
  type ErrorEvent,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
  type SymbolLayerSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Place } from "../../../config/index.ts";
import { watchMapLoad } from "./loadWatch.ts";
import {
  MAPTOOLKIT_STYLE,
  MAP_ATTRIBUTION_OPTIONS,
  PICK_SOURCES,
  applyLayerHighlights,
  enlargeMapLabels,
  featureKey,
  featurePlace,
  maptoolkitRequest,
  pointPlace,
  takeMaptoolkitStyle,
} from "./maptoolkitStyle.ts";
import { defaultMapZoom, type MapViewProps } from "./types.ts";

export default function MaptoolkitMap({
  place,
  viewport,
  marker: startMarker,
  onSelect,
  onConfirm,
  onError,
  onLoad,
  onViewportChange,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onConfirm, onError, onLoad, onViewportChange });
  useEffect(() => {
    callbacks.current = { onSelect, onConfirm, onError, onLoad, onViewportChange };
  });

  // The map is made once, at the place it shows; a new place moves it there (REQ-641). After a switch of maps it starts
  // with the other map's centre, zoom and marker (REQ-659).
  const shownPlace = useRef(place);
  const start = useRef({ viewport, marker: startMarker ?? place });
  const moveTo = useRef<((target: Place) => void) | null>(null);
  useEffect(() => {
    const { lat, lon, elevation } = shownPlace.current;
    const { viewport: view, marker: markerPlace } = start.current;
    let alive = true;
    let selected: MapGeoJSONFeature | null = null;
    let hovered: MapGeoJSONFeature | null = null;
    let layers: SymbolLayerSpecification[] = [];
    let map: maplibregl.Map | undefined;
    let marker: maplibregl.Marker | undefined;
    const watch = watchMapLoad({
      onError: () => callbacks.current.onError?.(),
      onLoad: () => callbacks.current.onLoad?.(),
    });
    try {
      const m = new maplibregl.Map({
        container: container.current!,
        center: view ? [view.lon, view.lat] : [lon, lat],
        zoom: view ? view.zoom : defaultMapZoom(10, elevation),
        doubleClickZoom: false,
        // North up, flat (REQ-511): no rotating or tilting; pinch zoom stays.
        bearing: 0,
        pitch: 0,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        rollEnabled: false,
        attributionControl: MAP_ATTRIBUTION_OPTIONS,
        // The page's domain as Referer on every Maptoolkit request (REQ-698).
        transformRequest: maptoolkitRequest,
      });
      map = m;
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      m.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
      // The style may have started loading with the library (REQ-771); should that fail, MapLibre tries once more.
      const applyStyle = (style: string | StyleSpecification) => {
        if (alive) m.setStyle(style, { transformStyle: (_previous, next) => enlargeMapLabels(next) });
      };
      const prefetched = takeMaptoolkitStyle();
      if (prefetched) prefetched.then(applyStyle, () => applyStyle(MAPTOOLKIT_STYLE));
      else applyStyle(MAPTOOLKIT_STYLE);
      m.addControl(new MaptoolkitLogoControl(), "bottom-left");
      const mk = new maplibregl.Marker({ color: "#c026d3" }).setLngLat([markerPlace.lon, markerPlace.lat]).addTo(m);
      marker = mk;

      const highlight = () => applyLayerHighlights(m, layers, selected, hovered);
      m.on("load", () => {
        watch.loaded();
        layers = (m.getStyle().layers ?? []).filter(
          (l): l is SymbolLayerSpecification =>
            l.type === "symbol" && !!l.layout?.["text-field"] && PICK_SOURCES.has(l["source-layer"] ?? ""),
        );
      });
      const hit = (e: MapMouseEvent) =>
        layers.length
          ? (m.queryRenderedFeatures(e.point, { layers: layers.map((l) => l.id) }).find((f) => featurePlace(f)) ??
            null)
          : null;
      const choose = (e: MapMouseEvent) => {
        selected = hit(e);
        hovered = selected;
        const picked = (selected && featurePlace(selected)) || pointPlace(e.lngLat);
        mk.setLngLat([picked.lon, picked.lat]);
        highlight();
        return picked;
      };
      m.on("mousemove", (e) => {
        const next = hit(e);
        if (featureKey(next) === featureKey(hovered)) return;
        hovered = next;
        m.getCanvas().style.cursor = hovered ? "pointer" : "";
        highlight();
      });
      m.on("mouseout", () => {
        hovered = null;
        m.getCanvas().style.cursor = "";
        highlight();
      });
      m.on("click", (e) => callbacks.current.onSelect?.(choose(e)));
      m.on("dblclick", (e) => {
        e.preventDefault();
        callbacks.current.onConfirm?.(choose(e));
      });
      // Centre and zoom for the other map, should the user switch (REQ-659).
      m.on("moveend", () => {
        const center = m.getCenter().wrap();
        callbacks.current.onViewportChange?.({ lat: center.lat, lon: center.lng, zoom: m.getZoom() });
      });
      // An error before the style has loaded is the style's own (offline, blocked, invalid): the map cannot load. Later
      // ones, and those of a source or tile (`sourceId`, `tile`), concern single resources and are no reason for the
      // card (REQ-771); a map that never gets complete fails by the deadline instead.
      let styleLoaded = false;
      m.on("styledata", () => {
        styleLoaded = true;
      });
      m.on("error", (event: ErrorEvent & { sourceId?: string; tile?: unknown }) => {
        if (alive && !styleLoaded && event.sourceId === undefined && event.tile === undefined) watch.failed();
      });
      moveTo.current = (target) => {
        selected = null;
        hovered = null;
        mk.setLngLat([target.lon, target.lat]);
        m.jumpTo({ center: [target.lon, target.lat], zoom: defaultMapZoom(10, target.elevation) });
        highlight();
      };
    } catch {
      // No WebGL (MapLibre throws "Failed to initialize WebGL"), or the map could not be made otherwise.
      watch.failed();
    }
    return () => {
      alive = false;
      watch.stop();
      moveTo.current = null;
      marker?.remove();
      map?.remove();
    };
  }, []);

  // A new place (a search hit or a favourite picked in the map) moves the map and the marker there (REQ-641).
  useEffect(() => {
    if (shownPlace.current === place) return;
    shownPlace.current = place;
    moveTo.current?.(place);
  }, [place]);

  return <div ref={container} className="map-view" data-map="maptoolkit" />;
}
