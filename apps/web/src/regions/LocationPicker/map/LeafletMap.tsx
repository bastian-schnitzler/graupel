// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * OpenTopoMap raster tiles with Leaflet (DEC-022, default). A click sets the place marker, a double click picks the
 * point at once (REQ-476). Loaded lazily when the map opens. A new `place` moves the map and the marker there (REQ-641).
 * After a switch from Maptoolkit it opens with that map's centre, zoom and marker (REQ-659). Only a map that does not
 * load reports an error (REQ-771, `watchMapLoad`): none of its first tiles loaded (offline, blocked), or still no tile
 * by the deadline; a single tile that fails does not.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Place } from "../../../config/index.ts";
import { MAP_PHONE_QUERY } from "../../../state/phoneLandscape.ts";
import { watchMapLoad } from "./loadWatch.ts";
import { pointPlace } from "./maptoolkitStyle.ts";
import { defaultMapZoom, type MapViewProps, type MapViewport } from "./types.ts";

export const OPENTOPOMAP_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/3.0/";
/**
 * Only the required credits (REQ-474), short (REQ-644): OpenStreetMap (ODbL) and OpenTopoMap (CC-BY-SA); SRTM is named
 * on About. "© OpenStreetMap" with a link to the copyright page is enough for OSM, so "contributors" is left out.
 */
export const OPENTOPOMAP_ATTRIBUTION =
  `&copy; <a href="${OSM_COPYRIGHT_URL}">OpenStreetMap</a>, ` +
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> ' +
  `(<a href="${CC_BY_SA_URL}">CC-BY-SA</a>)`;
/** Phones (REQ-644): without "(CC-BY-SA)"; "OpenTopoMap" links to the license instead. */
export const OPENTOPOMAP_PHONE_ATTRIBUTION =
  `&copy; <a href="${OSM_COPYRIGHT_URL}">OpenStreetMap</a>, &copy; <a href="${CC_BY_SA_URL}">OpenTopoMap</a>`;
/**
 * Phones (narrow, or held in landscape): the Leaflet credit is left out there (REQ-474) and named on About, the
 * attribution is the short one (REQ-644).
 */
export const PHONE_QUERY = MAP_PHONE_QUERY;

/** The attribution of the OpenTopoMap layer on a phone or on the desktop (REQ-644). */
export function opentopomapAttribution(phone: boolean): string {
  return phone ? OPENTOPOMAP_PHONE_ATTRIBUTION : OPENTOPOMAP_ATTRIBUTION;
}

function phoneQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null;
}
/** OpenTopoMap serves tiles up to zoom 17. */
export const OPENTOPOMAP_MAX_ZOOM = 17;

/** Zoom of the map at a place: Leaflet tiles are 256 px, MapLibre's 512 px, so one level more for the same view. */
function placeZoom(elevation: number | undefined): number {
  return leafletZoom(defaultMapZoom(10, elevation));
}

/** Leaflet zoom of a zoom in MapLibre levels (`MapViewport`, REQ-659), within OpenTopoMap's levels. */
export function leafletZoom(zoom: number): number {
  return Math.min(zoom + 1, OPENTOPOMAP_MAX_ZOOM);
}

export default function LeafletMap({
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
    let map: L.Map | undefined;
    const phone = phoneQuery();
    let updateAttribution: (() => void) | undefined;
    const watch = watchMapLoad({
      onError: () => callbacks.current.onError?.(),
      onLoad: () => callbacks.current.onLoad?.(),
    });
    try {
      const { lat, lon, elevation } = shownPlace.current;
      const { viewport: view, marker: markerPlace } = start.current;
      // Double click picks a place instead of zooming; zoom buttons top right as in the desktop app (REQ-475).
      const m = L.map(container.current!, {
        center: view ? [view.lat, view.lon] : [lat, lon],
        zoom: view ? leafletZoom(view.zoom) : placeZoom(elevation),
        doubleClickZoom: false,
        zoomControl: false,
      });
      map = m;
      L.control.zoom({ position: "topright" }).addTo(m);
      const { prefix } = L.Control.Attribution.prototype.options;
      const leafletPrefix = typeof prefix === "string" ? prefix : false;
      // The line changes with PHONE_QUERY (turning, window size), the Leaflet prefix with it (REQ-474, REQ-644).
      let shown: string | undefined;
      updateAttribution = () => {
        const control = m.attributionControl;
        if (!control) return;
        const isPhone = phone?.matches ?? false;
        const text = opentopomapAttribution(isPhone);
        control.setPrefix(isPhone ? false : leafletPrefix);
        if (text === shown) return;
        if (shown !== undefined) control.removeAttribution(shown);
        control.addAttribution(text);
        shown = text;
      };
      updateAttribution();
      phone?.addEventListener?.("change", updateAttribution);
      const tiles = L.tileLayer(OPENTOPOMAP_URL, {
        subdomains: "abc",
        maxZoom: OPENTOPOMAP_MAX_ZOOM,
      });
      // The map has loaded with its first tile (REQ-771). Leaflet's "load" comes once every tile asked for has loaded
      // or failed: when that is before any tile loaded, all of them failed and the map cannot load.
      let tileLoaded = false;
      tiles.on("tileload", () => {
        tileLoaded = true;
        watch.loaded();
      });
      tiles.on("load", () => {
        if (!tileLoaded) watch.failed();
      });
      tiles.addTo(m);
      const marker = L.circleMarker([markerPlace.lat, markerPlace.lon], {
        radius: 8,
        color: "#c026d3",
        weight: 3,
        fillOpacity: 0.4,
      }).addTo(m);
      const choose = (event: L.LeafletMouseEvent) => {
        const picked = pointPlace(event.latlng);
        marker.setLatLng([picked.lat, picked.lon]);
        return picked;
      };
      m.on("click", (event: L.LeafletMouseEvent) => callbacks.current.onSelect?.(choose(event)));
      m.on("dblclick", (event: L.LeafletMouseEvent) => callbacks.current.onConfirm?.(choose(event)));
      // Centre and zoom for the other map, should the user switch (REQ-659).
      m.on("moveend", () => {
        const center = m.getCenter().wrap();
        const shown: MapViewport = { lat: center.lat, lon: center.lng, zoom: m.getZoom() - 1 };
        callbacks.current.onViewportChange?.(shown);
      });
      moveTo.current = (target) => {
        marker.setLatLng([target.lat, target.lon]);
        m.setView([target.lat, target.lon], placeZoom(target.elevation), { animate: false });
      };
    } catch {
      watch.failed();
    }
    return () => {
      watch.stop();
      moveTo.current = null;
      if (updateAttribution) phone?.removeEventListener?.("change", updateAttribution);
      map?.remove();
    };
  }, []);

  // A new place (a search hit or a favourite picked in the map) moves the map and the marker there (REQ-641).
  useEffect(() => {
    if (shownPlace.current === place) return;
    shownPlace.current = place;
    moveTo.current?.(place);
  }, [place]);

  return <div ref={container} className="map-view" data-map="opentopomap" />;
}
