// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Content of the Help tab in the info popup (REQ-819): the controls of the page in five sections, each with a drawn
 * picture (HelpPicture.tsx, in the style of the install steps) and a text. The sections follow the page: the model
 * chains only while at least one is shown (and only the shown ones), the day slider only while it is shown, the history
 * only in the installed app with the period of its archive from the settings. Texts that name a gesture or a control
 * differ by device class: a click and the grips on the desktop, a tap and the slider on phones and tablets; full screen
 * opens with its button on desktops and tablets and by turning a phone.
 */
import { useT, type MessageKey, type Translate } from "../../i18n/index.ts";
import {
  useAppMode,
  useArchiveDays,
  useChainCardsVisible,
  useDaySlider,
  useDeviceClass,
  type ArchiveDays,
  type ChainCardsVisible,
  type DeviceClass,
} from "../../state/index.ts";
import { HelpPicture } from "./HelpPicture.tsx";
import "./HelpPanel.css";

/** The sections of the Help tab, in display order. */
export const HELP_SECTIONS = ["place", "chains", "days", "meteogram", "fullscreen"] as const;

export type HelpSection = (typeof HELP_SECTIONS)[number];

/** What the Help tab follows: the device, the app mode and the display settings of the page. */
export interface HelpContext {
  device: DeviceClass;
  installed: boolean;
  /** The model chain cards shown on the page. */
  chains: ChainCardsVisible;
  /** Whether the day slider is shown. */
  daySlider: boolean;
  /** How long the installed app keeps its fetches (settings, tab Archive). */
  archiveDays: ArchiveDays;
}

/** Sections shown in `context`: the model chains only while one is shown, the day slider only while it is shown. */
export function helpSections(context: HelpContext): HelpSection[] {
  return HELP_SECTIONS.filter((section) => {
    if (section === "chains") return context.chains.weather || context.chains.cloud;
    if (section === "days") return context.daySlider;
    return true;
  });
}

/** Title of each section. */
export const HELP_TITLES: Readonly<Record<HelpSection, MessageKey>> = {
  place: "info.help.place.title",
  chains: "info.help.chains.title",
  days: "info.help.days.title",
  meteogram: "info.help.meteogram.title",
  fullscreen: "info.help.fullscreen.title",
};

/** Text of a section: its paragraphs and, for the meteogram, a list of its three areas. */
export interface HelpText {
  paragraphs: string[];
  items?: string[];
}

/** Whether the device is used with a finger (phones and tablets) rather than a mouse. */
const touch = (device: DeviceClass) => device !== "desktop";

/** Text of `section` in `context`, translated with `t`. */
export function helpText(section: HelpSection, context: HelpContext, t: Translate): HelpText {
  switch (section) {
    case "place": {
      const paragraphs = [t("info.help.place.text")];
      if (context.installed) {
        // The phone has the history in its menu; desktops and tablets have the clock beside the favourites.
        const where = `${t("header.settings")} › ${t("settings.tab.archive")}`;
        paragraphs.push(
          [
            t(context.device === "phone" ? "info.help.place.history.menu" : "info.help.place.history.button"),
            context.archiveDays === "unlimited"
              ? t("info.help.place.history.unlimited", { where })
              : t("info.help.place.history.days", { count: context.archiveDays, where }),
          ].join(" "),
        );
      }
      return { paragraphs };
    }
    case "chains": {
      const { weather, cloud } = context.chains;
      const intro = weather && cloud ? "info.help.chains.both" : weather ? "info.help.chains.weather" : "info.help.chains.cloud";
      return {
        paragraphs: [
          [
            t(intro),
            t("info.help.chains.move"),
            t(touch(context.device) ? "info.help.chains.reset.tap" : "info.help.chains.reset.click"),
          ].join(" "),
        ],
      };
    }
    case "days":
      return {
        paragraphs: [
          [t("info.help.days.text"), t(touch(context.device) ? "info.help.days.touch" : "info.help.days.desktop")].join(" "),
        ],
      };
    case "meteogram":
      return {
        paragraphs: [t("info.help.meteogram.text")],
        items: [t("info.help.meteogram.temperature"), t("info.help.meteogram.precipitation"), t("info.help.meteogram.wind")],
      };
    case "fullscreen": {
      const open: Record<DeviceClass, MessageKey> = {
        desktop: "info.help.fullscreen.desktop",
        tablet: "info.help.fullscreen.tablet",
        phone: "info.help.fullscreen.phone",
      };
      return {
        paragraphs: [
          [t(open[context.device]), t(touch(context.device) ? "info.help.fullscreen.finger" : "info.help.fullscreen.mouse")].join(" "),
        ],
      };
    }
  }
}

/** The Help tab for `context`. */
export function HelpSections({ context }: { context: HelpContext }) {
  const t = useT();
  return (
    <div className="help">
      {helpSections(context).map((section) => {
        const text = helpText(section, context, t);
        return (
          <section key={section} className="help__section" data-help-section={section}>
            <h3 className="help__title">{t(HELP_TITLES[section])}</h3>
            <HelpPicture section={section} context={context} />
            {text.paragraphs.map((paragraph, index) => (
              <p key={index} className="help__text">
                {paragraph}
              </p>
            ))}
            {text.items ? (
              <ol className="help__list">
                {text.items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** The Help tab for this page; `context` overrides what the page tells (tests). */
export function HelpPanel({ context }: { context?: Partial<HelpContext> }) {
  const device = useDeviceClass();
  const installed = useAppMode() === "installed";
  const chains = useChainCardsVisible();
  const daySlider = useDaySlider().enabled;
  const archiveDays = useArchiveDays();
  return <HelpSections context={{ device, installed, chains, daySlider, archiveDays, ...context }} />;
}
