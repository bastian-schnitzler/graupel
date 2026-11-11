// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's full-screen meteogram and the system around it: the browser's own full screen without its bars
 * (REQ-717), a history entry that keeps the view open on the back button (REQ-716), and the double tap that zooms back
 * out (REQ-715).
 */
import { useEffect } from "react";

/** Element the browser shows on its whole screen: the page itself, since a `<dialog>` can not be (Fullscreen API). */
function fullscreenTarget(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

/**
 * Asks the browser to show the page on its whole screen, without the status bar at the top and the navigation bar at the
 * bottom or side (REQ-717, DEC-089): Fullscreen API with `navigationUI: "hide"`, where the browser has it (Chrome on
 * Android, the installed app). iOS Safari has no full screen for elements: nothing happens there, nor without a
 * gesture the browser would accept (it then refuses anyway), nor while the page already is on the whole screen.
 * Never throws; a refusal is quiet.
 */
export function enterSystemFullscreen(): void {
  const element = fullscreenTarget();
  if (!element || typeof element.requestFullscreen !== "function") return;
  if (document.fullscreenElement) return;
  // Without a recent touch the browser refuses (and Chrome logs it): only asked while one counts.
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (activation && !activation.isActive) return;
  try {
    const request = element.requestFullscreen({ navigationUI: "hide" });
    // Older engines return nothing.
    if (request && typeof request.catch === "function") request.catch(() => undefined);
  } catch {
    // Refused at once (e.g. not allowed in a frame).
  }
}

/** Leaves the browser's full screen again if the page holds it (REQ-717); quiet without the API. */
export function exitSystemFullscreen(): void {
  if (typeof document === "undefined" || typeof document.exitFullscreen !== "function") return;
  if (!document.fullscreenElement || document.fullscreenElement !== fullscreenTarget()) return;
  try {
    const exit = document.exitFullscreen();
    if (exit && typeof exit.catch === "function") exit.catch(() => undefined);
  } catch {
    // Already left.
  }
}

/** Key in `history.state` of the entry the open view adds (REQ-716). */
export const FULLSCREEN_HISTORY_KEY = "graupelMeteogramFullscreen";

function isOwnEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[FULLSCREEN_HISTORY_KEY] === true;
}

function pushOwnEntry() {
  const state: unknown = window.history.state;
  const base = typeof state === "object" && state !== null ? state : {};
  window.history.pushState({ ...base, [FULLSCREEN_HISTORY_KEY]: true }, "");
}

/**
 * Goes back from the view's own entry, keeping the page where the closing view left it (REQ-530): the browser would put
 * back the scroll position it noted for the entry below when the view opened and locked the page.
 */
function leaveOwnEntry() {
  const { scrollX, scrollY } = window;
  const keep = () => {
    if (window.scrollX === scrollX && window.scrollY === scrollY) return;
    try {
      window.scrollTo(scrollX, scrollY);
    } catch {
      // jsdom has no scrolling.
    }
  };
  window.addEventListener(
    "popstate",
    () => {
      keep();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(keep);
    },
    { once: true },
  );
  window.history.back();
}

/**
 * While the phone's view is open, the back button does not leave it (REQ-716): opening adds a history entry, and going
 * back from it adds it again, so the view stays and the page with it; only turning the phone back closes the view,
 * which then takes its entry away. Android's back button first closes a modal dialog (the Dialog holds it, `holdOpen`)
 * and first leaves the browser's own full screen (DEC-089); the entry catches it where neither applies.
 */
export function useBackButtonHold(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof window.history?.pushState !== "function") return;
    if (!isOwnEntry(window.history.state)) pushOwnEntry();
    const onPopState = (event: PopStateEvent) => {
      if (!isOwnEntry(event.state)) pushOwnEntry();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Closed (turned back): the entry goes again, so a later back leaves the page as before.
      if (isOwnEntry(window.history.state)) leaveOwnEntry();
    };
  }, [enabled]);
}

/** Longest time between the two taps of a double tap (ms), as the systems count it. */
export const DOUBLE_TAP_MS = 350;
/** Farthest the second tap of a double tap may land from the first (CSS px). */
export const DOUBLE_TAP_DISTANCE = 40;

/** A tap: where and when. */
export interface Tap {
  x: number;
  y: number;
  time: number;
}

/** Whether `tap` follows `previous` closely enough in time and place to make a double tap (REQ-715). */
export function isDoubleTap(previous: Tap | null, tap: Tap): boolean {
  if (!previous) return false;
  const elapsed = tap.time - previous.time;
  return elapsed >= 0 && elapsed <= DOUBLE_TAP_MS && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_DISTANCE;
}
