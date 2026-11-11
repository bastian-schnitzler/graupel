// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
    },
  }),
);
