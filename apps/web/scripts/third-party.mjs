// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Third-party notice of the website (REQ-431): writes THIRD_PARTY_LICENSES.md from the npm packages that the build
// bundles (SHIPPED) and the packages compiled into their files, read from the source maps next to them. The build
// (licensePlugin in vite.config.ts) checks that it bundles exactly the packages in SHIPPED and writes the same text
// to dist/. `node scripts/third-party.mjs` rewrites the file, `--check` only compares.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// Paths from the file path, not `new URL(…, import.meta.url)`: under jsdom (tests) `URL` is not Node's.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = `${dirname(dirname(root))}/`;
export const NOTICE_FILE = join(root, "THIRD_PARTY_LICENSES.md");

/**
 * @typedef {object} ShippedPackage
 * @property {string} name npm package
 * @property {string} from package that depends on it (`.` is the website), to find the installed copy
 * @property {string} use what the site uses it for
 * @property {string[]} [files] files of the package that are bundled and may bundle other packages (source maps)
 * @property {string} [licenseSection] heading that ends the part of the license file that applies (vite)
 * @property {string} [licenseText] license text when the package ships none
 */

/** npm packages whose code the build puts into dist/assets/ (checked by the build). @type {ShippedPackage[]} */
export const SHIPPED = [
  { name: "react", from: ".", use: "user interface" },
  { name: "react-dom", from: ".", use: "user interface" },
  { name: "scheduler", from: "react-dom", use: "user interface (dependency of react-dom)" },
  { name: "leaflet", from: ".", use: "OpenTopoMap map (lazy chunk)", files: ["dist/leaflet-src.js"] },
  { name: "maplibre-gl", from: ".", use: "Maptoolkit map (lazy chunk)", files: ["dist/maplibre-gl.js"] },
  {
    name: "@maptoolkit/maplibre-gl-logo",
    from: ".",
    use: "Maptoolkit logo on the Maptoolkit map (lazy chunk)",
    // The npm package declares MIT (package.json, README) but ships no license file; this is the MIT text of its
    // repository (github.com/maptoolkit/attribution-plugins).
    licenseText: [
      "MIT License",
      "",
      "Copyright (c) 2024 Maptoolkit",
      "",
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
      'of this software and associated documentation files (the "Software"), to deal',
      "in the Software without restriction, including without limitation the rights",
      "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
      "copies of the Software, and to permit persons to whom the Software is",
      "furnished to do so, subject to the following conditions:",
      "",
      "The above copyright notice and this permission notice shall be included in all",
      "copies or substantial portions of the Software.",
      "",
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
      "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
      "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
      "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
      "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
      "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
      "SOFTWARE.",
    ].join("\n"),
  },
  {
    name: "vite",
    from: ".",
    use: "module preload helper and polyfill that the build inserts",
    licenseSection: "# Licenses of bundled dependencies",
  },
  { name: "rolldown", from: "vite", use: "runtime helpers that the bundler inserts" },
];

/** SPDX ids of bundled packages that are not installed (build-time helpers of a shipped package). */
const NOT_INSTALLED = /** @type {Record<string, string>} */ ({ tslib: "0BSD" });

/**
 * @typedef {object} Bundled
 * @property {string} name
 * @property {string} version
 * @property {string} license SPDX id
 * @property {string} text license text
 * @property {string} via package whose file bundles it
 */

