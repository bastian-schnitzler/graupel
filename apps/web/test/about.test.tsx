// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** About tab of the info popup: logo, project information and data attribution (REQ-424). */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import {
  AboutPanel,
  CC_BY_SA_URL,
  CC_BY_URL,
  DOMAIN_VIEWER_LINK_TEXT,
  DOMAIN_VIEWER_URL,
  GPL_TITLE,
  ISSUES_LINK_TEXT,
  ISSUES_URL,
  LICENSE_HREF,
  MAP_CREDITS,
  OPEN_METEO_URL,
  OSM_COPYRIGHT_URL,
  SOURCE_URL,
  THIRD_PARTY_HREF,
} from "../src/dialogs/info/AboutPanel.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type MapProvider } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, storeLanguage, translate, type Language } from "../src/i18n/index.ts";
import packageJson from "../package.json";
import { appVersionLabel } from "../src/version.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** Fixed time for the tests of a describe block: Tuesday, 17 November 2026, 12:00 UTC; only the date is faked. */
function useFixedClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 17, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

function renderAbout(language: Language, map: MapProvider = "opentopomap") {
  return render(
    <ConfigProvider config={{ ...DEFAULT_CONFIG, map }}>
      <I18nProvider languages={LANGUAGES} fallbackLanguage="en" browserLanguages={[language]}>
        <AboutPanel />
      </I18nProvider>
    </ConfigProvider>,
  );
}

