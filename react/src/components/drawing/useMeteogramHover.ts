import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type RefObject,
  type MouseEvent,
} from "react";
import type { DataPoint } from "../../types";
import { getZonedDateParts } from "../../utils/timeline";
import { findTimestampAtOrBefore } from "../../utils/timeline";
import { calculateAccumulatedPrecipitation } from "../../utils/meteogramCalculations";

export interface TimelineScaleLike {
  xToTimestamp: (x: number, clamp?: boolean) => number;
  timestampToX: (timestamp: number) => number;
}

export interface UseMeteogramHoverOptions {
  containerRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  timeline: TimelineScaleLike | null;
  timestamps: number[];
  timeMap: Map<number, Record<string, DataPoint>>;
  precipValues: (number | null | undefined)[];
  resolvedTimezone: string;
  svgWidth: number;
  paddingLeft: number;
  paddingRight: number;
  getX: (timestamp: number) => number;
  onHoverPoint?: (point: DataPoint | null) => void;
  dayHeaderBottom?: number;
  totalSvgHeight?: number;
  suppressPopup?: boolean;
}

export interface UseMeteogramHoverReturn {
  hoverIndex: number | null;
  hoverTime: number | null;
  hoverTimestamp: number | null;
  hoverData: Record<string, DataPoint> | null;
  hoverX: number | null;
  hoverDateObj: Date | null;
  hoverDateParts: { hour: string; minute: string } | null;
  popupPos: { top: number; left: number } | null;
  accumulatedPrecip: number | null;
  handleMouseMove: (e: MouseEvent<SVGSVGElement>) => void;
  handleMouseLeave: () => void;
  clearHover: () => void;
  hidePopupOnZoom: () => void;
  programmaticCursorMoveRef: React.MutableRefObject<{
    timeoutId: number;
    expiresAt: number;
    expectedScreenX: number;
  } | null>;
}

/**
 * Cohesive hook managing hover interaction subsystem for the meteogram:
 * - Tracking mouse position and resolving nearest timeline hourly interval
 * - Tooltip popup positioning and boundary collision clamping
 * - Accumulated precipitation calculation
 * - Programmatic cursor move reconciliation
 */
