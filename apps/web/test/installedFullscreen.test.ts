// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Installed app on Android without the system's bars (REQ-755, DEC-102): the manifest asks for fullscreen, with
 * standalone as fallback (iPhone, iPad and desktops know no fullscreen for an installed page and keep standalone), and
 * its bars' colours stay the page background. The page counts such a fullscreen app as installed, but not a browser
 * tab in fullscreen. e2e/installed-fullscreen.spec.ts checks the layout in the browser.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FULLSCREEN_DISPLAY_MODE,
  PAGE_BACKGROUND,
  createAppModeStore,
  detectAppMode,
  fullscreenApp,
  type AppModeWindow,
} from "../src/state/index.ts";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path: string) => readFileSync(join(APP_DIR, path), "utf8");

describe("manifest of the installed app (REQ-755, DEC-102)", () => {
  const manifests = () => {
    const app = read("public/manifest.webmanifest");
    return [["app", app]] as [string, string][];
  };

  it("asks for fullscreen and falls back to standalone", () => {
    for (const [name, text] of manifests()) {
      const manifest = JSON.parse(text);
      expect(manifest.display, name).toBe("fullscreen");
      expect(manifest.display_override, name).toEqual(["fullscreen", "standalone"]);
    }
  });

  it("colours bars and splash screen in the page background, never the old blue", () => {
    for (const [name, text] of manifests()) {
      const manifest = JSON.parse(text);
      expect(manifest.theme_color, name).toBe(PAGE_BACKGROUND.light);
      expect(manifest.background_color, name).toBe(PAGE_BACKGROUND.light);
      expect(manifest.user_preferences.color_scheme.dark, name).toEqual({
        theme_color: PAGE_BACKGROUND.dark,
        background_color: PAGE_BACKGROUND.dark,
      });
      expect(text.toLowerCase(), name).not.toContain("#1f6fb2");
    }
  });
});

/** A window stand-in: which media queries match, an element in fullscreen, iOS's navigator.standalone. */
function fakeWindow({
  queries = [] as string[],
  fullscreenElement = null as Element | null,
  standalone = undefined as boolean | undefined,
} = {}) {
  const matching = new Set(queries);
  const win: AppModeWindow = {
    matchMedia: (query: string) =>
      ({
        media: query,
        get matches() {
          return matching.has(query);
        },
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
    navigator: { standalone } as AppModeWindow["navigator"],
    document: { fullscreenElement },
  };
  return { win, matching };
}

const TOUCH = "(pointer: coarse)";

describe("installed app in fullscreen (REQ-755)", () => {
  it("is installed in fullscreen on a touch screen, as the app on an Android phone or tablet", () => {
    const { win } = fakeWindow({ queries: [FULLSCREEN_DISPLAY_MODE, TOUCH] });
    expect(fullscreenApp(win)).toBe(true);
    expect(detectAppMode(win)).toBe("installed");
    expect(createAppModeStore(win).getSnapshot()).toBe("installed");
  });

  it("is the website in a desktop browser in F11 fullscreen and in a tab with an element in fullscreen", () => {
    expect(detectAppMode(fakeWindow({ queries: [FULLSCREEN_DISPLAY_MODE] }).win)).toBe("website");
    const element = {} as Element;
    const tab = fakeWindow({ queries: [FULLSCREEN_DISPLAY_MODE, TOUCH], fullscreenElement: element }).win;
    expect(detectAppMode(tab)).toBe("website");
    expect(detectAppMode(fakeWindow({ queries: [TOUCH] }).win)).toBe("website");
  });

  it("keeps the mode it started with when an element enters fullscreen later", () => {
    // A browser tab on a touch screen whose meteogram goes fullscreen: still the website.
    const tab = fakeWindow({ queries: [TOUCH] });
    const tabStore = createAppModeStore(tab.win);
    tab.matching.add(FULLSCREEN_DISPLAY_MODE);
    tab.win.document = { fullscreenElement: {} as Element };
    expect(tabStore.getSnapshot()).toBe("website");
    // The installed app whose meteogram goes fullscreen: still the app.
    const app = fakeWindow({ queries: [FULLSCREEN_DISPLAY_MODE, TOUCH] });
    const appStore = createAppModeStore(app.win);
    app.win.document = { fullscreenElement: {} as Element };
    expect(appStore.getSnapshot()).toBe("installed");
  });

  it("still recognises standalone and iOS's home-screen app", () => {
    expect(detectAppMode(fakeWindow({ queries: ["(display-mode: standalone)"] }).win)).toBe("installed");
    expect(detectAppMode(fakeWindow({ standalone: true }).win)).toBe("installed");
  });
});