describe("About panel", () => {
  it("shows logo, name, description, version, source, data and map attribution and the licenses", () => {
    renderAbout("en");
    const logo = screen.getByRole("img", { name: "Graupel logo" });
    expect(logo.getAttribute("src")).toMatch(/app-icons\/logo-192\.png$/);
    expect(screen.getByRole("heading", { level: 3, name: "Graupel" })).toBeTruthy();
    // The introduction of REQ-812.
    expect(screen.getByText(/meteogram/).textContent).toBe(
      "Graupel chains the data of short-, medium- and long-range weather models and shows them in a meteogram (about 16 days in total). It shows the hourly course of temperature, humidity, precipitation, clouds at different heights and wind. Depending on the place, the best available weather models are chosen.",
    );
    expect(screen.getByTestId("about-version").textContent).toBe(packageJson.version);
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      // No more link to the domain viewer below the introduction (REQ-856, before REQ-821).
      SOURCE_URL,
      // The note on GitHub Issues below the source (REQ-855).
      ISSUES_URL,
      "https://opentopomap.org/",
      OSM_COPYRIGHT_URL,
      // SRTM and Leaflet are named here instead of on the map (REQ-474).
      "http://viewfinderpanoramas.org/",
      "https://leafletjs.com/",
      // The licence of OpenTopoMap, small below its entry (REQ-646).
      CC_BY_SA_URL,
      // Both map providers, whichever is chosen (REQ-517), each in its own entry (REQ-646).
      "https://www.maptoolkit.org/",
      OSM_COPYRIGHT_URL,
      // GPL and third-party licenses are buttons that open a popup (REQ-647, REQ-514), not links to the files.
      // The weather data come after maps and licenses (REQ-491).
      OPEN_METEO_URL,
      CC_BY_URL,
      // The model map is the last entry (REQ-856).
      DOMAIN_VIEWER_URL,
    ]);
    const terms = [...document.querySelectorAll(".about__facts > dt")].map((dt) => dt.textContent);
    expect(terms).toEqual([
      "Version",
      "Source code",
      "Map OpenTopoMap",
      "Map Maptoolkit",
      "License",
      "Weather data",
      "Model map",
    ]);
    expect(screen.getByTestId("about-data").previousElementSibling?.textContent).toBe("Weather data");
    expect(screen.getByTestId("about-data").nextElementSibling?.textContent).toBe("Model map");
    expect(screen.getByTestId("about-model-map").nextElementSibling).toBeNull();
    expect(LICENSE_HREF).toMatch(/\/LICENSE$/);
    expect(THIRD_PARTY_HREF).toMatch(/\/THIRD_PARTY_LICENSES\.md$/);
    // The GPL opens in a popup instead of downloading the file (REQ-647).
    expect(GPL_TITLE).toBe("GPL-3.0-or-later");
    expect(screen.queryByRole("link", { name: "GPL-3.0-or-later" })).toBeNull();
    expect(screen.getByRole("button", { name: "GPL-3.0-or-later" }).getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.querySelector('a[href$="LICENSE"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Third-party licenses" })).toBeNull();
    const thirdParty = screen.getByRole("button", { name: "Third-party licenses" });
    expect(thirdParty.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.querySelector('a[href$=".md"]')).toBeNull();
    // One entry per map, the licence of OpenTopoMap small below its credits (REQ-646).
    expect(screen.getByTestId("about-map-opentopomap").textContent).toBe(
      "OpenTopoMap, © OpenStreetMap contributors, SRTM, LeafletLicence: CC BY-SA 3.0",
    );
    expect(screen.getByTestId("about-map-opentopomap-license").textContent).toBe("Licence: CC BY-SA 3.0");
    expect(screen.getByTestId("about-map-opentopomap-license").className).toBe(
      screen.getByTestId("about-data-license").className,
    );
    expect(screen.getByRole("link", { name: "CC BY-SA 3.0" }).getAttribute("href")).toBe(
      "https://creativecommons.org/licenses/by-sa/3.0/",
    );
    expect(screen.getByTestId("about-map-maptoolkit").textContent).toBe("Maptoolkit, © OpenStreetMap contributors");
    expect(screen.queryByTestId("about-map-maptoolkit-license")).toBeNull();
    expect(SOURCE_URL).toBe("https://github.com/bastian-schnitzler/graupel");
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toBeTruthy();
    // Licence of the weather data and the note on the changes (REQ-478).
    expect(screen.getByTestId("about-data").textContent).toBe(
      "Open-Meteo.comLicence: CC BY 4.0. The data were harmonised (units, timestamps) and combined from several weather models into one timeline.",
    );
    expect(screen.getByTestId("about-data-license").textContent).toBe(
      "Licence: CC BY 4.0. The data were harmonised (units, timestamps) and combined from several weather models into one timeline.",
    );
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it.each(LANGUAGES)("is translated in %s", (language) => {
    renderAbout(language);
    const tr = (key: Parameters<typeof translate>[1]) => translate(language, key);
    expect(screen.getByRole("img", { name: tr("info.about.logo") })).toBeTruthy();
    expect(screen.getByText(tr("info.about.description"))).toBeTruthy();
    for (const key of [
      "info.about.version",
      "info.about.source",
      "info.about.data",
      "info.about.license",
    ] as const) {
      expect(screen.getByText(tr(key)).tagName).toBe("DT");
    }
    // One entry per map, named in every language (REQ-646).
    for (const name of ["OpenTopoMap", "Maptoolkit"]) {
      const term = translate(language, "info.about.mapProvider", { name });
      expect(term).toContain(name);
      expect(screen.getByText(term).tagName).toBe("DT");
    }
    expect(screen.getByTestId("about-map-opentopomap-license").textContent).toBe(
      `${tr("info.about.dataLicense")} CC BY-SA 3.0`,
    );
    expect(screen.getByRole("button", { name: "GPL-3.0-or-later" })).toBeTruthy();
    // The weather data come after maps and licenses (REQ-491), only the model map follows them (REQ-856).
    const terms = [...document.querySelectorAll(".about__facts > dt")].map((dt) => dt.textContent);
    expect(terms.at(-2)).toBe(tr("info.about.data"));
    expect(terms.at(-1)).toBe(tr("info.about.modelMap"));
    const dataLicense = screen.getByTestId("about-data-license").textContent;
    expect(dataLicense).toBe(`${tr("info.about.dataLicense")} CC BY 4.0. ${tr("info.about.dataModifications")}`);
    expect(screen.getByRole("button", { name: tr("info.about.thirdParty") })).toBeTruthy();
    if (language !== "en") {
      expect(MESSAGES[language]["info.about.description"]).not.toBe(MESSAGES.en["info.about.description"]);
    }
  });

  // REQ-812: the new introduction, word for word in German, translated in every language: chained short-, medium- and
  // long-range models, one meteogram of about 16 days, humidity named before precipitation, the best models per place.
  it("shows the introduction of REQ-812 in German", () => {
    renderAbout("de");
    expect(screen.getByText(/Meteogramm/).textContent).toBe(
      "Graupel verkettet die Daten von kurz-, mittel- und langfristigen Wettermodellen und gibt diese in einem " +
        "Meteogramm wieder (ca. 16 Tage Gesamtdauer). Dieses zeigt den stündlichen Verlauf von Temperatur, " +
        "Luftfeuchtigkeit, Niederschlag, Wolken in verschiedenen Höhen und Wind. Abhängig vom Ort werden die besten " +
        "verfügbaren Wettermodelle ausgewählt.",
    );
  });

  /** Words for meteogram, temperature, humidity, precipitation, clouds and wind, in the order of the text. */
  const INTRO_WORDS: Readonly<Record<Language, readonly string[]>> = {
    de: ["Meteogramm", "Temperatur", "Luftfeuchtigkeit", "Niederschlag", "Wolken", "Wind"],
    en: ["meteogram", "temperature", "humidity", "precipitation", "clouds", "wind"],
    fr: ["météogramme", "température", "humidité", "précipitations", "nuages", "vent"],
    it: ["meteogramma", "temperatura", "umidità", "precipitazioni", "nuvole", "vento"],
    nl: ["meteogram", "temperatuur", "luchtvochtigheid", "neerslag", "bewolking", "wind"],
    da: ["meteogram", "temperatur", "luftfugtighed", "nedbør", "skyer", "vind"],
    cs: ["meteogramu", "teploty", "vlhkosti", "srážek", "oblačnosti", "větru"],
    sl: ["meteogramu", "temperature", "vlažnosti", "padavin", "oblakov", "vetra"],
  };

  it.each(LANGUAGES)("translates the introduction of REQ-812 in %s", (language) => {
    renderAbout(language);
    const text = translate(language, "info.about.description");
    expect(screen.getByText(text).tagName).toBe("P");
    // Three sentences, about 16 days, no more Open-Meteo in the introduction.
    const sentences = text.replace(/\bca\. /g, "ca ").split(/[.!?](?:\s|$)/);
    expect(sentences.filter((part) => part.trim() !== "")).toHaveLength(3);
    expect(text).toContain("16");
    expect(text).not.toContain("Open-Meteo");
    const positions = INTRO_WORDS[language].map((word) => text.indexOf(word));
    expect(positions.every((position) => position >= 0), positions.join(", ")).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it.each(Object.keys(MAP_CREDITS))("names both map providers when %s is configured (REQ-517, REQ-646)", (map) => {
    renderAbout("en", map as MapProvider);
    for (const [provider, credit] of Object.entries(MAP_CREDITS)) {
      const row = within(screen.getByTestId(`about-map-${provider}`));
      expect(row.getByRole("link", { name: credit.name }).getAttribute("href")).toBe(credit.href);
      const osm = row.getByRole("link", { name: "OpenStreetMap contributors" });
      expect(osm.getAttribute("href")).toBe(OSM_COPYRIGHT_URL);
      for (const more of credit.more) {
        expect(row.getByRole("link", { name: more.name }).getAttribute("href")).toBe(more.href);
      }
      if (credit.license)
        expect(row.getByRole("link", { name: credit.license.name }).getAttribute("href")).toBe(credit.license.href);
    }
  });

  // REQ-855: below the link of the source code, small like the text below the weather data, the note that problems,
  // bugs and feature requests can be reported via GitHub Issues, linked to the issues of the public repository.
  describe("note on GitHub Issues below the source (REQ-855)", () => {
    useFixedClock();

    it("is small below the source link, like the licence of the weather data, and links the issues", () => {
      expect(ISSUES_URL).toBe("https://github.com/bastian-schnitzler/graupel/issues");
      renderAbout("de");
      const source = screen.getByTestId("about-source");
      expect(source.previousElementSibling?.textContent).toBe("Quellcode");
      const note = screen.getByTestId("about-issues");
      expect(note.parentElement).toBe(source);
      // Below the link to the repository, in the class of the text below the weather data.
      expect(note.previousElementSibling?.getAttribute("href")).toBe(SOURCE_URL);
      expect(note.className).toBe(screen.getByTestId("about-data-license").className);
      expect(note.textContent).toBe("Probleme, Bugs und Feature Requests können über GitHub Issues gemeldet werden.");
      const link = within(note).getByRole("link", { name: "GitHub Issues" });
      expect(link.getAttribute("href")).toBe("https://github.com/bastian-schnitzler/graupel/issues");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")?.split(" ")).toContain("noopener");
    });

    it.each(LANGUAGES)("is translated in %s", (language) => {
      renderAbout(language);
      const template = translate(language, "info.about.issues");
      // One place for the link, inside the sentence; the name GitHub Issues stays as it is.
      expect(template.split("{link}")).toHaveLength(2);
      expect(template.trim().endsWith(".")).toBe(true);
      const note = screen.getByTestId("about-issues");
      expect(note.textContent).toBe(template.replace("{link}", ISSUES_LINK_TEXT));
      const link = within(note).getByRole("link", { name: ISSUES_LINK_TEXT });
      expect(link.getAttribute("href")).toBe(ISSUES_URL);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")?.split(" ")).toContain("noopener");
      if (language !== "en") expect(template).not.toBe(translate("en", "info.about.issues"));
    });
  });

  // REQ-856: after the weather data the entry "Model map" with the link to the Model Domain Viewer and, small below it,
  // how the model chains are chosen; the link below the introduction (REQ-821) is gone.
  describe("entry Model map after the weather data (REQ-856)", () => {
    useFixedClock();

    it("links the domain viewer in a new tab and explains the model chains below it", () => {
      expect(DOMAIN_VIEWER_URL).toBe("https://bastian-schnitzler.github.io/graupel/");
      renderAbout("de");
      const entry = screen.getByTestId("about-model-map");
      expect(entry.previousElementSibling?.textContent).toBe("Modellkarte");
      expect(entry.previousElementSibling?.previousElementSibling).toBe(screen.getByTestId("about-data"));
      const link = within(entry).getByRole("link", { name: DOMAIN_VIEWER_LINK_TEXT });
      expect(DOMAIN_VIEWER_LINK_TEXT).toBe("bastian-schnitzler.github.io/graupel");
      expect(link.getAttribute("href")).toBe("https://bastian-schnitzler.github.io/graupel/");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")?.split(" ")).toContain("noopener");
      const note = screen.getByTestId("about-model-map-note");
      expect(note.previousElementSibling).toBe(link);
      expect(note.className).toBe(screen.getByTestId("about-data-license").className);
      expect(note.textContent).toBe(
        "Die bestmöglichen Modellketten werden in Abhängigkeit vom Ort und den unter Open-Meteo verfügbaren " +
          "Modellen ausgewählt und können über die Modellkarte visualisiert werden.",
      );
      expect(within(entry).getAllByRole("link")).toHaveLength(1);
    });

    it("has no more link below the introduction", () => {
      renderAbout("de");
      expect(screen.queryByText("Gebiete der Wettermodelle auf der Karte ansehen")).toBeNull();
      expect(document.querySelector(".about__description")?.nextElementSibling?.className).toBe("about__facts");
      expect(screen.getAllByRole("link").filter((link) => link.getAttribute("href") === DOMAIN_VIEWER_URL)).toHaveLength(
        1,
      );
      for (const language of LANGUAGES) expect(MESSAGES[language]).not.toHaveProperty("info.about.domainViewer");
    });

    it.each(LANGUAGES)("is translated in %s", (language) => {
      renderAbout(language);
      const tr = (key: Parameters<typeof translate>[1]) => translate(language, key);
      const entry = screen.getByTestId("about-model-map");
      expect(screen.getByText(tr("info.about.modelMap")).tagName).toBe("DT");
      expect(entry.previousElementSibling?.textContent).toBe(tr("info.about.modelMap"));
      expect(within(entry).getByRole("link", { name: DOMAIN_VIEWER_LINK_TEXT }).getAttribute("href")).toBe(
        DOMAIN_VIEWER_URL,
      );
      const note = tr("info.about.modelMapNote");
      expect(screen.getByTestId("about-model-map-note").textContent).toBe(note);
      // Names Open-Meteo, whose models are chosen from.
      expect(note).toContain("Open-Meteo");
      if (language !== "en") {
        expect(tr("info.about.modelMap")).not.toBe(translate("en", "info.about.modelMap"));
        expect(note).not.toBe(translate("en", "info.about.modelMapNote"));
      }
    });

    it.each(LANGUAGES)("is in the first tab of the info popup in %s", (language) => {
      window.localStorage.clear();
      storeLanguage(language);
      render(<App />);
      const tr = (key: Parameters<typeof translate>[1]) => translate(language, key);
      fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: tr("header.info") }));
      const info = screen.getByRole("dialog", { name: tr("info.title") });
      const tabs = within(info).getAllByRole("tab");
      expect(tabs[0]!.textContent).toBe(tr("info.tab.about"));
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
      const panel = within(info).getByRole("tabpanel");
      expect(within(panel).getByRole("link", { name: DOMAIN_VIEWER_LINK_TEXT }).getAttribute("href")).toBe(
        DOMAIN_VIEWER_URL,
      );
      expect(within(panel).getByRole("link", { name: ISSUES_LINK_TEXT }).getAttribute("href")).toBe(ISSUES_URL);
      window.localStorage.clear();
    });
  });

  it("links the source code in the public repository (REQ-709)", () => {
    renderAbout("en");
    const link = screen.getByRole("link", { name: "github.com/bastian-schnitzler/graupel" });
    expect(link.getAttribute("href")).toBe("https://github.com/bastian-schnitzler/graupel");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  // REQ-724: a build with the commit in VITE_GRAUPEL_REVISION shows the version with the commit, a release build
  // (without it) the version alone; the build decides, not the hostname.
  it("shows the version with the commit when the build names one, the version alone otherwise (REQ-724)", () => {
    const version = packageJson.version; // 0.4.0 in WEB-S4
    vi.stubEnv("VITE_GRAUPEL_REVISION", "");
    renderAbout("de");
    expect(screen.getByTestId("about-version").textContent).toBe(version);
    expect(screen.getByTestId("about-version").parentElement?.textContent).toContain(`Version${version}Quellcode`);
    cleanup();

    vi.stubEnv("VITE_GRAUPEL_REVISION", "abc1234");
    renderAbout("de");
    expect(screen.getByTestId("about-version").textContent).toBe(`${version} (abc1234)`);
    expect(screen.getByTestId("about-version").previousElementSibling?.textContent).toBe("Version");
    expect(appVersionLabel("def5678")).toBe(`${version} (def5678)`);
    expect(appVersionLabel("")).toBe(version);
  });

  it("the placeholder text is gone", () => {
    for (const language of LANGUAGES) expect(MESSAGES[language]).not.toHaveProperty("info.about.placeholder");
  });
});

describe("logo only in the info popup", () => {
  it("the page shows no logo outside the About tab", () => {
    window.localStorage.clear();
    const { container } = render(<App />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(within(container).queryByRole("img", { name: "Graupel logo" })).toBeNull();
  });
});
