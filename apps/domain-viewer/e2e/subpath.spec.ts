// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-822: the built viewer under the sub-path /graupel/, as GitHub Pages serves it for the public repository
 * (https://bastian-schnitzler.github.io/graupel/). A server of its own serves dist/ (built by the webServer of
 * `pnpm --filter @graupel/domain-viewer start`) under /graupel/ only, so a root-absolute path answers 404. Without
 * network: other hosts get a blank base-map style or are aborted. The service worker is allowed here.
 */
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { createSiteServer } from "../scripts/serve.mjs";

const BASE = "/graupel/";
const STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ccc" } }] };

const server = createSiteServer({ base: BASE });
let origin = "";

test.beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((done) => server.close(done));
});

test.use({ serviceWorkers: "allow" });

test("REQ-822: loads data, map, chains and licenses under /graupel/ without 404; the service worker sits in the sub-path", async ({
  context,
  page,
  request,
}) => {
  const errors: string[] = [];
  const failed: string[] = [];
  const local: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (req) => {
    if (req.url().startsWith(origin)) failed.push(`failed ${req.url()}`);
  });
  page.on("request", (req) => {
    if (req.url().startsWith(origin)) local.push(new URL(req.url()).pathname);
  });
  await context.route(
    (url) => url.origin !== origin,
    (route) => {
      const url = route.request().url();
      if (url === "https://tiles.openfreemap.org/styles/liberty") return route.fulfill({ json: STYLE });
      return route.abort();
    },
  );

  await page.goto(`${origin}${BASE}`);
  await expect(page).toHaveTitle("Model Domains");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");

  // Data and libraries came from the sub-path.
  for (const file of ["model_domains.json", "model_catalogue.json", "chain_zones.json", "chain_zones.geojson", "regions.geojson"])
    expect(local).toContain(`${BASE}data/${file}`);
  expect(local).toContain(`${BASE}vendor/leaflet/leaflet.js`);
  expect(local).toContain(`${BASE}src/viewer.js`);
  expect(local.filter((path) => !path.startsWith(BASE))).toEqual([]);

  // Map: the regional domains are drawn.
  await expect(page.locator("#list .model")).toHaveCount(47);
  expect(await page.locator(".leaflet-overlay-pane path").count()).toBeGreaterThan(0);

  // Chains.
  await page.getByRole("tab", { name: "Chains" }).click();
  await expect(page.locator("#zone-list .model")).toHaveCount(38);

  // Footer: the license files resolve relative to the sub-path.
  const hrefs = await page
    .locator("#attribution a:not([href^='http'])")
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
  expect(hrefs).toHaveLength(5);
  for (const href of hrefs) {
    expect(href.startsWith(`${origin}${BASE}`), href).toBe(true);
    expect((await request.get(href)).status(), href).toBe(200);
  }

  // Service worker: registered relative (sw.js), so its scope is the sub-path.
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { scope: ready.scope, script: ready.active?.scriptURL };
  });
  expect(registration).toEqual({ scope: `${origin}${BASE}`, script: `${origin}${BASE}sw.js` });

  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test("REQ-822: the sub-path server leaves the root empty, so a root-absolute path would fail", async ({ request }) => {
  expect((await request.get(`${origin}/index.html`)).status()).toBe(404);
  expect((await request.get(`${origin}/data/model_domains.json`)).status()).toBe(404);
  expect((await request.get(`${origin}${BASE}data/model_domains.json`)).status()).toBe(200);
  const redirect = await request.get(`${origin}/graupel`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expect(redirect.headers().location).toBe(BASE);
});
