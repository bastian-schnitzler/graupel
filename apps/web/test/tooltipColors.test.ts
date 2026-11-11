// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Tooltip colours of the meteogram in styles/tokens.css (REQ-442): gusts like wind, apparent like temperature. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css"), "utf8");

/** Values of a custom property, one per block that sets it (light, dark by preference, forced dark). */
function values(name: string): string[] {
  return [...css.matchAll(new RegExp(`--graupel-tooltip-${name}:\\s*([^;]+);`, "g"))].map((match) =>
    match[1]!.trim().toLowerCase(),
  );
}

describe("meteogram tooltip colours", () => {
  it("give gusts the wind colour and the apparent temperature the temperature colour in every mode", () => {
    expect(values("wind")).toHaveLength(3);
    expect(values("temperature")).toHaveLength(3);
    expect(values("gust")).toEqual(values("wind"));
    expect(values("apparent-temperature")).toEqual(values("temperature"));
  });
});
