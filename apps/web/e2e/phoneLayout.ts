// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Checks of the phone layout that several specs share (REQ-566, REQ-693): nothing reaches beyond the screen's sides, so
 * the page can not be scrolled sideways (Safari shows it shifted then), and an element stands inside a given area.
 */
import { expect, type Locator, type Page } from "./fixtures.ts";

/**
 * Elements outside the screen's sides; the wide chart scrolls in its own box, measured copies are clipped, and so are
 * the map's tiles and drawings in its pane (Leaflet's container hides what lies beyond it).
 */
export async function outsideTheScreen(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const outside = [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          !element.closest(".meteogram__scroll > *, .day-slider__measure > *, .visually-hidden, .leaflet-map-pane"),
      )
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
      })
      .map((element) => `${element.tagName}.${element.getAttribute("class") ?? ""}`);
    return { outside, scrollWidth: document.documentElement.scrollWidth, width };
  });
}

/** No element beyond the screen's sides and no sideways scrolling of the page (REQ-566). */
export async function expectNoSidewaysOverflow(page: Page, label?: string) {
  const { outside, scrollWidth, width } = await outsideTheScreen(page);
  expect(outside, label).toEqual([]);
  expect(scrollWidth, label).toBeLessThanOrEqual(width);
}

/** An area of the screen in CSS px. */
export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Edges of an element on screen. */
export async function edges(locator: Locator) {
  const b = (await locator.boundingBox())!;
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, width: b.width, height: b.height };
}

/** The element is visible and stands wholly inside `area` (half a pixel of rounding allowed). */
export async function expectWithin(locator: Locator, area: Area, label?: string) {
  await expect(locator, label).toBeVisible();
  const b = await edges(locator);
  expect(b.left, label).toBeGreaterThanOrEqual(area.left - 0.5);
  expect(b.top, label).toBeGreaterThanOrEqual(area.top - 0.5);
  expect(b.right, label).toBeLessThanOrEqual(area.right + 0.5);
  expect(b.bottom, label).toBeLessThanOrEqual(area.bottom + 0.5);
  return b;
}

/** An axis label of the chart (REQ-694): its lines and its box on screen, from the top of its digits to its last baseline. */
export interface AxisLabel {
  /** Its `data-testid` (zero line, guide lines, units, cloud altitudes), else "". */
  testid: string;
  /** Left or right of the chart's middle. */
  side: "left" | "right";
  area: string;
  lines: string[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A drawing area of the chart on screen, with the axis labels drawn in its panel (also its units below it). */
export interface AxisArea {
  id: string;
  top: number;
  bottom: number;
  labels: AxisLabel[];
}

/**
 * The drawing areas of the chart `svg` and their axis labels (REQ-694): the texts drawn directly in an area's panel
 * (maximum, minimum, zero and guide lines of the left axis, right axis, half axes, the units of compact labels) and its
 * cloud altitudes; a label with a halo stands in a group after its stroked copy (REQ-746), which does not count. A
 * label's box reaches from the top edge of its digits (0.72 of the font size above the first baseline, as the library
 * measures it) to the baseline of its last line, so letters below the baseline do not count.
 */
export function axisLabelAreas(svg: Locator): Promise<AxisArea[]> {
  return svg.evaluate((root: SVGSVGElement) => {
    const matrix = root.getScreenCTM()!;
    const screenY = (y: number) => new DOMPoint(0, y).matrixTransform(matrix).y;
    const middle = root.viewBox.baseVal.width / 2;
    return [...root.querySelectorAll<SVGGElement>("g[data-area-id]")].map((panel) => {
      const id = panel.getAttribute("data-area-id")!;
      const clip = panel.querySelector(":scope > defs > clipPath > rect")!;
      const top = Number(clip.getAttribute("y"));
      const height = Number(clip.getAttribute("height"));
      const texts = [
        ...panel.querySelectorAll<SVGTextElement>(
          ':scope > text, :scope > g.label-halo > text:not([data-halo]), text[data-testid^="cloud-altitude-label-"]',
        ),
      ];
      const labels = texts.map((text) => {
        const fontSize = Number(text.getAttribute("font-size") ?? parseFloat(getComputedStyle(text).fontSize));
        const spans = [...text.querySelectorAll("tspan")];
        const y = Number(text.getAttribute("y"));
        const last = spans.reduce((sum, span, index) => sum + (index > 0 ? Number(span.getAttribute("dy") ?? 0) : 0), y);
        const rect = text.getBoundingClientRect();
        return {
          testid: text.getAttribute("data-testid") ?? "",
          side: (Number(text.getAttribute("x")) < middle ? "left" : "right") as "left" | "right",
          area: id,
          lines: spans.length > 0 ? spans.map((span) => span.textContent ?? "") : [text.textContent ?? ""],
          left: rect.left,
          right: rect.right,
          top: screenY(y - 0.72 * fontSize),
          bottom: screenY(last),
        };
      });
      return { id, top: screenY(top), bottom: screenY(top + height), labels };
    });
  });
}

/**
 * Maximum and minimum of an area's left axis: its left labels without test id (not zero line, guide lines or unit),
 * the highest and the lowest.
 */
export function leftExtremes(area: AxisArea) {
  const values = area.labels
    .filter((label) => label.side === "left" && label.testid === "")
    .sort((a, b) => a.top - b.top);
  return { max: values[0], min: values.length > 1 ? values[values.length - 1] : undefined };
}

/**
 * Share of a label's height the zero line's label may cover by the library's rule (REQ-603, `ZERO_LABEL_MAX_OVERLAP`):
 * up to 20 % both stay, above that only the zero label.
 */
const ZERO_LABEL_MAX_OVERLAP = 0.2;

/**
 * No two axis labels of the chart overlap (REQ-694), half a pixel of rounding allowed; only the zero line's label may
 * touch a maximum or minimum by up to 20 % of its height, as the library allows (REQ-603).
 */
export async function expectAxisLabelsApart(svg: Locator, label?: string) {
  const labels = (await axisLabelAreas(svg)).flatMap((area) => area.labels);
  expect(labels.length, label).toBeGreaterThan(0);
  const overlaps: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (across > 0.5 && down > 0.5) {
        const share = down / Math.min(a.bottom - a.top, b.bottom - b.top);
        const zero = a.testid === "axis-zero" || b.testid === "axis-zero";
        if (zero && share <= ZERO_LABEL_MAX_OVERLAP) continue;
        overlaps.push(`${a.area} "${a.lines.join(" ")}" ↔ ${b.area} "${b.lines.join(" ")}" (${share.toFixed(2)})`);
      }
    }
  }
  expect(overlaps, label).toEqual([]);
}
