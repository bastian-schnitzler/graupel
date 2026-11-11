// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colour mode of the page for the meteogram: `data-theme="light" | "dark"` on <html> forces it, otherwise the system
 * preference applies (same rules as styles/tokens.css).
 */
import { useSyncExternalStore } from "react";

export type PageTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function darkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_QUERY);
}

/** The page's colour mode right now. */
export function pageTheme(): PageTheme {
  if (typeof document === "undefined") return "light";
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return darkQuery()?.matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const query = darkQuery();
  query?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    query?.removeEventListener("change", onChange);
  };
}

/** The page's colour mode; updates when `data-theme` or the system preference changes. */
export function usePageTheme(): PageTheme {
  return useSyncExternalStore(subscribe, pageTheme, () => "light");
}
