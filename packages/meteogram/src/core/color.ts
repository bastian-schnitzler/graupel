// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Colour helpers for colours the host passes in (e.g. a model header colour per model): parsing of hex and
 * `rgb()` colours and the choice of a readable text colour by WCAG contrast.
 */

/** Red, green and blue of a colour, each 0–255. */
export type Rgb = readonly [number, number, number];

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `rgb()`/`rgba()`; alpha is ignored. Null for anything else. */
export function parseColor(color: string): Rgb | null {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const digits = hex[1]!;
    const short = digits.length <= 4;
    const channel = (index: number) =>
      short ? parseInt(digits[index]! + digits[index]!, 16) : parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    return [channel(0), channel(1), channel(2)];
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/.exec(value);
  if (rgb) {
    const channel = (part: string) =>
      Math.max(0, Math.min(255, part.endsWith("%") ? (parseFloat(part) * 255) / 100 : parseFloat(part)));
    return [channel(rgb[1]!), channel(rgb[2]!), channel(rgb[3]!)];
  }
  return null;
}

/** WCAG relative luminance (0 black – 1 white). */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two colours (1–21); null when one cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The candidate with the highest contrast on `background`; the first candidate when the background cannot be
 * parsed (or no candidate can).
 */
export function readableTextColor(background: string, candidates: readonly string[]): string {
  let best = candidates[0] ?? "";
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (ratio !== null && ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}
