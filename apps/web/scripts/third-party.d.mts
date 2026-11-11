// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Types of third-party.mjs for vite.config.ts and the tests. */
export interface ShippedPackage {
  name: string;
  from: string;
  use: string;
  files?: string[];
  licenseSection?: string;
  licenseText?: string;
}

export const NOTICE_FILE: string;
export const SHIPPED: readonly ShippedPackage[];
export function shippedDir(pkg: ShippedPackage): string;
export function thirdPartyNotice(): string;
export function bundledPackage(id: string): string | null;
export function checkShipped(bundled: Iterable<string>): string[];
