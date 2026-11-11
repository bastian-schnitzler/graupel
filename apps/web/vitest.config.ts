// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import base from "../../vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    resolve: {
      // Tests laufen gegen die Quellen der Workspace-Pakete, ohne vorherigen Build.
      alias: {
        "@graupel/meteogram-react": fileURLToPath(
          new URL("../../packages/meteogram-react/src/index.ts", import.meta.url),
        ),
        "@graupel/meteogram/png": fileURLToPath(
          new URL("../../packages/meteogram/src/png/index.ts", import.meta.url),
        ),
        "@graupel/meteogram": fileURLToPath(new URL("../../packages/meteogram/src/index.ts", import.meta.url)),
        "@graupel/download": fileURLToPath(new URL("../../packages/download/src/index.ts", import.meta.url)),
      },
    },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
      css: false,
    },
  }),
);
