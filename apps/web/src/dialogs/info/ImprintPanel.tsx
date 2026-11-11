// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ReactNode } from "react";
import { imprintHoster, useConfig, type HosterInfo, type ImprintConfig } from "../../config/index.ts";
import { useT, type MessageKey, type Translate } from "../../i18n/index.ts";
import "./ImprintPanel.css";

/** `tel:` link of a phone number as written in the config (spaces and separators dropped). */
function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Lines of the operator: name, then the postal address or, without one, the place of residence. */
function operatorLines(imprint: ImprintConfig, t: Translate): ReactNode[] {
  const lines: ReactNode[] = [imprint.name];
  if (imprint.address?.length) lines.push(...imprint.address);
  else if (imprint.residence) lines.push(t("info.imprint.residence", { place: imprint.residence }));
  if (imprint.email) {
    lines.push(
      <Contact label={t("info.imprint.email")} href={`mailto:${imprint.email}`} text={imprint.email} />,
    );
  }
  return lines;
}

function hosterLines(hoster: HosterInfo, t: Translate): ReactNode[] {
  const lines: ReactNode[] = [hoster.name, ...(hoster.address ?? [])];
  if (hoster.phone) {
    lines.push(<Contact label={t("info.imprint.phone")} href={phoneHref(hoster.phone)} text={hoster.phone} />);
  }
  if (hoster.email) {
    lines.push(<Contact label={t("info.imprint.email")} href={`mailto:${hoster.email}`} text={hoster.email} />);
  }
  if (hoster.url) {
    lines.push(
      <a href={hoster.url} target="_blank" rel="noopener noreferrer">
        {hoster.url.replace(/^https?:\/\//, "")}
      </a>,
    );
  }
  return lines;
}

function Contact({ label, href, text }: { label: string; href: string; text: string }) {
  return (
    <>
      {label} <a href={href}>{text}</a>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: MessageKey; children: ReactNode }) {
  const t = useT();
  return (
    <section className="imprint__section" data-section={id} aria-labelledby={`imprint-${id}`}>
      <h4 className="imprint__heading" id={`imprint-${id}`}>
        {t(title)}
      </h4>
      {children}
    </section>
  );
}

function Address({ lines, testId }: { lines: ReactNode[]; testId: string }) {
  return (
    <address className="imprint__address" data-testid={testId}>
      {lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </address>
  );
}

/**
 * Content of the Imprint tab in the info popup (REQ-430, DEC-023), driven by `legal.imprint` of the domain: the
 * operator with address or place of residence, or without a name an anonymous note; the hosting provider when
 * configured (e.g. the French "Mentions légales"). No heading of its own: the tab label names the panel (REQ-484).
 */
export function ImprintPanel() {
  const t = useT();
  const { imprint, hosting } = useConfig().legal;
  const hoster = imprintHoster(imprint, hosting);

  return (
    <article className="imprint">
      <Section id="operator" title="info.imprint.operator">
        {imprint.name ? (
          <Address lines={operatorLines(imprint, t)} testId="imprint-operator" />
        ) : (
          <p>{t("info.imprint.anonymous")}</p>
        )}
      </Section>
      {hoster && (
        <Section id="hoster" title="info.imprint.hoster">
          <Address lines={hosterLines(hoster, t)} testId="imprint-hoster" />
        </Section>
      )}
    </article>
  );
}
