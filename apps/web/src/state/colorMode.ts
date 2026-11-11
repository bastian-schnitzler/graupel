// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colour mode of the page (REQ-426): light, dark or the system preference. The choice is kept in `localStorage`
 * and applied as `data-theme="light" | "dark"` on <html>; "system" removes the attribute, so the tokens in
 * styles/tokens.css and the meteogram (`usePageTheme`) follow `prefers-color-scheme`.
 *
 * The browser's and the installed app's bars (meta theme-color: iOS status bar and the area above the page when it is
 * pulled down) take the page's background colour (REQ-750) and follow the chosen mode too.
 */
import { useCallback, useSyncExternalStore } from "react";

export const COLOR_MODES = ["system", "light", "dark"] as const;

export type ColorMode = (typeof COLOR_MODES)[number];

/** `localStorage` key of the chosen colour mode. */
export const COLOR_MODE_STORAGE_KEY = "graupel.colorMode";

/** Default without a stored choice. */
export const DEFAULT_COLOR_MODE: ColorMode = "system";

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (COLOR_MODES as readonly string[]).includes(value);
}

/** Stored choice, or `system` (also when storage is unavailable or holds something else). */
export function readStoredColorMode(): ColorMode {
  try {
    const value = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    return isColorMode(value) ? value : DEFAULT_COLOR_MODE;
  } catch {
    return DEFAULT_COLOR_MODE;
  }
}

/**
 * Background colour of the page (`--color-bg` in styles/tokens.css) per colour scheme (REQ-750). index.html (meta
 * theme-color) and public/manifest.webmanifest repeat it; test/pageBackground.test.ts keeps them equal.
 */
export const PAGE_BACKGROUND = { light: "#f4f6f8", dark: "#11161c" } as const;

/**
 * Sets the meta theme-color tags of index.html (one per `prefers-color-scheme`) to the page background of the mode:
 * each its own scheme's colour for `system`, both the forced scheme's colour for `light` and `dark` (REQ-750).
 */
export function applyThemeColor(mode: ColorMode, doc: Document = document): void {
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = mode !== "system" ? mode : /\bdark\b/.test(meta.media) ? "dark" : "light";
    meta.content = PAGE_BACKGROUND[scheme];
  }
}

/** Sets `data-theme` on <html> for the mode (`system` removes it) and the theme-color to match. */
export function applyColorMode(mode: ColorMode, root: HTMLElement = document.documentElement): void {
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  applyThemeColor(mode, root.ownerDocument);
}

const listeners = new Set<() => void>();
// Choice made in this tab (also kept when storage fails); before any choice the stored value counts.
let current: ColorMode | null = null;

/** Stores the choice (`system` removes it), applies it to the page and tells every `useColorMode()`. */
export function setColorMode(mode: ColorMode): void {
  try {
    if (mode === DEFAULT_COLOR_MODE) window.localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
    else window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode or blocked storage: the choice applies to this visit only.
  }
  current = mode;
  applyColorMode(mode);
  for (const listener of listeners) listener();
}

function snapshot(): ColorMode {
  return current ?? readStoredColorMode();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed the choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== COLOR_MODE_STORAGE_KEY && event.key !== null) return;
    current = readStoredColorMode();
    applyColorMode(current);
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Applies the stored choice to the page; called once before the first render to avoid a flash. */
export function initColorMode(): void {
  current = null;
  applyColorMode(readStoredColorMode());
}

/** Chosen colour mode and a setter that stores and applies it. */
export function useColorMode(): [ColorMode, (mode: ColorMode) => void] {
  const mode = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_COLOR_MODE);
  const set = useCallback((next: ColorMode) => setColorMode(next), []);
  return [mode, set];
}
