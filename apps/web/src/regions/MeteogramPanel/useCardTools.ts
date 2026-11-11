// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Size of the desktop meteogram card and its button column (REQ-613): how wide the card's content is, how wide the
 * chart is at least, and how large the column is, so the chart can take the card's whole width with the column in the
 * room right of the plot (`desktopSideRoom`).
 */
import { useLayoutEffect, useState, type RefObject } from "react";

export interface CardTools {
  /** Width of the card's content (CSS px). */
  content: number;
  /** Least width of the chart (CSS px); below it the chart scrolls sideways. */
  minChart: number;
  /** Width and height of the button column (CSS px). */
  toolsWidth: number;
  toolsHeight: number;
}

const same = (a: CardTools | null, b: CardTools) =>
  a !== null &&
  Math.abs(a.content - b.content) < 0.5 &&
  Math.abs(a.minChart - b.minChart) < 0.5 &&
  Math.abs(a.toolsWidth - b.toolsWidth) < 0.5 &&
  Math.abs(a.toolsHeight - b.toolsHeight) < 0.5;

/**
 * Measures the card `cardRef` and its button column `toolsRef` while `active`, again whenever either changes size; the
 * measure does not depend on where the column stands. Null while inactive.
 */
export function useCardTools(
  cardRef: RefObject<HTMLElement | null>,
  toolsRef: RefObject<HTMLElement | null>,
  active: boolean,
): CardTools | null {
  const [value, setValue] = useState<CardTools | null>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    const tools = toolsRef.current;
    if (!active || !card || !tools) {
      setValue(null);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(card);
      const chart = card.querySelector(".meteogram__chart");
      const next: CardTools = {
        content: card.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0),
        minChart: chart ? parseFloat(getComputedStyle(chart).minWidth) || 0 : 0,
        toolsWidth: tools.offsetWidth,
        toolsHeight: tools.offsetHeight,
      };
      setValue((current) => (same(current, next) ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(tools);
    return () => observer.disconnect();
  }, [cardRef, toolsRef, active]);
  return active ? value : null;
}
