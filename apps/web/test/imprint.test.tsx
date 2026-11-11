// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Imprint per domain (REQ-430, DEC-023): the info popup shows the data of `legal.imprint` with the label the domain
 * fixes, or the translated one, as tab and heading; translated into every language.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigProvider,
  DEFAULT_CONFIG,
  DEFAULT_HOSTER,
  parseConfig,
  type GraupelConfig,
  type ImprintConfig,
} from "../src/config/index.ts";
import { InfoDialog } from "../src/dialogs/index.ts";
import { PrivacyPanel } from "../src/dialogs/info/PrivacyPanel.tsx";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type Language } from "../src/i18n/index.ts";

const FILES = import.meta.glob<unknown>("../domains/*/config.json", { eager: true, import: "default" });
const DOMAINS: Record<string, GraupelConfig> = Object.fromEntries(
  Object.entries(FILES).map(([path, raw]) => [/domains\/([^/]+)\//.exec(path)![1]!, parseConfig(raw).config]),
);
const TLDS = ["at", "ch", "fr", "it", "eu"] as const;
type Tld = (typeof TLDS)[number];

const NAME = "Bastian Schnitzler";
const EMAIL = "baschni@gmx.de";
const HOSTER_LINES = ["GitHub, Inc.", "88 Colin P. Kelly Jr. Street", "San Francisco, CA 94107", "USA"];
/** Hoster of graupel.fr (ALL-INKL, DEC-086), as written in domains/fr/config.json. */
const FR_HOSTER_LINES = ["ALL-INKL.COM – Neue Medien Münnich", "Hauptstraße 68", "02742 Friedersdorf", "Allemagne"];

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderImprint(config: GraupelConfig, language: Language = "en") {
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={[...LANGUAGES]} fallbackLanguage="en" browserLanguages={[language]}>
        <InfoDialog tab="imprint" onSelectTab={() => {}} onClose={() => {}} />
      </I18nProvider>
    </ConfigProvider>,
  );
}

const withImprint = (imprint: ImprintConfig): GraupelConfig => ({
  ...DEFAULT_CONFIG,
  legal: { ...DEFAULT_CONFIG.legal, imprint },
});
const tabLabel = () => screen.getByRole("tab", { selected: true }).textContent;
const panel = () => screen.getByRole("tabpanel");
/** Accessible name of the panel: the tab label, as no heading repeats it (REQ-484). */
const title = () => {
  expect(within(panel()).queryByRole("heading", { level: 3 })).toBeNull();
  const tabId = panel().getAttribute("aria-labelledby");
  return tabId && document.getElementById(tabId)?.textContent;
};
const sections = () => within(panel()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
/** Lines of an address block, or null when it is missing. */
const lines = (testId: string) => {
  const element = screen.queryByTestId(testId);
  return element && [...element.children].map((line) => line.textContent);
};
/** The contact email of DEC-032 is a mailto link in the operator block. */
const mailto = () =>
  within(screen.getByTestId("imprint-operator")).getByRole("link", { name: EMAIL }).getAttribute("href");

describe("imprint per domain", () => {
  it(".eu: translated label, name, full address and email", () => {
    renderImprint(DOMAINS.eu!);
    expect(tabLabel()).toBe("Legal notice");
    expect(title()).toBe("Legal notice");
    expect(sections()).toEqual(["Operator"]);
    expect(lines("imprint-operator")).toEqual([NAME, "Cornelius-Fredericks-Straße 56a", "13351 Berlin", `Email: ${EMAIL}`]);
    expect(mailto()).toBe(`mailto:${EMAIL}`);
    expect(lines("imprint-hoster")).toBeNull();
  });

  it(".at: label Impressum, name, place of residence and email", () => {
    renderImprint(DOMAINS.at!, "de");
    expect(tabLabel()).toBe("Impressum");
    expect(title()).toBe("Impressum");
    expect(sections()).toEqual(["Betreiber"]);
    expect(lines("imprint-operator")).toEqual([NAME, "Wohnort: Berlin", `E-Mail: ${EMAIL}`]);
    expect(mailto()).toBe(`mailto:${EMAIL}`);
    expect(panel().textContent).not.toContain("Cornelius-Fredericks-Straße");
    expect(lines("imprint-hoster")).toBeNull();
  });

  it(".at keeps its label in other languages", () => {
    renderImprint(DOMAINS.at!, "en");
    expect(tabLabel()).toBe("Impressum");
    expect(title()).toBe("Impressum");
    expect(lines("imprint-operator")).toEqual([NAME, "Place of residence: Berlin", `Email: ${EMAIL}`]);
  });

  it(".ch: translated label, name and email", () => {
    renderImprint(DOMAINS.ch!, "de");
    expect(tabLabel()).toBe("Impressum");
    expect(title()).toBe("Impressum");
    expect(lines("imprint-operator")).toEqual([NAME, `E-Mail: ${EMAIL}`]);
    expect(mailto()).toBe(`mailto:${EMAIL}`);
    expect(lines("imprint-hoster")).toBeNull();
    cleanup();
    renderImprint(DOMAINS.ch!, "fr");
    expect(tabLabel()).toBe(translate("fr", "info.tab.imprint"));
    expect(title()).toBe(translate("fr", "info.tab.imprint"));
  });

  it(".it: label Note legali, name and email", () => {
    renderImprint(DOMAINS.it!, "it");
    expect(tabLabel()).toBe("Note legali");
    expect(title()).toBe("Note legali");
    expect(sections()).toEqual(["Gestore"]);
    expect(lines("imprint-operator")).toEqual([NAME, `E-mail: ${EMAIL}`]);
    expect(mailto()).toBe(`mailto:${EMAIL}`);
    expect(lines("imprint-hoster")).toBeNull();
    cleanup();
    renderImprint(DOMAINS.it!, "de");
    expect(tabLabel()).toBe("Note legali");
  });

  it(".fr: label Mentions légales, no name, hosting provider with phone", () => {
    renderImprint(DOMAINS.fr!, "fr");
    expect(tabLabel()).toBe("Mentions légales");
    expect(title()).toBe("Mentions légales");
    expect(sections()).toEqual(["Éditeur", "Hébergeur"]);
    expect(lines("imprint-operator")).toBeNull();
    expect(panel().textContent).not.toContain(NAME);
    expect(panel().textContent).toContain(translate("fr", "info.imprint.anonymous"));
    expect(lines("imprint-hoster")).toEqual([...FR_HOSTER_LINES, "Tél. : +49 35872 353-10"]);
    const phone = within(screen.getByTestId("imprint-hoster")).getByRole("link", { name: "+49 35872 353-10" });
    expect(phone.getAttribute("href")).toBe("tel:+493587235310");
  });

  it(".fr: the same hoster in the preview, whose legal.hosting is GitHub Pages (DEC-086)", () => {
    renderImprint({ ...DOMAINS.fr!, legal: { ...DOMAINS.fr!.legal, hosting: "github-pages" } }, "fr");
    expect(lines("imprint-hoster")).toEqual([...FR_HOSTER_LINES, "Tél. : +49 35872 353-10"]);
  });

  it.each(TLDS)("%s shows only the configured details", (tld: Tld) => {
    renderImprint(DOMAINS[tld]!);
    const { imprint } = DOMAINS[tld]!.legal;
    expect(lines("imprint-operator") !== null).toBe(Boolean(imprint.name));
    expect(lines("imprint-hoster") !== null).toBe(Boolean(imprint.hoster));
  });
});

describe("imprint configuration", () => {
  it("uses the default hosting provider for hoster: true", () => {
    renderImprint(withImprint({ hoster: true }));
    expect(lines("imprint-hoster")).toEqual([...HOSTER_LINES, `Phone: ${DEFAULT_HOSTER.phone}`]);
  });

  it("uses the provider of legal.hosting for hoster: true (REQ-710)", () => {
    renderImprint({ ...DEFAULT_CONFIG, legal: { ...DEFAULT_CONFIG.legal, hosting: "all-inkl", imprint: { hoster: true } } });
    expect(lines("imprint-hoster")).toEqual([
      "ALL-INKL.COM – Neue Medien Münnich",
      "Hauptstraße 68",
      "02742 Friedersdorf",
      "Germany",
      "Phone: +49 35872 353-10",
    ]);
  });

  it("shows email addresses and the website of the hosting provider as links", () => {
    renderImprint(
      withImprint({
        name: "Erika Muster",
        residence: "Wien",
        email: "erika@example.org",
        hoster: { name: "Host AG", email: "info@host.example", url: "https://host.example/" },
      }),
    );
    expect(lines("imprint-operator")).toEqual([
      "Erika Muster",
      "Place of residence: Wien",
      "Email: erika@example.org",
    ]);
    const email = screen.getByRole("link", { name: "erika@example.org" });
    expect(email.getAttribute("href")).toBe("mailto:erika@example.org");
    expect(lines("imprint-hoster")).toEqual(["Host AG", "Email: info@host.example", "host.example/"]);
    const website = screen.getByRole("link", { name: "host.example/" });
    expect(website.getAttribute("href")).toBe("https://host.example/");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("prefers the address over the place of residence", () => {
    renderImprint(withImprint({ name: "Erika Muster", residence: "Wien", address: ["Musterweg 1", "1010 Wien"] }));
    expect(lines("imprint-operator")).toEqual(["Erika Muster", "Musterweg 1", "1010 Wien"]);
  });

  it("shows the anonymous note without any details", () => {
    renderImprint(withImprint({}));
    expect(title()).toBe("Legal notice");
    expect(sections()).toEqual(["Operator"]);
    expect(panel().textContent).toContain(translate("en", "info.imprint.anonymous"));
    expect(lines("imprint-hoster")).toBeNull();
  });

  it("names the same hosting provider in the privacy policy when it names no controller", () => {
    render(
      <ConfigProvider config={withImprint(DOMAINS.fr!.legal.imprint)}>
        <PrivacyPanel />
      </ConfigProvider>,
    );
    expect(lines("privacy-hoster")).toEqual(["Hosting provider:", ...FR_HOSTER_LINES]);
  });
});

describe("imprint translations", () => {
  const keys = Object.keys(MESSAGES.en).filter((key) => key.startsWith("info.imprint."));

  it("has the imprint texts and no placeholder text", () => {
    expect(keys.sort()).toEqual(
      ["anonymous", "email", "hoster", "operator", "phone", "residence"].map((k) => `info.imprint.${k}`),
    );
    for (const language of LANGUAGES) expect(Object.keys(MESSAGES[language])).not.toContain("info.imprint.placeholder");
  });

  it("addresses nobody directly in German", () => {
    for (const key of keys) expect(MESSAGES.de[key], key).not.toMatch(/\b(du|dich|dir|dein\w*|Sie|Ihr\w*|Ihnen)\b/);
  });

  describe.each(LANGUAGES)("%s", (language) => {
    it.each(TLDS)("renders the imprint of %s", (tld) => {
      renderImprint(DOMAINS[tld]!, language);
      for (const key of keys) expect(MESSAGES[language][key]?.trim(), `${language}: ${key}`).toBeTruthy();
      const fixed = DOMAINS[tld]!.legal.imprint.label;
      expect(title()).toBe(fixed ?? MESSAGES[language]["info.tab.imprint"]);
      expect(tabLabel()).toBe(title());
      const expected = [translate(language, "info.imprint.operator")];
      if (DOMAINS[tld]!.legal.imprint.hoster) expected.push(translate(language, "info.imprint.hoster"));
      expect(sections()).toEqual(expected);
      expect(panel().textContent).not.toMatch(/\{\w+\}/);
      if (tld === "at") {
        const residence = translate(language, "info.imprint.residence", { place: "Berlin" });
        expect(lines("imprint-operator")?.[1]).toBe(residence);
      }
    });
  });
});
