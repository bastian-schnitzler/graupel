// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Font sizes of the meteogram on screen. The chart's SVG stretches its viewBox to its box, so a text of `font-size` 8
 * shows at 8 times the vertical scale.
 * - Smallest font size of the embedded chart (REQ-552): the phone's footer links take it through the custom property
 *   `--meteogram-min-font-size` on the root element. The elevation of the place (a mountain's height at the terrain
 *   line) only shows in the mountains; it is left out so the links keep their size from place to place.
 * - Font size of the daily temperature extremes in the phone's full-screen view (REQ-587): the row below the chart
 *   (place, graupel.eu, data source) takes it through `--meteogram-extremes-font-size` (MeteogramPanel.css).
 */
import type { MeteogramController } from "@graupel/meteogram";
import { useEffect, type RefObject } from "react";

/** Custom property on the root element with the smallest font size of the chart, e.g. `5.12px`. */
export const CHART_MIN_FONT_SIZE_PROPERTY = "--meteogram-min-font-size";

/** Custom property on the root element with the font size of the full-screen chart's temperature extremes (REQ-587). */
export const EXTREMES_FONT_SIZE_PROPERTY = "--meteogram-extremes-font-size";

/**
 * Size (CSS px, rounded to 0.01) on screen of a text drawn with `fontSize` viewBox units in a chart SVG, by the
 * chart's height; null before layout.
 */
export function chartFontPx(svg: SVGSVGElement, fontSize: number): number | null {
  const viewBoxHeight = svg.viewBox.baseVal?.height ?? 0;
  const height = svg.getBoundingClientRect().height;
  if (!(viewBoxHeight > 0) || !(height > 0) || !(fontSize > 0)) return null;
  return Math.round(((fontSize * height) / viewBoxHeight) * 100) / 100;
}

/** Smallest font size (CSS px) of the texts in a chart SVG, or null without texts or before layout. */
export function smallestChartFontPx(svg: SVGSVGElement): number | null {
  let smallest: number | null = null;
  for (const text of svg.querySelectorAll<SVGTextElement>("text[font-size]")) {
    if (text.closest(".terrain-mask-label-group")) continue;
    const size = Number(text.getAttribute("font-size"));
    if (size > 0 && (smallest === null || size < smallest)) smallest = size;
  }
  return smallest === null ? null : chartFontPx(svg, smallest);
}

/**
 * Keeps `--meteogram-min-font-size` on the root element at the smallest font size of the chart inside `container`:
 * after each render (`revision` changes) and whenever the container changes its size. Removed when the chart goes.
 */
export function useChartMinFontSize(container: RefObject<HTMLElement | null>, revision: unknown): void {
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const root = document.documentElement;
    const update = () => {
      const svg = element.querySelector<SVGSVGElement>("svg.meteogram-svg-integrated");
      const px = svg ? smallestChartFontPx(svg) : null;
      if (px === null) root.style.removeProperty(CHART_MIN_FONT_SIZE_PROPERTY);
      else root.style.setProperty(CHART_MIN_FONT_SIZE_PROPERTY, `${px}px`);
    };
    const frame = requestAnimationFrame(update);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      root.style.removeProperty(CHART_MIN_FONT_SIZE_PROPERTY);
    };
  }, [container, revision]);
}

/** Font size (CSS px) on screen of the daily temperature extremes of a mounted chart, or null before layout. */
export function extremesFontPx(controller: MeteogramController): number | null {
  const svg = controller.element.querySelector<SVGSVGElement>("svg.meteogram-svg-integrated");
  // The extremes are drawn in the size of the theme (@graupel/meteogram), also when none is in the visible range.
  return svg ? chartFontPx(svg, controller.getScene().theme.fontSizes.extremes) : null;
}

/**
 * Keeps `--meteogram-extremes-font-size` on the root element at the size on screen of the temperature extremes of the
 * chart in `meteogram` (REQ-587), while `enabled`: when the chart is shown, when `chartKey` brings a new one and
 * whenever the chart changes its size (a new screen size) or its viewBox (a new layout). A smaller row below the chart
 * gives the chart more height, so its text grows a little: the size settles after a frame or two. Removed when the
 * chart goes.
 */
export function useExtremesFontSize(
  meteogram: RefObject<MeteogramController | null>,
  enabled: boolean,
  chartKey: unknown,
): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let svg: Element | null = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const controller = meteogram.current;
      const current = controller?.element.querySelector("svg.meteogram-svg-integrated") ?? null;
      if (current !== svg) {
        if (svg) resizes?.unobserve(svg);
        viewBoxes?.disconnect();
        if (current) {
          resizes?.observe(current);
          viewBoxes?.observe(current, { attributes: true, attributeFilter: ["viewBox"] });
        }
        svg = current;
      }
      // Before layout the last size stays.
      const px = controller ? extremesFontPx(controller) : null;
      if (px === null || root.style.getPropertyValue(EXTREMES_FONT_SIZE_PROPERTY) === `${px}px`) return;
      root.style.setProperty(EXTREMES_FONT_SIZE_PROPERTY, `${px}px`);
    };
    // Once per frame, after the chart drew itself in its new size.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    const viewBoxes = typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resizes?.disconnect();
      viewBoxes?.disconnect();
      root.style.removeProperty(EXTREMES_FONT_SIZE_PROPERTY);
    };
  }, [meteogram, enabled, chartKey]);
}
