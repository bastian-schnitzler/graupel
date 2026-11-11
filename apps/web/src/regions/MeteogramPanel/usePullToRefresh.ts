// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pull to refresh on a phone in portrait (REQ-638): pulled down at the top of the page, the meteogram follows the
 * finger, everything above stays; released after `PULL_THRESHOLD` px, the place's forecast loads anew. A shorter pull
 * does nothing. Only a gesture of one finger that clearly goes down from the start takes part: sideways scrolling of the
 * chart, a pinch and every other touch stay the browser's.
 *
 * Not only the chart can be pulled: the whole page can, at its top, from the header, the place row or the day slider as
 * well (REQ-750), with the same effect. A touch outside the chart takes part unless `pagePulls` says no: not while a
 * dialog (the full-screen meteogram, the map, the settings) or a menu is open, not on what scrolls on its own and is not
 * at its top, and not on what takes every touch for itself (`touch-action: none`: the day slider's marker and grips, the
 * model chain's boundaries, a map). The browser's own pull to refresh is off while a finger is on the page
 * (`overscroll-behavior` of the page, MeteogramPanel.css).
 *
 * The hook moves nothing through React while the finger moves: it sets on the card
 * - `data-pull` ("pulling", or "ready" past the threshold) while pulling,
 * - `--meteogram-pull` (how far the chart moves, CSS px),
 * - `data-pull-settling` for a moment after the release, while the chart moves back to its place,
 * and on the root element `data-meteogram-touch` while a finger is on the page, `data-meteogram-pull` (as `data-pull`)
 * and `--meteogram-pull-progress` (0 to 1) while pulling: the day slider's box shows the refresh symbol with them
 * (REQ-737, DaySlider.css). After the release the chart goes straight back to its place; while the forecast loads anew
 * the box above says so, the chart does not wait lower (REQ-737).
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Finger travel (CSS px) from which releasing reloads (REQ-638, spec: about 64 px). */
export const PULL_THRESHOLD = 64;
/** The chart moves less than the finger, at most this far (CSS px). */
export const PULL_MAX_OFFSET = 80;
/** Share of the finger's travel the chart follows. */
export const PULL_RESISTANCE = 0.6;
/** Finger travel (CSS px) before the gesture is told a pull or something else. */
export const PULL_SLOP = 8;
/** How long the chart takes to move back after the release (ms); MeteogramPanel.css has the same transition. */
export const PULL_SETTLE_MS = 250;

/** How far the chart moves down for a finger travel of `distance` CSS px. */
export function pullOffset(distance: number): number {
  return Math.min(PULL_MAX_OFFSET, Math.max(0, distance) * PULL_RESISTANCE);
}

/**
 * Whether a move of the finger by (`dx`, `dy`) from where it touched is a pull: clearly down, at least twice as far
 * down as sideways, and beyond the slop. Null while it cannot be told yet.
 */
export function isPull(dx: number, dy: number): boolean | null {
  if (Math.abs(dx) < PULL_SLOP && Math.abs(dy) < PULL_SLOP) return null;
  return dy >= PULL_SLOP && dy > 2 * Math.abs(dx);
}

/** Whether the page stands at its very top and is not zoomed in (a finger there pans the zoomed page). */
function pageAtTop(): boolean {
  const viewport = window.visualViewport;
  if (viewport && (viewport.scale > 1.01 || viewport.pageTop > 0.5)) return false;
  return window.scrollY <= 0.5;
}

/**
 * Whether a touch on `target`, outside the chart, may pull the page down to refresh it (REQ-750). Not while a dialog or
 * a menu is open (its panel, or the page behind it), not on an element that scrolls on its own and is not at its top
 * (it scrolls back up first), and not on one that takes every touch for itself (`touch-action: none`).
 */
export function pagePulls(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (document.querySelector('dialog[open], [aria-modal="true"], [aria-expanded="true"]')) return false;
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (element === document.documentElement) break;
    if (element.scrollTop > 0) return false;
    if (getComputedStyle(element).touchAction === "none") return false;
  }
  return true;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  state: "undecided" | "pulling" | "ignored";
  /** Finger travel down (CSS px), not below 0. */
  distance: number;
}

