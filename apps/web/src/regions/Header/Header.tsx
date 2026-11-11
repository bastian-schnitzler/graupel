// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { LanguageSelect } from "../../components/LanguageSelect.tsx";
import { useConfig } from "../../config/index.ts";
import { useInfoDialog, useSettingsDialog } from "../../dialogs/index.ts";
import { useT } from "../../i18n/index.ts";
import { ChevronDownIcon, DownloadIcon, GlobeIcon, InfoIcon, SettingsIcon } from "../../icons/index.ts";
import "./Header.css";

export interface HeaderProps {
  /** Show the highlighted download button (website only, see `HeaderContainer`). Hidden by default. */
  showDownload?: boolean;
  /** Called by the download button (e.g. the install prompt). */
  onDownload?: () => void;
}

/**
 * Header bar (REQ-434): language picker, settings and info popups, and the download button. Settings, info and
 * download show only their icon, named for screen readers and in a tooltip (REQ-455, REQ-501); the download button
 * sits right of info in the same row and stays highlighted. The popups need the `DialogsProvider` around
 * the page. The globe sits inside the language field on the left, the field is as high as the buttons (REQ-526); on
 * phones the globe stands right above the GPS button of the search field.
 */
export function Header({ showDownload = false, onDownload }: HeaderProps) {
  const t = useT();
  const settings = useSettingsDialog();
  const info = useInfoDialog();
  const { languages } = useConfig();
  return (
    <header className="region header" data-region="header" aria-labelledby="region-header-title">
      <h2 className="visually-hidden" id="region-header-title">
        {t("region.header.title")}
      </h2>
      <div className="header__bar">
        {languages.length > 1 && (
          <label className="header__language">
            <span className="visually-hidden">{t("header.language")}</span>
            <LanguageSelect className="field header__select" />
            <GlobeIcon className="icon header__globe" />
            <ChevronDownIcon className="icon header__chevron" />
          </label>
        )}
        <button
          type="button"
          className="header__button header__button--icon"
          aria-haspopup="dialog"
          title={t("header.settings")}
          onClick={settings.open}
        >
          <SettingsIcon />
          <span className="visually-hidden">{t("header.settings")}</span>
        </button>
        <button
          type="button"
          className="header__button header__button--icon"
          aria-haspopup="dialog"
          title={t("header.info")}
          onClick={() => info.open()}
        >
          <InfoIcon />
          <span className="visually-hidden">{t("header.info")}</span>
        </button>
        {showDownload && (
          <button
            type="button"
            className="header__button header__button--icon header__button--download"
            title={t("header.download")}
            onClick={onDownload}
          >
            <DownloadIcon />
            <span className="visually-hidden">{t("header.download")}</span>
          </button>
        )}
      </div>
    </header>
  );
}
