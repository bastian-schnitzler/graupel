// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Class of the device (REQ-728, DEC-090), decided here once for the whole page: a phone, a tablet or a desktop. A device
 * with a coarse (touch) pointer whose screen's short side measures at least 600 CSS px is a tablet, an unfolded foldable
 * included; a smaller one with a coarse pointer is a phone; without a coarse pointer it is a desktop. Tablets get the
 * phone's design with all its rules and controls (`usePhone` in phoneLandscape.ts), with the desktop's header bar while
 * it fits (REQ-731) and, held in landscape, the phone's upright view instead of the phone's full-screen view.
 *
 * The page confirms the screen: a phone's page is never TABLET_MIN_SHORT_SIDE wide upright nor higher than
 * PHONE_MAX_LANDSCAPE_HEIGHT turned, a tablet's always is, also below its browser's bars. A page too small for a tablet
 * (a tablet zoomed in a lot, or a screen size that does not belong to the page, as in an emulator) is a phone's.
 */
import { useSyncExternalStore } from "react";

export type DeviceClass = "phone" | "tablet" | "desktop";

/** Short side of the screen (CSS px) from which a device with a coarse pointer is a tablet (DEC-090). */
export const TABLET_MIN_SHORT_SIDE = 600;

/** Highest page (CSS px) of a phone in landscape, as in `PHONE_LANDSCAPE_QUERY` (phoneLandscape.ts). */
export const PHONE_MAX_LANDSCAPE_HEIGHT = 500;

/** Media query of a coarse (touch) pointer as the primary one. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** Media query of a page wider than high. */
export const LANDSCAPE_QUERY = "(orientation: landscape)";

/** Size of the page (CSS px). */
export interface PageSize {
  width: number;
  height: number;
}

/** Whether the page is as large as a tablet's: upright at least TABLET_MIN_SHORT_SIDE wide, turned higher than a phone's. */
function tabletPage(page: PageSize): boolean {
  return page.width <= page.height ? page.width >= TABLET_MIN_SHORT_SIDE : page.height > PHONE_MAX_LANDSCAPE_HEIGHT;
}

/**
 * Class of a device from its pointer and the short side of its screen (CSS px, null when unknown): without a coarse
 * pointer a desktop; with one a tablet from TABLET_MIN_SHORT_SIDE on, if the `page` (when given) is as large as a
 * tablet's, else a phone. Where the browser does not tell the screen's size, the class can not be told either: then it
 * counts as a desktop, and the phone's media query alone decides whether the page has the phone's design
 * (`PHONE_QUERY`, phoneLandscape.ts), as before tablets had their own.
 */
export function deviceClassOf(coarse: boolean, shortSide: number | null, page: PageSize | null = null): DeviceClass {
  if (!coarse || shortSide === null) return "desktop";
  return shortSide >= TABLET_MIN_SHORT_SIDE && (page === null || tabletPage(page)) ? "tablet" : "phone";
}

function query(text: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(text);
}

/**
 * Short side of the screen in CSS px, or null when the browser does not tell (jsdom reports 0). The screen, not the
 * page: neither the keyboard nor the browser's bars change it, and it is the same upright and turned.
 */
function screenShortSide(): number | null {
  if (typeof screen === "undefined") return null;
  const side = Math.min(screen.width, screen.height);
  return Number.isFinite(side) && side > 0 ? side : null;
}

/** Size of the page's layout viewport, or null without a window. */
function pageSize(): PageSize | null {
  if (typeof window === "undefined" || !(window.innerWidth > 0) || !(window.innerHeight > 0)) return null;
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Class of this device right now. */
export function readDeviceClass(): DeviceClass {
  return deviceClassOf(query(COARSE_POINTER_QUERY)?.matches ?? false, screenShortSide(), pageSize());
}

/** Whether this device is a tablet (REQ-728). */
export function isTablet(): boolean {
  return readDeviceClass() === "tablet";
}

/** Whether this device is a tablet held in landscape (REQ-728); it is never a phone in landscape. */
export function isTabletLandscape(): boolean {
  return isTablet() && (query(LANDSCAPE_QUERY)?.matches ?? false);
}

/**
 * Listens to the pointer's and the orientation's queries and, as a fallback, to `resize` and `orientationchange` (a
 * pointer attached or detached, a foldable unfolded, a turn). The answer is read afresh each time.
 */
function subscribe(onChange: () => void): () => void {
  const queries = [query(COARSE_POINTER_QUERY), query(LANDSCAPE_QUERY)];
  for (const item of queries) item?.addEventListener?.("change", onChange);
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    for (const item of queries) item?.removeEventListener?.("change", onChange);
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

/** Class of this device; updates when a pointer changes or a foldable is unfolded. */
export function useDeviceClass(): DeviceClass {
  return useSyncExternalStore(subscribe, readDeviceClass, () => "desktop");
}

/** Whether this device is a tablet (REQ-728). */
export function useTablet(): boolean {
  return useSyncExternalStore(subscribe, isTablet, () => false);
}

/** Whether this device is a tablet held in landscape (REQ-728, REQ-756); updates when it is turned. */
export function useTabletLandscape(): boolean {
  return useSyncExternalStore(subscribe, isTabletLandscape, () => false);
}
