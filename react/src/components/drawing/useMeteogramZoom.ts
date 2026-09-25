import {
  useState,
  useEffect,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  calculateZoomedTimeRange,
  normalizeWheelZoomDirection,
  type TimeRange,
} from "../../utils/meteogramZoom";
import { createTimelineScale } from "../../utils/timeline";
import { apiService } from "../../services/apiService";

export interface TimelineZoomScale {
  startMs: number;
  endMs: number;
  timestampToX: (timestamp: number) => number;
}

export interface UseMeteogramZoomOptions {
  maximumRange: TimeRange | null;
  timeline: TimelineZoomScale | null;
  hoverTime?: number | null;
  hoverTimeRef?: RefObject<number | null>;
  isFullscreen: boolean;
  embeddedSvgRef: RefObject<SVGSVGElement | null>;
  fullscreenSvgRef: RefObject<SVGSVGElement | null>;
  svgWidth: number;
  paddingLeft: number;
  paddingRight: number;
  programmaticCursorMoveRef?: React.MutableRefObject<{
    timeoutId: number;
    expiresAt: number;
    expectedScreenX: number;
  } | null>;
  visibleRange?: TimeRange | null;
  setVisibleRange?: Dispatch<SetStateAction<TimeRange | null>>;
  onZoomStart?: () => void;
}

export interface UseMeteogramZoomReturn {
  visibleRange: TimeRange | null;
  setVisibleRange: Dispatch<SetStateAction<TimeRange | null>>;
  handleWheel: (e: WheelEvent) => void;
}

/**
 * Cohesive hook managing zoom interaction subsystem for the meteogram:
 * - Wheel event normalization and zoomed time-range calculation
 * - Global window capture wheel listener with conflict resolution
 * - Programmatic cursor recentering across zoom transitions
 */
export function useMeteogramZoom({
  maximumRange,
  timeline,
  hoverTime,
  hoverTimeRef,
  isFullscreen,
  embeddedSvgRef,
  fullscreenSvgRef,
  svgWidth,
  paddingLeft,
  paddingRight,
  programmaticCursorMoveRef,
  visibleRange: propVisibleRange,
  setVisibleRange: propSetVisibleRange,
  onZoomStart,
}: UseMeteogramZoomOptions): UseMeteogramZoomReturn {
  const [internalVisibleRange, setInternalVisibleRange] =
    useState<TimeRange | null>(null);
  const visibleRange =
    propVisibleRange !== undefined ? propVisibleRange : internalVisibleRange;
  const setVisibleRange = propSetVisibleRange || setInternalVisibleRange;

  const handleWheel = (e: WheelEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(".fullscreen-map-picker")) return;
    if (target?.closest(".autocomplete-dropdown")) return;
    if (isFullscreen && !target?.closest(".fullscreen-meteogram-overlay"))
      return;

    const svg = isFullscreen
      ? fullscreenSvgRef.current
      : embeddedSvgRef.current;
    // Test the white container's geometry, including its padding, rather than
    // event ancestry: overlays and surrounding model controls are distinct.
    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    const hasPageOverflow =
      scrollingElement.scrollHeight > document.documentElement.clientHeight + 1;
    if (!isFullscreen && hasPageOverflow) {
      const rect = svg
        ?.closest('.meteogram-redesign-container')
        ?.getBoundingClientRect();
      if (
        !rect || rect.width <= 0 || rect.height <= 0 ||
        e.clientX < rect.left || e.clientX >= rect.right ||
        e.clientY < rect.top || e.clientY >= rect.bottom
      ) return;
    }
    const insideChart = !!svg && !!target && svg.contains(target);
    const direction = normalizeWheelZoomDirection(e.deltaY, e.deltaMode);
    if (!direction || !maximumRange || !timeline) return;

    onZoomStart?.();

    e.preventDefault();
    e.stopPropagation();

    const oldRange = { start: timeline.startMs, end: timeline.endMs };
    const currentHoverTime = hoverTimeRef
      ? hoverTimeRef.current
      : (hoverTime ?? null);
    const activeHoverTime =
      insideChart &&
      currentHoverTime !== null &&
      currentHoverTime > oldRange.start &&
      currentHoverTime < oldRange.end
        ? currentHoverTime
        : null;

    const nextRange = calculateZoomedTimeRange({
      range: oldRange,
      maximumRange,
      hoverTime: activeHoverTime,
      direction,
    });

    if (nextRange.start === oldRange.start && nextRange.end === oldRange.end) {
      return;
    }

    if (activeHoverTime !== null && svg) {
      const rect = svg.getBoundingClientRect();
      const nextScale = createTimelineScale(
        nextRange.start,
        nextRange.end,
        paddingLeft,
        svgWidth - paddingRight,
      );
      const oldCssX =
        (timeline.timestampToX(activeHoverTime) / svgWidth) * rect.width;
      const newCssX =
        (nextScale.timestampToX(activeHoverTime) / svgWidth) * rect.width;
      const deltaX = newCssX - oldCssX;
      const expectedScreenX = e.screenX + deltaX;

      if (programmaticCursorMoveRef) {
        if (programmaticCursorMoveRef.current) {
          window.clearTimeout(programmaticCursorMoveRef.current.timeoutId);
        }
        const timeoutId = window.setTimeout(() => {
          if (programmaticCursorMoveRef)
            programmaticCursorMoveRef.current = null;
        }, 250);
        programmaticCursorMoveRef.current = {
          expectedScreenX,
          expiresAt: performance.now() + 250,
          timeoutId,
        };

        void apiService
          .moveCursorTo(expectedScreenX, e.screenY)
          .then((moved) => {
            if (
              !moved &&
              programmaticCursorMoveRef?.current?.timeoutId === timeoutId
            ) {
              window.clearTimeout(timeoutId);
              programmaticCursorMoveRef.current = null;
            }
          });
      }
    }

    setVisibleRange(nextRange);
  };

  // One capture listener accepts the whole window and prevents competing handlers.
  const wheelHandlerRef = useRef(handleWheel);
  wheelHandlerRef.current = handleWheel;

  useEffect(() => {
    const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return {
    visibleRange,
    setVisibleRange,
    handleWheel,
  };
}
