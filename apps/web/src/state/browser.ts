// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Platform and browser of the page from the user agent: for the hint where to allow the location again (REQ-509) and
 * for the room the page leaves below the footer for Safari's bar on the iPhone (REQ-581, REQ-611). Pure functions; the
 * callers pass `navigator`, the tests a table of real strings.
 */
export type Platform = "ios" | "android" | "desktop";
export type Browser = "safari" | "chrome" | "edge" | "firefox" | "opera" | "samsung" | "other";

export interface BrowserInfo {
  platform: Platform;
  browser: Browser;
  /** Major version of iOS/iPadOS (from `OS 17_4` or, on the iPad and in iOS 26, Safari's `Version/`). */
  iosVersion?: number;
}

/** What the detection reads of `navigator`. */
export interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean; brands?: readonly { brand: string }[] };
}

const IOS_APPS: readonly [RegExp, Browser][] = [
  [/CriOS\//, "chrome"],
  [/FxiOS\//, "firefox"],
  [/EdgiOS\//, "edge"],
  [/OPiOS\/|OPT\//, "opera"],
];

function iosVersion(ua: string): number | undefined {
  const os = /OS (\d+)[_.]\d/.exec(ua);
  const safari = /Version\/(\d+)/.exec(ua);
  // iOS 26 freezes the OS in the user agent at 18_x and tells the real version only in `Version/`.
  const versions = [os, safari].flatMap((match) => (match ? [Number(match[1])] : []));
  return versions.length > 0 ? Math.max(...versions) : undefined;
}

/** Platform and browser of a navigator; unknown browsers are `other`, unknown systems `desktop`. */
export function detectBrowser(nav: NavigatorLike): BrowserInfo {
  const ua = nav.userAgent ?? "";
  const touch = nav.maxTouchPoints ?? 0;
  // iPhone, iPod and the iPad, which asks for desktop pages with a Mac user agent but has a touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) {
    const app = IOS_APPS.find(([pattern]) => pattern.test(ua));
    const browser: Browser = app ? app[1] : /Safari\//.test(ua) ? "safari" : "other";
    const version = iosVersion(ua);
    return version === undefined ? { platform: "ios", browser } : { platform: "ios", browser, iosVersion: version };
  }
  const android = /Android/.test(ua) || nav.userAgentData?.platform === "Android";
  const brands = (nav.userAgentData?.brands ?? []).map(({ brand }) => brand);
  let browser: Browser = "other";
  if (/SamsungBrowser\//.test(ua) || brands.includes("Samsung Internet")) browser = "samsung";
  else if (/Edg(A|e)?\//.test(ua) || brands.includes("Microsoft Edge")) browser = "edge";
  else if (/OPR\/|Opera/.test(ua) || brands.includes("Opera")) browser = "opera";
  else if (/Firefox\//.test(ua)) browser = "firefox";
  else if (/Chrome\/|Chromium\//.test(ua) && !/; wv\)|YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser/.test(ua))
    browser = "chrome";
  else if (/Safari\//.test(ua) && /Macintosh/.test(ua)) browser = "safari";
  return { platform: android ? "android" : "desktop", browser };
}

/**
 * Safari on the iPhone (or iPod), whose bottom bar lies over the page (REQ-581): not the other browsers on the iPhone
 * (Chrome, Firefox, Edge, Opera), not the iPad, Android or the desktop (REQ-611).
 */
export function isIphoneSafari(nav: NavigatorLike): boolean {
  return /iPhone|iPod/.test(nav.userAgent ?? "") && detectBrowser(nav).browser === "safari";
}

/** Whether the page runs in Safari on the iPhone. */
export function inIphoneSafari(): boolean {
  return typeof navigator !== "undefined" && isIphoneSafari(navigator as NavigatorLike);
}
