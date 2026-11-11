// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { bundledPackage, checkShipped, thirdPartyNotice } from "./scripts/third-party.mjs";

const appFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Licenses in the build (REQ-431): checks that the bundle holds exactly the npm packages named in
 * scripts/third-party.mjs and writes LICENSE, LICENSES/ and THIRD_PARTY_LICENSES.md next to index.html.
 */
function licensePlugin(): Plugin {
  return {
    name: "graupel-licenses",
    apply: "build",
    generateBundle(_options, bundle) {
      const packages = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of output.moduleIds) {
          const name = bundledPackage(id);
          if (name) packages.add(name);
        }
      }
      const problems = checkShipped(packages);
      if (problems.length > 0) this.error(`third-party notice out of date: ${problems.join("; ")}`);
      this.emitFile({ type: "asset", fileName: "LICENSE", source: readFileSync(appFile("LICENSE"), "utf8") });
      for (const file of readdirSync(appFile("LICENSES"))) {
        const source = readFileSync(appFile(`LICENSES/${file}`), "utf8");
        this.emitFile({ type: "asset", fileName: `LICENSES/${file}`, source });
      }
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_LICENSES.md", source: thirdPartyNotice() });
    },
  };
}

/** Dev server: the third-party notice that the About tab loads into its popup (REQ-514), as the build writes it. */
function licenseDevPlugin(): Plugin {
  return {
    name: "graupel-licenses-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/THIRD_PARTY_LICENSES.md", (_req, res) => {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.end(thirdPartyNotice());
      });
    },
  };
}

// Relative Pfade: Die Seite läuft unter beliebigen Domains und Unterpfaden (GitHub Pages).
export default defineConfig({
  base: "./",
  plugins: [react(), licensePlugin(), licenseDevPlugin()],
  server: { port: 5173 },
  // 4173 belegt die Demo des Meteogramm-Kerns, 4174 der Model Domain Viewer (playwright.config.ts).
  preview: { port: 4175, strictPort: true },
  // MapLibre (Maptoolkit-Karte) ist ein eigener, erst beim Öffnen der Karte geladener Chunk von gut 1 MB.
  build: { chunkSizeWarningLimit: 1100 },
});
