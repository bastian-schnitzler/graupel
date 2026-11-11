import { defineConfig } from "vitest/config";

// Gemeinsame Grundkonfiguration; die Pakete erweitern sie mit mergeConfig.
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
