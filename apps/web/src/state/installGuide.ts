// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Install steps for browsers without an install prompt (REQ-775): which steps, with which pictures, fit this device,
 * this browser and its version. The buttons sit in different places from one version to the next (Safari's Share at
 * the bottom up to iOS 18; from iOS 26 in the bar or, with the compact bar, in the menu "…"; Chrome's in the address
 * bar), so the user agent decides.
 * A browser that cannot install at all keeps the hint without pictures (REQ-658). A pure function; the dialog passes
 * `navigator`, the tests a table of real user agent strings.
 */
import { detectBrowser, type NavigatorLike } from "./browser.ts";

/** Device the steps are drawn for. */
export type InstallDevice = "iphone" | "ipad" | "mac" | "android";

/** Browser named in the dialog's lead (a product name, the same in every language). */
export type InstallBrowserName = "Safari" | "Chrome" | "Edge" | "Firefox" | "Samsung Internet";

/**
 * One step: its picture, also the key of its line of text (`install.step.<picture>`). The pictures of the menus that
 * sit elsewhere on the iPad (Firefox's menu) follow the guide's device.
 */
export type InstallPicture =
  | "safariBarBottom"
  | "safariShareOrMore"
  | "safariBarTop"
  | "addressShare"
  | "firefoxMenu"
  | "shareSheetMore"
  | "shareSheet"
  | "homeScreen"
  | "macMenuBar"
  | "macFileMenu"
  | "dock"
  | "samsungMenu"
  | "samsungAdd"
  | "androidMenu"
  | "firefoxMore"
  | "firefoxAdd"
  | "androidHome";

/** Guides with pictures. */
export type InstallGuideId =
  | "iphoneSafari"
  | "iphoneSafari26"
  | "ipadSafari"
  | "iosChrome"
  | "iosEdge"
  | "iosFirefox"
  | "macSafari"
  | "androidSamsung"
  | "androidFirefox";

/**
 * Hints without pictures (`install.<hint>`), each naming only what works on this device (REQ-658): `ios` (another
 * browser on the iPhone or iPad), `iosSafari` (Chrome, Edge or Firefox before iOS 16.4, which could not add to the
 * home screen yet), `android` (another Android browser), `macosUpdate` (Safari before 17, without Add to Dock),
 * `macosOther` (another browser on a Mac), `desktop` (Windows, Linux, ChromeOS).
 */
export type InstallHint = "ios" | "iosSafari" | "android" | "macosUpdate" | "macosOther" | "desktop";

/** Extra line below the steps (`install.note.<note>`). */
export type InstallNote = "ipad26" | "mac";

export interface InstallSteps {
  kind: "steps";
  guide: InstallGuideId;
  device: InstallDevice;
  browser: InstallBrowserName;
  steps: readonly InstallPicture[];
  note?: InstallNote;
}

export interface InstallHintOnly {
  kind: "hint";
  hint: InstallHint;
}

export type InstallGuide = InstallSteps | InstallHintOnly;

/** Share sheet and home screen: the last two steps on the iPhone and iPad in every browser. */
const IOS_END = ["shareSheet", "homeScreen"] as const;

const GUIDES: Readonly<Record<InstallGuideId, readonly InstallPicture[]>> = {
  iphoneSafari: ["safariBarBottom", ...IOS_END],
  // iOS 26 on the iPhone (REQ-844): the share sheet lists "Add to Home Screen" only after "Show More" at the end of its
  // row of actions (Copy, Add Bookmark, Add to Reading List). Up to iOS 18 the sheet is one long list without it.
  iphoneSafari26: ["safariShareOrMore", "shareSheetMore", ...IOS_END],
  ipadSafari: ["safariBarTop", ...IOS_END],
  iosChrome: ["addressShare", ...IOS_END],
  iosEdge: ["addressShare", ...IOS_END],
  iosFirefox: ["firefoxMenu", ...IOS_END],
  macSafari: ["macMenuBar", "macFileMenu", "dock"],
  androidSamsung: ["samsungMenu", "samsungAdd", "androidHome"],
  // Firefox on Android (REQ-847): the menu "⋮" opens as a sheet from the bottom, which lists "Add app to Home screen"
  // only after "More" is expanded.
  androidFirefox: ["androidMenu", "firefoxMore", "firefoxAdd", "androidHome"],
};

function steps(
  guide: InstallGuideId,
  device: InstallDevice,
  browser: InstallBrowserName,
  note?: InstallNote,
): InstallSteps {
  const result: InstallSteps = { kind: "steps", guide, device, browser, steps: GUIDES[guide] };
  return note ? { ...result, note } : result;
}

const hint = (name: InstallHint): InstallHintOnly => ({ kind: "hint", hint: name });

/**
 * Whether another browser than Safari can add to the home screen: from iOS 16.4. The OS token of these browsers is not
 * frozen (only Safari's is, from iOS 26); without one (an iPad asking for desktop pages) it is a current system.
 */
function appsCanInstall(ua: string): boolean {
  const os = /OS (\d+)_(\d+)/.exec(ua);
  if (!os) return true;
  const [major, minor] = [Number(os[1]), Number(os[2])];
  return major > 16 || (major === 16 && minor >= 4);
}

/** Steps or hint for a browser without install prompt, by platform, browser and version (REQ-775, REQ-658). */
export function installGuide(nav: NavigatorLike): InstallGuide {
  const ua = nav.userAgent ?? "";
  const info = detectBrowser(nav);
  if (info.platform === "ios") {
    // The iPad may ask for desktop pages with a Mac user agent; detectBrowser tells it by its touch screen.
    const device: InstallDevice = /iPhone|iPod/.test(ua) ? "iphone" : "ipad";
    // From iOS 26 Safari's user agent keeps the OS at 18_x; detectBrowser takes the real version from `Version/`.
    const ios26 = (info.iosVersion ?? 0) >= 26;
    switch (info.browser) {
      case "safari":
        // From iOS 26 Safari has the bars Compact (Share in "…"), Bottom and Top (Share in the bar), which the page
        // cannot tell apart: step 1 names Share in the bar first, then "…" (REQ-808).
        if (device === "iphone") return ios26 ? steps("iphoneSafari26", device, "Safari") : steps("iphoneSafari", device, "Safari");
        // Safari on the iPad keeps Share at the top right; only its optional compact bar (iPadOS 26.4) moves it into "…".
        return ios26 ? steps("ipadSafari", device, "Safari", "ipad26") : steps("ipadSafari", device, "Safari");
      case "chrome":
        return appsCanInstall(ua) ? steps("iosChrome", device, "Chrome") : hint("iosSafari");
      case "edge":
        return appsCanInstall(ua) ? steps("iosEdge", device, "Edge") : hint("iosSafari");
      case "firefox":
        return appsCanInstall(ua) ? steps("iosFirefox", device, "Firefox") : hint("iosSafari");
      default:
        return hint("ios");
    }
  }
  if (info.platform === "android") {
    if (info.browser === "samsung") return steps("androidSamsung", "android", "Samsung Internet");
    if (info.browser === "firefox") return steps("androidFirefox", "android", "Firefox");
    return hint("android");
  }
  if (/Macintosh/.test(ua)) {
    if (info.browser !== "safari") return hint("macosOther");
    // Add to Dock came with Safari 17 (macOS Sonoma); the Mac's OS token is frozen at 10_15_7.
    const version = Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0);
    return version >= 17 ? steps("macSafari", "mac", "Safari", "mac") : hint("macosUpdate");
  }
  return hint("desktop");
}
