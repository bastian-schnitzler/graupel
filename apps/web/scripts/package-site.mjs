#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Packs the built website (apps/web/dist) into graupel-site.zip, the release artifact that is deployed to every domain
 * with the domain's own config.json. Without dependencies: a small ZIP writer on
 * node:zlib. The default config.json stays in the archive, so the site also runs without a domain configuration.
 *
 * Usage: node scripts/package-site.mjs [--dist <dir>] [--out <file>]
 *        (defaults: dist, release/graupel-site.zip, relative to apps/web)
 * After writing, the archive is read back and checked for index.html, config.json, the license files and assets/.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const ARTIFACT_NAME = "graupel-site.zip";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as used by ZIP. */
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamp (1980-01-01 00:00), so the same build gives the same archive.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * Builds a ZIP archive from entries { name, data } (name with "/" separators). Entries are deflated when that
 * makes them smaller, otherwise stored. Names are written as UTF-8.
 */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const compress = deflated.length < data.length;
    const body = compress ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // file mode rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Reads a ZIP archive (as written by createZip, no ZIP64) and returns its entries { name, data }. */
export function readZip(buffer) {
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("not a ZIP archive (no end of central directory)");
  const count = buffer.readUInt16LE(endOffset + 10);
  let pos = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error(`broken central directory at ${pos}`);
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const size = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength);
    const localStart =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const body = buffer.subarray(localStart, localStart + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    entries.push({ name, data });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** All files below `dir` as entries { name, data }, sorted by name (names relative, with "/"). */
export function collectFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push({ name: relative(dir, path).split(sep).join("/"), data: readFileSync(path) });
    }
  };
  walk(dir);
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Files the site archive must contain besides assets/: the page, its configuration and the licenses (REQ-431). */
export const REQUIRED_FILES = ["index.html", "config.json", "LICENSE", "THIRD_PARTY_LICENSES.md"];

/** Problems of a site archive's file list: it needs REQUIRED_FILES and at least one file in assets/. */
export function checkSiteEntries(names) {
  const problems = [];
  for (const file of REQUIRED_FILES) if (!names.includes(file)) problems.push(`${file} missing`);
  if (!names.some((name) => name.startsWith("assets/"))) problems.push("no files in assets/");
  return problems;
}

/** Packs `distDir` into `outFile`, reads the archive back and checks it. Returns the entry names. */
export function packageSite(distDir, outFile) {
  if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${distDir} not found; run "pnpm build" first`);
  }
  const zip = createZip(collectFiles(distDir));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zip);
  const names = readZip(readFileSync(outFile)).map((entry) => entry.name);
  const problems = checkSiteEntries(names);
  if (problems.length > 0) throw new Error(`${outFile}: ${problems.join(", ")}`);
  return names;
}

function argument(args, flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const distDir = resolve(appDir, argument(args, "--dist", "dist"));
  const outFile = resolve(appDir, argument(args, "--out", join("release", ARTIFACT_NAME)));
  try {
    const names = packageSite(distDir, outFile);
    console.log(`${relative(process.cwd(), outFile) || outFile}: ${names.length} files, ${statSync(outFile).size} bytes`);
  } catch (error) {
    console.error(`package-site: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
