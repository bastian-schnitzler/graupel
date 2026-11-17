// @vitest-environment node
// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The built site holds every icon it points to (REQ-777, REQ-779): 0.4.0 shipped its icons in icons/, which Apache
 * maps to its own symbols (Alias /icons/), so on the domains the iPhone showed a letter instead of the app icon and
 * the About tab a broken logo. Builds the site with Vite (against the sources of the workspace packages, like the
 * other tests) and checks dist/ with the check of the release archive (scripts/package-site.mjs).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkServedPaths,
  checkSite,
  checkSiteReferences,
  collectFiles,
  ICON_FOLDER,
  RESERVED_FOLDERS,
  pngSize,
  siteReferences,
} from "../scripts/package-site.mjs";
import { SCREENSHOT_FOLDER } from "../scripts/app-manifest.mjs";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGES = join(APP_DIR, "..", "..", "packages");

/** The icons of the site; the manifest lists the 192 and 512 px ones (REQ-516), the About tab shows the logo. */
const ICONS = [
  "apple-touch-icon.png",
  "favicon-32.png",
  "icon-192.png",
  "icon-512.png",
  "icon-192-maskable.png",
  "icon-512-maskable.png",
  "logo-192.png",
].map((name) => `${ICON_FOLDER}${name}`);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const site = (files: Record<string, string | Buffer>) =>
  new Map(Object.entries(files).map(([name, data]) => [name, Buffer.from(data)]));

describe("built site (REQ-777, REQ-779)", () => {
  let outDir: string;
  let files: Map<string, Buffer>;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "graupel-dist-"));
    await build({
      root: APP_DIR,
      configFile: join(APP_DIR, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
      resolve: {
        alias: {
          "@graupel/meteogram-react": join(PACKAGES, "meteogram-react", "src", "index.ts"),
          "@graupel/meteogram/png": join(PACKAGES, "meteogram", "src", "png", "index.ts"),
          "@graupel/meteogram": join(PACKAGES, "meteogram", "src", "index.ts"),
          "@graupel/download": join(PACKAGES, "download", "src", "index.ts"),
        },
      },
    });
    files = new Map(collectFiles(outDir).map(({ name, data }) => [name, data]));
  }, 120_000);

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it("contains the apple-touch-icon, the logo and every icon of the manifest, as PNG", () => {
    const manifest = JSON.parse(files.get("manifest.webmanifest")!.toString("utf8"));
    const manifestIcons = manifest.icons.map((icon: { src: string }) => icon.src);
    expect(manifestIcons).toHaveLength(4);
    for (const path of new Set([...ICONS, ...manifestIcons])) {
      expect(files.has(path), path).toBe(true);
      expect(files.get(path)!.subarray(0, 8).equals(PNG.subarray(0, 8)), path).toBe(true);
    }
  });

  it("contains the manifest's screenshots, each as PNG of the size the manifest gives (REQ-807)", () => {
    const manifest = JSON.parse(files.get("manifest.webmanifest")!.toString("utf8"));
    expect(manifest.description).toEqual(expect.any(String));
    const screenshots = manifest.screenshots as { src: string; sizes: string; form_factor: string }[];
    expect(screenshots.map((shot) => shot.form_factor).sort()).toEqual(["narrow", "wide"]);
    for (const { src, sizes } of screenshots) {
      expect(src.startsWith(SCREENSHOT_FOLDER), src).toBe(true);
      const size = pngSize(files.get(src)!);
      expect(size && `${size.width}x${size.height}`, src).toBe(sizes);
    }
    // Screenshots of the other languages, for the manifests of the domains.
    expect([...files.keys()].filter((name) => name.startsWith(SCREENSHOT_FOLDER)).length).toBeGreaterThan(2);
    expect(siteReferences(files).filter(({ rel }) => rel === "manifest screenshot").map(({ path }) => path)).toEqual(
      screenshots.map(({ src }) => src),
    );
  });

  it("points index.html, the manifest and the About tab to files of the build, relative to the page", () => {
    const references = siteReferences(files);
    const pairs = references.map(({ rel, path }) => [rel, path]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["apple-touch-icon", `${ICON_FOLDER}apple-touch-icon.png`],
        ["icon", `${ICON_FOLDER}favicon-32.png`],
        ["icon", "favicon.svg"],
        ["manifest", "manifest.webmanifest"],
        ["manifest icon", `${ICON_FOLDER}icon-192.png`],
        ["manifest icon", `${ICON_FOLDER}icon-512-maskable.png`],
        // AboutPanel's LOGO_SRC, `${BASE_URL}app-icons/logo-192.png` with BASE_URL "./".
        ["bundle", `${ICON_FOLDER}logo-192.png`],
      ]),
    );
    const html = files.get("index.html")!.toString("utf8");
    expect(html).toContain(`<link rel="apple-touch-icon" href="./${ICON_FOLDER}apple-touch-icon.png" />`);
    expect(checkSiteReferences(files)).toEqual([]);
    expect(checkSite(collectFiles(outDir))).toEqual([]);
  });

  it("puts nothing into folders that Apache maps elsewhere (icons/)", () => {
    expect(RESERVED_FOLDERS).toContain("icons/");
    expect(ICON_FOLDER).not.toBe("icons/");
    expect([...files.keys()].filter((name) => RESERVED_FOLDERS.some((folder) => name.startsWith(folder)))).toEqual([]);
    expect(existsSync(join(APP_DIR, "public", "icons"))).toBe(false);
  });
});

