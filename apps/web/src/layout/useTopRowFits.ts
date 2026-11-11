// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Whether the tablet's top row fits (REQ-731): the place row and the desktop's header bar side by side, every button at
 * its size and the search field at least SEARCH_MIN_REM wide, without overlapping. Where they do not, the tablet shows
 * the phone's place row with its menu instead; once the page is again as wide as the desktop row needed, it shows that.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Narrowest width (rem) of the search field in the tablet's top row: the desktop's, its flex basis, below which the
 * desktop's place row would wrap (REQ-748). So an upright iPad keeps the desktop's row with the history's day beside
 * the clock, its search field as wide as on a desktop of the same width.
 */
export const SEARCH_MIN_REM = 8;

const px = (value: string) => parseFloat(value) || 0;

/** Width the children of a flex `row` take side by side with its gaps; `flexible` counts `flexibleWidth` instead. */
function rowWidth(row: Element, flexible: string | null, flexibleWidth: number): number {
  const style = getComputedStyle(row);
  const children = [...row.children].filter((child) => child.getBoundingClientRect().width > 0);
  if (children.length === 0) return 0;
  const widths = children.map((child) => {
    if (flexible !== null && child.matches(flexible)) return flexibleWidth;
    const own = getComputedStyle(child);
    return child.getBoundingClientRect().width + px(own.marginLeft) + px(own.marginRight);
  });
  const gap = px(style.columnGap);
  return widths.reduce((sum, width) => sum + width, 0) + gap * (children.length - 1);
}

/** Horizontal padding of an element. */
function paddingX(element: Element | null): number {
  if (!element) return 0;
  const style = getComputedStyle(element);
  return px(style.paddingLeft) + px(style.paddingRight);
}

/**
 * Width (CSS px) the top row `top` needs with the desktop's header bar beside the place row (REQ-731): the place row's
 * buttons with the search field at its narrowest, the header bar's language field and buttons at their size, their
 * paddings and the gap between the two. Null while the row does not show both.
 */
export function topRowNeeds(top: HTMLElement): number | null {
  const bar = top.querySelector(".location__bar");
  const header = top.querySelector(".header");
  const headerBar = header?.querySelector(".header__bar");
  if (!bar || !header || !headerBar) return null;
  const rem = px(getComputedStyle(document.documentElement).fontSize) || 16;
  const place = rowWidth(bar, ".location__search", SEARCH_MIN_REM * rem) + paddingX(bar.closest(".location"));
  const buttons = rowWidth(headerBar, null, 0) + paddingX(header);
  return place + buttons + px(getComputedStyle(top).columnGap);
}

/**
 * Whether the tablet's top row fits (REQ-731), and the ref of that row (`.app__top`). While `enabled` (on a tablet) the
 * row is measured when it or its parts change size: with the desktop header bar shown, what it needs; with the phone's
 * row shown, whether the page is again as wide as that. Starts with the desktop bar; true while not enabled.
 */
export function useTopRowFits(enabled: boolean): [boolean, (element: HTMLElement | null) => void] {
  const [fits, setFits] = useState(true);
  const [element, setElement] = useState<HTMLElement | null>(null);
  // Width the desktop row needed when last shown; the phone's row is measured against it.
  const needed = useRef<number | null>(null);
  const ref = useCallback((next: HTMLElement | null) => setElement(next), []);

  useLayoutEffect(() => {
    // Not on a tablet the hook answers true; a tablet again later goes on from the last answer.
    if (!enabled || !element) return;
    const measure = () => {
      const available = element.clientWidth;
      if (!(available > 0)) return;
      if (fits) {
        const needs = topRowNeeds(element);
        if (needs === null) return;
        needed.current = needs;
        // Half a pixel of rounding.
        if (needs > available + 0.5) setFits(false);
      } else if (needed.current === null || available + 0.5 >= needed.current) {
        setFits(true);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The language field changes width with the language, the place row with the installed app's history; the rows
    // themselves get higher where a button added later (the history's) wraps.
    if (fits) {
      const parts = element.querySelectorAll(".location__bar, .header__bar, .location__bar > *, .header__bar > *");
      for (const part of parts) observer.observe(part);
    }
    return () => observer.disconnect();
  }, [enabled, element, fits]);

  return [enabled ? fits : true, ref];
}
