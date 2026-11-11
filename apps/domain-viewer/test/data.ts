// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// The model-data files as the viewer gets them (prebuild copies them unchanged).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed JSON; each test reads the fields it checks
export function load(file: string): any {
  return JSON.parse(readFileSync(require.resolve(`@graupel/model-data/${file}`), "utf8"));
}
