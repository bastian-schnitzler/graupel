// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useSyncExternalStore } from "react";

/** Chromium's install prompt event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

/**
 * How the page can be installed right now:
 * - `prompt`: the browser offered an install prompt (`beforeinstallprompt`, Chromium); the download button shows it.
 * - `manual`: the browser has no install prompt at all (Safari, Firefox); the download button shows instructions.
 * - `none`: a browser with install prompts that has not offered one (already installed, not installable, or the
 *   prompt was just used) or the app was installed (`appinstalled`); no download button.
 */
export type InstallAvailability = "prompt" | "manual" | "none";

/** Result of `install()`: the user's choice, or `unavailable` without a kept prompt. */
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallPromptStore {
  getSnapshot: () => InstallAvailability;
  subscribe: (listener: () => void) => () => void;
  /** Shows the kept install prompt (once per prompt event). */
  install: () => Promise<InstallOutcome>;
  /** Removes the event listeners. */
  dispose: () => void;
}

type InstallWindow = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Keeps the install prompt of a window. It must be created before the page renders: Chromium fires
 * `beforeinstallprompt` once, possibly while `config.json` is still loading.
 */
export function createInstallPromptStore(win: InstallWindow): InstallPromptStore {
  const supportsPrompt = "onbeforeinstallprompt" in win;
  let deferred: BeforeInstallPromptEvent | null = null;
  let installed = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const onPrompt = (event: Event) => {
    // Keep the event and suppress the browser's own mini-infobar; the download button shows the prompt.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    installed = false;
    notify();
  };
  const onInstalled = () => {
    deferred = null;
    installed = true;
    notify();
  };
  win.addEventListener("beforeinstallprompt", onPrompt);
  win.addEventListener("appinstalled", onInstalled);

  return {
    getSnapshot() {
      if (installed) return "none";
      if (deferred) return "prompt";
      return supportsPrompt ? "none" : "manual";
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async install() {
      const event = deferred;
      if (!event) return "unavailable";
      // A prompt event can be used once; Chromium sends a new one if the user dismisses it.
      deferred = null;
      notify();
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome;
    },
    dispose() {
      win.removeEventListener("beforeinstallprompt", onPrompt);
      win.removeEventListener("appinstalled", onInstalled);
      listeners.clear();
    },
  };
}

const noPromptStore: InstallPromptStore = {
  getSnapshot: () => "none",
  subscribe: () => () => {},
  install: async () => "unavailable",
  dispose: () => {},
};

/** Store of the page's own window, created when this module loads (before the first render). */
export const installPromptStore: InstallPromptStore =
  typeof window === "undefined" ? noPromptStore : createInstallPromptStore(window);

/** Current install availability; re-renders on `beforeinstallprompt`, `appinstalled` and after `install()`. */
export function useInstallAvailability(store: InstallPromptStore = installPromptStore): InstallAvailability {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => "none");
}

/**
 * Platform whose install instructions the dialog shows when the browser has no install prompt. Each names only what
 * works on this device (REQ-658): `desktop` (Windows, Linux, ChromeOS: Chrome or Edge), `macosOther` (a Mac browser
 * other than Safari: Safari's Add to Dock, or Chrome or Edge).
 */
export type InstallPlatform = "ios" | "android" | "macos" | "macosOther" | "desktop";

/**
 * Platform from the user agent: iPhone/iPad in any browser (Safari, Chrome, Edge, Firefox; also the iPad with a
 * desktop user agent), Android, Safari on a Mac, another browser on a Mac, otherwise a desktop system (REQ-658).
 */
export function installPlatform(nav: Pick<Navigator, "userAgent" | "maxTouchPoints">): InstallPlatform {
  const ua = nav.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) {
    const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua);
    return safari ? "macos" : "macosOther";
  }
  return "desktop";
}
