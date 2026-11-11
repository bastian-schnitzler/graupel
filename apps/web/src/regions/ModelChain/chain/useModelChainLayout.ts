// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Layout and boundary moving of one model chain (REQ-481). While a boundary is
 * dragged (mouse, pen or touch) or moved with the keys, the cards show the moved chain; it is handed on with `onCommit`
 * once, when the pointer is released or the key let go (or the boundary loses the focus), so the meteogram loads the
 * new chain only once per move. While a pointer drags it, `onPreview` gets the moved chain at every hour step (at most
 * once per frame), so the meteogram follows the drag (REQ-504), and `null` when the drag ends. A double-click (a double-tap with finger or pen) on a boundary asks with `onReset` to put
 * it back where the auto chain has it (REQ-498). A moved boundary changes only the two cards beside it, while it is
 * moved and afterwards; every other boundary stays where it is (REQ-610). The keys also move the boundary under the
 * mouse without the focus, unless the focus keeps them (a field, a popup; REQ-657).
 */
import type { WeatherModel } from "@graupel/download";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { keyDeltaHours, keysStayWithFocus, pointerDeltaHours, sameBoundaries } from "./chainBoundaries.ts";
import type { AvailableModels } from "./chainUtils.ts";
import {
  calculateModelChainLayout,
  followBoundaryWidths,
  getMaxTimelineHorizon,
  resizeBoundaryPair,
} from "./modelChainLayout.ts";

interface UseModelChainLayoutProps {
  modelChain: WeatherModel[];
  /** Catalogue entries; their horizons limit how far a boundary can be moved. */
  availableModels: AvailableModels;
  /** The moved chain, once per move; not called when the boundaries ended where they started. */
  onCommit?: ((chain: WeatherModel[]) => void) | undefined;
  /** Puts boundary `index` back to its original position (double-click or double-tap, REQ-498). */
  onReset?: ((index: number) => void) | undefined;
  /** The chain while a pointer drags a boundary, at every hour step; `null` when the drag ends (REQ-504). */
  onPreview?: ((chain: WeatherModel[] | null) => void) | undefined;
}

/** Longest time between two taps of a double-tap (REQ-498). */
export const DOUBLE_TAP_MS = 300;

/** A move in progress: the chain it shows, and for a drag where it started. */
interface Draft {
  chain: WeatherModel[];
  /** The chain on which the move began (`modelChain` then). */
  base: WeatherModel[];
}

