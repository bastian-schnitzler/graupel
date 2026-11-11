// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { LocationPicker } from "../src/regions/LocationPicker/index.ts";
import { resetModelChainView, setModelChainVisible } from "../src/state/index.ts";
import {
  I18nProvider,
  LANGUAGES,
  LANGUAGE_NAMES,
  LANGUAGE_STORAGE_KEY,
  MESSAGES,
  meteogramI18n,
  readStoredLanguage,
  resolveLanguage,
  storeLanguage,
  toLocale,
  translate,
  useI18n,
  type I18nContextValue,
  type MessageKey,
} from "../src/i18n/index.ts";
import { DEFAULT_TEXTS, DEFAULT_TOOLTIP_TEXTS } from "@graupel/meteogram";

const englishKeys = Object.keys(MESSAGES.en).sort();

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetModelChainView();
});

describe("translation files", () => {
  it.each(LANGUAGES)("%s has exactly the keys of en.json, none empty", (language) => {
    const messages = MESSAGES[language];
    expect(Object.keys(messages).sort()).toEqual(englishKeys);
    for (const [key, value] of Object.entries(messages)) {
      expect(typeof value, `${language}: ${key}`).toBe("string");
      expect(value?.trim(), `${language}: ${key}`).not.toBe("");
    }
  });

  it.each(LANGUAGES)("%s keeps the placeholders of English", (language) => {
    const placeholders = (text: string | undefined) => [...(text ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of englishKeys) {
      expect(placeholders(MESSAGES[language][key]), `${language}: ${key}`).toEqual(placeholders(MESSAGES.en[key]));
    }
  });

  it("has a name and a locale for every language", () => {
    for (const language of LANGUAGES) {
      expect(LANGUAGE_NAMES[language]).toBeTruthy();
      expect(Intl.getCanonicalLocales(toLocale(language))).toEqual([toLocale(language)]);
    }
  });
});

describe("translate", () => {
  it("returns the text of the language", () => {
    expect(translate("de", "region.location.title")).toBe("Ort");
    expect(translate("fr", "region.location.title")).toBe("Lieu");
  });

  it("falls back to English for missing or empty keys", () => {
    const de = MESSAGES.de as Record<string, string | undefined>;
    const original = de["region.location.title"];
    try {
      delete de["region.location.title"];
      expect(translate("de", "region.location.title")).toBe("Location");
      de["region.location.title"] = "";
      expect(translate("de", "region.location.title")).toBe("Location");
    } finally {
      de["region.location.title"] = original;
    }
  });

  it("fills placeholders and keeps unknown ones", () => {
    expect(translate("fr", "meteogram.tooltipLabel", { label: "Vent" })).toBe("Vent :");
    expect(translate("en", "meteogram.tooltipLabel")).toBe("{label}:");
  });
});

describe("resolveLanguage", () => {
  it("prefers the stored choice", () => {
    expect(resolveLanguage({ stored: "cs", browserLanguages: ["de-AT"], fallback: "fr" })).toBe("cs");
  });

  it("then the first supported browser language", () => {
    expect(resolveLanguage({ stored: null, browserLanguages: ["pl-PL", "nl-BE", "de"], fallback: "fr" })).toBe("nl");
    expect(resolveLanguage({ stored: "xx", browserLanguages: ["sl_SI"], fallback: "fr" })).toBe("sl");
  });

  it("then the fallback language of the domain", () => {
    expect(resolveLanguage({ stored: null, browserLanguages: ["pl", "ja-JP"], fallback: "it" })).toBe("it");
  });

  it("skips languages the domain does not offer", () => {
    expect(
      resolveLanguage({ stored: "cs", browserLanguages: ["nl", "fr-CH"], fallback: "de", available: ["de", "fr"] }),
    ).toBe("fr");
    expect(resolveLanguage({ stored: "cs", browserLanguages: ["nl"], fallback: "de", available: ["de", "fr"] })).toBe(
      "de",
    );
  });

  it("finally English", () => {
    expect(resolveLanguage({})).toBe("en");
    expect(resolveLanguage({ browserLanguages: ["pl"], fallback: null })).toBe("en");
  });
});

describe("persistence", () => {
  it("stores, reads and removes the choice", () => {
    storeLanguage("da");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("da");
    expect(readStoredLanguage()).toBe("da");
    storeLanguage(null);
    expect(readStoredLanguage()).toBeNull();
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "klingon");
    expect(readStoredLanguage()).toBeNull();
  });

  it("survives unavailable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredLanguage()).toBeNull();
    expect(() => storeLanguage("de")).not.toThrow();
  });
});

