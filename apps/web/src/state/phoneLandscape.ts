// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Whether a phone is held in landscape (REQ-454): landscape orientation, a coarse (touch) pointer and a low screen.
 * A wide desktop window is landscape as well; the pointer and height checks keep it from counting. A page that is only
 * wider than high because the keyboard made it lower does not count (REQ-628). Also whether the device is a phone at
 * all (REQ-531, REQ-532).
 */
import { useSyncExternalStore } from "react";
import { COARSE_POINTER_QUERY, readDeviceClass } from "./deviceClass.ts";

/** Media query of a phone in landscape. */
export const PHONE_LANDSCAPE_QUERY = "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";

function landscapeQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_LANDSCAPE_QUERY);
}

/**
 * Width of the page's layout viewport, as the media query sees it: `clientWidth` of the root element, which pinch zoom
 * leaves alone, else `innerWidth`.
 */
function pageWidth(): number {
  return document.documentElement.clientWidth || window.innerWidth;
}

/** Short side of the screen in CSS pixels, or null when the browser does not tell. */
function screenShortSide(): number | null {
  if (typeof screen === "undefined") return null;
  const side = Math.min(screen.width, screen.height);
  return Number.isFinite(side) && side > 0 ? side : null;
}

/**
 * Whether the page is only wider than high because the keyboard made it lower (REQ-628): a text field has the focus and
 * the page is no wider than the screen's short side, as it is upright. A turn makes the page as wide as the long side;
 * the screen's sides stay put (or swap) on a turn, so the short side tells either way. While turning, the screen's
 * orientation may change a moment before the page's size; the width does not, so the page is not laid out upright in a
 * landscape window meanwhile.
 */
export function isLoweredByKeyboard(): boolean {
  if (typeof window === "undefined" || !isTypingInField()) return false;
  const side = screenShortSide();
  return side !== null && pageWidth() <= side + 1;
}

/**
 * Whether the device is a phone in landscape right now: the page's shape as the media query sees it, unless only the
 * keyboard made it wider than high (REQ-628). A tablet is never one (REQ-728): turned, it shows the phone's upright view,
 * also where its browser's bars leave the page as low as a phone's.
 */
export function isPhoneLandscape(): boolean {
  if (!(landscapeQuery()?.matches ?? false)) return false;
  return !isLoweredByKeyboard() && readDeviceClass() !== "tablet";
}

/** Input types without a keyboard: focusing them does not open one. */
const NO_KEYBOARD_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether a field that takes typed text has the focus, so a phone shows its keyboard (REQ-628): a text input, a text
 * area or editable content.
 */
export function isTypingInField(): boolean {
  if (typeof document === "undefined") return false;
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
  // Older engines (and jsdom) lack isContentEditable: the attribute then tells.
  const editable = element.getAttribute("contenteditable");
  if (editable !== null && editable !== "false") return true;
  return element instanceof HTMLInputElement && !NO_KEYBOARD_INPUTS.has(element.type);
}

/**
 * Media query of a phone in either orientation (REQ-531, REQ-532): narrow as on the rest of the site (30rem) or low in
 * landscape, and always with a coarse (touch) pointer, so a narrow desktop window or a tablet does not count.
 */
export const PHONE_QUERY = `(pointer: coarse) and (max-width: 30rem), ${PHONE_LANDSCAPE_QUERY}`;

function phoneQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_QUERY);
}

/**
 * Whether the page has the phone's design right now, held either way: a phone as `PHONE_QUERY` sees it, or a device the
 * central detection takes for a phone or a tablet (REQ-728, deviceClass.ts). Tablets get the phone's design with all its
 * rules and controls; where they differ from a phone, they ask `useTablet()`.
 */
export function isPhone(): boolean {
  return (phoneQuery()?.matches ?? false) || readDeviceClass() !== "desktop";
}

/**
 * Media query of a phone as the full-screen map sees it: narrow, or a phone in landscape. Unlike `PHONE_QUERY` it does
 * not ask for a touch pointer, as a narrow window has no room either: the short attribution (REQ-474, REQ-644) and no
 * search field in the map (REQ-641).
 */
export const MAP_PHONE_QUERY = `(max-width: 30rem), ${PHONE_LANDSCAPE_QUERY}`;

function mapPhoneQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(MAP_PHONE_QUERY);
}

/** Whether the full-screen map is laid out for a phone right now (`MAP_PHONE_QUERY`). */
export function isMapPhone(): boolean {
  return mapPhoneQuery()?.matches ?? false;
}

/**
 * Listens to the query's `change` and, as a fallback, to `resize` and `orientationchange`: a browser evaluates media
 * queries only in its next rendering step, so quick turns can coalesce into no `change` at all, and older browsers lack
 * `MediaQueryList.addEventListener`. `matches` is read afresh each time, so an extra call changes nothing.
 */
function subscribeTo(query: MediaQueryList | null, onChange: () => void): () => void {
  query?.addEventListener?.("change", onChange);
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    query?.removeEventListener?.("change", onChange);
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

/** As `subscribeTo`, and also to the focus moving: a text field gaining or losing it may change the answer (REQ-628). */
function subscribeLandscape(onChange: () => void): () => void {
  const unsubscribe = subscribeTo(landscapeQuery(), onChange);
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", onChange);
  return () => {
    unsubscribe();
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", onChange);
  };
}
/** As `subscribeTo`, and also to the pointer's query of the device's class (REQ-728). */
function subscribePhone(onChange: () => void): () => void {
  const unsubscribe = subscribeTo(phoneQuery(), onChange);
  const coarse = typeof window.matchMedia === "function" ? window.matchMedia(COARSE_POINTER_QUERY) : null;
  coarse?.addEventListener?.("change", onChange);
  return () => {
    unsubscribe();
    coarse?.removeEventListener?.("change", onChange);
  };
}
const subscribeMapPhone = (onChange: () => void) => subscribeTo(mapPhoneQuery(), onChange);

/** Whether the device is a phone in landscape; updates when it is rotated. */
export function usePhoneLandscape(): boolean {
  return useSyncExternalStore(subscribeLandscape, isPhoneLandscape, () => false);
}

/** Whether the page has the phone's design (a phone either way, or a tablet); updates on rotation and resize. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, isPhone, () => false);
}

/** Whether the full-screen map is laid out for a phone (`MAP_PHONE_QUERY`); updates on rotation and resize. */
export function useMapPhone(): boolean {
  return useSyncExternalStore(subscribeMapPhone, isMapPhone, () => false);
}

/** Side of the screen the camera is on when the phone is held in landscape (REQ-606); null when unknown. */
export type CameraSide = "left" | "right" | null;

/**
 * Side of the camera from the angle the screen is turned by (`screen.orientation.angle`, or `window.orientation`):
 * turned by 90° (to the left) the phone's top with the camera is at the left, by 270° or −90° (to the right) at the
 * right. In portrait (0°, 180°) or without an angle there is no camera side.
 */
export function cameraSideOf(angle: number | null | undefined): CameraSide {
  if (typeof angle !== "number" || !Number.isFinite(angle)) return null;
  const turned = ((Math.round(angle) % 360) + 360) % 360;
  if (turned === 90) return "left";
  if (turned === 270) return "right";
  return null;
}

/** Angle the screen is turned by: `screen.orientation.angle`, else the older `window.orientation`, else null. */
function screenAngle(): number | null {
  if (typeof window === "undefined") return null;
  const orientation = typeof screen === "undefined" ? undefined : screen.orientation;
  if (orientation && typeof orientation.angle === "number") return orientation.angle;
  const legacy = (window as Window & { orientation?: unknown }).orientation;
  return typeof legacy === "number" ? legacy : null;
}

/** Side of the camera right now (REQ-606). */
export function readCameraSide(): CameraSide {
  return cameraSideOf(screenAngle());
}

/** Listens to turns: the screen orientation's `change`, and `orientationchange` and `resize` as a fallback. */
function subscribeCamera(onChange: () => void): () => void {
  const orientation = typeof screen === "undefined" ? undefined : screen.orientation;
  orientation?.addEventListener?.("change", onChange);
  window.addEventListener("orientationchange", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    orientation?.removeEventListener?.("change", onChange);
    window.removeEventListener("orientationchange", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/** Side of the camera; updates when the phone is turned (REQ-606). */
export function useCameraSide(): CameraSide {
  return useSyncExternalStore(subscribeCamera, readCameraSide, () => null);
}
