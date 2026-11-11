// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's design on a tablet (REQ-728, REQ-742, REQ-744). Safari before 18 does not know style queries and drops a
 * whole `@container … or style(…)` rule, size condition included: on an iPad the phone's rules were missing, the day
 * slider's labels overlapped and the page ran over sideways. The tablet therefore gets each phone rule as a copy under
 * `.app--tablet`, and no style sheet asks a style query.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** The CSS files below `src`, recursively. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** `css` without its comments. */
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Selectors of the style rules directly inside `@container <name> (…) { … }` blocks whose condition matches `size`. */
function containerSelectors(css: string, size: RegExp): string[] {
  const source = uncommented(css);
  const selectors: string[] = [];
  const opening = /@container\s+([^{]*)\{/g;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    if (!size.test(match[1]!)) continue;
    let depth = 1;
    let index = opening.lastIndex;
    let prelude = "";
    for (; index < source.length && depth > 0; index++) {
      const char = source[index];
      if (char === "{") {
        if (depth === 1) selectors.push(...prelude.split(",").map((part) => part.trim().replace(/\s+/g, " ")));
        depth++;
        prelude = "";
      } else if (char === "}") {
        depth--;
        prelude = "";
      } else if (char === ";") prelude = "";
      else prelude += char;
    }
    opening.lastIndex = index;
  }
  return selectors.filter((selector) => selector && !selector.startsWith("@"));
}

describe("phone rules on a tablet (REQ-728, REQ-742, REQ-744)", () => {
  const files = cssFiles(SRC_DIR).map((path) => ({ name: relative(SRC_DIR, path), css: readFileSync(path, "utf8") }));

  it("asks no style query, which Safari before 18 drops with the whole rule", () => {
    const offending = files
      .filter(({ css }) => /@container[^{]*style\(/.test(uncommented(css)))
      .map(({ name }) => name);
    expect(offending).toEqual([]);
  });

  it("copies each rule of the phone's day slider, model chains and meteogram card under .app--tablet", () => {
    const phone = /\((?:max-width:\s*40rem|width\s*<\s*40rem)\)/;
    for (const name of [
      "regions/DaySlider/DaySlider.css",
      "regions/ModelChain/ModelChain.css",
      "regions/MeteogramPanel/MeteogramPanel.css",
      "regions/Footer/Footer.css",
    ]) {
      const { css } = files.find((file) => file.name === name)!;
      const tablet = new Set(
        containerSelectors(`@container all (max-width: 40rem) {${uncommented(css)}}`, phone)
          .filter((selector) => selector.startsWith(":where(.app--tablet) "))
          .map((selector) => selector.slice(":where(.app--tablet) ".length)),
      );
      const missing = containerSelectors(css, phone).filter((selector) => !tablet.has(selector));
      expect({ name, missing }).toEqual({ name, missing: [] });
    }
  });
});
