// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * App icons and favicon (REQ-424, REQ-516): the cloud lies on an opaque light blue background; full-bleed icons (iOS,
 * maskable) have no transparent pixel, rounded ones only in their corners. The manifest's background_color is the
 * page's background colour since REQ-750 (test/pageBackground.test.ts). The logo in the About tab and the favicon
 * (REQ-662) stay transparent.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const PUBLIC_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");
const BACKGROUND = "#dbe8f5";
const BACKGROUND_RGB = [0xdb, 0xe8, 0xf5];

interface Png {
  width: number;
  height: number;
  /** RGBA, 8 bit per channel */
  pixels: Uint8Array;
}

/** Byte at `index`, 0 outside the array. */
const byte = (array: Uint8Array, index: number) => array[index] ?? 0;

/** Decodes an 8-bit RGBA or RGB PNG without interlacing, as Chromium's canvas writes it. */
function decodePng(file: Buffer): Png {
  expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8], "bit depth").toBe(8);
      expect([2, 6], "colour type").toContain(data[9]);
      expect(data[12], "interlace").toBe(0);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = byte(raw, y * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const value = byte(raw, y * (stride + 1) + 1 + x);
      const a = x >= channels ? byte(rows, y * stride + x - channels) : 0;
      const b = y > 0 ? byte(rows, (y - 1) * stride + x) : 0;
      const c = x >= channels && y > 0 ? byte(rows, (y - 1) * stride + x - channels) : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 3; k++) pixels[i * 4 + k] = byte(rows, i * channels + k);
    pixels[i * 4 + 3] = channels === 4 ? byte(rows, i * channels + 3) : 255;
  }
  return { width, height, pixels };
}

const readPng = (name: string) => decodePng(readFileSync(join(PUBLIC_DIR, "icons", name)));
const pixel = (png: Png, x: number, y: number) =>
  Array.from(png.pixels.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));

/** Pixels that are not fully opaque, outside the corner squares of side `corner` (0: everywhere). */
function transparentPixels(png: Png, corner: number) {
  let count = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const inCorner = (x < corner || x >= png.width - corner) && (y < corner || y >= png.height - corner);
      if (!inCorner && png.pixels[(y * png.width + x) * 4 + 3] !== 255) count++;
    }
  }
  return count;
}

const FULL_BLEED: [string, number][] = [
  ["apple-touch-icon.png", 180],
  ["icon-192-maskable.png", 192],
  ["icon-512-maskable.png", 512],
];
const ROUNDED: [string, number][] = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

describe("app icons (REQ-516)", () => {
  it.each(FULL_BLEED)("%s is full-bleed and opaque, the background in every corner", (name, size) => {
    const png = readPng(name);
    expect([png.width, png.height]).toEqual([size, size]);
    expect(transparentPixels(png, 0)).toBe(0);
    const corners: [number, number][] = [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ];
    for (const [x, y] of corners) expect(pixel(png, x, y)).toEqual([...BACKGROUND_RGB, 255]);
  });

  it.each(FULL_BLEED.slice(1))("%s keeps the cloud inside the safe zone of maskable icons", (name, size) => {
    const png = readPng(name);
    // Outside the circle with 80 % diameter there is only background.
    const outside: string[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size * 0.4) continue;
        const i = (y * size + x) * 4;
        if (BACKGROUND_RGB.some((value, k) => png.pixels[i + k] !== value)) outside.push(`${x},${y}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it.each(ROUNDED)("%s is a rounded square on the background, opaque except in the corners", (name, size) => {
    const png = readPng(name);
    expect([png.width, png.height]).toEqual([size, size]);
    // Corner radius 22 %: outside squares of a quarter of the edge everything is opaque.
    expect(transparentPixels(png, Math.ceil(size / 4))).toBe(0);
    expect(pixel(png, 0, 0)[3]).toBeLessThan(255);
    expect(pixel(png, Math.floor(size / 2), 1)).toEqual([...BACKGROUND_RGB, 255]);
    expect(pixel(png, 1, Math.floor(size / 2))).toEqual([...BACKGROUND_RGB, 255]);
  });

  it("shows the dark outline of the cloud on the icons", () => {
    const png = readPng("icon-512-maskable.png");
    let dark = 0;
    for (let i = 0; i < png.pixels.length; i += 4)
      if (byte(png.pixels, i) + byte(png.pixels, i + 1) + byte(png.pixels, i + 2) < 200) dark++;
    expect(dark).toBeGreaterThan(500);
  });

  it("keeps the logo of the About tab transparent", () => {
    const png = readPng("logo-192.png");
    expect([png.width, png.height]).toEqual([192, 192]);
    expect(pixel(png, 0, 0)[3]).toBe(0);
  });
});

describe("manifest and favicon (REQ-516)", () => {
  it("lists any and maskable icons", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC_DIR, "manifest.webmanifest"), "utf8"));
    expect(manifest.icons).toEqual([
      {
        src: "icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
    for (const icon of manifest.icons) {
      const png = readPng(icon.src.replace("icons/", ""));
      expect(`${png.width}x${png.height}`).toBe(icon.sizes);
    }
  });

  // REQ-662: the favicon shows the cloud without a background, unlike the app icons.
  it("draws favicon.svg without a background behind the cloud", () => {
    const svg = readFileSync(join(PUBLIC_DIR, "favicon.svg"), "utf8");
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain(BACKGROUND);
    expect(svg).toContain("<image");
  });

  it("draws favicon-32.png without a background: transparent corners and edges, the cloud in the middle", () => {
    const png = readPng("favicon-32.png");
    expect([png.width, png.height]).toEqual([32, 32]);
    for (const [x, y] of [
      [0, 0],
      [31, 0],
      [0, 31],
      [31, 31],
      [16, 0],
      [0, 16],
    ] as [number, number][]) {
      expect(pixel(png, x, y)[3]).toBe(0);
    }
    expect(transparentPixels(png, 0)).toBeGreaterThan(0);
    expect(32 * 32 - transparentPixels(png, 0)).toBeGreaterThan(100);
  });
});

describe("logo source (REQ-711)", () => {
  const scriptsDir = join(dirname(PUBLIC_DIR), "scripts");

  it("lies in apps/web next to the generator and holds the 1024 px master", () => {
    const script = readFileSync(join(scriptsDir, "generate-icons.mjs"), "utf8");
    expect(script).toContain('new URL("./graupel-cloud.svg", import.meta.url)');
    expect(script).not.toMatch(/\.\.\/\.\.\/\.\./);
    const source = readFileSync(join(scriptsDir, "graupel-cloud.svg"), "utf8");
    const master = /href="data:image\/png;base64,([^"]+)"/.exec(source)?.[1];
    expect(master).toBeDefined();
    const png = decodePng(Buffer.from(master!, "base64"));
    expect([png.width, png.height]).toEqual([1024, 1024]);
  });
});
