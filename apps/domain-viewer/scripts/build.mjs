// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Build: static site in dist/ (index.html, sw.js, src/, data/, vendor/, license files). No bundler: the page uses ES
// modules and the map libraries as shipped (Leaflet, MapLibre GL, maplibre-gl-leaflet; DEC-009), served from vendor/
// instead of a CDN so that the page and its tests run without third-party hosts. Only the base map comes from
// OpenFreeMap.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { thirdPartyNotice } from "./third-party.mjs";
import { vendorCopies } from "./vendor.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

execFileSync(process.execPath, [join(root, "scripts", "prebuild.mjs")], { stdio: "inherit" });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const file of ["index.html", "sw.js"]) cpSync(join(root, file), join(dist, file));
// schema.js only serves the prebuild.
for (const file of ["lib.js", "viewer.js"]) cpSync(join(root, "src", file), join(dist, "src", file));
cpSync(join(root, "public"), dist, { recursive: true });
// Licenses (REQ-095): the GPL of the code, the texts of the data licenses and the third-party notice.
cpSync(join(root, "LICENSE"), join(dist, "LICENSE"));
cpSync(join(root, "LICENSES"), join(dist, "LICENSES"), { recursive: true });
writeFileSync(join(dist, "THIRD_PARTY_LICENSES.md"), thirdPartyNotice());
for (const [to, from] of vendorCopies()) cpSync(from, join(dist, "vendor", to), { recursive: true });
console.log("build: dist/ ready");
