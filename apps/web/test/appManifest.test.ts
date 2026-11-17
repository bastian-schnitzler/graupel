// @vitest-environment node
// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Description and screenshots of the web app manifest (REQ-807): with them Edge and Chrome on the desktop show their
 * richer install dialog with our text and pictures instead of general points about apps. The manifest of the build is
 * English; each domain gets it in its own language (scripts/app-manifest.mjs, deploy/upload/site.mjs). The
 * screenshots meet what Chromium asks of them, and `sizes` names their real size.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  localizedManifest,
  MANIFEST_TEXT,
  manifestLanguage,
  manifestScreenshots,
  SCREENSHOT_FOLDER,
  SCREENSHOT_LANGUAGES,
  SCREENSHOTS,
  screenshotPath,
} from "../scripts/app-manifest.mjs";
import { pngSize, RESERVED_FOLDERS } from "../scripts/package-site.mjs";
import { LANGUAGES } from "../src/i18n/languages.ts";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(APP_DIR, "public");
const MANIFEST_TEXT_SOURCE = readFileSync(join(PUBLIC_DIR, "manifest.webmanifest"), "utf8");
const manifest = JSON.parse(MANIFEST_TEXT_SOURCE);

interface Screenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: "wide" | "narrow";
  label: string;
}

const size = (sizes: string) => sizes.split("x").map(Number) as [number, number];
const domainLanguages = () =>
  readdirSync(join(APP_DIR, "domains")).map(
    (tld) => JSON.parse(readFileSync(join(APP_DIR, "domains", tld, "config.json"), "utf8")).defaultLanguage as string,
  );

/** What Chromium asks of the screenshots of its richer install dialog (scripts/app-manifest.mjs). */
function checkScreenshots(screenshots: readonly Screenshot[]) {
  for (const { src, sizes, type, form_factor } of screenshots) {
    const [width, height] = size(sizes);
    expect(type, src).toBe("image/png");
    for (const side of [width, height]) {
      expect(side, src).toBeGreaterThanOrEqual(320);
      expect(side, src).toBeLessThanOrEqual(3840);
    }
    expect(Math.max(width, height) / Math.min(width, height), src).toBeLessThanOrEqual(2.3);
    if (form_factor === "wide") expect(width, src).toBeGreaterThan(height);
    else expect(height, src).toBeGreaterThan(width);
  }
  for (const [form, limit] of [
    ["wide", 8],
    ["narrow", 5],
  ] as const) {
    const ofForm = screenshots.filter((shot) => shot.form_factor === form);
    expect(ofForm.length, form).toBeGreaterThanOrEqual(1);
    expect(ofForm.length, form).toBeLessThanOrEqual(limit);
    expect(new Set(ofForm.map(({ sizes }) => size(sizes)[0] / size(sizes)[1])).size, form).toBe(1);
  }
}

describe("manifest of the build (REQ-807)", () => {
  it("has a description and screenshots for the desktop (wide) and phones (narrow), in English", () => {
    expect(manifest.lang).toBe("en");
    expect(manifest.description).toBe(MANIFEST_TEXT.en!.description);
    expect(manifest.screenshots.map((shot: Screenshot) => [shot.form_factor, shot.src])).toEqual([
      ["wide", `${SCREENSHOT_FOLDER}wide-en.png`],
      ["narrow", `${SCREENSHOT_FOLDER}narrow-en.png`],
    ]);
    checkScreenshots(manifest.screenshots);
  });

  it("is what localizedManifest writes for English, so the domains differ from it only in language", () => {
    expect(JSON.parse(localizedManifest(MANIFEST_TEXT_SOURCE, "en"))).toEqual(manifest);
  });

  it("says what the reasons in the install dialog say: the history offline and the view without the browser's address and navigation bars (REQ-806, REQ-852)", () => {
    expect(manifest.description).toMatch(/history/);
    expect(manifest.description).toMatch(/offline/);
    expect(manifest.description).toMatch(/without the browser’s address and navigation bars\.$/);
  });

  it("keeps the screenshots outside the folders Apache maps elsewhere", () => {
    expect(SCREENSHOT_FOLDER.endsWith("/")).toBe(true);
    expect(RESERVED_FOLDERS).not.toContain(SCREENSHOT_FOLDER);
  });
});

