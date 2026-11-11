// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Types of package-site.mjs for the tests. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export const ARTIFACT_NAME: string;
export const REQUIRED_FILES: readonly string[];
export function crc32(data: Uint8Array): number;
export function createZip(entries: readonly ZipEntry[]): Buffer;
export function readZip(buffer: Buffer): { name: string; data: Buffer }[];
export function collectFiles(dir: string): { name: string; data: Buffer }[];
export function checkSiteEntries(names: readonly string[]): string[];
export function packageSite(distDir: string, outFile: string): string[];
