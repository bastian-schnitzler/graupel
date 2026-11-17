// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Static server for dist/ (local preview and end-to-end tests): http://localhost:4174/
// BASE=/graupel/ serves the site under that sub-path, as GitHub Pages does for the public repository (REQ-822);
// everything outside the sub-path then answers 404, so a root-absolute path in the page shows up as an error.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
/** @type {Record<string, string>} */
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  "": "text/plain; charset=utf-8", // LICENSE
};

/**
 * HTTP server for a built site; not listening yet.
 * @param {{ root?: string, base?: string }} [options] root: folder to serve (dist/); base: sub-path, "/" or "/x/"
 */
export function createSiteServer({ root = DIST, base = "/" } = {}) {
  if (!base.startsWith("/") || !base.endsWith("/")) throw new Error(`base must start and end with "/": ${base}`);
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    // The sub-path without its slash leads to the sub-path, as on GitHub Pages.
    if (base !== "/" && url.pathname === base.slice(0, -1)) {
      response.writeHead(301, { location: base }).end();
      return;
    }
    if (!url.pathname.startsWith(base)) {
      response.writeHead(404).end();
      return;
    }
    let path = normalize(join(root, decodeURIComponent(url.pathname.slice(base.length - 1))));
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (statSync(path).isDirectory()) path = join(path, "index.html");
      statSync(path);
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(response);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4174);
  const base = process.env.BASE ?? "/";
  createSiteServer({ base }).listen(port, () => console.log(`Model Domain Viewer: http://localhost:${port}${base}`));
}
