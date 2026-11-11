#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Builds the website from fresh packages (REQ-718, REQ-721): Vite bundles the dist/ of the workspace packages as it
 * lies, so a site built without them first ships an old core (the preview 3c9d21f showed the run with its month and
 * the unit twice). `freshBuild` builds every workspace package the website depends on (`pnpm --filter
 * "@graupel/web^..." build`, in the order of their dependencies), stops if a dist/ is still older than its sources and
 * only then builds the website. `pnpm package` and `pnpm preview:build` start with it.
 *
 * Usage: node scripts/fresh-build.mjs   (builds the packages and the website for the domains, without a commit in the
 *        bundle, REQ-724)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_DIR = dirname(dirname(APP_DIR));

/** Build-time variable with the commit of a preview build; the Info tab shows it after the version (REQ-724). */
export const REVISION_VARIABLE = "VITE_GRAUPEL_REVISION";

/** pnpm arguments that build every workspace package the website depends on, not the website itself. */
export const DEPENDENCY_BUILD = ["--filter", "@graupel/web^...", "--if-present", "run", "build"];
/** pnpm arguments that build the website (type check and Vite). */
export const SITE_BUILD = ["--filter", "@graupel/web", "run", "build"];

/**
 * Workspace packages (`workspace:` dependencies) of the package in `dir`, with their own ones, each once: name and
 * folder, resolved through node_modules as pnpm links them.
 */
export function workspaceDependencies(dir = APP_DIR) {
  const found = new Map();
  const visit = (from) => {
    const manifest = JSON.parse(readFileSync(join(from, "package.json"), "utf8"));
    for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (!String(spec).startsWith("workspace:") || found.has(name)) continue;
      const path = realpathSync(join(from, "node_modules", name));
      found.set(name, path);
      visit(path);
    }
  };
  visit(dir);
  return [...found].map(([name, path]) => ({ name, dir: path }));
}

/** Latest modification time (ms) of the files below `path`, or -Infinity without any. */
function newest(path) {
  if (!existsSync(path)) return -Infinity;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path).reduce((latest, name) => Math.max(latest, newest(join(path, name))), -Infinity);
}

/**
 * Why the built dist/ of the package in `dir` cannot be used, or null: missing, or older than the newest file in src/
 * (REQ-718). Packages without a build script (model-data) have nothing to check.
 */
export function staleDist(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!manifest.scripts?.build) return null;
  const built = newest(join(dir, "dist"));
  if (built === -Infinity) return `${manifest.name}: dist/ missing`;
  if (newest(join(dir, "src")) > built) return `${manifest.name}: dist/ older than src/`;
  return null;
}

/** Throws if one of the website's workspace packages has no current dist/. */
export function checkDependencies(dependencies = workspaceDependencies()) {
  const problems = dependencies.map(({ dir }) => staleDist(dir)).filter(Boolean);
  if (problems.length > 0) throw new Error(`stale package build, not building the website: ${problems.join("; ")}`);
}

/** Runs pnpm in the repo root with the given arguments and environment, output to the console. */
function pnpm(args, env) {
  execFileSync("pnpm", args, { cwd: REPO_DIR, stdio: "inherit", env, shell: process.platform === "win32" });
}

/**
 * Builds the packages, checks their dist/ and builds the website (REQ-718, REQ-721). `revision`: the commit the Info
 * tab names after the version, only for the preview (REQ-724); without it the variable is removed, so a domain build
 * never carries one. `run` and `check` are replaceable for the tests.
 */
export function freshBuild({ revision, run = pnpm, check = checkDependencies } = {}) {
  const env = { ...process.env };
  delete env[REVISION_VARIABLE];
  run(DEPENDENCY_BUILD, env);
  check();
  run(SITE_BUILD, revision ? { ...env, [REVISION_VARIABLE]: revision } : env);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    freshBuild();
  } catch (error) {
    console.error(`fresh-build: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`website built in ${relative(process.cwd(), join(APP_DIR, "dist")) || "."}`);
}
