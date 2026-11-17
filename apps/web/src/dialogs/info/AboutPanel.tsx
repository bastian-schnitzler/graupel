// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { Fragment, lazy, Suspense, useState } from "react";
import type { MapProvider } from "../../config/index.ts";
import { useT } from "../../i18n/index.ts";
import { appVersionLabel } from "../../version.ts";
import "./AboutPanel.css";

export const SOURCE_URL = "https://github.com/bastian-schnitzler/graupel";
/** Issues of the public repository: problems, bugs and feature requests are reported there (REQ-855). */
export const ISSUES_URL = "https://github.com/bastian-schnitzler/graupel/issues";
/** Name of the issue tracker, the link text in the note below the source (REQ-855); a product name, not translated. */
export const ISSUES_LINK_TEXT = "GitHub Issues";
export const OPEN_METEO_URL = "https://open-meteo.com/";
export const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/3.0/";
/**
 * Model Domain Viewer on the GitHub Pages of the public repository (REQ-821): areas of the weather models on a map.
 * Linked from the entry "Model map" after the weather data (REQ-856), its address without the scheme as link text,
 * like the source code.
 */
export const DOMAIN_VIEWER_URL = "https://bastian-schnitzler.github.io/graupel/";
export const DOMAIN_VIEWER_LINK_TEXT = "bastian-schnitzler.github.io/graupel";

/**
 * License files next to index.html, written by the build (REQ-431, vite.config.ts). Both open in a popup, loaded only
 * then: the third-party notice as Markdown (REQ-514), the GPL as plain text instead of a download (REQ-647).
 */
export const LICENSE_HREF = `${import.meta.env.BASE_URL}LICENSE`;
export const THIRD_PARTY_HREF = `${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.md`;

const ThirdPartyDialog = lazy(() => import("./ThirdPartyDialog.tsx"));

/** Name of the license of Graupel, the link text and the title of its popup (REQ-647). */
export const GPL_TITLE = "GPL-3.0-or-later";

interface Credit {
  name: string;
  href: string;
}

const OSM_CREDIT: Credit = { name: "OpenStreetMap contributors", href: OSM_COPYRIGHT_URL };

/**
 * Name and link of each map provider. The About tab names both, whichever map is chosen (REQ-517; before: only the
 * effective one, REQ-467), each in its own entry with "© OpenStreetMap contributors" (REQ-646); the map itself shows
 * the attribution its provider requires. `more`: credits named here instead of on the map (REQ-474): the SRTM
 * elevation data of OpenTopoMap and Leaflet, whose credit the map shows on the desktop only. `license`: shown small
 * below the entry, like the licence of the weather data (REQ-646).
 */
export const MAP_CREDITS: Readonly<Record<MapProvider, Credit & { more: readonly Credit[]; license?: Credit }>> = {
  opentopomap: {
    name: "OpenTopoMap",
    href: "https://opentopomap.org/",
    more: [
      { name: "SRTM", href: "http://viewfinderpanoramas.org/" },
      { name: "Leaflet", href: "https://leafletjs.com/" },
    ],
    license: { name: "CC BY-SA 3.0", href: CC_BY_SA_URL },
  },
  maptoolkit: { name: "Maptoolkit", href: "https://www.maptoolkit.org/", more: [] },
};

/** A credited name with its link, opened in a new tab. */
function CreditLink({ credit }: { credit: Credit }) {
  return (
    <a href={credit.href} target="_blank" rel="noopener noreferrer">
      {credit.name}
    </a>
  );
}

/**
 * Logo of the page; it is shown only here (REQ-424), the favicon is the same cloud. Transparent, unlike the app
 * icons on their light blue background (REQ-516).
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}app-icons/logo-192.png`;

/**
 * The note below the source (REQ-855): the translated sentence with the link to the issues where its `{link}` stands.
 */
function IssuesNote() {
  const t = useT();
  const [before = "", after = ""] = t("info.about.issues").split("{link}");
  return (
    <span className="about__note" data-testid="about-issues">
      {before}
      <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
        {ISSUES_LINK_TEXT}
      </a>
      {after}
    </span>
  );
}

