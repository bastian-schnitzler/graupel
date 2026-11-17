// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-822: the viewer runs under a sub-path (GitHub Pages of the public repository, /graupel/). Every path of the page
 * is relative; a path starting with "/" would point to the root of the host. The end-to-end test
 * (e2e/subpath.spec.ts) loads the built site under /graupel/; this test points at the line early.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("relative paths (REQ-822)", () => {
  it("index.html links scripts, styles and license files relative", () => {
    const refs = [...read("index.html").matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(10);
    const local = refs.filter((ref) => !/^https?:\/\//.test(ref));
    expect(local).toEqual(expect.arrayContaining(["vendor/leaflet/leaflet.js", "src/viewer.js", "LICENSE"]));
    expect(local.filter((ref) => ref.startsWith("/") || ref.startsWith(".."))).toEqual([]);
  });

  it("viewer.js loads the data and registers the service worker relative", () => {
    const viewer = read("src/viewer.js");
    expect(viewer).toContain("fetch(`data/${file}`)");
    expect(viewer).toContain('navigator.serviceWorker.register("sw.js")');
    const calls = [...viewer.matchAll(/\b(?:fetch|register|import)\(\s*["'`]([^"'`]*)/g)].map((m) => m[1]!);
    expect(calls.filter((url) => url.startsWith("/"))).toEqual([]);
  });
});
