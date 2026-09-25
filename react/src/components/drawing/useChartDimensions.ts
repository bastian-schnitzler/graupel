import { useState, useEffect, type RefObject } from "react";

export interface ChartDimensions {
  width: number;
  height: number;
}

/**
 * Custom hook managing SVG element bounding box measurements via ResizeObserver.
 * Tracks rendered width and height, preserving exact dimension equality to avoid unnecessary re-renders.
 */
export function useChartDimensions(
  svgRef: RefObject<SVGSVGElement | null>,
  active: boolean = true,
  defaultWidth: number = 1000,
  dependencyKey?: unknown,
): ChartDimensions {
  const [dimensions, setDimensions] = useState<ChartDimensions>({
    width: defaultWidth,
    height: 0,
  });

  useEffect(() => {
    if (!active) return;
    const svg = svgRef.current;
    if (!svg) return;

    const updateDimensions = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width > 0) {
        setDimensions((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height },
        );
      }
    };

    updateDimensions();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [active, dependencyKey]);

  return dimensions;
}
