// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Whether the page is narrow (REQ-542): at most 40rem wide, where the container query `app` drops the cards around
 * chains, slider and meteogram (REQ-529). Unlike `usePhone()` it does not ask for a touch pointer: the chart's legend
 * follows the page's look, which depends on the width only, except on a tablet, which has the phone's look at any width
 * (REQ-728).
 */
import { useSyncExternalStore } from "react";
import { isTablet } from "./deviceClass.ts";

/** Media query of a narrow page, the width of the container query `app` in the stylesheets. */
export const NARROW_PAGE_QUERY = "(max-width: 40rem)";

function narrowQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(NARROW_PAGE_QUERY);
}

/** Whether the page is narrow right now: at most 40rem wide, or on a tablet, which has the phone's design (REQ-728). */
export function isNarrowPage(): boolean {
  return (narrowQuery()?.matches ?? false) || isTablet();
}

function subscribe(onChange: () => void): () => void {
  const query = narrowQuery();
  query?.addEventListener?.("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    query?.removeEventListener?.("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** Whether the page is narrow; updates when the window is resized or the phone turned. */
export function useNarrowPage(): boolean {
  return useSyncExternalStore(subscribe, isNarrowPage, () => false);
}