/** Marks `card` as settling for `PULL_SETTLE_MS` (the chart moves back meanwhile, still clipped at the card's bottom). */
function startSettling(card: HTMLElement, timer: { current: number }) {
  card.dataset.pullSettling = "";
  window.clearTimeout(timer.current);
  timer.current = window.setTimeout(() => delete card.dataset.pullSettling, PULL_SETTLE_MS);
}

/**
 * Listens to touches on the page while `enabled` and moves the card `cardRef` with them: always to those on `targetRef`
 * (the chart's scroll container), elsewhere as `pagePulls` allows (REQ-750). `onRefresh` runs when a pull past the
 * threshold is released. `loading` is true while a reload the pull started still runs: no new pull then.
 */
export function usePullToRefresh(
  cardRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onRefresh: () => void,
  loading: boolean,
): void {
  const latest = useRef({ onRefresh, loading });
  useLayoutEffect(() => {
    latest.current = { onRefresh, loading };
  });
  const settle = useRef(0);

  useEffect(() => {
    const card = cardRef.current;
    const target = targetRef.current;
    if (!enabled || !card || !target) return;
    const root = document.documentElement;
    let gesture: Gesture | null = null;
    const timer = settle;

    const show = (distance: number) => {
      const state = distance >= PULL_THRESHOLD ? "ready" : "pulling";
      card.style.setProperty("--meteogram-pull", `${pullOffset(distance)}px`);
      card.dataset.pull = state;
      // For the day slider's box above, which shows the refresh symbol instead of an arrow over the chart (REQ-737).
      root.style.setProperty("--meteogram-pull-progress", String(Math.min(1, distance / PULL_THRESHOLD)));
      root.dataset.meteogramPull = state;
    };
    const clear = () => {
      delete card.dataset.pull;
      card.style.removeProperty("--meteogram-pull");
      delete root.dataset.meteogramPull;
      root.style.removeProperty("--meteogram-pull-progress");
    };
    /** Ends the gesture; the chart moves back to its place. */
    const finish = (refresh: boolean) => {
      const pulled = gesture?.state === "pulling";
      gesture = null;
      if (!pulled) return;
      clear();
      startSettling(card, timer);
      if (refresh) latest.current.onRefresh();
    };

    const onStart = (event: TouchEvent) => {
      delete root.dataset.meteogramTouch;
      if (event.touches.length !== 1) {
        // A second finger: a pinch, no pull.
        finish(false);
        return;
      }
      root.dataset.meteogramTouch = "";
      const touch = event.touches[0]!;
      // The chart as before (REQ-638), the rest of the page where nothing else takes the touch (REQ-750).
      const pulls = (event.target instanceof Node && target.contains(event.target)) || pagePulls(event.target);
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        state: pulls && pageAtTop() && !latest.current.loading ? "undecided" : "ignored",
        distance: 0,
      };
    };
    const onMove = (event: TouchEvent) => {
      if (!gesture || gesture.state === "ignored") return;
      if (event.touches.length !== 1) {
        finish(false);
        return;
      }
      const touch = [...event.touches].find((item) => item.identifier === gesture!.id);
      if (!touch) return;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (gesture.state === "undecided") {
        const pull = isPull(dx, dy);
        if (pull === null) return;
        if (!pull || !pageAtTop()) {
          gesture.state = "ignored";
          return;
        }
        gesture.state = "pulling";
      }
      // Neither the page nor the chart scrolls, and the browser does not pull to refresh itself.
      if (event.cancelable) event.preventDefault();
      gesture.distance = Math.max(0, dy);
      show(gesture.distance);
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) delete root.dataset.meteogramTouch;
      finish(event.type === "touchend" && event.touches.length === 0 && (gesture?.distance ?? 0) >= PULL_THRESHOLD);
    };

    // On the whole page, one listener for the chart and the rest: one reload per pull (REQ-750).
    document.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: a pull cancels the moves.
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      window.clearTimeout(timer.current);
      clear();
      delete card.dataset.pullSettling;
      delete root.dataset.meteogramTouch;
    };
  }, [cardRef, targetRef, enabled]);
}