export function useMeteogramHover({
  containerRef,
  popupRef,
  timeline,
  timestamps,
  timeMap,
  precipValues,
  resolvedTimezone,
  svgWidth,
  paddingLeft,
  paddingRight,
  getX,
  onHoverPoint,
  dayHeaderBottom = 44,
  totalSvgHeight = 450,
  suppressPopup = false,
}: UseMeteogramHoverOptions): UseMeteogramHoverReturn {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [cursorClientX, setCursorClientX] = useState<number | null>(null);
  const [popupPos, setPopupPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const programmaticCursorMoveRef = useRef<{
    timeoutId: number;
    expiresAt: number;
    expectedScreenX: number;
  } | null>(null);
  const isPopupHiddenByZoomRef = useRef<boolean>(false);

  // Clean up any programmatic move timers on unmount
  const clearHover = () => {
    setHoverIndex(null);
    setHoverTime(null);
    setCursorClientX(null);
    setPopupPos(null);
    onHoverPoint?.(null);
  };

  useEffect(() => {
    if (suppressPopup) {
      clearHover();
    }
  }, [suppressPopup]);

  // Clean up any programmatic move timers and hover state on unmount
  useEffect(() => {
    return () => {
      if (programmaticCursorMoveRef.current) {
        window.clearTimeout(programmaticCursorMoveRef.current.timeoutId);
      }
      clearHover();
    };
  }, []);

  const hidePopupOnZoom = () => {
    isPopupHiddenByZoomRef.current = true;
    setPopupPos(null);
  };

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current || !timeline) return;

    const programmaticMove = programmaticCursorMoveRef.current;
    if (programmaticMove) {
      if (
        performance.now() <= programmaticMove.expiresAt &&
        Math.abs(e.screenX - programmaticMove.expectedScreenX) <= 2
      ) {
        window.clearTimeout(programmaticMove.timeoutId);
        programmaticCursorMoveRef.current = null;
        return;
      }
      if (performance.now() > programmaticMove.expiresAt) {
        window.clearTimeout(programmaticMove.timeoutId);
        programmaticCursorMoveRef.current = null;
      }
    }

    // Genuine mouse move clears any zoom-induced popup suppression
    isPopupHiddenByZoomRef.current = false;
    setCursorClientX(e.clientX);

    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgScaledWidth = rect.width;
    const scaledX = (mouseX / svgScaledWidth) * svgWidth;

    if (scaledX < paddingLeft || scaledX > svgWidth - paddingRight) {
      setHoverIndex(null);
      setHoverTime(null);
      return;
    }

    const targetTime = timeline.xToTimestamp(scaledX, true);
    const nearestTimestamp = findTimestampAtOrBefore(timestamps, targetTime);
    setHoverIndex(
      nearestTimestamp === null ? null : timestamps.indexOf(nearestTimestamp),
    );
    setHoverTime(targetTime);
  };

  const handleMouseLeave = () => {
    if (
      programmaticCursorMoveRef.current &&
      performance.now() <= programmaticCursorMoveRef.current.expiresAt
    ) {
      return;
    }
    isPopupHiddenByZoomRef.current = false;
    setHoverIndex(null);
    setHoverTime(null);
    setCursorClientX(null);
    setPopupPos(null);
  };

  const hoverTimestamp = hoverIndex !== null ? timestamps[hoverIndex] : null;
  const hoverData = hoverTimestamp
    ? (timeMap.get(hoverTimestamp) ?? null)
    : null;
  const hoverX = hoverTime !== null ? getX(hoverTime) : null;
  const hoverDateObj = hoverTimestamp ? new Date(hoverTimestamp) : null;
  const hoverDateParts = hoverTimestamp
    ? getZonedDateParts(hoverTimestamp, resolvedTimezone)
    : null;

  // Inform parent when hover point changes
  useEffect(() => {
    if (onHoverPoint) {
      onHoverPoint(hoverData?.["temperature"] || null);
    }
  }, [hoverData, onHoverPoint]);

  // Accumulated precipitation calculation
  const accumulatedPrecip = useMemo(() => {
    return calculateAccumulatedPrecipitation(
      hoverIndex,
      precipValues,
      timestamps,
    );
  }, [hoverIndex, precipValues, timestamps]);

  // Calculate popup position pinned to opposite side of cursor and below date header
  useEffect(() => {
    if (
      suppressPopup ||
      !containerRef.current ||
      hoverIndex === null ||
      hoverX === null ||
      isPopupHiddenByZoomRef.current
    ) {
      setPopupPos(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const popupWidth =
      popupRef.current?.offsetWidth ||
      popupRef.current?.getBoundingClientRect().width ||
      220;
    const popupHeight =
      popupRef.current?.offsetHeight ||
      popupRef.current?.getBoundingClientRect().height ||
      230;

    const inset = 12;

    // Horizontal placement: opposite side from cursor relative to white meteogram container
    const meteogramCenterX = containerRect.left + containerRect.width / 2;
    const clientX =
      cursorClientX ??
      containerRect.left + (hoverX / svgWidth) * containerRect.width;
    const isCursorLeft = clientX < meteogramCenterX;

    let computedLeft: number;
    if (isCursorLeft) {
      computedLeft = containerRect.right - inset - popupWidth;
    } else {
      computedLeft = containerRect.left + inset;
    }

    computedLeft = Math.max(
      containerRect.left + inset,
      Math.min(containerRect.right - inset - popupWidth, computedLeft),
    );

    // Vertical placement: start below date/day header if sufficient space exists,
    // otherwise shift upward just enough to keep popup completely inside the container.
    const svgEl = containerRef.current.querySelector(
      "svg.meteogram-svg-integrated",
    ) as SVGSVGElement | null;
    const svgRect = svgEl ? svgEl.getBoundingClientRect() : containerRect;
    const svgHeight =
      totalSvgHeight && totalSvgHeight > 0 ? totalSvgHeight : 450;
    const dayHeaderBottomScreen =
      svgRect.top + (dayHeaderBottom / svgHeight) * svgRect.height;

    const preferredTop = dayHeaderBottomScreen + 4;
    const minTop = containerRect.top + inset;
    const maxTop = containerRect.bottom - inset - popupHeight;

    let computedTop: number;
    if (preferredTop <= maxTop) {
      computedTop = preferredTop;
    } else {
      computedTop = Math.max(minTop, maxTop);
    }

    setPopupPos({
      top: Math.round(computedTop),
      left: Math.round(computedLeft),
    });
  }, [
    suppressPopup,
    hoverIndex,
    hoverX,
    cursorClientX,
    svgWidth,
    totalSvgHeight,
    dayHeaderBottom,
    containerRef,
    popupRef,
  ]);

  return {
    hoverIndex,
    hoverTime,
    hoverTimestamp,
    hoverData,
    hoverX,
    hoverDateObj,
    hoverDateParts,
    popupPos,
    accumulatedPrecip,
    handleMouseMove,
    handleMouseLeave,
    clearHover,
    hidePopupOnZoom,
    programmaticCursorMoveRef,
  };
}
