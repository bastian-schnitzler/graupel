// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "png/index": "src/png/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
});