describe("site check (REQ-777, REQ-779)", () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

  it("refuses the layout of 0.4.0: icons in icons/", () => {
    const old = site({
      "index.html": page('<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />'),
      "icons/apple-touch-icon.png": PNG,
    });
    expect(checkServedPaths([...old.keys()])).toEqual([
      "icons/ is mapped elsewhere by Apache (Alias), its files would be missing on the server",
    ]);
    expect(checkSiteReferences(old)).toEqual([
      "index.html (apple-touch-icon) ./icons/apple-touch-icon.png: icons/ is mapped elsewhere by Apache (Alias)",
    ]);
  });

  it("finds missing files, paths from the domain root and files that are no PNG", () => {
    const broken = site({
      "index.html": page(
        [
          '<link rel="icon" href="/app-icons/favicon-32.png" type="image/png">',
          "<link rel='apple-touch-icon' href='app-icons/touch.png'>",
          '<link rel="manifest" href="./manifest.webmanifest">',
          '<link rel="stylesheet" href="./assets/missing.css">',
        ].join(""),
      ),
      "app-icons/touch.png": "<!doctype html>",
      "manifest.webmanifest": JSON.stringify({ icons: [{ src: "app-icons/icon-192.png", type: "image/png" }] }),
      "assets/index.js": 'const LOGO_SRC = "./" + "app-icons/logo-192.png";',
    });
    expect(checkSiteReferences(broken)).toEqual([
      "index.html (icon) /app-icons/favicon-32.png: not relative to the page",
      "index.html (apple-touch-icon) app-icons/touch.png: app-icons/touch.png is not a PNG",
      "manifest.webmanifest (manifest icon) app-icons/icon-192.png: app-icons/icon-192.png missing",
      "assets/index.js (bundle) app-icons/logo-192.png: app-icons/logo-192.png missing",
    ]);
  });

  it("finds a manifest screenshot or icon whose size is not the one the manifest gives (REQ-807)", () => {
    const png = (width: number, height: number) => {
      const data = Buffer.alloc(33);
      PNG.copy(data);
      data.write("IHDR", 12, "latin1");
      data.writeUInt32BE(width, 16);
      data.writeUInt32BE(height, 20);
      return data;
    };
    expect(pngSize(png(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(pngSize(Buffer.from("<!doctype html>"))).toBeNull();
    const shots = site({
      "index.html": page('<link rel="manifest" href="manifest.webmanifest">'),
      "manifest.webmanifest": JSON.stringify({
        icons: [{ src: "app-icons/icon-192.png", sizes: "192x192" }],
        screenshots: [
          { src: "app-screenshots/wide.png", sizes: "1280x800", form_factor: "wide" },
          { src: "app-screenshots/narrow.png", sizes: "780x1688", form_factor: "narrow" },
          { src: "icons/narrow.png", sizes: "780x1688", form_factor: "narrow" },
          { src: "app-screenshots/missing.png", sizes: "780x1688", form_factor: "narrow" },
        ],
      }),
      "app-icons/icon-192.png": png(180, 180),
      "app-screenshots/wide.png": png(1280, 800),
      "app-screenshots/narrow.png": png(390, 844),
      "icons/narrow.png": png(780, 1688),
    });
    expect(checkSiteReferences(shots)).toEqual([
      "manifest.webmanifest (manifest icon) app-icons/icon-192.png: app-icons/icon-192.png is 180x180, not 192x192",
      "manifest.webmanifest (manifest screenshot) app-screenshots/narrow.png: app-screenshots/narrow.png is 390x844, not 780x1688",
      "manifest.webmanifest (manifest screenshot) icons/narrow.png: icons/ is mapped elsewhere by Apache (Alias)",
      "manifest.webmanifest (manifest screenshot) app-screenshots/missing.png: app-screenshots/missing.png missing",
    ]);
  });

  it("resolves manifest icons relative to the manifest", () => {
    const nested = site({
      "index.html": page('<link rel="manifest" href="app/manifest.webmanifest">'),
      "app/manifest.webmanifest": JSON.stringify({ icons: [{ src: "../app-icons/icon-192.png" }] }),
      "app-icons/icon-192.png": PNG,
    });
    expect(siteReferences(nested).map(({ path }) => path)).toEqual([
      "app/manifest.webmanifest",
      "app-icons/icon-192.png",
    ]);
    expect(checkSiteReferences(nested)).toEqual([]);
  });

  it("is part of the Vite build", () => {
    expect(readFileSync(join(APP_DIR, "vite.config.ts"), "utf8")).toMatch(/plugins: \[[^\]]*siteCheckPlugin\(\)/);
  });
});
