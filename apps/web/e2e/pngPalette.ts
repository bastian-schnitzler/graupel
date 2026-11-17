// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Makes a screenshot small for the repository and the site (manifest screenshots, REQ-807): reduces an opaque 8-bit
 * RGB(A) PNG, as Chromium writes it, to at most 256 colours (median cut, no dithering) and writes it as a palette PNG.
 * A screenshot of the page has a few flat colours plus the shades of anti-aliased text; at screenshot size the
 * difference cannot be seen, and the file shrinks to about a third. Without dependencies (node:zlib).
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width, height and the RGB value (0xRRGGBB) of each pixel of a PNG without interlacing, 8 bit RGB or RGBA. */
function decode(file: Buffer): { width: number; height: number; colors: Uint32Array } {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
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
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[12] !== 0)
        throw new Error("only 8-bit RGB or RGBA PNGs without interlacing");
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? rows[y * stride + x - channels]! : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels]! : 0;
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
  const colors = new Uint32Array(width * height);
  for (let i = 0; i < colors.length; i++) {
    colors[i] = (rows[i * channels]! << 16) | (rows[i * channels + 1]! << 8) | rows[i * channels + 2]!;
  }
  return { width, height, colors };
}

const channel = (color: number, index: number) => (color >> (16 - 8 * index)) & 0xff;

/** Up to `size` colours for the histogram (colour → pixel count): median cut, weighted by pixels. */
function palette(histogram: Map<number, number>, size: number): number[] {
  type Box = { colors: number[]; pixels: number };
  const box = (colors: number[]): Box => ({ colors, pixels: colors.reduce((sum, c) => sum + histogram.get(c)!, 0) });
  const ranges = (colors: number[]) =>
    [0, 1, 2].map((k) => {
      let low = 255;
      let high = 0;
      for (const color of colors) {
        const value = channel(color, k);
        if (value < low) low = value;
        if (value > high) high = value;
      }
      return high - low;
    });
  const boxes = [box([...histogram.keys()])];
  while (boxes.length < size) {
    // The box with the most pixels times its widest range, so large flat areas keep their exact colour.
    let best = -1;
    let score = 0;
    boxes.forEach((candidate, index) => {
      if (candidate.colors.length < 2) return;
      const value = Math.max(...ranges(candidate.colors)) * candidate.pixels;
      if (value > score) {
        score = value;
        best = index;
      }
    });
    if (best < 0) break;
    const { colors } = boxes[best]!;
    const spans = ranges(colors);
    const k = spans.indexOf(Math.max(...spans));
    colors.sort((a, b) => channel(a, k) - channel(b, k));
    const half = boxes[best]!.pixels / 2;
    let count = 0;
    let cut = 1;
    for (; cut < colors.length - 1; cut++) {
      count += histogram.get(colors[cut - 1]!)!;
      if (count >= half) break;
    }
    boxes.splice(best, 1, box(colors.slice(0, cut)), box(colors.slice(cut)));
  }
  return boxes.map(({ colors, pixels }) => {
    const sums = [0, 0, 0];
    for (const color of colors) for (let k = 0; k < 3; k++) sums[k]! += channel(color, k) * histogram.get(color)!;
    const [r, g, b] = sums.map((sum) => Math.round(sum / pixels));
    return (r! << 16) | (g! << 8) | b!;
  });
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The PNG `file` with at most 256 colours, as a palette PNG of the same size. */
export function toPalettePng(file: Buffer): Buffer {
  const { width, height, colors } = decode(file);
  const histogram = new Map<number, number>();
  for (const color of colors) histogram.set(color, (histogram.get(color) ?? 0) + 1);
  const entries = palette(histogram, 256);
  const nearest = new Map<number, number>();
  for (const color of histogram.keys()) {
    let best = 0;
    let distance = Infinity;
    entries.forEach((entry, index) => {
      let d = 0;
      for (let k = 0; k < 3; k++) d += (channel(color, k) - channel(entry, k)) ** 2;
      if (d < distance) {
        distance = d;
        best = index;
      }
    });
    nearest.set(color, best);
  }
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = nearest.get(colors[y * width + x]!)!;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // palette
  const plte = Buffer.alloc(entries.length * 3);
  entries.forEach((entry, index) => {
    for (let k = 0; k < 3; k++) plte[index * 3 + k] = channel(entry, k);
  });
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
