// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigProvider,
  DEFAULT_CONFIG,
  parseConfig,
  validateConfig,
  type GraupelConfig,
  type HostingProvider,
  type ImprintConfig,
  type PrivacyConfig,
} from "../src/config/index.ts";
import { PrivacyPanel } from "../src/dialogs/info/PrivacyPanel.tsx";
import { HOSTING, MAP_PROVIDERS, PRIVACY_UPDATED } from "../src/dialogs/info/privacy.ts";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type Language } from "../src/i18n/index.ts";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const FILES = import.meta.glob<unknown>("../domains/*/config.json", { eager: true, import: "default" });
const DOMAINS: Record<string, GraupelConfig> = Object.fromEntries(
  Object.entries(FILES).map(([path, raw]) => [/domains\/([^/]+)\//.exec(path)![1]!, parseConfig(raw).config]),
);
const TLDS = ["at", "ch", "fr", "it", "eu"] as const;
const NAME = "Bastian Schnitzler";
const EMAIL = "baschni@gmx.de";

const SECTIONS = ["controller", "hosting", "weather", "map", "location", "storage", "rights", "switzerland"];

function setup({
  language = "en",
  map = DEFAULT_CONFIG.map,
  imprint = {},
  privacy = { swissNotice: true },
  hosting = DEFAULT_CONFIG.legal.hosting,
  config = { ...DEFAULT_CONFIG, map, legal: { hosting, imprint, privacy } },
}: {
  language?: Language;
  map?: GraupelConfig["map"];
  hosting?: HostingProvider;
  imprint?: ImprintConfig;
  privacy?: PrivacyConfig;
  config?: GraupelConfig;
} = {}) {
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={[...LANGUAGES]} fallbackLanguage="en" browserLanguages={[language]}>
        <PrivacyPanel />
      </I18nProvider>
    </ConfigProvider>,
  );
}

const section = (id: string) => {
  const element = document.querySelector<HTMLElement>(`[data-section="${id}"]`);
  if (!element) throw new Error(`section ${id} missing`);
  return element;
};

describe("privacy policy", () => {
  it("renders the date and every section with its heading, without a title repeating the tab (REQ-484)", () => {
    setup();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Privacy policy" })).toBeNull();
    expect(screen.getByText("Last updated: 10 November 2026")).toBeTruthy();
    expect(PRIVACY_UPDATED).toBe("2026-11-10");
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Controller",
      "Hosting on GitHub Pages",
      "Weather data from Open-Meteo",
      "Map",
      "Location and IP address",
      "Storage in your browser",
      "Your rights",
      "Note for Switzerland",
    ]);
    for (const id of SECTIONS) expect(section(id).querySelector("p")).toBeTruthy();
  });

  it("names GitHub, the USA transfer under the Data Privacy Framework and Open-Meteo", () => {
    setup();
    const hosting = section("hosting");
    expect(hosting.textContent).toContain("GitHub, Inc.");
    expect(hosting.textContent).toContain("IP address");
    expect(hosting.textContent).toContain("Data Privacy Framework");
    expect(hosting.textContent).toContain("Art. 6(1)(f) GDPR");
    const hostingLinks = within(hosting)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hostingLinks).toEqual([
      "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
      "https://www.dataprivacyframework.gov/list",
    ]);
    const weather = section("weather");
    expect(weather.textContent).toContain("coordinates");
    expect(within(weather).getByRole("link").getAttribute("href")).toBe("https://open-meteo.com/en/terms");
    expect(section("storage").textContent).toContain("no cookies");
    expect(section("rights").textContent).toContain("Art. 77 GDPR");
    for (const link of screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("https:"))) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("names ALL-INKL in Germany with its server logs and no transfer to the USA (REQ-703, REQ-710)", () => {
    setup({ hosting: "all-inkl" });
    expect(screen.getAllByRole("heading", { level: 4 })[1]!.textContent).toBe("Hosting at ALL-INKL");
    const hosting = section("hosting");
    for (const fact of [
      "ALL-INKL.COM – Neue Medien Münnich",
      "Hauptstraße 68, 02742 Friedersdorf, Germany",
      "IP address",
      "date and time of the request",
      "files requested",
      "server logs are deleted after seven days at the latest",
      "Art. 6(1)(f) GDPR",
    ])
      expect(hosting.textContent).toContain(fact);
    expect(hosting.textContent).not.toMatch(/GitHub|USA|Data Privacy Framework/);
    const hostingLinks = within(hosting)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(hostingLinks).toEqual([["ALL-INKL privacy information", "https://all-inkl.com/en/privacy-policy"]]);
    // The Swiss section names Germany instead of the Swiss-U.S. Data Privacy Framework.
    const swiss = section("switzerland");
    expect(swiss.textContent).toContain("Germany");
    expect(swiss.textContent).toContain("Annex 1");
    expect(swiss.textContent).toContain("FDPIC");
    expect(swiss.textContent).not.toMatch(/GitHub|USA|Data Privacy Framework/);
  });

  it("keeps GitHub and the Swiss-U.S. Data Privacy Framework in the Swiss section on GitHub Pages", () => {
    setup({ hosting: "github-pages" });
    const swiss = section("switzerland");
    expect(swiss.textContent).toContain(translate("en", "privacy.switzerland.githubPages"));
    expect(swiss.textContent).toContain("Swiss-U.S. Data Privacy Framework");
    expect(swiss.textContent).toContain("FDPIC");
    expect(swiss.textContent).not.toContain("ALL-INKL");
  });

  it.each(LANGUAGES)("has the hosting section of each provider in %s (REQ-710)", (language) => {
    const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
    for (const key of ["privacy.hosting.allInkl.text", "privacy.switzerland.allInkl"] as const) {
      expect(t(key)).toContain("ALL-INKL");
      expect(t(key)).not.toMatch(/GitHub|USA|Privacy Framework/);
    }
    expect(t("privacy.hosting.allInkl.text")).toContain("Hauptstraße 68, 02742 Friedersdorf");
    expect(t("privacy.hosting.allInkl.retention")).toMatch(/7|sieben|seven|sept|sette|zeven|sedmih|sedmi|syv/);
    expect(t("privacy.switzerland.text")).not.toContain("GitHub");
    expect(t("privacy.switzerland.githubPages")).toContain("GitHub");
    for (const [hosting, provider] of Object.entries(HOSTING)) {
      setup({ language, hosting: hosting as HostingProvider });
      const text = section("hosting").textContent;
      for (const key of provider.paragraphs) expect(text).toContain(t(key));
      expect(text).toContain(t("privacy.hosting.basis"));
      expect(section("switzerland").textContent).toContain(t(provider.swiss));
      expect(within(section("hosting")).getAllByRole("link")).toHaveLength(provider.links.length);
      cleanup();
    }
  });

  const PROVIDER_LINKS = {
    opentopomap: "https://opentopomap.org/about",
    maptoolkit: "https://www.maptoolkit.org/privacy",
  } as const;
  const MAPTOOLKIT_FACTS = [
    "Toursprung GmbH",
    "Mariahilfer Straße 93/20, 1060 Vienna",
    "truncated IP addresses",
    "15 days",
    "Cloudflare",
    "standard contractual clauses",
  ];

  it.each(["opentopomap", "maptoolkit"] as const)("names both map providers whichever is configured (REQ-493): %s", (map) => {
    setup({ map });
    const mapSection = section("map");
    expect(mapSection.textContent).toContain(translate("en", "privacy.map.choice"));
    expect(mapSection.textContent).toContain("choice in the settings");
    const providers = [...mapSection.querySelectorAll<HTMLElement>("[data-provider]")];
    expect(providers.map((p) => p.dataset.provider)).toEqual(["opentopomap", "maptoolkit"]);
    expect(providers[0]!.textContent).toContain("OpenTopoMap");
    for (const fact of MAPTOOLKIT_FACTS) expect(providers[1]!.textContent).toContain(fact);
    expect(mapSection.textContent).toContain("IP address and the map section");
    expect(mapSection.textContent).toContain("Art. 6(1)(f) GDPR");
    const hrefs = within(mapSection)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([PROVIDER_LINKS.opentopomap, PROVIDER_LINKS.maptoolkit]);
    expect(MAP_PROVIDERS.opentopomap.links[0]?.href).toBe(PROVIDER_LINKS.opentopomap);
    expect(MAP_PROVIDERS.maptoolkit.links[0]?.href).toBe(PROVIDER_LINKS.maptoolkit);
  });

  it.each(LANGUAGES)("says the coordinates also fetch the map section from the map provider (REQ-494): %s", (language) => {
    setup({ language });
    const gps = translate(language, "privacy.location.gps");
    for (const name of ["Open-Meteo", "OpenTopoMap", "Maptoolkit"]) expect(gps).toContain(name);
    expect(section("location").textContent).toContain(gps);
  });

  it("names the operator from the imprint configuration", () => {
    setup({
      imprint: { name: "Erika Muster", address: ["Musterweg 1", "12345 Musterstadt"], email: "erika@example.org" },
    });
    const controller = section("controller");
    expect(controller.textContent).toContain("Erika Muster");
    expect(controller.textContent).toContain("Musterweg 1");
    expect(within(controller).getByRole("link", { name: "erika@example.org" }).getAttribute("href")).toBe(
      "mailto:erika@example.org",
    );
    expect(screen.queryByTestId("privacy-hoster")).toBeNull();
  });

  it("shows the residence when there is no address", () => {
    setup({ imprint: { name: "Erika Muster", residence: "Berlin" } });
    expect(section("controller").textContent).toContain("Berlin");
  });

  it("refers to the imprint and the hoster without a named operator", () => {
    setup({ imprint: { hoster: true } });
    const controller = section("controller");
    expect(controller.textContent).toContain(translate("en", "privacy.controller.anonymous"));
    expect(screen.getByTestId("privacy-hoster").textContent).toContain("88 Colin P. Kelly Jr. Street");
  });

  it("names the imprint hoster of legal.hosting without a named operator (REQ-710)", () => {
    setup({ imprint: { hoster: true }, hosting: "all-inkl" });
    expect(screen.getByTestId("privacy-hoster").textContent).toContain("Hauptstraße 68");
    cleanup();
    setup({ imprint: { hoster: { name: "Fixed Host", address: ["Street 9"] } }, hosting: "all-inkl" });
    expect(screen.getByTestId("privacy-hoster").textContent).toContain("Street 9");
  });

  it("leaves out the section for Switzerland by default (DEC-029)", () => {
    expect(DEFAULT_CONFIG.legal.privacy.swissNotice).toBe(false);
    setup({ privacy: DEFAULT_CONFIG.legal.privacy });
    expect(document.querySelector('[data-section="switzerland"]')).toBeNull();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(SECTIONS.length - 1);
    expect(document.body.textContent).not.toContain("EDÖB");
  });

  it("names the controller from legal.privacy.controller without an address, ahead of the imprint (DEC-028)", () => {
    setup({
      imprint: { name: "Imprint Name", address: ["Musterweg 1"], email: "imprint@example.org", hoster: true },
      privacy: { swissNotice: false, controller: { name: "Erika Muster", email: "erika@example.org" } },
    });
    const lines = [...screen.getByTestId("privacy-controller").children].map((line) => line.textContent);
    expect(lines).toEqual(["Erika Muster", "Email: erika@example.org"]);
    expect(within(section("controller")).getByRole("link").getAttribute("href")).toBe("mailto:erika@example.org");
    expect(section("controller").textContent).not.toContain("Musterweg");
    expect(section("controller").textContent).not.toContain("Imprint Name");
    expect(screen.queryByTestId("privacy-hoster")).toBeNull();
  });

  it("validates the privacy settings and keeps older configs without them valid", () => {
    const errors = (privacy: unknown) => validateConfig({ legal: { privacy } }).join();
    expect(validateConfig({ legal: { imprint: { name: "A" } } })).toEqual([]);
    expect(errors({ swissNotice: true, controller: { name: "A", email: "a@b.c" } })).toBe("");
    expect(errors({ controller: { email: "a@b.c" } })).toContain("/legal/privacy/controller");
    expect(errors({ controller: { name: "A", address: ["x"] } })).toContain("/legal/privacy/controller");
    expect(errors({ swissNotice: "yes" })).toContain("/legal/privacy/swissNotice");
    const { config, warnings } = parseConfig({ legal: { imprint: { name: "A" } } });
    expect(warnings).toEqual([]);
    expect(config.legal.privacy).toEqual({ swissNotice: false });
  });

  describe.each(TLDS)("domain %s", (tld) => {
    const config = () => DOMAINS[tld]!;

    it("names ALL-INKL in the hosting section (REQ-710)", () => {
      setup({ config: config() });
      expect(section("hosting").textContent).toContain("ALL-INKL.COM");
      expect(section("hosting").textContent).not.toContain("GitHub");
    });

    it("shows the Swiss section only on .ch", () => {
      expect(config().legal.privacy.swissNotice).toBe(tld === "ch");
      setup({ config: config() });
      expect(document.querySelector('[data-section="switzerland"]') !== null).toBe(tld === "ch");
    });

    it("names the controller with email; the imprint data or, on .fr, name and email only", () => {
      setup({ config: config() });
      const lines = [...screen.getByTestId("privacy-controller").children].map((line) => line.textContent);
      expect(lines[0]).toBe(NAME);
      expect(screen.queryByTestId("privacy-hoster")).toBeNull();
      if (tld === "fr") {
        expect(config().legal.privacy.controller?.name).toBe(NAME);
        expect(config().legal.imprint.name).toBeUndefined();
        expect(lines.join()).not.toMatch(/Street|Straße|Berlin/);
      }
      // DEC-032: every domain, .fr included, names the contact email as a mailto link.
      const email = within(screen.getByTestId("privacy-controller")).getByRole("link", { name: EMAIL });
      expect(email.getAttribute("href")).toBe(`mailto:${EMAIL}`);
      if (tld === "eu") expect(lines).toContain("13351 Berlin");
      if (tld === "at") expect(lines).toContain("Berlin");
    });
  });

  it.each(LANGUAGES)("is translated into %s without placeholder", (language) => {
    setup({ language });
    const keys = Object.keys(MESSAGES.en).filter((key) => key.startsWith("privacy."));
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) expect(MESSAGES[language][key]?.trim(), `${language}: ${key}`).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(SECTIONS.length);
    expect(document.body.textContent).not.toMatch(/\{\w+\}/);
    expect(Object.keys(MESSAGES[language])).not.toContain("info.privacy.placeholder");
    // REQ-493: both map providers and the note on the choice in the settings, in every language.
    const mapSection = section("map");
    for (const key of ["privacy.map.choice", "privacy.map.opentopomap", "privacy.map.maptoolkit"] as const)
      expect(mapSection.textContent).toContain(translate(language, key));
    expect(mapSection.querySelectorAll("[data-provider]")).toHaveLength(2);
    expect(within(mapSection).getAllByRole("link")).toHaveLength(2);
    expect(MESSAGES[language]["privacy.map.maptoolkit"]).toContain("Mariahilfer Straße 93/20");
  });
});
