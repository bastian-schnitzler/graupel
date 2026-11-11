// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * License check of the website (REQ-431, DEC-024): GPL-3.0-or-later text in `LICENSE`, the data and library license
 * texts in `LICENSES/`, the license in `package.json`, the SPDX header in every source file, the third-party notice
 * as the build writes it, the origin of the logo and the attribution of data and map providers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundledPackage, checkShipped, SHIPPED, thirdPartyNotice } from "../scripts/third-party.mjs";
import { OPENTOPOMAP_ATTRIBUTION } from "../src/regions/LocationPicker/map/LeafletMap.tsx";

// Not `new URL(…, import.meta.url)`: under jsdom `URL` is not Node's.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_DIR = dirname(dirname(APP_DIR));
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "public",
  "release",
  "test-results",
  "playwright-report",
  "coverage",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".html", ".css"]);
const COPYRIGHT = "SPDX-FileCopyrightText: 2026 Bastian Schnitzler";
const SPDX_GPL = "SPDX-License-Identifier: GPL-3.0-or-later";
/** Licenses of shipped code that may be combined with GPL-3.0-or-later. */
const GPL_COMPATIBLE = new Set([
  "MIT",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "(MIT OR Apache-2.0)",
  "MPL-2.0",
]);

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
const notice = thirdPartyNotice();