describe("meteogramI18n", () => {
  it("gives a locale and every text of the meteogram except those of the convection area (REQ-447)", () => {
    const without = (keys: string[], dropped: string[]) => keys.filter((key) => !dropped.includes(key)).sort();
    for (const language of LANGUAGES) {
      const { locale, texts, tooltipTexts, shortTooltipTexts } = meteogramI18n(language);
      expect(locale).toBe(toLocale(language));
      expect(Object.keys(texts).sort()).toEqual(without(Object.keys(DEFAULT_TEXTS), ["cape", "cin"]));
      // The rows of dew point, spread and relative humidity (REQ-676) are translated too (REQ-671).
      expect(Object.keys(tooltipTexts).sort()).toEqual(
        without(Object.keys(DEFAULT_TOOLTIP_TEXTS), ["cape", "cin", "lpi"]),
      );
      expect(Object.keys(shortTooltipTexts).sort()).toEqual(Object.keys(tooltipTexts).sort());
      for (const value of [texts, tooltipTexts, shortTooltipTexts].flatMap(Object.values)) expect(value).toBeTruthy();
    }
  });

  it("translates the texts", () => {
    const { texts, tooltipTexts } = meteogramI18n("de");
    expect(texts.gusts).toBe("Böen");
    expect(tooltipTexts.windGusts).toBe("Böen:");
    expect(meteogramI18n("fr").tooltipTexts.temperature).toBe("Température :");
  });

  it("translates the rows of dew point, spread and relative humidity, short in the phone's side bar (REQ-671)", () => {
    const de = meteogramI18n("de");
    const rows = (texts: typeof de.tooltipTexts) => [texts.dewPoint, texts.dewPointSpread, texts.relativeHumidity];
    expect(rows(de.tooltipTexts)).toEqual(["Taupunkt:", "Taupunktdifferenz:", "Relative Luftfeuchte:"]);
    // Short forms for the narrow side bar on the phone (REQ-557).
    expect(rows(de.shortTooltipTexts)).toEqual(["Taupunkt:", "Spread:", "Rel. Feuchte:"]);
    expect(meteogramI18n("fr").tooltipTexts.dewPointSpread).toBe("Écart au point de rosée :");
    expect(meteogramI18n("fr").shortTooltipTexts.relativeHumidity).toBe("Hum. rel. :");
    // No language keeps the meteogram's English defaults or the English texts; the short forms are not longer.
    const english = meteogramI18n("en").tooltipTexts;
    for (const language of LANGUAGES.filter((language) => language !== "en")) {
      const { tooltipTexts, shortTooltipTexts } = meteogramI18n(language);
      for (const key of ["dewPoint", "dewPointSpread", "relativeHumidity"] as const) {
        expect(tooltipTexts[key], `${language} ${key}`).not.toBe(DEFAULT_TOOLTIP_TEXTS[key]);
        expect(tooltipTexts[key], `${language} ${key}`).not.toBe(english[key]);
        expect(shortTooltipTexts[key].length, `${language} ${key}`).toBeLessThanOrEqual(tooltipTexts[key].length);
      }
    }
  });
});

describe("I18nProvider", () => {
  let context: I18nContextValue | undefined;
  function Probe() {
    context = useI18n();
    return null;
  }

  function texts(container: HTMLElement): string[] {
    // Headings, placeholders and region names given by aria-label (the location region has no visible heading).
    return [...container.querySelectorAll("h1, h2, .region__placeholder, section[aria-label]")].map(
      (el) => (el.matches("section[aria-label]") ? el.getAttribute("aria-label") : el.textContent) ?? "",
    );
  }

  it("uses the browser language, then the domain fallback", () => {
    render(
      <I18nProvider browserLanguages={["de-CH"]} fallbackLanguage="fr">
        <Probe />
      </I18nProvider>,
    );
    expect(context?.language).toBe("de");
    expect(context?.locale).toBe("de-DE");
    expect(document.documentElement.lang).toBe("de");
    cleanup();

    render(
      <I18nProvider browserLanguages={["pl"]} fallbackLanguage="fr">
        <Probe />
      </I18nProvider>,
    );
    expect(context?.language).toBe("fr");
  });

  it("setLanguage switches, persists and wins over the browser language", () => {
    render(
      <I18nProvider browserLanguages={["de"]}>
        <Probe />
      </I18nProvider>,
    );
    act(() => context?.setLanguage("it"));
    expect(context?.language).toBe("it");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("it");
    cleanup();

    render(
      <I18nProvider browserLanguages={["de"]}>
        <Probe />
      </I18nProvider>,
    );
    expect(context?.language).toBe("it");
    act(() => context?.setLanguage(null));
    expect(context?.language).toBe("de");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("switching the language changes every visible text", () => {
    const { container } = render(
      <I18nProvider browserLanguages={["en-US"]}>
        <Probe />
        <Header />
        <LocationPicker />
      </I18nProvider>,
    );
    const english = texts(container);
    expect(english).toEqual([
      "Menu",
      "Location",
    ]);
    expect(screen.getByRole("combobox", { name: "Search for a place" }).getAttribute("placeholder")).toBe("Place or mountain");
    act(() => context?.setLanguage("cs"));
    expect(texts(container)).toEqual([
      "Nabídka",
      "Místo",
    ]);
    expect(screen.getByRole("combobox", { name: "Hledat místo" }).getAttribute("placeholder")).toBe("Místo nebo hora");
    expect(screen.getByRole("button", { name: /Aktuální poloha/ })).toBeTruthy();
  });
});

describe("App", () => {
  // Page heading, region titles and placeholders of regions not built yet; popups (header, dialog, settings,
  // info) are tested in header.test.tsx, the location picker in location.test.tsx.
  const visibleKeys = Object.keys(MESSAGES.en).filter((key) => /^(app|region)\./.test(key)) as MessageKey[];

  it.each(LANGUAGES)("shows every page text in %s", (language) => {
    storeLanguage(language);
    // With the model chain switched on; switched off it has no card (REQ-471).
    setModelChainVisible(true);
    const { container } = render(<App />);
    const shown = [...container.querySelectorAll("h1, h2, .region__placeholder, section[aria-label]")].map((el) =>
      el.matches("section[aria-label]") ? el.getAttribute("aria-label") : el.textContent,
    );
    expect(shown.sort()).toEqual(visibleKeys.map((key) => translate(language, key)).sort());
    expect(document.documentElement.lang).toBe(language);
  });

  it("uses the domain fallback when the browser language is not supported", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pl-PL"]);
    render(
      <ConfigProvider config={{ ...DEFAULT_CONFIG, defaultLanguage: "it" }}>
        <App />
      </ConfigProvider>,
    );
    expect(screen.getByRole("region", { name: "Località" })).toBeTruthy();
  });
});
