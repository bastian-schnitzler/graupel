// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * License check of the package (REQ-096): MPL-2.0 text in `LICENSE`, the
 * license in `package.json`, the MPL header in every source file, no GPL
 * material, and the attribution of the Open-Meteo data (CC BY 4.0) in the
 * result.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OPEN_METEO_ATTRIBUTION, createClient, downloadChain, toHarmonizedResponse } from "../src/index";
import { fakeOpenMeteo, hourlyAnswer, windowStart } from "./fakeOpenMeteo";
import { registry, resolverData } from "./modelData";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SPDX_MPL = "SPDX-License-Identifier: MPL-2.0";
const EXHIBIT_A = "This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.";
const GPL_MARKERS = [/SPDX-License-Identifier:[ \t]*[\w.+()-]*GPL/, /GNU (AFFERO |LESSER )?GENERAL PUBLIC LICENSE/i];

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

const rel = (path: string) => relative(PACKAGE_DIR, path);
const allFiles = listFiles(PACKAGE_DIR);
const sourceFiles = allFiles.filter((path) => SOURCE_EXTENSIONS.has(extname(path)));

describe("license (MPL-2.0)", () => {
  it("ships the full MPL-2.0 text as LICENSE", () => {
    const text = readFileSync(join(PACKAGE_DIR, "LICENSE"), "utf8");
    expect(text.startsWith("Mozilla Public License Version 2.0")).toBe(true);
    expect(text).toContain('Exhibit B - "Incompatible With Secondary Licenses" Notice');
  });

  it("declares MPL-2.0 in package.json and ships LICENSE", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
      license?: string;
      files?: string[];
    };
    expect(manifest.license).toBe("MPL-2.0");
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "LICENSE"]));
  });

  it("finds the source files", () => {
    expect(sourceFiles.map(rel)).toEqual(
      expect.arrayContaining([join("src", "index.ts"), join("src", "client.ts"), "tsup.config.ts", rel(SELF)]),
    );
  });

  it("has the MPL header at the top of every source file", () => {
    const missing = sourceFiles.filter((path) => {
      const head = readFileSync(path, "utf8").split("\n").slice(0, 6).join("\n");
      return !head.includes(SPDX_MPL) || !head.includes(EXHIBIT_A);
    });
    expect(missing.map(rel)).toEqual([]);
  });

  it("contains no GPL material", () => {
    // LICENSE itself names the GNU licenses as MPL "Secondary Licenses"; it is checked above.
    const scanned = allFiles.filter((path) => path !== SELF && path !== join(PACKAGE_DIR, "LICENSE"));
    const gpl = scanned.filter((path) => GPL_MARKERS.some((marker) => marker.test(readFileSync(path, "utf8"))));
    expect(gpl.map(rel)).toEqual([]);
  });

  it("documents the data license and the API terms in the README", () => {
    const readme = readFileSync(join(PACKAGE_DIR, "README.md"), "utf8");
    expect(readme).toContain("MPL-2.0");
    expect(readme).toContain("CC BY 4.0");
    expect(readme).toContain("Weather data by Open-Meteo.com");
    expect(readme).toContain("10 000");
    expect(readme).toContain("apiKey");
  });
});

describe("attribution of the data (CC BY 4.0)", () => {
  const NOW = Date.UTC(2026, 8, 14, 10, 30);
  const NOW_HOUR = Date.UTC(2026, 8, 14, 10);
  const BERLIN = { name: "Berlin", latitude: 52.52, longitude: 13.405, timezone: "Europe/Berlin" };

  async function download() {
    const api = fakeOpenMeteo({
      forecast: (call) => {
        const { start, count } = windowStart(call, NOW_HOUR);
        return hourlyAnswer(call.hourly, start, count, () => 10);
      },
    });
    const client = createClient({ fetch: api.fetch, retryBackoffMs: 0, cache: null });
    return downloadChain(
      client,
      {
        location: BERLIN,
        now: NOW,
        cloudChain: [],
        chain: [{ name: "ICON-EU", max_forecast_horizon_hours: 24 }],
        quantities: ["temperature"],
      },
      { registry, ...resolverData },
    );
  }

  it("names Open-Meteo, the license and the harmonization in the result", async () => {
    const result = await download();
    expect(result.attribution).toEqual({
      text: "Weather data by Open-Meteo.com",
      url: "https://open-meteo.com/",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      modifications: expect.stringMatching(/harmonized[\s\S]*combined/),
    });
    expect(result.attribution).toEqual(OPEN_METEO_ATTRIBUTION);
    expect(result.attribution).not.toBe(OPEN_METEO_ATTRIBUTION);
  });

  it("carries the attribution into the response of the former backend", async () => {
    const response = toHarmonizedResponse(await download());
    expect(response.attribution).toEqual({
      text: OPEN_METEO_ATTRIBUTION.text,
      url: OPEN_METEO_ATTRIBUTION.url,
      license: OPEN_METEO_ATTRIBUTION.license,
      license_url: OPEN_METEO_ATTRIBUTION.licenseUrl,
      modifications: OPEN_METEO_ATTRIBUTION.modifications,
    });
  });
});