describe("license (GPL-3.0-or-later)", () => {
  it("ships the full GPL-3.0 text as LICENSE", () => {
    const text = read("LICENSE");
    expect(text).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(text).toContain("END OF TERMS AND CONDITIONS");
    expect(text).toContain("How to Apply These Terms to Your New Programs");
  });

  it("ships the license texts of the bundled packages and data, the same as in model-data", () => {
    expect(readdirSync(join(APP_DIR, "LICENSES")).sort()).toEqual(["CC-BY-4.0.txt", "MPL-2.0.txt"]);
    for (const file of ["CC-BY-4.0.txt", "MPL-2.0.txt"])
      expect(read(join("LICENSES", file)), file).toBe(readFileSync(join(REPO_DIR, "model-data", "LICENSES", file), "utf8"));
    expect(read("LICENSES/CC-BY-4.0.txt")).toMatch(/^Creative Commons Attribution 4\.0 International/);
    expect(read("LICENSES/MPL-2.0.txt")).toMatch(/^Mozilla Public License Version 2\.0/);
  });

  it("declares GPL-3.0-or-later in package.json", () => {
    const manifest = JSON.parse(read("package.json")) as { license?: string; scripts?: Record<string, string> };
    expect(manifest.license).toBe("GPL-3.0-or-later");
    expect(manifest.scripts?.licenses).toBe("node scripts/third-party.mjs");
  });

  it("finds the source files", () => {
    expect(sourceFiles.map(rel)).toEqual(
      expect.arrayContaining([
        "index.html",
        "vite.config.ts",
        "vitest.config.ts",
        join("src", "main.tsx"),
        join("src", "styles", "global.css"),
        join("scripts", "third-party.mjs"),
        join("scripts", "third-party.d.mts"),
        join("scripts", "package-site.mjs"),
        join("test", "license.test.ts"),
        join("e2e", "about.spec.ts"),
      ]),
    );
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it("has the SPDX header at the top of every source file", () => {
    const missing = sourceFiles.filter((path) => {
      const head = readFileSync(path, "utf8").split("\n").slice(0, 4).join("\n");
      return !head.includes(COPYRIGHT) || !head.includes(SPDX_GPL);
    });
    expect(missing.map(rel)).toEqual([]);
  });
});

describe("third-party notice", () => {
  it("keeps THIRD_PARTY_LICENSES.md as the build writes it (`pnpm licenses`)", () => {
    expect(read("THIRD_PARTY_LICENSES.md")).toBe(notice);
  });

  it("names every bundled npm package with a GPL-compatible license and its text", () => {
    expect(SHIPPED.map((pkg) => pkg.name)).toEqual([
      "react",
      "react-dom",
      "scheduler",
      "leaflet",
      "maplibre-gl",
      "@maptoolkit/maplibre-gl-logo",
      "vite",
      "rolldown",
    ]);
    const licenses = [...notice.matchAll(/^#{3,5} (\S+) .*\n\n- \*\*License:\*\* (.+)$/gm)].map(([, name, license]) => [
      name,
      license,
    ]);
    for (const pkg of SHIPPED) expect(licenses.map(([name]) => name)).toContain(pkg.name);
    expect(licenses.filter(([, license]) => !GPL_COMPATIBLE.has(license!))).toEqual([]);
    expect(notice).toMatch(/### react 19\.\d+\.\d+\n\n- \*\*License:\*\* MIT/);
    expect(notice).toMatch(/### leaflet 1\.9\.4\n\n- \*\*License:\*\* BSD-2-Clause/);
    expect(notice).toMatch(/### maplibre-gl 5\.\d+\.\d+\n\n- \*\*License:\*\* BSD-3-Clause/);
    expect(notice).toMatch(/### @maptoolkit\/maplibre-gl-logo 0\.1\.0\n\n- \*\*License:\*\* MIT/);
    for (const name of ["earcut", "gl-matrix", "pbf", "@maplibre/maplibre-gl-style-spec", "tslib"])
      expect(notice).toContain(`##### ${name} `);
    // Every license section carries a text.
    expect(notice).not.toMatch(/```text\n```/);
  });

  it("names the Graupel packages, the Lucide icons and the origin of the logo", () => {
    for (const name of ["@graupel/meteogram", "@graupel/meteogram-react", "@graupel/download", "@graupel/model-data"])
      expect(notice).toContain(`\`${name}\``);
    expect(notice).toMatch(/### Lucide icons[\s\S]*ISC License/);
    expect(notice).toMatch(/logo and favicon[\s\S]*`scripts\/graupel-cloud\.svg`[\s\S]*GPL-3\.0-or-later/);
  });

  it("names Open-Meteo (CC BY 4.0) and the map providers", () => {
    expect(notice).toContain("derived from [Open-Meteo.com](https://open-meteo.com/) data (CC BY 4.0)");
    expect(notice).toMatch(/\| \[Open-Meteo\.com\]\(https:\/\/open-meteo\.com\/\) \|.*CC BY 4\.0/);
    expect(notice).toMatch(/\| \[OpenTopoMap\]\(https:\/\/opentopomap\.org\/\) \|.*CC BY-SA 3\.0.*OpenStreetMap contributors/);
    expect(notice).toMatch(/\| \[Maptoolkit\]\(https:\/\/www\.maptoolkit\.org\/\) \|.*OpenStreetMap contributors/);
    expect(notice).toContain("Natural Earth");
  });

  it("the OpenTopoMap layer carries its attribution on the map", () => {
    expect(OPENTOPOMAP_ATTRIBUTION).toContain("OpenStreetMap</a>");
    expect(OPENTOPOMAP_ATTRIBUTION).not.toContain("contributors");
    expect(OPENTOPOMAP_ATTRIBUTION).not.toMatch(/SRTM|Map data|Map style/);
    expect(OPENTOPOMAP_ATTRIBUTION).toContain("OpenTopoMap");
    expect(OPENTOPOMAP_ATTRIBUTION).toContain("CC-BY-SA");
  });
});

describe("bundle check of the build", () => {
  it("maps module ids to their npm package", () => {
    expect(bundledPackage("/x/node_modules/.pnpm/react@19/node_modules/react/index.js")).toBe("react");
    expect(bundledPackage("/x/node_modules/@maptoolkit/maplibre-gl-logo/dist/index.js")).toBe(
      "@maptoolkit/maplibre-gl-logo",
    );
    expect(bundledPackage("\0vite/preload-helper.js")).toBe("vite");
    expect(bundledPackage("\0rolldown/runtime.js")).toBe("rolldown");
    expect(bundledPackage(join(REPO_DIR, "packages", "meteogram", "dist", "index.js"))).toBeNull();
    expect(bundledPackage(join(APP_DIR, "src", "main.tsx"))).toBeNull();
    expect(() => bundledPackage("/elsewhere/lib.js")).toThrow(/unknown origin/);
  });

  it("reports packages missing from or not bundled for the notice", () => {
    const names = SHIPPED.map((pkg) => pkg.name);
    expect(checkShipped(names)).toEqual([]);
    expect(checkShipped([...names.filter((name) => name !== "leaflet"), "lodash"])).toEqual([
      "lodash is bundled but not in SHIPPED",
      "leaflet is in SHIPPED but not bundled",
    ]);
  });
});
