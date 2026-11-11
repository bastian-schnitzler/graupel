// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Hover looks of the website's style sheets (REQ-598). iOS Safari keeps a tapped element under :hover until the next
 * tap elsewhere, so a hover look stuck on a selected day of the phone's strip showed it as a white card without label
 * after a double tap. Hover looks therefore apply only to pointers that can hover, and the day slider has one only in
 * its wide layout.
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

interface StyleRule {
  selector: string;
  /** Preludes of the at-rules around the rule, outermost first (e.g. `@media (hover: hover)`). */
  atRules: string[];
}

/** The style rules of a style sheet with the at-rules they are nested in (no nested style rules, strings skipped). */
function styleRules(css: string): StyleRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: string[] = [];
  const rules: StyleRule[] = [];
  let prelude = "";
  let quote: string | null = null;
  for (const char of source) {
    if (quote) {
      if (char === quote) quote = null;
      prelude += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      prelude += char;
    } else if (char === "{") {
      const text = prelude.trim().replace(/\s+/g, " ");
      if (!text.startsWith("@")) {
        rules.push({ selector: text, atRules: blocks.filter((block) => block.startsWith("@")) });
      }
      blocks.push(text);
      prelude = "";
    } else if (char === "}") {
      blocks.pop();
      prelude = "";
    } else if (char === ";") {
      prelude = "";
    } else {
      prelude += char;
    }
  }
  return rules;
}

const hoverRules = (file: string) =>
  styleRules(readFileSync(file, "utf8")).filter((rule) => rule.selector.includes(":hover"));

describe("hover looks (REQ-598)", () => {
  it("finds the rules of a style sheet with the at-rules around them", () => {
    const rules = styleRules(`
      a:hover { color: red; }
      /* b:hover { } */
      @media (hover: hover) {
        @container x (width >= 40rem) { .c:hover { content: "{"; } }
        .d:hover { color: blue }
      }
      .e { color: green; }
    `);
    expect(rules).toEqual([
      { selector: "a:hover", atRules: [] },
      { selector: ".c:hover", atRules: ["@media (hover: hover)", "@container x (width >= 40rem)"] },
      { selector: ".d:hover", atRules: ["@media (hover: hover)"] },
      { selector: ".e", atRules: [] },
    ]);
  });

  it("apply only to pointers that can hover, so a tap on a touch screen leaves none behind", () => {
    const files = cssFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(5);
    const unguarded = files.flatMap((file) =>
      hoverRules(file)
        .filter((rule) => !rule.atRules.some((atRule) => /^@media\b.*\(hover: ?hover\)/.test(atRule)))
        .map((rule) => `${relative(SRC_DIR, file)}: ${rule.selector}`),
    );
    expect(unguarded).toEqual([]);
  });

  it("leave the phone's day strip alone, so a selected day keeps its filled look", () => {
    const rules = hoverRules(join(SRC_DIR, "regions/DaySlider/DaySlider.css"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.atRules).toContain("@container day-slider (width >= 40rem)");
  });
});
