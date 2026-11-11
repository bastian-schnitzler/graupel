// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useSyncExternalStore } from "react";

/** Whether the page runs as a website in a browser tab or as the installed app (REQ-425). */
export type AppMode = "website" | "installed";

/**
 * Display modes of an installed app. `standalone` is what iPhone, iPad and desktops install it as;
 * `window-controls-overlay` is an installed desktop app with its title bar hidden. `fullscreen`, which the manifest
 * asks for since REQ-755, is handled apart (FULLSCREEN_DISPLAY_MODE): a browser tab in F11 fullscreen or with an
 * element in fullscreen may match it too.
 */
export const INSTALLED_DISPLAY_MODES = ["(display-mode: standalone)", "(display-mode: window-controls-overlay)"];

/**
 * The installed app on Android (REQ-755): the manifest opens it in fullscreen, without status and navigation bar. It
 * counts as installed only with a touch screen as main pointer (desktops install it as `standalone`, so fullscreen
 * there is F11) and only when the page starts in it with no element in fullscreen (a browser tab gets there only
 * later, e.g. through the meteogram's fullscreen); the app stays in fullscreen, so this holds for the page's life.
 */
export const FULLSCREEN_DISPLAY_MODE = "(display-mode: fullscreen)";
const TOUCH_POINTER = "(pointer: coarse)";

/** The parts of `window` the detection uses (a stand-in in tests). */
export type AppModeWindow = Pick<Window, "matchMedia"> & {
  navigator: Navigator & { standalone?: boolean };
  document?: Pick<Document, "fullscreenElement">;
};

export interface AppModeStore {
  getSnapshot: () => AppMode;
  subscribe: (listener: () => void) => () => void;
}

function mediaQueries(win: AppModeWindow): MediaQueryList[] {
  if (typeof win.matchMedia !== "function") return [];
  return INSTALLED_DISPLAY_MODES.map((query) => win.matchMedia(query));
}

/** Whether the window shows the installed app in fullscreen, as on Android (REQ-755, FULLSCREEN_DISPLAY_MODE). */
export function fullscreenApp(win: AppModeWindow): boolean {
  if (typeof win.matchMedia !== "function" || win.document?.fullscreenElement) return false;
  return win.matchMedia(FULLSCREEN_DISPLAY_MODE).matches && win.matchMedia(TOUCH_POINTER).matches;
}

/**
 * Current mode: installed when a display-mode query of an app matches, the app runs in fullscreen (`fullscreen`;
 * without it, whether it does now) or iOS reports a home-screen app.
 */
export function detectAppMode(win: AppModeWindow, fullscreen = fullscreenApp(win)): AppMode {
  if (win.navigator.standalone === true || fullscreen) return "installed";
  return mediaQueries(win).some((query) => query.matches) ? "installed" : "website";
}

/** Mode of a window that follows changes of the display mode (e.g. a tab opened in the installed app). */
export function createAppModeStore(win: AppModeWindow): AppModeStore {
  // Fullscreen as at the start: an element in fullscreen later neither makes a tab the app nor the app a tab.
  const fullscreen = fullscreenApp(win);
  return {
    getSnapshot: () => detectAppMode(win, fullscreen),
    subscribe(listener) {
      const queries = mediaQueries(win);
      for (const query of queries) query.addEventListener?.("change", listener);
      return () => {
        for (const query of queries) query.removeEventListener?.("change", listener);
      };
    },
  };
}

const websiteStore: AppModeStore = { getSnapshot: () => "website", subscribe: () => () => {} };

/** Store of the page's own window. */
export const appModeStore: AppModeStore = typeof window === "undefined" ? websiteStore : createAppModeStore(window);

/** `"website"` or `"installed"`; re-renders when the display mode changes. Later app features branch on it. */
export function useAppMode(store: AppModeStore = appModeStore): AppMode {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => "website");
}