describe("manifest per language (REQ-807)", () => {
  it("has a short description and labels in every language of the site", () => {
    expect(Object.keys(MANIFEST_TEXT).sort()).toEqual([...LANGUAGES].sort());
    for (const [language, text] of Object.entries(MANIFEST_TEXT)) {
      // Chrome cuts the description after a few lines.
      expect(text.description.length, language).toBeLessThanOrEqual(300);
      expect(text.description.length, language).toBeGreaterThan(80);
      expect(text.wide, language).not.toBe("");
      expect(text.narrow, language).not.toBe("");
    }
  });

  // REQ-852: the second reason reads the same in the manifest as in the install dialog, in every language.
  it.each([...LANGUAGES])("ends its description with the dialog's reason about the address and navigation bars in %s (REQ-852)", (language) => {
    const texts = JSON.parse(readFileSync(join(APP_DIR, "src", "i18n", `${language}.json`), "utf8")) as Record<string, string>;
    const display = texts["install.why.display"]!;
    const description = MANIFEST_TEXT[language]!.description;
    expect(description.endsWith(` ${display}`), language).toBe(true);
  });

  it("sets lang, description and screenshots of the language and keeps everything else", () => {
    const german = JSON.parse(localizedManifest(MANIFEST_TEXT_SOURCE, "de"));
    expect(german).toEqual({
      ...manifest,
      lang: "de",
      description: MANIFEST_TEXT.de!.description,
      screenshots: manifestScreenshots("de"),
    });
    expect(german.description).toMatch(/^Wettervorhersagen als Meteogramme\. .*Historie.*offline/);
    expect(german.screenshots.map((shot: Screenshot) => shot.src)).toEqual([
      `${SCREENSHOT_FOLDER}wide-de.png`,
      `${SCREENSHOT_FOLDER}narrow-de.png`,
    ]);
    expect(german.screenshots[0].label).toBe(MANIFEST_TEXT.de!.wide);
  });

  it("takes the English pictures for languages without their own, and English for unknown languages", () => {
    const slovenian = JSON.parse(localizedManifest(MANIFEST_TEXT_SOURCE, "sl"));
    expect(slovenian.lang).toBe("sl");
    expect(slovenian.description).toBe(MANIFEST_TEXT.sl!.description);
    expect(slovenian.screenshots.map((shot: Screenshot) => [shot.src, shot.label])).toEqual([
      [`${SCREENSHOT_FOLDER}wide-en.png`, MANIFEST_TEXT.sl!.wide],
      [`${SCREENSHOT_FOLDER}narrow-en.png`, MANIFEST_TEXT.sl!.narrow],
    ]);
    expect(manifestLanguage("xx")).toBe("en");
    expect(JSON.parse(localizedManifest(MANIFEST_TEXT_SOURCE, "xx"))).toEqual(manifest);
  });

  it("has screenshots in the language of every domain", () => {
    for (const language of domainLanguages()) expect(SCREENSHOT_LANGUAGES, language).toContain(language);
  });
});

describe("screenshot files (REQ-807)", () => {
  const files = SCREENSHOT_LANGUAGES.flatMap((language) => manifestScreenshots(language));

  it("exist for every language and form factor, as PNG of the size the manifest names", () => {
    expect(files).toHaveLength(SCREENSHOT_LANGUAGES.length * SCREENSHOTS.length);
    for (const { src, sizes } of files) {
      const path = join(PUBLIC_DIR, src);
      expect(existsSync(path), src).toBe(true);
      const actual = pngSize(readFileSync(path));
      expect(actual, src).not.toBeNull();
      expect(`${actual!.width}x${actual!.height}`, src).toBe(sizes);
    }
    checkScreenshots(manifestScreenshots("en"));
  });

  it("are no other files than those, and small", () => {
    const expected = files.map(({ src }) => src.slice(SCREENSHOT_FOLDER.length)).sort();
    expect(readdirSync(join(PUBLIC_DIR, SCREENSHOT_FOLDER)).sort()).toEqual(expected);
    for (const { src } of files) expect(readFileSync(join(PUBLIC_DIR, src)).length, src).toBeLessThan(150_000);
  });

  it("names its paths after form factor and language", () => {
    expect(screenshotPath("wide", "fr")).toBe(`${SCREENSHOT_FOLDER}wide-fr.png`);
  });
});
