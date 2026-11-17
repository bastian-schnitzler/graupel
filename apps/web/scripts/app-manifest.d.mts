// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Types of app-manifest.mjs for the tests and the screenshot generator. */
export interface ManifestScreenshotSpec {
  name: "wide" | "narrow";
  form_factor: "wide" | "narrow";
  viewport: { width: number; height: number };
  scale: number;
  mobile: boolean;
}
export interface ManifestScreenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: "wide" | "narrow";
  label: string;
}
export const SCREENSHOT_FOLDER: string;
export const SCREENSHOTS: readonly ManifestScreenshotSpec[];
export const SCREENSHOT_LANGUAGES: readonly string[];
export const MANIFEST_FALLBACK_LANGUAGE: string;
export const MANIFEST_TEXT: Readonly<Record<string, { description: string; wide: string; narrow: string }>>;
export function manifestLanguage(language: string): string;
export function screenshotPath(name: string, language: string): string;
export function manifestScreenshots(language: string): ManifestScreenshot[];
export function localizedManifest(text: string, language: string): string;
