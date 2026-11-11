// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Types of fresh-build.mjs for the tests. */
export interface WorkspaceDependency {
  name: string;
  dir: string;
}

export const REVISION_VARIABLE: string;
export const DEPENDENCY_BUILD: readonly string[];
export const SITE_BUILD: readonly string[];
export function workspaceDependencies(dir?: string): WorkspaceDependency[];
export function staleDist(dir: string): string | null;
export function checkDependencies(dependencies?: readonly WorkspaceDependency[]): void;
export function freshBuild(options?: {
  revision?: string;
  run?: (args: readonly string[], env: Record<string, string | undefined>) => void;
  check?: () => void;
}): void;