/** @param {string} dir */
const readManifest = (dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

/** The installed package `name` as seen from `from` (pnpm keeps dependencies next to their dependent). */
function findPackage(/** @type {string} */ name, /** @type {string} */ from) {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  return undefined;
}

/** Directory of a shipped package. @param {ShippedPackage} pkg */
export function shippedDir(pkg) {
  const from = pkg.from === "." ? root : shippedDir(SHIPPED.find((other) => other.name === pkg.from) ?? fail(pkg.from));
  return findPackage(pkg.name, from) ?? fail(pkg.name);
}

/** @param {string} name @returns {never} */
function fail(name) {
  throw new Error(`${name} is not installed`);
}

/** License text of an installed package: its LICENSE file, else the License section of its README. */
function licenseText(/** @type {string} */ dir) {
  const files = readdirSync(dir);
  const license = files.find((file) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(file));
  if (license) return readFileSync(join(dir, license), "utf8").trim();
  const readme = files.find((file) => /^readme(\.md)?$/i.test(file));
  const text = readme ? readFileSync(join(dir, readme), "utf8") : "";
  const section = /^#+ *License.*\n([\s\S]*?)(?=^#|(?![\s\S]))/im.exec(text);
  if (section?.[1]) return section[1].trim();
  throw new Error(`no license text in ${dir}`);
}

/** Leading comment of a source (license header of an inlined helper). @param {string} source */
function headerComment(source) {
  const match = /^\s*\/\*+([\s\S]*?)\*+\//.exec(source);
  if (!match?.[1]) throw new Error("bundled source without license header");
  return match[1].replace(/^\s*\*+\s*$/gm, "").trim();
}

/**
 * Packages bundled into `file` of the package in `dir`, by the file's source map; follows source maps of bundled
 * files (a package that ships a bundle itself).
 * @param {string} dir @param {string} file @param {Map<string, Bundled>} found
 */
function collectBundled(dir, file, found) {
  const mapFile = join(dir, `${file}.map`);
  if (!existsSync(mapFile)) return;
  const manifest = readManifest(dir);
  /** @type {{ sources: string[], sourcesContent?: string[] }} */
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  map.sources.forEach((source, index) => {
    const at = source.lastIndexOf("node_modules/");
    if (at < 0) return;
    const [scope = "", ...rest] = source.slice(at + "node_modules/".length).split("/");
    const name = scope.startsWith("@") ? `${scope}/${rest.shift()}` : scope;
    const inner = rest.join("/");
    const installed = findPackage(name, dir);
    if (installed) {
      const pkg = readManifest(installed);
      const key = `${pkg.name}@${pkg.version}`;
      if (!found.has(key))
        found.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: pkg.license,
          text: licenseText(installed),
          via: manifest.name,
        });
      collectBundled(installed, posix.normalize(inner), found);
      return;
    }
    const license = NOT_INSTALLED[name];
    if (!license) throw new Error(`${name} (bundled into ${manifest.name}/${file}) is not installed`);
    const range = manifest.devDependencies?.[name] ?? manifest.dependencies?.[name] ?? "unknown";
    const key = `${name}@${range}`;
    if (!found.has(key))
      found.set(key, {
        name,
        version: `${range} (required by ${manifest.name}; text from the header in its source map)`,
        license,
        text: headerComment(map.sourcesContent?.[index] ?? ""),
        via: manifest.name,
      });
  });
}

/** ISC text of the Lucide icons inlined in @graupel/meteogram, from that package's notice. */
function lucideLicense() {
  const notice = readFileSync(join(repoRoot, "packages", "meteogram", "THIRD_PARTY_LICENSES.md"), "utf8");
  const text = /### Lucide[\s\S]*?```text\n([\s\S]*?)\n```/.exec(notice)?.[1];
  if (!text) throw new Error("no Lucide license in packages/meteogram/THIRD_PARTY_LICENSES.md");
  return text.trim();
}

const fence = (/** @type {string} */ text) => ["```text", text, "```"].join("\n");

const HEAD = `# Third-party licenses

<!-- Generated by scripts/third-party.mjs from what the build ships; do not edit. -->

Graupel (the website and app in \`apps/web\`) is Copyright 2026 Bastian Schnitzler and licensed under the GNU General
Public License v3.0 or later (\`GPL-3.0-or-later\`, full text in \`LICENSE\`). Every source file carries the SPDX
header \`SPDX-License-Identifier: GPL-3.0-or-later\`. This file names the material of others that the site contains
or uses. Their licenses apply unchanged next to the GPL; all of them
are compatible with it (MIT, ISC, BSD, 0BSD are permissive; MPL-2.0 allows distribution under the GPL as a
Secondary License, section 3.3; CC BY 4.0 covers data, not code).

## Origin of the code and the logo

| Part | Source | License there | License here |
|---|---|---|---|
| logo and favicon (\`public/favicon.svg\`, \`public/icons/\`), the Graupel cloud | \`scripts/graupel-cloud.svg\` (own work of the project, reduced by \`scripts/generate-icons.mjs\`) | – | GPL-3.0-or-later |
| line icons (\`src/icons/\`, \`src/regions/LocationPicker/Icon.tsx\`) | drawn for this site | – | GPL-3.0-or-later |
| everything else | written for this site | – | GPL-3.0-or-later |

The site uses no web fonts (system fonts only).

## Graupel packages bundled from this repository

| Package | License | Notes |
|---|---|---|
| \`@graupel/meteogram\` | MPL-2.0 (\`LICENSES/MPL-2.0.txt\`) | contains the Lucide icons \`CloudLightning\` and \`CloudHail\` (ISC, text below) |
| \`@graupel/meteogram-react\` | MPL-2.0 | – |
| \`@graupel/download\` | MPL-2.0 | – |
| \`@graupel/model-data\` | CC BY 4.0 (\`LICENSES/CC-BY-4.0.txt\`) and MPL-2.0 | \`model_catalogue.json\`, \`model_domains.json\`: derived from [Open-Meteo.com](https://open-meteo.com/) data (CC BY 4.0), modified: selected, combined and processed by graupel-gen. \`quantities.json\`, \`regions.geojson\` (own curation on country borders from [Natural Earth](https://www.naturalearthdata.com/), public domain): MPL-2.0 |

The MPL-2.0 files of these packages remain under the MPL-2.0; their source is in the same repository
(<https://github.com/bastian-schnitzler/graupel>, \`packages/\` and \`model-data/\`).

### Lucide icons in @graupel/meteogram

- **License:** ISC
- **Source:** Lucide (<https://lucide.dev>)

${fence(lucideLicense())}

## Services the page uses (not shipped)

| Service | What | Terms and attribution |
|---|---|---|
| [Open-Meteo.com](https://open-meteo.com/) | weather forecast, place search (geocoding), elevation | data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the page names Open-Meteo with the license under the meteogram and in Info → About; place names of the geocoding API come from [GeoNames](https://www.geonames.org/) (CC BY 4.0); [terms](https://open-meteo.com/en/terms) |
| [OpenTopoMap](https://opentopomap.org/) | map tiles (map provider \`opentopomap\`) | map style © OpenTopoMap ([CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)), map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL), elevation SRTM; credits on the map, SRTM and Leaflet in Info → About |
| [Maptoolkit](https://www.maptoolkit.org/) | hiking map style, vector tiles, fonts and sprites (map provider \`maptoolkit\`) | operated by Toursprung GmbH; © Maptoolkit, map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL); the map shows the attribution of the style and the Maptoolkit logo (at least 24 px, linking to maptoolkit.org) as the provider requires; [privacy](https://www.maptoolkit.org/privacy) |
| GitHub Pages | hosting | see the privacy policy (Info → Privacy) |

## npm packages in \`assets/\`

Bundled by the build (Vite), each with the license text of the installed package.`;

