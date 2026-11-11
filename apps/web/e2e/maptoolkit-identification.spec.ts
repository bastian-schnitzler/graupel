// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Identification at Maptoolkit (REQ-698, DEC-075): the website runs under its domains (graupel.eu, graupel.at,
 * graupel.ch, …), and every request of the Maptoolkit map carries that domain as Origin and Referer, nothing more: no
 * path, no query, no place. Maptoolkit registers and limits applications by Referer (maptoolkit.org/tos, section 9).
 * Each page is served under its real domain: Playwright answers https://graupel.<tld>/ with the files of the local
 * preview server, so the browser sees the page at that origin. Maptoolkit itself is a stand-in (style, empty tiles).
 */
import type { Request } from "@playwright/test";
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175";
/** Stand-in for the Maptoolkit style: one vector source on tiles.maptoolkit.org with the credits of the real one. */
const MAPTOOLKIT_STYLE = {
  version: 8,
  sources: {
    maptoolkit: {
      type: "vector",
      tiles: ["https://tiles.maptoolkit.org/test/{z}/{x}/{y}.pbf"],
      maxzoom: 14,
      attribution:
        '<a href="https://www.maptoolkit.com/copyright/">© Maptoolkit</a> ' +
        '<a href="https://www.openstreetmap.org/copyright">© Openstreetmap</a>',
    },
  },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": "#f6f4ef" } },
    { id: "water", type: "fill", source: "maptoolkit", "source-layer": "water" },
  ],
};

test.use({ locale: "en-GB", timezoneId: "UTC" });

/** Serves the website at https://<domain>/ from the local preview server and records every Maptoolkit request. */
async function serveAt(page: Page, domain: string): Promise<Request[]> {
  await page.route(`https://${domain}/**`, async (route) => {
    const { pathname, search } = new URL(route.request().url());
    const response = await route.fetch({ url: `${APP}${pathname}${search}` });
    await route.fulfill({ response });
  });
  await page.route(/opentopomap\.org/, (route) => route.abort());
  const requests: Request[] = [];
  await page.route(/maptoolkit\.(org|com|net)/, (route) => {
    const url = route.request().url();
    requests.push(route.request());
    if (url.endsWith("/hiking.json")) return route.fulfill({ json: MAPTOOLKIT_STYLE });
    if (url.startsWith("https://tiles.maptoolkit.org/"))
      return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: "" });
    return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem("graupel.map", "maptoolkit"));
  return requests;
}

async function openMap(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog).toHaveAttribute("data-provider", "maptoolkit");
  await expect(dialog.locator(".maplibregl-ctrl-attrib")).toContainText("© Maptoolkit © Openstreetmap");
}

for (const domain of ["graupel.eu", "graupel.at", "graupel.ch", "graupel.fr", "graupel.it"]) {
  test(`every Maptoolkit request names ${domain} as Origin and Referer, without path or place (REQ-698)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = await serveAt(page, domain);
    // A path, a query and a fragment that must not leave the page.
    await openMap(page, `https://${domain}/index.html?lat=47.2627&lon=11.3945#Innsbruck`);
    await expect.poll(() => requests.some((r) => r.url().startsWith("https://tiles.maptoolkit.org/"))).toBe(true);

    const style = requests.find((r) => r.url() === "https://styles.maptoolkit.org/hiking.json");
    const tile = requests.find((r) => r.url().startsWith("https://tiles.maptoolkit.org/"));
    expect(style, "style requested").toBeDefined();
    expect(tile, "tile requested").toBeDefined();
    for (const request of [style!, tile!]) {
      const headers = await request.allHeaders();
      expect(headers.origin, request.url()).toBe(`https://${domain}`);
      expect(headers.referer, request.url()).toBe(`https://${domain}/`);
      // No domain parameter: Maptoolkit does not read one (DEC-075).
      expect(new URL(request.url()).search, request.url()).toBe("");
    }
    for (const request of requests) {
      const referer = (await request.allHeaders()).referer;
      if (referer !== undefined) expect(referer, request.url()).toBe(`https://${domain}/`);
    }
    expect(errors).toEqual([]);
  });
}
