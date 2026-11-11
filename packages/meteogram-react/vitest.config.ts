// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      // Tests laufen gegen die Quellen des Kerns, ohne vorherigen Build.
      alias: {
        "@graupel/meteogram": fileURLToPath(new URL("../meteogram/src/index.ts", import.meta.url)),
      },
    },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
    },
  }),
);