/** THIRD_PARTY_LICENSES.md as the build ships it. */
export function thirdPartyNotice() {
  const sections = [HEAD];
  for (const shipped of SHIPPED) {
    const dir = shippedDir(shipped);
    const pkg = readManifest(dir);
    let text = shipped.licenseText ?? licenseText(dir);
    if (shipped.licenseSection) {
      const end = text.indexOf(shipped.licenseSection);
      if (end < 0) throw new Error(`${shipped.name}: no "${shipped.licenseSection}" in its license file`);
      text = text.slice(0, end).trim();
    }
    sections.push(
      [`### ${pkg.name} ${pkg.version}`, "", `- **License:** ${pkg.license}`, `- **Use:** ${shipped.use}`, "", fence(text)].join(
        "\n",
      ),
    );
    /** @type {Map<string, Bundled>} */
    const found = new Map();
    for (const file of shipped.files ?? []) collectBundled(dir, file, found);
    if (found.size === 0) continue;
    sections.push(
      `#### Bundled into ${pkg.name}\n\nPackages compiled into its files, as their source maps list them ` +
        "(version as installed).",
    );
    for (const bundled of [...found.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const via = bundled.via === pkg.name ? "" : ` (through ${bundled.via})`;
      const title = `##### ${bundled.name} ${bundled.version}${via}`;
      sections.push([title, "", `- **License:** ${bundled.license}`, "", fence(bundled.text)].join("\n"));
    }
  }
  return `${sections.join("\n\n")}\n`;
}

/**
 * The npm package a bundled module belongs to: the package below the last `node_modules/`, `vite` or `rolldown` for
 * the virtual helper modules, `null` for files of this repository; throws for anything else.
 * @param {string} id module id as the bundler reports it
 */
export function bundledPackage(id) {
  const clean = id.replace(/^\0/, "").replace(/\\/g, "/");
  const at = clean.lastIndexOf("/node_modules/");
  if (at >= 0) {
    const [scope = "", name = ""] = clean.slice(at + "/node_modules/".length).split("/");
    return scope.startsWith("@") ? `${scope}/${name}` : scope;
  }
  const helper = /^(vite|rolldown)\//.exec(clean);
  if (helper?.[1]) return helper[1];
  if (clean.startsWith(repoRoot.replace(/\\/g, "/"))) return null;
  throw new Error(`unknown origin of bundled module ${id}`);
}

/** Problems when the bundled packages differ from SHIPPED. @param {Iterable<string>} bundled */
export function checkShipped(bundled) {
  const actual = new Set(bundled);
  const listed = new Set(SHIPPED.map((pkg) => pkg.name));
  return [
    ...[...actual].filter((name) => !listed.has(name)).map((name) => `${name} is bundled but not in SHIPPED`),
    ...[...listed].filter((name) => !actual.has(name)).map((name) => `${name} is in SHIPPED but not bundled`),
  ];
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = thirdPartyNotice();
  if (process.argv.includes("--check")) {
    const current = existsSync(NOTICE_FILE) ? readFileSync(NOTICE_FILE, "utf8") : "";
    if (current !== text) {
      console.error("THIRD_PARTY_LICENSES.md is out of date: run `pnpm licenses`");
      process.exit(1);
    }
  } else {
    writeFileSync(NOTICE_FILE, text);
    console.log("third-party: THIRD_PARTY_LICENSES.md written");
  }
}
