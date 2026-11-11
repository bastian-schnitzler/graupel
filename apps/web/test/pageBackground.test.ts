// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Background behind the page and in the status bar (REQ-750): meta theme-color, the iOS status bar style and the web
 * app manifest (theme_color, background_color, also in each domain's manifest of the preview) have the page's
 * background colour (`--color-bg`), light and dark, and the theme-color follows the chosen colour mode.
 * e2e/page-background.spec.ts checks the same in a browser.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PAGE_BACKGROUND, applyColorMode, applyThemeColor } from "../src/state/index.ts";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path: string) => readFileSync(join(APP_DIR, path), "utf8");

/** `--color-bg` of the first CSS block after `selector` in styles/tokens.css. */
function tokenBackground(selector: string): string | undefined {
  const css = read("src/styles/tokens.css");
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return /--color-bg:\s*([^;]+);/.exec(css.slice(start))?.[1];
}

describe("page background colour (REQ-750)", () => {
  it("is the colour of --color-bg in styles/tokens.css, light and dark", () => {
    expect(tokenBackground(":root {")).toBe(PAGE_BACKGROUND.light);
    expect(tokenBackground(':root:not([data-theme="light"]) {')).toBe(PAGE_BACKGROUND.dark);
    expect(tokenBackground(':root[data-theme="dark"] {')).toBe(PAGE_BACKGROUND.dark);
  });

  it("is the theme-color of index.html per colour scheme, with the default iOS status bar", () => {
    const html = read("index.html");
    const metas = [...html.matchAll(/<meta name="theme-color" content="([^"]*)" media="([^"]*)" \/>/g)];
    expect(metas.map(([, content, media]) => [media, content])).toEqual([
      ["(prefers-color-scheme: light)", PAGE_BACKGROUND.light],
      ["(prefers-color-scheme: dark)", PAGE_BACKGROUND.dark],
    ]);
    // "default": the installed app's status bar takes the theme-color and the page starts below it.
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />');
  });

  it("is theme_color and background_color of the manifest, light and in its dark colour scheme", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.theme_color).toBe(PAGE_BACKGROUND.light);
    expect(manifest.background_color).toBe(PAGE_BACKGROUND.light);
    expect(manifest.user_preferences.color_scheme.dark).toEqual({
      theme_color: PAGE_BACKGROUND.dark,
      background_color: PAGE_BACKGROUND.dark,
    });
  });
});

describe("theme-color follows the colour mode (REQ-750)", () => {
  const head = document.head;

  afterEach(() => {
    head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
    applyColorMode("system");
  });

  /** The two theme-color tags of index.html, with a wrong colour to see that they are set. */
  function addMetas() {
    for (const scheme of ["light", "dark"]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.media = `(prefers-color-scheme: ${scheme})`;
      meta.content = "#1f6fb2";
      head.append(meta);
    }
    return () => [...head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content);
  }

  it("takes each scheme's colour for the system and the forced scheme's colour for light and dark", () => {
    const contents = addMetas();
    applyColorMode("dark");
    expect(contents()).toEqual([PAGE_BACKGROUND.dark, PAGE_BACKGROUND.dark]);
    applyColorMode("light");
    expect(contents()).toEqual([PAGE_BACKGROUND.light, PAGE_BACKGROUND.light]);
    applyColorMode("system");
    expect(contents()).toEqual([PAGE_BACKGROUND.light, PAGE_BACKGROUND.dark]);
  });

  it("does nothing without theme-color tags", () => {
    expect(() => applyThemeColor("dark")).not.toThrow();
  });
});
