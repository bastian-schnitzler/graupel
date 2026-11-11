// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The website is built from fresh packages (REQ-718, REQ-721): `pnpm package` (and the preview build) build the
 * workspace packages first (scripts/fresh-build.mjs) and stop when a dist/ is older than its sources, so the site
 * no longer bundles an old core (run with month, unit twice). Only a build given a commit carries it (REQ-724).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkDependencies,
  DEPENDENCY_BUILD,
  freshBuild,
  REVISION_VARIABLE,
  SITE_BUILD,
  staleDist,
  workspaceDependencies,
} from "../scripts/fresh-build.mjs";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_DIR = join(APP_DIR, "..", "..");
const PACKAGES = ["@graupel/download", "@graupel/meteogram", "@graupel/meteogram-react"];

let temp: string | undefined;
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

/** A package folder with a build script, src/index.ts and dist/index.js at the given times (seconds). */
function fakePackage(times: { src: number; dist?: number }) {
  temp = mkdtempSync(join(tmpdir(), "graupel-fresh-"));
  writeFileSync(join(temp, "package.json"), JSON.stringify({ name: "@graupel/fake", scripts: { build: "tsup" } }));
  mkdirSync(join(temp, "src"));
  writeFileSync(join(temp, "src", "index.ts"), "export {};\n");
  utimesSync(join(temp, "src", "index.ts"), times.src, times.src);
  if (times.dist !== undefined) {
    mkdirSync(join(temp, "dist"));
    writeFileSync(join(temp, "dist", "index.js"), "export {};\n");
    utimesSync(join(temp, "dist", "index.js"), times.dist, times.dist);
  }
  return temp;
}

describe("fresh build of the website (REQ-718, REQ-721)", () => {
  const scripts = () =>
    (JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("pnpm package starts with the packages", () => {
    expect(scripts().package).toBe("node scripts/fresh-build.mjs && node scripts/package-site.mjs");
  });


  it("selects meteogram, meteogram-react and download for the package build, not the website", () => {
    expect(DEPENDENCY_BUILD.slice(0, 2)).toEqual(["--filter", "@graupel/web^..."]);
    expect(DEPENDENCY_BUILD.slice(-2)).toEqual(["run", "build"]);
    const listed = JSON.parse(
      execFileSync("pnpm", [...DEPENDENCY_BUILD.slice(0, 2), "ls", "--depth", "-1", "--json"], {
        cwd: REPO_DIR,
        encoding: "utf8",
      }),
    ) as { name: string }[];
    const names = listed.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(PACKAGES));
    expect(names).not.toContain("@graupel/web");
    expect(workspaceDependencies().map(({ name }) => name).sort()).toEqual(
      [...PACKAGES, "@graupel/model-data"].sort(),
    );
  });

  it("builds the packages, checks them, then builds the website", () => {
    const steps: string[] = [];
    freshBuild({
      run: (args) => steps.push(args === DEPENDENCY_BUILD ? "packages" : args === SITE_BUILD ? "site" : args.join(" ")),
      check: () => steps.push("check"),
    });
    expect(steps).toEqual(["packages", "check", "site"]);
  });

  it("stops before the website when a package's dist/ is stale", () => {
    const steps: string[] = [];
    const stale = fakePackage({ src: 2_000_000_000, dist: 1_000_000_000 });
    expect(() =>
      freshBuild({
        run: (args) => steps.push(args === SITE_BUILD ? "site" : "packages"),
        check: () => checkDependencies([{ name: "@graupel/fake", dir: stale }]),
      }),
    ).toThrow("stale package build, not building the website: @graupel/fake: dist/ older than src/");
    expect(steps).toEqual(["packages"]);
  });

  it("finds a dist/ older than its sources or missing, accepts a fresh one", () => {
    expect(staleDist(fakePackage({ src: 2_000_000_000, dist: 1_000_000_000 }))).toBe(
      "@graupel/fake: dist/ older than src/",
    );
    expect(staleDist(fakePackage({ src: 1_000_000_000 }))).toBe("@graupel/fake: dist/ missing");
    expect(staleDist(fakePackage({ src: 1_000_000_000, dist: 2_000_000_000 }))).toBeNull();
    expect(() => checkDependencies([{ name: "@graupel/fake", dir: fakePackage({ src: 1, dist: 2 }) }])).not.toThrow();
    // model-data has no build: nothing to check.
    expect(staleDist(join(REPO_DIR, "model-data"))).toBeNull();
  });

  it("gives only the preview build the commit (REQ-724)", () => {
    const envs: Record<string, string | undefined>[] = [];
    const record = (args: readonly string[], env: Record<string, string | undefined>) => {
      if (args === SITE_BUILD) envs.push(env);
    };
    const before = process.env[REVISION_VARIABLE];
    process.env[REVISION_VARIABLE] = "left-over";
    try {
      freshBuild({ run: record, check: () => {} });
      freshBuild({ revision: "abc1234", run: record, check: () => {} });
    } finally {
      if (before === undefined) delete process.env[REVISION_VARIABLE];
      else process.env[REVISION_VARIABLE] = before;
    }
    expect(REVISION_VARIABLE).toBe("VITE_GRAUPEL_REVISION");
    expect(envs[0]).not.toHaveProperty(REVISION_VARIABLE);
    expect(envs[1]?.[REVISION_VARIABLE]).toBe("abc1234");
  });
});
