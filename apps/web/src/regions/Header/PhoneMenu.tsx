// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LanguageSelect } from "../../components/LanguageSelect.tsx";
import { useConfig } from "../../config/index.ts";
import { InstallDialog, infoTabLabel, useInfoDialog, useSettingsDialog } from "../../dialogs/index.ts";
import { useI18n } from "../../i18n/index.ts";
import {
  ChevronDownIcon,
  ClockIcon,
  DownloadIcon,
  GlobeIcon,
  InfoIcon,
  MenuIcon,
  SettingsIcon,
} from "../../icons/index.ts";
import { useHistory, type AppModeStore, type InstallPromptStore } from "../../state/index.ts";
import { HistoryDialog } from "../History/HistoryDialog.tsx";
import { formatFetchDay } from "../History/format.ts";
import { useDownload } from "./useDownload.ts";
import "./PhoneMenu.css";

export interface PhoneMenuProps {
  /** Display mode source (tests); defaults to the page's window. */
  appMode?: AppModeStore;
  /** Install prompt source (tests); defaults to the page's window. */
  installPrompt?: InstallPromptStore;
}

/**
 * The phone's menu (REQ-575, REQ-580, REQ-582): a phone has no header bar, so its button stands at the end of the place
 * row, after the favourites. It opens a panel below it with, from the top, the language picker (only with more than one
 * language), "install app" in the accent colour on the website while the installation is offered (REQ-425), settings,
 * a divider and info, imprint and privacy, which open the info popup at their tab (the phone's footer has no links).
 * In the installed app, once the place has an earlier fetch, "History" stands before settings and opens the history's
 * dialog (REQ-684); it names the day of the fetch shown, the current values' as well as an archived one's (REQ-726).
 * Its clock is gold with the current values while they are at most 20 minutes old (REQ-757), checked again on opening.
 * A choice closes it, as do a second tap on the button, a tap beside it and Escape. Opening and closing leave the page
 * where it is (REQ-574): the panel floats over the page and takes no focus.
 */
export function PhoneMenu({ appMode, installPrompt }: PhoneMenuProps) {
  const { t, locale } = useI18n();
  const settings = useSettingsDialog();
  const history = useHistory();
  const [historyOpen, setHistoryOpen] = useState(false);
  // In the installed app, once the place has an earlier fetch (REQ-684).
  const historyShown = history.available && (history.fetches.length > 0 || history.shown !== null);
  // The fetch shown: the archived one or the current values (REQ-726).
  const historyAt = history.shown ? history.shown.fetchedAt : history.currentFetchedAt;
  const info = useInfoDialog();
  const { languages, legal } = useConfig();
  const download = useDownload(appMode, installPrompt);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus({ preventScroll: true });
    };
    // Captured: the chart handles its own pointers and may keep them from reaching the document.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const item = (icon: ReactNode, label: string, action: () => void, options: { haspopup?: "dialog"; className?: string } = {}) => (
    <button
      type="button"
      className={options.className ? `phone-menu__item ${options.className}` : "phone-menu__item"}
      aria-haspopup={options.haspopup}
      onClick={() => {
        setOpen(false);
        action();
      }}
    >
      {/* Without an icon an empty one keeps the label in line with the others. */}
      {icon ?? <span className="icon phone-menu__no-icon" aria-hidden="true" />}
      {label}
    </button>
  );

  return (
    <div className="phone-menu" ref={root} data-testid="phone-menu">
      <button
        ref={button}
        type="button"
        className="button button--icon phone-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("menu.label")}
        title={t("menu.label")}
        onClick={() => {
          // Opening checks again whether the current values are still current (REQ-757).
          if (!open) history.checkCurrent();
          setOpen(!open);
        }}
      >
        <MenuIcon />
      </button>
      <div className="phone-menu__panel" id={panelId} hidden={!open} data-testid="phone-menu-panel">
        {languages.length > 1 && (
          <label className="phone-menu__language">
            <span className="visually-hidden">{t("header.language")}</span>
            <LanguageSelect className="field phone-menu__select" onSelect={() => setOpen(false)} />
            <GlobeIcon className="icon phone-menu__globe" />
            <ChevronDownIcon className="icon phone-menu__chevron" />
          </label>
        )}
        {download.shown &&
          item(<DownloadIcon />, t("menu.install"), download.start, { className: "phone-menu__item--install" })}
        {historyShown &&
          item(
            <ClockIcon />,
            historyAt !== null ? `${t("history.title")} · ${formatFetchDay(historyAt, locale)}` : t("history.title"),
            () => {
              history.checkCurrent();
              setHistoryOpen(true);
            },
            {
              haspopup: "dialog",
              ...(history.shown === null && history.currentLive
                ? { className: "phone-menu__item--history-current" }
                : {}),
            },
          )}
        {item(<SettingsIcon />, t("header.settings"), settings.open, { haspopup: "dialog" })}
        <hr className="phone-menu__divider" />
        {item(<InfoIcon />, t("footer.info"), () => info.open("about"), { haspopup: "dialog" })}
        {item(null, infoTabLabel("imprint", legal.imprint, t), () => info.open("imprint"), { haspopup: "dialog" })}
        {item(null, t("footer.privacy"), () => info.open("privacy"), { haspopup: "dialog" })}
      </div>
      {download.instructions && <InstallDialog onClose={download.closeInstructions} />}
      {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
