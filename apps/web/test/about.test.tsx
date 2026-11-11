// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** About tab of the info popup: logo, project information and data attribution (REQ-424). */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import {
  AboutPanel,
  CC_BY_SA_URL,
  CC_BY_URL,
  GPL_TITLE,
  LICENSE_HREF,
  MAP_CREDITS,
  OPEN_METEO_URL,
  OSM_COPYRIGHT_URL,
  SOURCE_URL,
  THIRD_PARTY_HREF,
} from "../src/dialogs/info/AboutPanel.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type MapProvider } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type Language } from "../src/i18n/index.ts";
import packageJson from "../package.json";
import { appVersionLabel } from "../src/version.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

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
    expect(logo.getAttribute("src")).toMatch(/icons\/logo-192\.png$/);
    expect(screen.getByRole("heading", { level: 3, name: "Graupel" })).toBeTruthy();
    expect(screen.getByText(/meteograms/).textContent).toContain("Open-Meteo");
    expect(screen.getByTestId("about-version").textContent).toBe(packageJson.version);
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      SOURCE_URL,
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
      // The weather data come last (REQ-491).
      OPEN_METEO_URL,
      CC_BY_URL,
    ]);
    const terms = [...document.querySelectorAll(".about__facts > dt")].map((dt) => dt.textContent);
    expect(terms).toEqual([
      "Version",
      "Source code",
      "Map OpenTopoMap",
      "Map Maptoolkit",
      "License",
      "Weather data",
    ]);
    expect(screen.getByTestId("about-data").previousElementSibling?.textContent).toBe("Weather data");
    expect(screen.getByTestId("about-data").nextElementSibling).toBeNull();
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
    // The weather data are the last entry in every language (REQ-491).
    const terms = [...document.querySelectorAll(".about__facts > dt")].map((dt) => dt.textContent);
    expect(terms.at(-1)).toBe(tr("info.about.data"));
    const dataLicense = screen.getByTestId("about-data-license").textContent;
    expect(dataLicense).toBe(`${tr("info.about.dataLicense")} CC BY 4.0. ${tr("info.about.dataModifications")}`);
    expect(screen.getByRole("button", { name: tr("info.about.thirdParty") })).toBeTruthy();
    if (language !== "en") {
      expect(MESSAGES[language]["info.about.description"]).not.toBe(MESSAGES.en["info.about.description"]);
    }
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

  it("links the source code in the public repository (REQ-709)", () => {
    renderAbout("en");
    const link = screen.getByRole("link", { name: "github.com/bastian-schnitzler/graupel" });
    expect(link.getAttribute("href")).toBe("https://github.com/bastian-schnitzler/graupel");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  // REQ-724: graupel_test (the preview, built with the commit in VITE_GRAUPEL_REVISION) shows the version with the
  // commit, the domains (built without it) the version alone; the build decides, not the hostname.
  it("shows the version with the commit on the preview, the version alone on the domain builds (REQ-724)", () => {
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
