// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Visible width of the embedded chart on a tablet (REQ-742, REQ-744): the width of its scrolling box, which does not
 * change with the chart's own width inside it, so the days on the screen (`tabletDaysOnScreen`) do not feed back.
 */
import { useLayoutEffect, useState, type RefObject } from "react";

/** Width (CSS px) of `ref`'s element while `active`, measured again when it changes size; null otherwise. */
export function useVisibleWidth(ref: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) {
      setWidth(null);
      return;
    }
    // Less than half a pixel is measuring noise; it would only render the chart again.
    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth((current) => (current !== null && Math.abs(current - next) < 0.5 ? current : next));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, active]);
  return active ? width : null;
}
