// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Where to allow the location again after the browser denied it (REQ-509): detects platform and browser from the user
 * agent and picks the matching hint. Pure functions; the picker passes `navigator`, the tests a table of real strings.
 */
import type { MessageKey } from "../../i18n/index.ts";
import { detectBrowser, type Browser, type BrowserInfo, type NavigatorLike } from "../../state/browser.ts";

// Platform and browser detection moved to state/browser.ts (REQ-611); still offered here.
export {
  detectBrowser,
  type Browser,
  type BrowserInfo,
  type NavigatorLike,
  type Platform,
} from "../../state/browser.ts";

export interface LocationHint {
  key: MessageKey;
  /** `{app}`: name of the iOS app whose location access is meant. */
  params?: Readonly<Record<string, string>>;
}

const APP_NAMES: Partial<Record<Browser, string>> = {
  chrome: "Chrome",
  firefox: "Firefox",
  edge: "Edge",
  opera: "Opera",
};

/** The hint for a browser: a message key and, on iOS apps, their name. */
export function locationHint(info: BrowserInfo): LocationHint {
  const { platform, browser } = info;
  if (platform === "ios") {
    // From iOS 18 the apps are listed under Settings › Apps; before, directly in Settings.
    const legacy = info.iosVersion !== undefined && info.iosVersion < 18;
    if (browser === "safari") {
      return { key: legacy ? "location.gps.hint.iosSafariLegacy" : "location.gps.hint.iosSafari" };
    }
    const app = APP_NAMES[browser];
    if (app) return { key: legacy ? "location.gps.hint.iosAppLegacy" : "location.gps.hint.iosApp", params: { app } };
    return { key: "location.gps.hint.ios" };
  }
  if (platform === "android") {
    if (browser === "chrome") return { key: "location.gps.hint.androidChrome" };
    if (browser === "samsung") return { key: "location.gps.hint.androidSamsung" };
    if (browser === "firefox") return { key: "location.gps.hint.androidFirefox" };
    return { key: "location.gps.hint.android" };
  }
  if (browser === "chrome" || browser === "edge" || browser === "opera") return { key: "location.gps.hint.chromium" };
  if (browser === "firefox") return { key: "location.gps.hint.firefox" };
  if (browser === "safari") return { key: "location.gps.hint.safariMac" };
  return { key: "location.gps.hint.generic" };
}

/** The hint for the browser the page runs in. */
export function currentLocationHint(): LocationHint {
  return locationHint(detectBrowser(typeof navigator === "undefined" ? {} : (navigator as NavigatorLike)));
}
