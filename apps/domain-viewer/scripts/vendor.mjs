// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// What the build copies to dist/vendor/: the map libraries as shipped (DEC-009). scripts/build.mjs copies these
// files, scripts/third-party.mjs writes THIRD_PARTY_LICENSES.md from the same list.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Directory of an installed package. @param {string} name */
export const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

/**
 * @typedef {object} VendorPackage
 * @property {string} name npm package
 * @property {string} dir folder below dist/vendor/
 * @property {string[]} files files and folders of the package that the build copies
 * @property {string} license license file of the package, copied with the files
 */

/** @type {VendorPackage[]} */
export const VENDOR = [
  {
    name: "leaflet",
    dir: "leaflet",
    files: ["dist/leaflet.js", "dist/leaflet.css", "dist/images"],
    license: "LICENSE",
  },
  {
    name: "maplibre-gl",
    dir: "maplibre-gl",
    files: ["dist/maplibre-gl.js", "dist/maplibre-gl.css"],
    license: "LICENSE.txt",
  },
  {
    name: "@maplibre/maplibre-gl-leaflet",
    dir: "maplibre-gl-leaflet",
    files: ["leaflet-maplibre-gl.js"],
    license: "LICENSE",
  },
];

/** [path below dist/vendor/, source path] for every file the build copies. @returns {Array<[string, string]>} */
export function vendorCopies() {
  return VENDOR.flatMap((pkg) => {
    const dir = packageDir(pkg.name);
    return [...pkg.files, pkg.license].map((file) => {
      const name = file.split("/").pop() ?? file;
      return /** @type {[string, string]} */ ([join(pkg.dir, name), join(dir, file)]);
    });
  });
}
