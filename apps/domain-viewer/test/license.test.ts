// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * License check of the site (REQ-095): GPL-3.0-or-later text in `LICENSE`, the data licenses in `LICENSES/`, the
 * license in `package.json`, the SPDX header in every source file, the third-party notice as the build writes it and
 * the attribution in the page.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { thirdPartyNotice } from "../scripts/third-party.mjs";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const MODEL_DATA_DIR = fileURLToPath(new URL("../../../model-data/", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", "public", "test-results", "playwright-report", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css"]);
const COPYRIGHT = "SPDX-FileCopyrightText: 2026 Bastian Schnitzler";
const SPDX_GPL = "SPDX-License-Identifier: GPL-3.0-or-later";

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(APP_DIR, path), "utf8");
const rel = (path: string) => relative(APP_DIR, path);
const sourceFiles = listFiles(APP_DIR).filter((path) => SOURCE_EXTENSIONS.has(extname(path)));

describe("license (GPL-3.0-or-later, data CC BY 4.0)", () => {
  it("ships the full GPL-3.0 text as LICENSE", () => {
    const text = read("LICENSE");
    expect(text).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(text).toContain("END OF TERMS AND CONDITIONS");
    expect(text).toContain("How to Apply These Terms to Your New Programs");
  });

  it("ships the data license texts, the same as in model-data", () => {
    for (const file of ["CC-BY-4.0.txt", "MPL-2.0.txt"])
      expect(read(join("LICENSES", file)), file).toBe(readFileSync(join(MODEL_DATA_DIR, "LICENSES", file), "utf8"));
    expect(read("LICENSES/CC-BY-4.0.txt")).toMatch(/^Creative Commons Attribution 4\.0 International/);
  });

  it("declares GPL-3.0-or-later in package.json", () => {
    expect(JSON.parse(read("package.json")).license).toBe("GPL-3.0-or-later");
  });

  it("finds the source files", () => {
    expect(sourceFiles.map(rel)).toEqual(
      expect.arrayContaining([
        "index.html",
        "sw.js",
        join("src", "lib.js"),
        join("src", "schema.js"),
        join("src", "viewer.js"),
        join("scripts", "build.mjs"),
        join("scripts", "third-party.mjs"),
        join("test", "license.test.ts"),
        join("e2e", "viewer.spec.ts"),
        "vitest.config.ts",
      ]),
    );
  });

  it("has the SPDX header at the top of every source file", () => {
    const missing = sourceFiles.filter((path) => {
      const head = readFileSync(path, "utf8").split("\n").slice(0, 4).join("\n");
      return !head.includes(COPYRIGHT) || !head.includes(SPDX_GPL);
    });
    expect(missing.map(rel)).toEqual([]);
  });

  it("notes the code from MPL-2.0 sources as distributed under the GPL as Secondary License", () => {
    const head = read("src/lib.js").split("\n").slice(0, 10).join("\n");
    expect(head).toMatch(/graupel-gen[\s\S]*MPL-2\.0[\s\S]*section 3\.3[\s\S]*Secondary License/);
    expect(read("THIRD_PARTY_LICENSES.md")).toMatch(/\| MPL-2\.0 \| GPL-3\.0-or-later as a Secondary License/);
  });

  it("keeps THIRD_PARTY_LICENSES.md as the build writes it (`pnpm licenses`)", () => {
    expect(read("THIRD_PARTY_LICENSES.md")).toBe(thirdPartyNotice());
  });

  it("names every vendored library and what maplibre-gl bundles", () => {
    const notice = thirdPartyNotice();
    expect(notice).toMatch(/### leaflet 1\.9\.4\n\n- \*\*License:\*\* BSD-2-Clause/);
    expect(notice).toMatch(/### maplibre-gl 4\.7\.1\n\n- \*\*License:\*\* BSD-3-Clause/);
    expect(notice).toMatch(/### @maplibre\/maplibre-gl-leaflet 0\.0\.22\n\n- \*\*License:\*\* ISC/);
    const bundled = ["earcut", "geojson-vt", "gl-matrix", "pbf", "supercluster", "@maplibre/maplibre-gl-style-spec"];
    for (const name of bundled) expect(notice).toContain(`##### ${name} `);
    expect(notice).toContain("derived from [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0)");
    expect(notice).toContain("Natural Earth");
  });

  it("shows the attribution and the license note in the page", () => {
    const footer = /<footer id="attribution">([\s\S]*?)<\/footer>/.exec(read("index.html"))?.[1] ?? "";
    const text = footer.replace(/<[^>]+>/g, "").replace(/&copy;/g, "©").replace(/\s+/g, " ");
    expect(text).toContain("OpenFreeMap");
    expect(text).toContain("© OpenStreetMap contributors");
    expect(text).toContain("Open-Meteo.com data (CC BY 4.0)");
    expect(text).toContain("Natural Earth");
    expect(text).toContain("GPL-3.0-or-later");
    for (const href of ["LICENSE", "LICENSES/CC-BY-4.0.txt", "THIRD_PARTY_LICENSES.md", "data/LICENSE"])
      expect(footer).toContain(`href="${href}"`);
  });
});
