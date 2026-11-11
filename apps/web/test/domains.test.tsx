// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Domain configurations (REQ-422, REQ-437, DEC-018, DEC-023, DEC-027) and the release artifact (DEC-019):
 * every domains/<tld>/config.json is valid, has its fallback language, start place and imprint, and the page renders
 * with it; the site archive contains what a domain needs.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import {
  ConfigProvider,
  DEFAULT_HOSTER,
  HOSTERS,
  imprintHoster,
  parseConfig,
  siteDomain,
  startPlace,
  validateConfig,
} from "../src/config/index.ts";
import { translate } from "../src/i18n/index.ts";
import {
  ARTIFACT_NAME,
  checkSiteEntries,
  collectFiles,
  createZip,
  crc32,
  packageSite,
  readZip,
} from "../scripts/package-site.mjs";

const FILES = import.meta.glob<unknown>("../domains/*/config.json", { eager: true, import: "default" });
const DOMAINS: Record<string, unknown> = Object.fromEntries(
  Object.entries(FILES).map(([path, config]) => [/domains\/([^/]+)\//.exec(path)![1]!, config]),
);

const EXPECTED = {
  at: { language: "de", start: "Großglockner", timeZone: "Europe/Vienna" },
  ch: { language: "de", start: "Matterhorn", timeZone: "Europe/Zurich" },
  fr: { language: "fr", start: "Mont Blanc", timeZone: "Europe/Paris" },
  it: { language: "it", start: "Ortler", timeZone: "Europe/Rome" },
  eu: { language: "en", start: "Brussels", timeZone: "Europe/Brussels" },
} as const;
type Tld = keyof typeof EXPECTED;
const TLDS = Object.keys(EXPECTED) as Tld[];

function domain(tld: Tld) {
  const { config, warnings } = parseConfig(DOMAINS[tld]);
  expect(warnings).toEqual([]);
  return config;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("domain configurations", () => {
  it("exist for exactly the domains of DEC-018", () => {
    expect(Object.keys(DOMAINS).sort()).toEqual([...TLDS].sort());
  });

  it.each(TLDS)("%s is valid against the schema", (tld) => {
    expect(validateConfig(DOMAINS[tld])).toEqual([]);
  });

  it.each(TLDS)("%s has its fallback language and start place, all languages and no preset favourites (REQ-708)", (tld) => {
    const config = domain(tld);
    expect(config.defaultLanguage).toBe(EXPECTED[tld].language);
    expect(config.startLocation).not.toBe("gps");
    expect(startPlace(config).name).toBe(EXPECTED[tld].start);
    // The zone of the start place, for the run times without a determinable device zone (REQ-733).
    expect(config.timeZone).toBe(EXPECTED[tld].timeZone);
    expect(config.languages).toEqual(["de", "en", "fr", "it", "sl", "cs", "nl", "da"]);
    expect(config.favorites.enabled).toBe(true);
    expect(config.favorites.presets).toEqual([]);
  });

  it("starts graupel.it at the Ortler summit (REQ-477) without making it a favourite (REQ-708)", () => {
    const config = domain("it");
    expect(startPlace(config)).toEqual({ name: "Ortler", lat: 46.5086, lon: 10.5447, elevation: 3905 });
    expect(config.favorites.presets).toEqual([]);
  });

  it.each(TLDS)("%s shows its domain in the meteogram footer (REQ-464)", (tld) => {
    // From the host name until the configuration names the domain; a configured domain must be this one.
    const config = domain(tld);
    expect(siteDomain(config, `graupel.${tld}`)).toBe(`graupel.${tld}`);
    expect(siteDomain(config, `www.graupel.${tld}`)).toBe(`graupel.${tld}`);
  });

  it("puts the imprint data of DEC-023, REQ-430 and DEC-032 on each domain", () => {
    const imprint = (tld: Tld) => domain(tld).legal.imprint;
    expect(imprint("eu")).toEqual({
      name: "Bastian Schnitzler",
      email: "baschni@gmx.de",
      address: ["Cornelius-Fredericks-Straße 56a", "13351 Berlin"],
    });
    expect(imprint("at")).toEqual({
      label: "Impressum",
      name: "Bastian Schnitzler",
      email: "baschni@gmx.de",
      residence: "Berlin",
    });
    expect(imprint("ch")).toEqual({ name: "Bastian Schnitzler", email: "baschni@gmx.de" });
    expect(imprint("it")).toEqual({ label: "Note legali", name: "Bastian Schnitzler", email: "baschni@gmx.de" });
    const fr = imprint("fr");
    expect(fr.label).toBe("Mentions légales");
    expect(fr.name).toBeUndefined();
    expect(fr.address).toBeUndefined();
    expect(fr.email).toBeUndefined();
    // DEC-086: the hoster of the domain (ALL-INKL) as explicit details, so the preview on GitHub Pages shows it too.
    expect(imprintHoster(fr, "github-pages")).toEqual({
      name: "ALL-INKL.COM – Neue Medien Münnich",
      address: ["Hauptstraße 68", "02742 Friedersdorf", "Allemagne"],
      phone: "+49 35872 353-10",
    });
  });

  it.each(TLDS)("names ALL-INKL as the hoster of %s (REQ-710)", (tld) => {
    expect(domain(tld).legal.hosting).toBe("all-inkl");
  });

  it("puts the privacy settings of DEC-028, DEC-029 and DEC-032 on each domain", () => {
    const privacy = (tld: Tld) => domain(tld).legal.privacy;
    expect(privacy("ch")).toEqual({ swissNotice: true });
    expect(privacy("fr")).toEqual({
      swissNotice: false,
      controller: { name: "Bastian Schnitzler", email: "baschni@gmx.de" },
    });
    for (const tld of ["at", "it", "eu"] as const) expect(privacy(tld)).toEqual({ swissNotice: false });
  });

  it.each(TLDS)("renders the page with %s in its fallback language", (tld) => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pl-PL"]);
    const { container } = render(
      <ConfigProvider config={domain(tld)}>
        <App />
      </ConfigProvider>,
    );
    expect(document.documentElement.lang).toBe(EXPECTED[tld].language);
    expect(screen.getByRole("region", { name: translate(EXPECTED[tld].language, "region.location.title") })).toBeTruthy();
    const regions = [...container.querySelectorAll("[data-region]")].map((el) => el.getAttribute("data-region"));
    // The model chain is hidden by default and then has no card (REQ-445, REQ-471).
    expect(regions).toEqual(["location", "header", "day-slider", "meteogram", "footer"]);
  });
});

describe("imprint hoster", () => {
  it("accepts true, details or nothing and stays backward compatible", () => {
    expect(validateConfig({ legal: { imprint: { hoster: true } } })).toEqual([]);
    expect(validateConfig({ legal: { imprint: { hoster: false } } })).toEqual([]);
    expect(validateConfig({ legal: { imprint: { hoster: { name: "Host" } } } })).toEqual([]);
    expect(imprintHoster({ hoster: true })).toEqual(DEFAULT_HOSTER);
    expect(imprintHoster({ hoster: false })).toBeUndefined();
    expect(imprintHoster({})).toBeUndefined();
  });

  it("resolves true to the provider of legal.hosting, explicit details stay (REQ-710)", () => {
    expect(DEFAULT_HOSTER).toBe(HOSTERS["github-pages"]);
    expect(imprintHoster({ hoster: true }, "github-pages")?.name).toBe("GitHub, Inc.");
    expect(imprintHoster({ hoster: true }, "all-inkl")).toEqual({
      name: "ALL-INKL.COM – Neue Medien Münnich",
      address: ["Hauptstraße 68", "02742 Friedersdorf", "Germany"],
      phone: "+49 35872 353-10",
    });
    expect(imprintHoster({ hoster: { name: "Host" } }, "all-inkl")).toEqual({ name: "Host" });
    expect(imprintHoster({ hoster: false }, "all-inkl")).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ["details without name", { address: ["x"] }],
    ["unknown detail", { name: "Host", fax: "1" }],
    ["a string", "GitHub"],
  ])("rejects %s", (_name, hoster) => {
    expect(validateConfig({ legal: { imprint: { hoster } } }).some((e) => e.startsWith("/legal/imprint/hoster"))).toBe(
      true,
    );
  });
});

describe("site archive (package-site)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graupel-site-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is called graupel-site.zip, the name the release build and the upload expect (REQ-709)", () => {
    expect(ARTIFACT_NAME).toBe("graupel-site.zip");
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("reads back what it writes, stored and deflated", () => {
    const entries = [
      { name: "small.txt", data: Buffer.from("x") },
      { name: "a/big.txt", data: Buffer.from("graupel ".repeat(1000)) },
      { name: "ümlaut.json", data: Buffer.from("{}") },
    ];
    const zip = createZip(entries);
    expect(readZip(zip).map(({ name, data }) => [name, data.toString()])).toEqual(
      entries.map(({ name, data }) => [name, data.toString()]),
    );
    expect(zip.length).toBeLessThan(2000);
  });

  it("packs a site with index.html, config.json, the licenses and assets", () => {
    const dist = join(dir, "dist");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<!doctype html>");
    writeFileSync(join(dist, "config.json"), "{}");
    writeFileSync(join(dist, "LICENSE"), "GNU GENERAL PUBLIC LICENSE");
    writeFileSync(join(dist, "THIRD_PARTY_LICENSES.md"), "# Third-party licenses");
    writeFileSync(join(dist, "assets", "index.js"), "console.log(1)");
    const out = join(dir, "release", ARTIFACT_NAME);
    expect(packageSite(dist, out)).toEqual([
      "LICENSE",
      "THIRD_PARTY_LICENSES.md",
      "assets/index.js",
      "config.json",
      "index.html",
    ]);
    const files = readZip(readFileSync(out));
    expect(files.map(({ name }) => name)).toEqual(collectFiles(dist).map(({ name }) => name));
    expect(files.find(({ name }) => name === "index.html")?.data.toString()).toBe("<!doctype html>");
  });

  it("refuses a site without index.html or assets", () => {
    expect(checkSiteEntries(["config.json"])).toEqual([
      "index.html missing",
      "LICENSE missing",
      "THIRD_PARTY_LICENSES.md missing",
      "no files in assets/",
    ]);
    const dist = join(dir, "dist");
    mkdirSync(dist);
    writeFileSync(join(dist, "config.json"), "{}");
    expect(() => packageSite(dist, join(dir, "site.zip"))).toThrow(/index.html missing/);
    expect(() => packageSite(join(dir, "missing"), join(dir, "site.zip"))).toThrow(/pnpm build/);
  });
});
