// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ReactNode } from "react";
import { imprintHoster, useConfig } from "../../config/index.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { HOSTING, MAP_PROVIDERS, OPEN_METEO_LINKS, PRIVACY_UPDATED, type PrivacyLink } from "./privacy.ts";
import "./PrivacyPanel.css";

/** Formats the ISO date of the policy in the active locale (UTC, so the day never shifts). */
function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/**
 * Content of the Privacy tab in the info popup: the privacy policy (REQ-432), without a heading of its own; the tab
 * label "Privacy policy" names the panel (REQ-484).
 */
export function PrivacyPanel() {
  const { t, locale } = useI18n();
  const { legal } = useConfig();
  const { imprint, privacy } = legal;
  const hoster = imprintHoster(imprint, legal.hosting);
  // REQ-710: the provider that actually serves the site; an unknown value cannot pass the config validation.
  const hosting = HOSTING[legal.hosting] ?? HOSTING["github-pages"];

  const paragraphs = (...keys: MessageKey[]) => keys.map((key) => <p key={key}>{t(key)}</p>);
  const links = (items: readonly PrivacyLink[]) => (
    <ul className="privacy__links">
      {items.map(({ label, href }) => (
        <li key={href}>
          <a href={href} target="_blank" rel="noopener noreferrer">
            {t(label)}
          </a>
        </li>
      ))}
    </ul>
  );
  const section = (id: string, title: MessageKey, children: ReactNode) => (
    <section className="privacy__section" data-section={id} aria-labelledby={`privacy-${id}`}>
      <h4 className="privacy__heading" id={`privacy-${id}`}>
        {t(title)}
      </h4>
      {children}
    </section>
  );

  // The controller: `legal.privacy.controller` (name and email, DEC-028) or else the operator of the imprint.
  const imprintLines = imprint.name
    ? [imprint.name, ...(imprint.address ?? (imprint.residence ? [imprint.residence] : []))]
    : undefined;
  const controller = privacy.controller
    ? { lines: [privacy.controller.name], email: privacy.controller.email }
    : imprintLines && { lines: imprintLines, email: imprint.email };

  return (
    <article className="privacy">
      <p className="privacy__updated">
        {t("privacy.updated", { date: formatDate(PRIVACY_UPDATED, locale) })}
      </p>
      <p>{t("privacy.intro")}</p>

      {section(
        "controller",
        "privacy.controller.title",
        controller ? (
          <>
            <p>{t("privacy.controller.text")}</p>
            <address className="privacy__address" data-testid="privacy-controller">
              {controller.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
              {controller.email && (
                <span>
                  {t("privacy.controller.email")}: <a href={`mailto:${controller.email}`}>{controller.email}</a>
                </span>
              )}
            </address>
          </>
        ) : (
          <>
            <p>{t("privacy.controller.anonymous")}</p>
            {hoster && (
              <address className="privacy__address" data-testid="privacy-hoster">
                <span>{t("privacy.controller.hoster")}:</span>
                {[hoster.name, ...(hoster.address ?? [])].map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </address>
            )}
          </>
        ),
      )}

      {section(
        "hosting",
        hosting.title,
        <>
          {paragraphs(...hosting.paragraphs, "privacy.hosting.basis")}
          {links(hosting.links)}
        </>,
      )}

      {section(
        "weather",
        "privacy.weather.title",
        <>
          {paragraphs("privacy.weather.text", "privacy.weather.search", "privacy.weather.retention", "privacy.weather.basis")}
          {links(OPEN_METEO_LINKS)}
        </>,
      )}

      {section(
        "map",
        "privacy.map.title",
        <>
          {paragraphs("privacy.map.text", "privacy.map.choice")}
          {/* REQ-493: every provider, whichever is chosen, since the user can switch in the settings. */}
          {Object.entries(MAP_PROVIDERS).map(([id, provider]) => (
            <div key={id} className="privacy__provider" data-provider={id}>
              <p>{t(provider.text)}</p>
              {links(provider.links)}
            </div>
          ))}
          {paragraphs("privacy.map.basis")}
        </>,
      )}

      {section(
        "location",
        "privacy.location.title",
        paragraphs("privacy.location.gps", "privacy.location.ip", "privacy.location.basis"),
      )}

      {section(
        "storage",
        "privacy.storage.title",
        paragraphs("privacy.storage.text", "privacy.storage.noTracking", "privacy.storage.basis"),
      )}

      {section(
        "rights",
        "privacy.rights.title",
        paragraphs("privacy.rights.text", "privacy.rights.note", "privacy.rights.complaint"),
      )}

      {privacy.swissNotice &&
        section(
          "switzerland",
          "privacy.switzerland.title",
          paragraphs("privacy.switzerland.text", hosting.swiss, "privacy.switzerland.complaint"),
        )}
    </article>
  );
}
