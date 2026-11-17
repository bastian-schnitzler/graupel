// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Playwright configuration that makes the screenshots of the web app manifest (REQ-807, scripts/app-manifest.mjs).
 * Not part of the e2e tests; run by hand after a visible change and commit the pictures (`pnpm screenshots` in
 * apps/web). Builds the site and serves it like the e2e tests, on the same port.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "manifest-screenshots.gen.ts",
  reporter: "list",
  workers: 1,
  use: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
    : {},
  webServer: {
    command: "pnpm --filter @graupel/web build && pnpm --filter @graupel/web preview",
    url: "http://localhost:4175/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
