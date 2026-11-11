// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The page reaches the screen's edges (REQ-618): the viewport meta tag of the page (index.html, which the build and the
 * preview's domain pages carry over) has viewport-fit=cover, so Safari reports the safe-area insets and the full-screen
 * meteogram can reach the camera and the screen's edge (REQ-606). The screen's side insets for what the page places
 * itself; e2e/phone-safe-area.spec.ts checks the built page with them in a browser.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSideInsets } from "../src/state/index.ts";

// Not `new URL(…, import.meta.url)`: under jsdom `URL` is not Node's.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(join(APP_DIR, "index.html"), "utf8");

/** The entries of every viewport meta tag of an HTML page. */
const viewports = (html: string) =>
  [...html.matchAll(/<meta\s+name="viewport"\s+content="([^"]*)"/g)].map(([, content]) =>
    content!.split(",").map((entry) => entry.trim()),
  );

describe("viewport meta tag (REQ-618)", () => {
  it("lets the page reach the screen's edges: viewport-fit=cover", () => {
    expect(viewports(page)).toEqual([["width=device-width", "initial-scale=1.0", "viewport-fit=cover"]]);
  });
});

describe("side insets of the screen (REQ-618)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("are 0 where the browser reports none, and the probe is gone afterwards", () => {
    const children = document.body.childElementCount;
    expect(readSideInsets()).toEqual({ left: 0, right: 0 });
    expect(document.body.childElementCount).toBe(children);
  });

  it("are the probe's padding by the insets", () => {
    const probes: string[] = [];
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = (element as HTMLElement).style;
      probes.push(`${style.paddingLeft}|${style.paddingRight}`);
      return { paddingLeft: "47px", paddingRight: "0px" } as CSSStyleDeclaration;
    });
    expect(readSideInsets()).toEqual({ left: 47, right: 0 });
    expect(probes).toHaveLength(1);
  });
});
