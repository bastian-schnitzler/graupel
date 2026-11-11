// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Prebuild: copies the model data the viewer reads from @graupel/model-data (model-data/) to public/data/ and checks
// it (src/schema.js), together with the package's license notices. public/data/ is generated and not versioned.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_FILES, validateData } from "../src/schema.js";

const require = createRequire(import.meta.url);
const out = fileURLToPath(new URL("../public/data/", import.meta.url));

/** @type {Record<string, string>} */
const texts = {};
for (const file of DATA_FILES) texts[file] = readFileSync(require.resolve(`@graupel/model-data/${file}`), "utf8");
const errors = validateData(Object.fromEntries(Object.entries(texts).map(([file, text]) => [file, JSON.parse(text)])));
if (errors.length) {
  console.error(`model-data does not fit the viewer:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [file, text] of Object.entries(texts)) writeFileSync(out + file, text);
// Not exported by the package: read from its folder.
const modelData = dirname(require.resolve("@graupel/model-data/package.json"));
for (const file of ["LICENSE", "LICENSES", "THIRD_PARTY_LICENSES.md"])
  cpSync(join(modelData, file), out + file, { recursive: true });
console.log(`prebuild: ${DATA_FILES.length} files from model-data checked and copied to public/data/`);
