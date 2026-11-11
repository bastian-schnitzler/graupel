// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { LANGUAGES, MESSAGES, translate, type MessageKey } from "../src/i18n/index.ts";
import {
  detectBrowser,
  locationHint,
  type BrowserInfo,
  type NavigatorLike,
} from "../src/regions/LocationPicker/index.ts";
import { isIphoneSafari } from "../src/state/browser.ts";

/** Real user agents (some reduced by the browsers, e.g. `Android 10; K`). */
const CASES: readonly [string, NavigatorLike, BrowserInfo, MessageKey][] = [
  [
    "iPhone Safari, iOS 18",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { platform: "ios", browser: "safari", iosVersion: 18 },
    "location.gps.hint.iosSafari",
  ],
  [
    "iPhone Safari, iOS 26 (OS frozen at 18_6)",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { platform: "ios", browser: "safari", iosVersion: 26 },
    "location.gps.hint.iosSafari",
  ],
  [
    "iPhone Safari, iOS 17",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { platform: "ios", browser: "safari", iosVersion: 17 },
    "location.gps.hint.iosSafariLegacy",
  ],
  [
    "iPad Safari, desktop user agent",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    { platform: "ios", browser: "safari", iosVersion: 18 },
    "location.gps.hint.iosSafari",
  ],
  [
    "iPad Safari, iPadOS 16",
    {
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
    },
    { platform: "ios", browser: "safari", iosVersion: 16 },
    "location.gps.hint.iosSafariLegacy",
  ],
  [
    "iPhone Chrome, iOS 18",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
    },
    { platform: "ios", browser: "chrome", iosVersion: 18 },
    "location.gps.hint.iosApp",
  ],
  [
    "iPhone Chrome, iOS 17",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    },
    { platform: "ios", browser: "chrome", iosVersion: 17 },
    "location.gps.hint.iosAppLegacy",
  ],
  [
    "iPhone Firefox",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
    },
    { platform: "ios", browser: "firefox", iosVersion: 18 },
    "location.gps.hint.iosApp",
  ],
  [
    "iPhone Edge",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/129.0.2792.84 Mobile/15E148 Safari/605.1.15",
    },
    { platform: "ios", browser: "edge", iosVersion: 18 },
    "location.gps.hint.iosApp",
  ],
  [
    "iPhone in-app browser",
    {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.31.104]",
    },
    { platform: "ios", browser: "other", iosVersion: 17 },
    "location.gps.hint.ios",
  ],
  [
    "Android Chrome",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      userAgentData: { platform: "Android", mobile: true, brands: [{ brand: "Google Chrome" }, { brand: "Chromium" }] },
    },
    { platform: "android", browser: "chrome" },
    "location.gps.hint.androidChrome",
  ],
  [
    "Samsung Internet",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    },
    { platform: "android", browser: "samsung" },
    "location.gps.hint.androidSamsung",
  ],
  [
    "Firefox Android",
    { userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0" },
    { platform: "android", browser: "firefox" },
    "location.gps.hint.androidFirefox",
  ],
  [
    "Edge Android",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
    },
    { platform: "android", browser: "edge" },
    "location.gps.hint.android",
  ],
  [
    "Android WebView",
    {
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36",
    },
    { platform: "android", browser: "other" },
    "location.gps.hint.android",
  ],
  [
    "Chrome Windows",
    {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    },
    { platform: "desktop", browser: "chrome" },
    "location.gps.hint.chromium",
  ],
  [
    "Chrome macOS",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      maxTouchPoints: 0,
    },
    { platform: "desktop", browser: "chrome" },
    "location.gps.hint.chromium",
  ],
  [
    "Edge Windows",
    {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    },
    { platform: "desktop", browser: "edge" },
    "location.gps.hint.chromium",
  ],
  [
    "Opera Windows",
    {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
    },
    { platform: "desktop", browser: "opera" },
    "location.gps.hint.chromium",
  ],
  [
    "Firefox Windows",
    { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0" },
    { platform: "desktop", browser: "firefox" },
    "location.gps.hint.firefox",
  ],
  [
    "Firefox Linux",
    { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" },
    { platform: "desktop", browser: "firefox" },
    "location.gps.hint.firefox",
  ],
  [
    "Safari macOS",
    {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      maxTouchPoints: 0,
    },
    { platform: "desktop", browser: "safari" },
    "location.gps.hint.safariMac",
  ],
  [
    "unknown",
    { userAgent: "Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/25.0.1" },
    { platform: "desktop", browser: "other" },
    "location.gps.hint.generic",
  ],
  ["no navigator data", {}, { platform: "desktop", browser: "other" }, "location.gps.hint.generic"],
];

const HINT_KEYS = Object.keys(MESSAGES.en).filter((key) => key.startsWith("location.gps.hint.")) as MessageKey[];

describe("browser detection for the location hint (REQ-509)", () => {
  it.each(CASES)("%s", (_name, nav, info, key) => {
    expect(detectBrowser(nav)).toEqual(info);
    expect(locationHint(info).key).toBe(key);
  });

  it("names the iOS app", () => {
    expect(locationHint({ platform: "ios", browser: "chrome", iosVersion: 18 }).params).toEqual({ app: "Chrome" });
    expect(locationHint({ platform: "ios", browser: "firefox", iosVersion: 17 }).params).toEqual({ app: "Firefox" });
    expect(locationHint({ platform: "ios", browser: "edge" })).toEqual({
      key: "location.gps.hint.iosApp",
      params: { app: "Edge" },
    });
  });

  it("has every hint in every language, with the app name where it is used", () => {
    expect(HINT_KEYS).toHaveLength(13);
    for (const language of LANGUAGES) {
      for (const key of HINT_KEYS) {
        expect(MESSAGES[language][key], `${language} ${key}`).toBeTruthy();
        const appCount = /iosApp/.test(key) ? 1 : 0;
        expect((MESSAGES[language][key]!.match(/\{app\}/g) ?? []).length, `${language} ${key}`).toBe(appCount);
      }
    }
  });
});

describe("location hint texts (REQ-509)", () => {
  const text = (language: "de" | "en", nav: NavigatorLike) => {
    const hint = locationHint(detectBrowser(nav));
    return translate(language, hint.key, hint.params);
  };
  const ua = (name: string) => CASES.find(([caseName]) => caseName === name)![1];

  it("iOS Safari: Settings › Apps › Safari › Location and Location Services", () => {
    expect(text("de", ua("iPhone Safari, iOS 18"))).toBe(
      "So erlauben Sie ihn: Einstellungen › Apps › Safari › Standort auf „Fragen“ oder „Erlauben“ stellen. Außerdem müssen unter Einstellungen › Datenschutz & Sicherheit › Ortungsdienste die Ortungsdienste an sein und „Safari-Websites“ auf „Beim Verwenden der App“ stehen.",
    );
    expect(text("en", ua("iPhone Safari, iOS 18"))).toBe(
      "To allow it, set Settings › Apps › Safari › Location to “Ask” or “Allow”. Location Services must also be on under Settings › Privacy & Security › Location Services, with “Safari Websites” set to “While Using the App”.",
    );
    expect(text("de", ua("iPhone Safari, iOS 17"))).toContain("Einstellungen › Safari › Standort");
    expect(text("en", ua("iPad Safari, iPadOS 16"))).toContain("Settings › Safari › Location");
  });

  it("iOS Chrome, Firefox, Edge: the app's location in the iOS settings", () => {
    expect(text("de", ua("iPhone Chrome, iOS 18"))).toBe(
      "So erlauben Sie ihn: Einstellungen › Apps › Chrome › Standort auf „Beim Verwenden der App“ stellen. Außerdem müssen die Ortungsdienste an sein (Einstellungen › Datenschutz & Sicherheit › Ortungsdienste).",
    );
    expect(text("en", ua("iPhone Firefox"))).toBe(
      "To allow it, set Settings › Apps › Firefox › Location to “While Using the App”. Location Services must also be on (Settings › Privacy & Security › Location Services).",
    );
    expect(text("de", ua("iPhone Chrome, iOS 17"))).toContain("Einstellungen › Chrome › Standort");
    expect(text("en", ua("iPhone Edge"))).toContain("Settings › Apps › Edge › Location");
    expect(text("de", ua("iPhone in-app browser"))).toContain("Datenschutz & Sicherheit › Ortungsdienste");
  });

  it("Android: Chrome, Samsung Internet, Firefox and others", () => {
    expect(text("de", ua("Android Chrome"))).toBe(
      "So erlauben Sie ihn: in Chrome ⋮ › Einstellungen › Website-Einstellungen › Standort öffnen und diese Website erlauben. Außerdem muss der Standort in den Android-Einstellungen an sein.",
    );
    expect(text("en", ua("Android Chrome"))).toBe(
      "To allow it, open ⋮ › Settings › Site settings › Location in Chrome and allow this site. Location must also be on in the Android settings.",
    );
    expect(text("de", ua("Samsung Internet"))).toContain("Samsung Internet");
    expect(text("en", ua("Samsung Internet"))).toContain("Samsung Internet");
    expect(text("de", ua("Firefox Android"))).toContain("Schloss links neben der Adresse");
    expect(text("en", ua("Firefox Android"))).toContain("padlock left of the address");
    expect(text("en", ua("Edge Android"))).toBe(
      "To allow it, allow location for this site in the browser settings. Location must also be on in the Android settings.",
    );
  });

  it("desktop: Chromium browsers, Firefox, Safari and the fallback", () => {
    for (const name of ["Chrome Windows", "Chrome macOS", "Edge Windows", "Opera Windows"]) {
      expect(text("de", ua(name))).toBe(
        "So erlauben Sie ihn: links neben der Adresse auf das Symbol für die Website-Informationen klicken, „Standort“ erlauben und die Seite neu laden.",
      );
      expect(text("en", ua(name))).toBe(
        "To allow it, click the site information icon left of the address, allow “Location” and reload the page.",
      );
    }
    expect(text("de", ua("Firefox Windows"))).toBe(
      "So erlauben Sie ihn: links neben der Adresse auf das durchgestrichene Standort-Symbol klicken, die Blockierung mit ✕ aufheben und es erneut versuchen.",
    );
    expect(text("en", ua("Firefox Linux"))).toBe(
      "To allow it, click the crossed-out location icon left of the address, clear the block with ✕ and try again.",
    );
    expect(text("de", ua("Safari macOS"))).toContain("Safari › Einstellungen … › Websites › Standort");
    expect(text("en", ua("Safari macOS"))).toContain("Safari › Settings… › Websites › Location");
    expect(text("de", ua("unknown"))).toBe("Sie können ihn in den Browser-Einstellungen erlauben.");
    expect(text("en", ua("unknown"))).toBe("You can allow it in the browser settings.");
  });
});

describe("isIphoneSafari (REQ-581, REQ-611)", () => {
  it("is Safari on the iPhone only: not Chrome, Firefox, Edge or an app there, not the iPad or others", () => {
    for (const [name, nav] of CASES) {
      expect(isIphoneSafari(nav), name).toBe(name.startsWith("iPhone Safari"));
    }
    expect(CASES.filter(([name]) => name.startsWith("iPhone Safari"))).toHaveLength(3);
    expect(isIphoneSafari({})).toBe(false);
  });
});
