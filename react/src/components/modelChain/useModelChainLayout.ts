import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { WeatherModel, ModelMetadata } from "../../types";
import {
  calculateModelChainLayout,
  resizeBoundaryPair,
  getBaselineWidthPct,
  getMinimumWidthPct,
  getMaxTimelineHorizon,
  normalizeWidths,
  areModelChainsEqual,
} from "./modelChainLayout";

interface UseModelChainLayoutProps {
  modelChain: WeatherModel[];
  onChange: (newChain: WeatherModel[]) => void;
  availableModels: Record<string, ModelMetadata>;
  readOnly?: boolean;
  onResizeEnd?: () => void;
  onBoundaryDrag?: (
    isDragging: boolean,
    boundaryIndex?: number,
    boundaryHour?: number,
  ) => void;
}

export function useModelChainLayout({
  modelChain,
  onChange,
  availableModels = {},
  readOnly = false,
  onResizeEnd,
  onBoundaryDrag,
}: UseModelChainLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1000);
  const [customWidthsPct, setCustomWidthsPct] = useState<number[]>([]);
  const [resizingBoundaryIdx, setResizingBoundaryIdx] = useState<number | null>(
    null,
  );
  const resizingBoundaryIdxRef = useRef<number | null>(null);

  const startPointerXRef = useRef<number>(0);
  const initialWidthsRef = useRef<number[]>([]);
  const initialChainRef = useRef<WeatherModel[]>([]);
  const customWidthsPctRef = useRef<number[]>([]);
  customWidthsPctRef.current = customWidthsPct;
  const lastEmittedChainRef = useRef<WeatherModel[] | null>(null);

  // When modelChain changes externally (e.g. boundary reset or config switch),
  // reset custom widths so all segments immediately reflect the new canonical chain.
  useEffect(() => {
    if (!areModelChainsEqual(lastEmittedChainRef.current, modelChain)) {
      setCustomWidthsPct([]);
    }
  }, [modelChain]);

  const count = modelChain.length;
  const baseWidthPct = useMemo(() => getBaselineWidthPct(count), [count]);
  const minWidthPct = useMemo(() => getMinimumWidthPct(count), [count]);
  const maxTimelineHorizon = useMemo(
    () => getMaxTimelineHorizon(modelChain, availableModels),
    [modelChain, availableModels],
  );

  // ResizeObserver to track container width changes
  useEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => {
      if (containerRef.current) {
        const w = containerRef.current.getBoundingClientRect().width;
        if (w > 0) setContainerWidth(w);
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateWidth();
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }
  }, []);

  // Sync / normalize customWidthsPct when modelChain count changes
  useEffect(() => {
    setCustomWidthsPct((prevWidths) => {
      if (prevWidths.length === count && count > 0) {
        return normalizeWidths(prevWidths, count);
      }
      return [];
    });
  }, [count]);

  // Compute layout segments
  const segments = useMemo(() => {
    return calculateModelChainLayout(
      modelChain,
      availableModels,
      customWidthsPct.length === count ? customWidthsPct : undefined,
    );
  }, [modelChain, availableModels, customWidthsPct, count]);

  // Boundary resize pointer drag handlers
  const handlePointerDownBoundary = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, boundaryIndex: number) => {
      if (readOnly) return;
      event.preventDefault();
      event.stopPropagation();

      const handleElement = event.currentTarget;
      try {
        handleElement.setPointerCapture(event.pointerId);
      } catch {
        // Ignore setPointerCapture errors in test environment
      }

      resizingBoundaryIdxRef.current = boundaryIndex;
      setResizingBoundaryIdx(boundaryIndex);
      startPointerXRef.current = event.clientX;
      initialWidthsRef.current = segments.map((s) => s.widthPct);
      initialChainRef.current = [...modelChain];

      const initialHour = modelChain[boundaryIndex]?.max_forecast_horizon_hours;
      if (onBoundaryDrag) {
        onBoundaryDrag(true, boundaryIndex, initialHour);
      }
    },
    [readOnly, modelChain, segments, onBoundaryDrag],
  );

  const handlePointerMoveBoundary = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, boundaryIndex: number) => {
      if (readOnly || resizingBoundaryIdxRef.current !== boundaryIndex) return;

      const effectiveWidth = containerWidth > 0 ? containerWidth : 1000;
      const dx = event.clientX - startPointerXRef.current;
      const deltaHoursRaw = (dx / effectiveWidth) * maxTimelineHorizon;
      const deltaHours = Math.round(deltaHoursRaw);

      const baseWidths =
        initialWidthsRef.current.length === count
          ? initialWidthsRef.current
          : Array(count).fill(baseWidthPct);

      const baseChain =
        initialChainRef.current.length === count
          ? initialChainRef.current
          : modelChain;

      const result = resizeBoundaryPair(
        baseChain,
        availableModels,
        baseWidths,
        boundaryIndex,
        deltaHours,
      );

      lastEmittedChainRef.current = result.updatedChain;
      setCustomWidthsPct(result.updatedWidthsPct);
      onChange(result.updatedChain);

      const draggedHour =
        result.updatedChain[boundaryIndex]?.max_forecast_horizon_hours;
      if (onBoundaryDrag) {
        onBoundaryDrag(true, boundaryIndex, draggedHour);
      }
    },
    [
      readOnly,
      containerWidth,
      maxTimelineHorizon,
      count,
      baseWidthPct,
      modelChain,
      availableModels,
      onChange,
      onBoundaryDrag,
    ],
  );

  const handlePointerUpBoundary = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture already released
      }
      resizingBoundaryIdxRef.current = null;
      setResizingBoundaryIdx((prev) => {
        if (prev !== null && onResizeEnd) {
          onResizeEnd();
        }
        return null;
      });
      if (onBoundaryDrag) {
        onBoundaryDrag(false);
      }
    },
    [onResizeEnd, onBoundaryDrag],
  );

  const handleKeyDownBoundary = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, boundaryIndex: number) => {
      if (readOnly) return;

      const step = event.shiftKey ? 12 : 1;
      let deltaHours = 0;

      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        deltaHours = -step;
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        deltaHours = step;
      }

      if (deltaHours !== 0) {
        const currentWidths =
          customWidthsPctRef.current.length === count
            ? customWidthsPctRef.current
            : segments.map((s) => s.widthPct);

        const result = resizeBoundaryPair(
          modelChain,
          availableModels,
          currentWidths,
          boundaryIndex,
          deltaHours,
        );

        if (result.actualDeltaHours !== 0 || result.actualDeltaPct !== 0) {
          lastEmittedChainRef.current = result.updatedChain;
          setCustomWidthsPct(result.updatedWidthsPct);
          onChange(result.updatedChain);
          if (onResizeEnd) onResizeEnd();
        }
      }
    },
    [
      readOnly,
      modelChain,
      availableModels,
      count,
      segments,
      onChange,
      onResizeEnd,
    ],
  );

  return {
    containerRef,
    containerWidth,
    baseWidthPct,
    minWidthPct,
    maxTimelineHorizon,
    segments,
    resizingBoundaryIdx,
    handlePointerDownBoundary,
    handlePointerMoveBoundary,
    handlePointerUpBoundary,
    handleKeyDownBoundary,
  };
}
