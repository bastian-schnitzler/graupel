// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Full-screen map (REQ-433), laid out like the desktop app (REQ-475): the map fills
 * the dialog, zoom top right, Cancel and OK bottom right, no header. With both providers a click sets the place
 * marker and OK confirms it, a double click picks at once (REQ-476). The map library loads only when the dialog
 * opens. A map that fails to load leaves the area empty and shows an error card (REQ-492); a slow map or single failing
 * tiles are no failure, and a map that loads after all takes the card away (REQ-771). While it is open the page
 * behind does not scroll, so no scroll bar shows next to the map (REQ-512). On the desktop the opener may put tools in
 * the top-left corner (`tools`: the place search with the favourites, REQ-641); a place picked there moves the map and
 * its marker to it for OK. A phone (`MAP_PHONE_QUERY`) has no room for them.
 * The map shown is the provider chosen in the settings (`useMapProvider`, REQ-467); a switch in the map changes it
 * there and then (REQ-659): a preview tile bottom left on the desktop, a layers button under the zoom on a phone. The
 * other map opens with the same centre, zoom and marker, and a place picked before stays picked for OK.
 */
import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import type { MapProvider, Place } from "../../config/index.ts";
import { useT } from "../../i18n/index.ts";
import { MAP_DIALOG_OPEN_CLASS } from "../../state/mapDialog.ts";
import { setMapProvider, useMapProvider } from "../../state/mapProvider.ts";
import { useMapPhone } from "../../state/phoneLandscape.ts";
import { useErrorNotice } from "../../state/notices.ts";
import { MapSwitch } from "./MapSwitch.tsx";
import { prefetchMaptoolkitStyle } from "./map/maptoolkitStyle.ts";
import type { MapViewProps, MapViewport } from "./map/types.ts";
import "./MapDialog.css";

const MAP_VIEWS = {
  opentopomap: lazy(() => import("./map/LeafletMap.tsx")),
  // The style loads alongside the library the first time (REQ-771).
  maptoolkit: lazy(() => {
    prefetchMaptoolkitStyle();
    return import("./map/MaptoolkitMap.tsx");
  }),
} satisfies Record<MapProvider, unknown>;

/** Shows `fallback` when loading the map module fails (offline, outdated chunk). */
class LoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Fallback of a map module that failed to load: the map area stays empty, the message is a card. */
function MapFailed() {
  useErrorNotice("location.map", "location.map.error");
  return null;
}

/** What the tools in the top-left corner of the map can do (REQ-641). */
export interface MapDialogTools {
  /** The place marked on the map: the one picked last, else the one the map opened with. */
  place: Place;
  /** Marks a place and moves the map there; OK takes it. */
  pick: (place: Place) => void;
  /** Takes a place at once and closes the map (`onAccept`). */
  accept: (place: Place) => void;
}

export interface MapDialogProps {
  place: Place;
  onClose: () => void;
  /** The user confirmed a place picked on the map. */
  onAccept: (place: Place) => void;
  /** Tools in the top-left corner, on the desktop only (REQ-641). */
  tools?: (tools: MapDialogTools) => ReactNode;
}

export function MapDialog({ place, onClose, onAccept, tools }: MapDialogProps) {
  const t = useT();
  const phone = useMapPhone();
  const provider = useMapProvider();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<Place | null>(null);
  // The provider whose map failed; the other map may still load after a switch (REQ-659).
  const [failedMap, setFailedMap] = useState<MapProvider | null>(null);
  const failed = failedMap === provider;
  // Centre and zoom of the map, as it reports them; the other map opens with them after a switch (REQ-659).
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const View = MAP_VIEWS[provider];
  // Where the map is centred and marked: the given place, or one picked with the tools (REQ-641). A click in the map
  // only moves the marker. Each pick is a new object, so the map moves there again after the user panned away. A
  // change of the given place (its elevation arriving) leaves a place picked meanwhile where it is.
  const [center, setCenter] = useState(place);
  const [given, setGiven] = useState(place);
  if (place !== given) {
    setGiven(place);
    if (!pending) setCenter(place);
  }
  const pick = (next: Place) => {
    const picked = { ...next };
    setPending(picked);
    setCenter(picked);
  };

  // Focus moves into the dialog and back to the opener on close; Escape closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => opener?.focus();
  }, []);
  // The page behind keeps its height; locking its scrolling takes its scroll bar away while the map covers it. The class
  // also tells the full-screen meteogram not to open when the phone is turned meanwhile (REQ-645).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(MAP_DIALOG_OPEN_CLASS);
    return () => root.classList.remove(MAP_DIALOG_OPEN_CLASS);
  }, []);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // An element inside that used Escape itself (the search list, the favourites menu) keeps the map open.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The switch stores the choice as the settings do (REQ-467, REQ-659); the other map gets a fresh try.
  const switchMap = (next: MapProvider) => {
    setFailedMap(null);
    setMapProvider(next);
  };

  // Until the dialog closes; a module that failed to load reports the same card (`MapFailed`).
  useErrorNotice("location.map", failed ? "location.map.error" : null);
  const error = <MapFailed />;
  const viewProps: MapViewProps = {
    place: center,
    // Read when a map is made: after a switch the new map shows what the other one showed (REQ-659).
    viewport,
    marker: pending ?? center,
    onViewportChange: setViewport,
    onError: () => setFailedMap(provider),
    // A map that loads after its card showed takes the card away (REQ-771).
    onLoad: () => setFailedMap(null),
    onSelect: setPending,
    onConfirm: onAccept,
  };

  return (
    <div
      className="map-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t("location.map.title")}
      data-provider={provider}
    >
      <div className="map-dialog__map">
        <LoadBoundary key={provider} fallback={error}>
          <Suspense
            fallback={
              <p className="map-dialog__status" role="status">
                {t("location.map.loading")}
              </p>
            }
          >
            <View {...viewProps} />
          </Suspense>
        </LoadBoundary>
        {tools && !phone && (
          <div className="map-dialog__tools">{tools({ place: pending ?? place, pick, accept: onAccept })}</div>
        )}
        {/* After the search in the tab order, before Cancel and OK (REQ-659). */}
        <MapSwitch provider={provider} phone={phone} onSwitch={switchMap} />
        <div className="map-dialog__actions">
          <button ref={cancelRef} type="button" className="map-dialog__button" onClick={onClose}>
            {t("location.map.cancel")}
          </button>
          <button
            type="button"
            className="map-dialog__button map-dialog__button--ok"
            disabled={!pending}
            onClick={() => pending && onAccept(pending)}
          >
            {t("location.map.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