export function useModelChainLayout({
  modelChain,
  availableModels,
  onCommit,
  onReset,
  onPreview,
}: UseModelChainLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1000);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resizingBoundaryIdx, setResizingBoundaryIdx] = useState<number | null>(null);
  const drag = useRef<{ index: number; startX: number } | null>(null);
  // The last tap of a finger or pen that did not move the boundary, for the double-tap (REQ-498).
  const lastTap = useRef<{ index: number; time: number } | null>(null);
  // When a double-tap last reset a boundary: a `dblclick` the browser may add for it does not reset it again.
  const tapReset = useRef(Number.NEGATIVE_INFINITY);
  // The latest draft for the event handlers (a release can follow a move before the next render).
  const draftRef = useRef<Draft | null>(null);
  // REQ-504: the frame that hands the dragged chain on, and whether a preview is out (ended on release).
  const previewFrame = useRef<number | null>(null);
  const previewSent = useRef(false);
  // REQ-657: the boundary under the mouse, which takes the keys without the focus, and whether its keys moved it.
  const hovered = useRef<number | null>(null);
  const hoverKeys = useRef(false);
  const latestPreview = useRef(onPreview);
  useEffect(() => {
    latestPreview.current = onPreview;
  }, [onPreview]);

  // A new chain from outside (other place, loaded forecast) ends a move that was not handed on.
  const [shownChain, setShownChain] = useState(modelChain);
  if (shownChain !== modelChain) {
    setShownChain(modelChain);
    if (draft && resizingBoundaryIdx === null) setDraft(null);
  }
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // REQ-610: the widths of the chain from outside. A chain that differs from the one before in one boundary (a move
  // handed on, a boundary put back) keeps the cards that are not beside it (`moved`); the same chain again (a new
  // object, e.g. while the meteogram follows a drag) keeps the widths; any other chain gets the default layout, which
  // follows the catalogue (`availableModels`, new with every chain) until a boundary is moved.
  const defaultWidths = (models: WeatherModel[]) =>
    calculateModelChainLayout(models, availableModels).map((segment) => segment.widthPct);
  const [layout, setLayout] = useState(() => ({
    chain: modelChain,
    models: availableModels,
    widths: defaultWidths(modelChain),
    moved: false,
  }));
  let current = layout;
  if (layout.chain !== modelChain || layout.models !== availableModels) {
    const next = { chain: modelChain, models: availableModels };
    if (sameBoundaries(layout.chain, modelChain)) {
      current = { ...next, widths: layout.moved ? layout.widths : defaultWidths(modelChain), moved: layout.moved };
    } else {
      const followed = followBoundaryWidths(layout.chain, layout.widths, modelChain, availableModels);
      current = { ...next, widths: followed ?? defaultWidths(modelChain), moved: followed !== null };
    }
    setLayout(current);
  }
  /** Widths of `models`: the chain from outside, or one boundary moved from it (else the default layout). */
  const { chain: layoutChain, widths: layoutWidths } = current;
  const widthsOf = useCallback(
    (models: WeatherModel[]) =>
      models === layoutChain
        ? layoutWidths
        : (followBoundaryWidths(layoutChain, layoutWidths, models, availableModels) ?? undefined),
    [layoutChain, layoutWidths, availableModels],
  );

  const chain = draft?.chain ?? modelChain;
  const maxTimelineHorizon = useMemo(() => getMaxTimelineHorizon(chain, availableModels), [chain, availableModels]);

  // Track the container width (pointer distance → hours).
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setContainerWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const segments = useMemo(
    () => calculateModelChainLayout(chain, availableModels, widthsOf(chain)),
    [chain, availableModels, widthsOf],
  );

  const update = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  // REQ-504: at most once per frame, the latest dragged chain goes to `onPreview`.
  const schedulePreview = useCallback(() => {
    if (previewFrame.current !== null) return;
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null;
      const current = draftRef.current;
      if (!drag.current || !current) return;
      previewSent.current = true;
      latestPreview.current?.(current.chain);
    });
  }, []);
  const endPreview = useCallback(() => {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
    if (!previewSent.current) return;
    previewSent.current = false;
    latestPreview.current?.(null);
  }, []);
  useEffect(() => endPreview, [endPreview]);

  const commit = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    // The cards keep the moved chain until the new chain comes back from outside.
    if (onCommit && !sameBoundaries(current.chain, current.base)) onCommit(current.chain);
    else update(null);
  }, [onCommit, update]);

  const handlePointerDownBoundary = useCallback(
    (event: PointerEvent<HTMLDivElement>, boundaryIndex: number) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No pointer capture in the test environment.
      }
      event.currentTarget.focus({ preventScroll: true });
      drag.current = { index: boundaryIndex, startX: event.clientX };
      setResizingBoundaryIdx(boundaryIndex);
      update({ chain, base: chain });
    },
    [chain, update],
  );

  const handlePointerMoveBoundary = useCallback(
    (event: PointerEvent<HTMLDivElement>, boundaryIndex: number) => {
      const current = drag.current;
      const base = draftRef.current?.base;
      if (!current || current.index !== boundaryIndex || !base) return;
      const deltaHours = pointerDeltaHours(event.clientX - current.startX, containerWidth, maxTimelineHorizon);
      const widths = calculateModelChainLayout(base, availableModels, widthsOf(base)).map((s) => s.widthPct);
      const result = resizeBoundaryPair(base, availableModels, widths, boundaryIndex, deltaHours);
      // Only an hour step changes the chain; the meteogram follows each one (REQ-504).
      if (draftRef.current && sameBoundaries(result.updatedChain, draftRef.current.chain)) return;
      update({ chain: result.updatedChain, base });
      schedulePreview();
    },
    [containerWidth, maxTimelineHorizon, availableModels, update, schedulePreview, widthsOf],
  );

  const handlePointerUpBoundary = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture already released.
      }
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      setResizingBoundaryIdx(null);
      const draft = draftRef.current;
      const tapped = !draft || sameBoundaries(draft.chain, draft.base);
      // The release hands the chain on; the preview ends in the same update, so the meteogram keeps its rebuilt chain.
      commit();
      endPreview();
      // REQ-498: a mouse double-click arrives as `dblclick`; fingers and pens get no reliable one, so two taps in a
      // row on the same boundary count as a double-tap. A tap that moved the boundary starts no double-tap.
      if (event.pointerType === "mouse" || event.type !== "pointerup") return;
      const previous = lastTap.current;
      const now = Date.now();
      if (tapped && previous && previous.index === current.index && now - previous.time <= DOUBLE_TAP_MS) {
        lastTap.current = null;
        tapReset.current = now;
        onReset?.(current.index);
      } else lastTap.current = tapped ? { index: current.index, time: now } : null;
    },
    [commit, endPreview, onReset],
  );

  // REQ-498: a double-click puts the boundary back to its original position.
  const handleDoubleClickBoundary = useCallback(
    (boundaryIndex: number) => {
      if (drag.current || Date.now() - tapReset.current <= DOUBLE_TAP_MS) return;
      update(null);
      onReset?.(boundaryIndex);
    },
    [onReset, update],
  );

  /** Moves boundary `boundaryIndex` for `key` (REQ-481); false for a key that does not move a boundary. */
  const moveWithKey = useCallback(
    (key: string, shiftKey: boolean, boundaryIndex: number) => {
      const segment = segments[boundaryIndex];
      if (!segment) return false;
      let deltaHours = keyDeltaHours(key, shiftKey);
      if (key === "Home") deltaHours = segment.minAllowedHorizon - segment.endHour;
      else if (key === "End") deltaHours = segment.maxAllowedHorizon - segment.endHour;
      if (deltaHours === null) return false;
      const base = draftRef.current?.base ?? modelChain;
      const widths = segments.map((s) => s.widthPct);
      const result = resizeBoundaryPair(chain, availableModels, widths, boundaryIndex, deltaHours);
      update({ chain: result.updatedChain, base });
      return true;
    },
    [segments, modelChain, chain, availableModels, update],
  );

  const handleKeyDownBoundary = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, boundaryIndex: number) => {
      if (moveWithKey(event.key, event.shiftKey, boundaryIndex)) event.preventDefault();
    },
    [moveWithKey],
  );

  // Letting go of the key (or leaving the boundary) hands the moved chain on.
  const handleKeyUpBoundary = useCallback(() => {
    if (!drag.current) commit();
  }, [commit]);

  // REQ-657: the mouse over a boundary (not a finger or pen) gives it the keys; leaving it hands a key move on.
  const handlePointerEnterBoundary = useCallback((event: PointerEvent<HTMLDivElement>, boundaryIndex: number) => {
    if (event.pointerType === "mouse") hovered.current = boundaryIndex;
  }, []);
  const handlePointerLeaveBoundary = useCallback(
    (boundaryIndex: number) => {
      if (hovered.current === boundaryIndex) hovered.current = null;
      if (!hoverKeys.current) return;
      hoverKeys.current = false;
      if (!drag.current) commit();
    },
    [commit],
  );

  // REQ-657: a key pressed anywhere goes to the boundary under the mouse, as with the focus, unless something took it
  // already (the focused boundary itself) or the focus keeps it (a field, a popup, a dialog). Letting it go hands on.
  const latestKeys = useRef({ moveWithKey, commit });
  useEffect(() => {
    latestKeys.current = { moveWithKey, commit };
  }, [moveWithKey, commit]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const index = hovered.current;
      if (index === null || drag.current || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || keysStayWithFocus(document)) return;
      if (!latestKeys.current.moveWithKey(event.key, event.shiftKey, index)) return;
      event.preventDefault();
      hoverKeys.current = true;
    };
    const onKeyUp = () => {
      if (!hoverKeys.current) return;
      hoverKeys.current = false;
      if (!drag.current) latestKeys.current.commit();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onKeyUp);
    };
  }, []);

  return {
    containerRef,
    containerWidth,
    maxTimelineHorizon,
    segments,
    /** Whether the cards show a moved chain that is not handed on yet (or not back yet). */
    moving: draft !== null,
    resizingBoundaryIdx,
    handlePointerDownBoundary,
    handlePointerMoveBoundary,
    handlePointerUpBoundary,
    handleKeyDownBoundary,
    handleKeyUpBoundary,
    handlePointerEnterBoundary,
    handlePointerLeaveBoundary,
    handleDoubleClickBoundary,
  };
}
