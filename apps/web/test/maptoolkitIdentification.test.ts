// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Identification at Maptoolkit (REQ-698, DEC-075): every request of the Maptoolkit map carries the page's domain
 * (graupel.eu, graupel.at, graupel.ch, …) as Origin and Referer, the Referer cut down to the domain by the referrer
 * policy strict-origin-when-cross-origin, set in index.html for the whole page and by transformRequest for each map
 * request. No URL parameter: Maptoolkit does not read one (maptoolkit.org/tos, section 9).
 * e2e/maptoolkit-identification.spec.ts checks the headers the browser actually sends.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAPTOOLKIT_REFERRER_POLICY,
  MAPTOOLKIT_STYLE,
  isMaptoolkitUrl,
  maptoolkitRequest,
} from "../src/regions/LocationPicker/map/maptoolkitStyle.ts";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const INDEX_HTML = readFileSync(join(APP_DIR, "index.html"), "utf8");
const referrerMeta = (html: string) =>
  [...html.matchAll(/<meta\s+name="referrer"\s+content="([^"]*)"\s*\/?>/g)].map(([, content]) => content);

describe("referrer policy of the page (REQ-698)", () => {
  it("index.html sets strict-origin-when-cross-origin once, in the head before any script", () => {
    expect(referrerMeta(INDEX_HTML)).toEqual(["strict-origin-when-cross-origin"]);
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf("</head>"));
    expect(head.indexOf('name="referrer"')).toBeGreaterThan(-1);
    expect(head.indexOf('name="referrer"')).toBeLessThan(head.indexOf("<script"));
  });


  it("transformRequest uses the same policy as the page", () => {
    expect(MAPTOOLKIT_REFERRER_POLICY).toBe("strict-origin-when-cross-origin");
  });
});

describe("Maptoolkit requests (REQ-698)", () => {
  it("recognises the endpoints of maptoolkit.org", () => {
    for (const url of [
      MAPTOOLKIT_STYLE,
      "https://styles.maptoolkit.org/hiking.json",
      "https://tiles.maptoolkit.org/osm/14/8710/5744.pbf",
      "https://fonts.maptoolkit.org/Noto%20Sans%20Regular/0-255.pbf",
      "https://styles.maptoolkit.org/sprites/hiking@2x.png",
      "https://maptoolkit.org/",
    ])
      expect(isMaptoolkitUrl(url), url).toBe(true);
  });

  it("leaves other hosts, look-alikes, plain http and broken URLs alone", () => {
    for (const url of [
      "https://tiles.mapterhorn.com/12/2176/1436.webp",
      "https://a.tile.opentopomap.org/14/8710/5744.png",
      "https://maptoolkit.org.example.com/hiking.json",
      "https://evilmaptoolkit.org/hiking.json",
      "http://styles.maptoolkit.org/hiking.json",
      "not a url",
    ])
      expect(isMaptoolkitUrl(url), url).toBe(false);
  });

  it("gives every Maptoolkit request the referrer policy and keeps the URL unchanged, without a domain parameter", () => {
    const url = "https://tiles.maptoolkit.org/osm/14/8710/5744.pbf";
    expect(maptoolkitRequest(url)).toEqual({ url, referrerPolicy: "strict-origin-when-cross-origin" });
    expect(maptoolkitRequest(MAPTOOLKIT_STYLE).url).toBe(MAPTOOLKIT_STYLE);
  });

  it("does not touch requests to other hosts", () => {
    const url = "https://tiles.mapterhorn.com/12/2176/1436.webp";
    expect(maptoolkitRequest(url)).toEqual({ url });
  });
});

/**
 * The README's section on the map data (REQ-699) tells forks the Maptoolkit terms and where the code sends the
 * identification. The places it names must exist, so that a renamed file or function does not leave forks with a
 * stale pointer.
 */
describe("README on the map data for forks (REQ-699)", () => {
  const readme = readFileSync(join(APP_DIR, "README.md"), "utf8");
  const start = readme.indexOf("## Kartendaten");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 1));

  it("names the Maptoolkit community licence with its terms and asks forks for an identification of their own", () => {
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain("Maptoolkit-Community-Lizenz");
    expect(section).toContain("https://www.maptoolkit.org/tos");
    expect(section).toContain("**Forks:**");
  });

  it("points to the code and the tests of the identification, which exist", () => {
    const paths = [...section.matchAll(/`((?:src|test|e2e)\/[^`]+\.tsx?)`/g)].map(([, path]) => path!);
    expect(paths).toEqual([
      "src/regions/LocationPicker/map/maptoolkitStyle.ts",
      "test/maptoolkitIdentification.test.ts",
      "e2e/maptoolkit-identification.spec.ts",
    ]);
    for (const path of paths) expect(existsSync(join(APP_DIR, path)), path).toBe(true);
    expect(section).toContain("`maptoolkitRequest`");
    expect(readFileSync(join(APP_DIR, paths[0]!), "utf8")).toContain("export function maptoolkitRequest(");
  });
});
