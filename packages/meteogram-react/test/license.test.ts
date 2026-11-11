// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment node
/**
 * License check of the package (REQ-097): MPL-2.0 text in `LICENSE`, the
 * license in `package.json`, the MPL header in every source file, the
 * third-party notice, and no GPL material, fonts or image assets.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set(["node_modules", "test-results", "playwright-report", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html"]);
const ASSET_EXTENSIONS = new Set([
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp",
]);
const SPDX_MPL = "SPDX-License-Identifier: MPL-2.0";
const EXHIBIT_A = "This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.";
const GPL_MARKERS = [/SPDX-License-Identifier:[ \t]*[\w.+()-]*GPL/, /GNU (AFFERO |LESSER )?GENERAL PUBLIC LICENSE/i];

function listFiles(dir: string, skip: Set<string>): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return skip.has(entry.name) ? [] : listFiles(path, skip);
    return entry.isFile() ? [path] : [];
  });
}

const rel = (path: string) => relative(PACKAGE_DIR, path);
const sourceFiles = listFiles(PACKAGE_DIR, new Set([...SKIP_DIRS, "dist"])).filter((path) =>
  SOURCE_EXTENSIONS.has(extname(path)),
);
const allFiles = listFiles(PACKAGE_DIR, SKIP_DIRS);

describe("license (MPL-2.0)", () => {
  it("ships the full MPL-2.0 text as LICENSE", () => {
    const text = readFileSync(join(PACKAGE_DIR, "LICENSE"), "utf8");
    expect(text.startsWith("Mozilla Public License Version 2.0")).toBe(true);
    expect(text).toContain('Exhibit B - "Incompatible With Secondary Licenses" Notice');
  });

  it("declares MPL-2.0 in package.json and ships the notices", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
      license?: string;
      files?: string[];
    };
    expect(manifest.license).toBe("MPL-2.0");
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "LICENSE", "THIRD_PARTY_LICENSES.md"]));
    expect(existsSync(join(PACKAGE_DIR, "THIRD_PARTY_LICENSES.md"))).toBe(true);
  });

  it("finds the source files", () => {
    expect(sourceFiles.map(rel)).toEqual(
      expect.arrayContaining([join("src", "index.ts"), join("src", "Meteogram.tsx"), rel(SELF)]),
    );
  });

  it("has the MPL header at the top of every source file", () => {
    const missing = sourceFiles.filter((path) => {
      const head = readFileSync(path, "utf8").split("\n").slice(0, 6).join("\n");
      return !head.includes(SPDX_MPL) || !head.includes(EXHIBIT_A);
    });
    expect(missing.map(rel)).toEqual([]);
  });


  it("contains no fonts, image assets or GPL material", () => {
    expect(allFiles.filter((path) => ASSET_EXTENSIONS.has(extname(path).toLowerCase())).map(rel)).toEqual([]);
    // LICENSE itself names the GNU licenses as MPL "Secondary Licenses"; it is checked above.
    const scanned = allFiles.filter((path) => path !== SELF && path !== join(PACKAGE_DIR, "LICENSE"));
    const gpl = scanned.filter((path) => GPL_MARKERS.some((marker) => marker.test(readFileSync(path, "utf8"))));
    expect(gpl.map(rel)).toEqual([]);
  });
});
