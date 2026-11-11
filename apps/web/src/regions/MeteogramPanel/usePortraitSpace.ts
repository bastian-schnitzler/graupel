// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Room for the embedded chart on a phone in portrait (REQ-608): how high the screen is and how much of it the rest of
 * the page takes, so the chart can take what is left (`portraitAreaScale`).
 */
import { useLayoutEffect, useState, type RefObject } from "react";

export interface PortraitSpace {
  /** Smallest visible height of the screen (CSS px, `100svh`: in Safari with its bars shown). */
  screen: number;
  /**
   * Height of the page without the chart (CSS px): place row, day slider, model chains, source line, footer; without
   * the room below the footer for Safari's bottom bar, which the page leaves out where it fits on the screen (REQ-614).
   */
  rest: number;
  /** CSS px per viewBox unit of the chart; the same for every selection of days (REQ-585). */
  pxPerUnit: number;
  /**
   * Room (CSS px) of a part of `rest` the page may leave out where the chart would otherwise get too low: the legend
   * card (REQ-639, `data-portrait-optional`) with the gap below it; 0 without it.
   */
  optional: number;
}

/** Changes below half a pixel are measuring noise; they would only render the chart again. */
const same = (a: PortraitSpace | null, b: PortraitSpace) =>
  a !== null &&
  Math.abs(a.screen - b.screen) < 0.5 &&
  Math.abs(a.rest - b.rest) < 0.5 &&
  Math.abs(a.optional - b.optional) < 0.5 &&
  Math.abs(a.pxPerUnit - b.pxPerUnit) < 1e-4;

/**
 * Measures the room of the chart inside `scrollRef` while `active`: the page is the chart's `.app__inner` (place row,
 * main column, footer); its content ends at the bottom of its lowest part plus its bottom padding, without the footer's
 * room for Safari's bar (REQ-581, REQ-614). Measured again, a frame later, whenever the page (with its padding, so also
 * when only the screen's safe-area insets change, REQ-635), the window or `svh` changes size; the chart's own height
 * does not count, so the result does not change when the chart takes it. Null while inactive or before the chart is
 * drawn.
 */
export function usePortraitSpace(scrollRef: RefObject<HTMLElement | null>, active: boolean): PortraitSpace | null {
  const [space, setSpace] = useState<PortraitSpace | null>(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const page = scroll?.closest(".app__inner");
    if (!active || !scroll || !(page instanceof HTMLElement)) {
      setSpace(null);
      return;
    }
    // The smallest visible height: `svh` where supported, else `vh`.
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.portraitProbe = "";
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none";
    probe.style.height = "100vh";
    probe.style.height = "100svh";
    document.body.append(probe);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const svg = scroll.querySelector("svg");
      const viewBox = svg?.viewBox.baseVal;
      if (!svg || !viewBox || !(viewBox.width > 0)) return;
      const chart = svg.getBoundingClientRect();
      const parts = [...page.children].map((part) => part.getBoundingClientRect().bottom);
      const padding = parseFloat(getComputedStyle(page).paddingBottom) || 0;
      const bottom = Math.max(page.getBoundingClientRect().top, ...parts) + padding;
      // Whether or not the room for Safari's bar is shown now, the measure leaves it out, so it stays the same.
      const footer = page.querySelector(".footer--safari");
      const room = footer ? parseFloat(getComputedStyle(footer).paddingBottom) || 0 : 0;
      // The room of the legend card: its height, its bottom margin and the gap of its column below it.
      const optional = page.querySelector<HTMLElement>("[data-portrait-optional]");
      let optionalRoom = 0;
      if (optional) {
        const style = getComputedStyle(optional);
        const parent = optional.parentElement ? getComputedStyle(optional.parentElement) : null;
        optionalRoom =
          optional.getBoundingClientRect().height +
          (parseFloat(style.marginTop) || 0) +
          (parseFloat(style.marginBottom) || 0) +
          (parseFloat(parent?.rowGap ?? "") || 0);
      }
      const next: PortraitSpace = {
        screen: probe.getBoundingClientRect().height,
        rest: bottom + window.scrollY - chart.height - room,
        pxPerUnit: chart.width / viewBox.width,
        optional: optionalRoom,
      };
      setSpace((current) => (same(current, next) ? current : next));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    // With its padding (REQ-635): the screen's insets are padding of the page, so a change of them alone (the installed
    // app under status bar and home indicator) leaves its content box as it is where the page ends at its content.
    observer?.observe(page, { box: "border-box" });
    // Its parts too: a part that gets lower (the legend card closed, REQ-639) leaves a page as high as the screen.
    for (const part of page.children) observer?.observe(part);
    observer?.observe(scroll);
    observer?.observe(probe);
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      probe.remove();
    };
  }, [scrollRef, active]);
  return active ? space : null;
}