/**
 * Content of the About tab in the info popup: logo, name, description, version (with the commit when the build names
 * one, REQ-724), source with the note on GitHub Issues (REQ-855), data and map attribution with the licence of the
 * weather data and how it was changed (REQ-478), and the licenses (REQ-424, REQ-431). The weather data come after map
 * and licenses (REQ-491), followed only by the model map, the link to the domain viewer with how the model chains are
 * chosen (REQ-856; before: a link below the description, REQ-821).
 */
export function AboutPanel() {
  const t = useT();
  const mapProviders = Object.entries(MAP_CREDITS) as [MapProvider, (typeof MAP_CREDITS)[MapProvider]][];
  const [popup, setPopup] = useState<"license" | "thirdParty" | null>(null);
  return (
    <div className="about">
      <div className="about__brand">
        <img className="about__logo" src={LOGO_SRC} width={64} height={64} alt={t("info.about.logo")} />
        <h3 className="about__name">{t("app.title")}</h3>
      </div>
      <p className="about__description">{t("info.about.description")}</p>
      <dl className="about__facts">
        <dt>{t("info.about.version")}</dt>
        <dd data-testid="about-version">{appVersionLabel()}</dd>
        <dt>{t("info.about.source")}</dt>
        <dd data-testid="about-source">
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            github.com/bastian-schnitzler/graupel
          </a>
          <IssuesNote />
        </dd>
        {mapProviders.map(([provider, credit]) => (
          <Fragment key={provider}>
            <dt>{t("info.about.mapProvider", { name: credit.name })}</dt>
            <dd data-testid={`about-map-${provider}`}>
              <CreditLink credit={credit} />
              {", © "}
              <CreditLink credit={OSM_CREDIT} />
              {credit.more.map((more) => (
                <Fragment key={more.name}>
                  {", "}
                  <CreditLink credit={more} />
                </Fragment>
              ))}
              {credit.license ? (
                <span className="about__note" data-testid={`about-map-${provider}-license`}>
                  {t("info.about.dataLicense")}{" "}
                  <a href={credit.license.href} target="_blank" rel="noopener noreferrer license">
                    {credit.license.name}
                  </a>
                </span>
              ) : null}
            </dd>
          </Fragment>
        ))}
        <dt>{t("info.about.license")}</dt>
        <dd>
          <button
            type="button"
            className="about__popup-link"
            aria-haspopup="dialog"
            onClick={() => setPopup("license")}
          >
            {GPL_TITLE}
          </button>
          {", "}
          <button
            type="button"
            className="about__popup-link"
            aria-haspopup="dialog"
            onClick={() => setPopup("thirdParty")}
          >
            {t("info.about.thirdParty")}
          </button>
        </dd>
        <dt>{t("info.about.data")}</dt>
        <dd data-testid="about-data">
          <a href={OPEN_METEO_URL} target="_blank" rel="noopener noreferrer">
            Open-Meteo.com
          </a>
          <span className="about__note" data-testid="about-data-license">
            {t("info.about.dataLicense")}{" "}
            <a href={CC_BY_URL} target="_blank" rel="noopener noreferrer license">
              CC BY 4.0
            </a>
            . {t("info.about.dataModifications")}
          </span>
        </dd>
        <dt>{t("info.about.modelMap")}</dt>
        <dd data-testid="about-model-map">
          <a href={DOMAIN_VIEWER_URL} target="_blank" rel="noopener noreferrer">
            {DOMAIN_VIEWER_LINK_TEXT}
          </a>
          <span className="about__note" data-testid="about-model-map-note">
            {t("info.about.modelMapNote")}
          </span>
        </dd>
      </dl>
      {popup ? (
        <Suspense key={popup} fallback={null}>
          {popup === "license" ? (
            <ThirdPartyDialog
              title={GPL_TITLE}
              href={LICENSE_HREF}
              format="text"
              error={t("info.about.licenseError")}
              testId="license-text"
              onClose={() => setPopup(null)}
            />
          ) : (
            <ThirdPartyDialog
              title={t("info.about.thirdParty")}
              href={THIRD_PARTY_HREF}
              format="markdown"
              error={t("info.about.thirdPartyError")}
              testId="third-party-licenses"
              onClose={() => setPopup(null)}
            />
          )}
        </Suspense>
      ) : null}
    </div>
  );
}
