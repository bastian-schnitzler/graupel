// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useId, useState } from "react";
import { useConfig } from "../config/index.ts";
import { useT } from "../i18n/index.ts";
import { useAppMode } from "../state/index.ts";
import { Dialog } from "./Dialog.tsx";
import {
  SETTINGS_TAB_IDS,
  SETTINGS_TABS,
  shownSettingsTabs,
  type SettingsSection,
  type SettingsTab,
  type SettingsTabId,
} from "./settings/sections.tsx";
import { TransferButtons, TransferMessages, useSettingsTransfer } from "./settings/TransferSettings.tsx";
import { TabBar, tabId, tabPanelId } from "./TabBar.tsx";
import "./SettingsDialog.css";

function Section({ section }: { section: SettingsSection }) {
  const t = useT();
  const titleId = useId();
  const { Component } = section;
  return (
    <section className="settings__section" aria-labelledby={titleId} data-settings={section.id}>
      <h3 className="settings__title" id={titleId}>
        {t(section.title)}
      </h3>
      <Component titleId={titleId} />
    </section>
  );
}

export interface SettingsDialogProps {
  onClose: () => void;
  /** Selected tab; without it the popup keeps its own, starting with the first. */
  tab?: SettingsTabId;
  /** Called when another tab is selected. */
  onSelectTab?: (tab: SettingsTabId) => void;
  /** Tabs to show; defaults to `SETTINGS_TABS`. */
  tabs?: readonly SettingsTab[];
}

/**
 * Settings popup (REQ-434): export and import as icon buttons in the heading row (REQ-469), below it a tab bar
 * (REQ-686: WAI-ARIA tabs, arrow keys, Home and End switch; it scrolls sideways when the tabs do not fit, e.g. on a
 * phone), then the messages of export and import, the sections of the selected tab and a note on where the settings
 * are kept. The tab Archive is only shown in the installed app; a selected tab that is not shown falls back to the
 * first. The popup keeps one height for all tabs, so it does not jump when the tab changes.
 */
export function SettingsDialog({ onClose, tab, onSelectTab, tabs = SETTINGS_TABS }: SettingsDialogProps) {
  const t = useT();
  const config = useConfig();
  const appMode = useAppMode();
  const baseId = useId();
  const transfer = useSettingsTransfer();
  const [ownTab, setOwnTab] = useState<SettingsTabId>(SETTINGS_TAB_IDS[0]);
  const shown = shownSettingsTabs({ config, appMode }, tabs);
  const ids = shown.map(({ tab: { id } }) => id);
  const requested = tab ?? ownTab;
  const selected = ids.includes(requested) ? requested : (ids[0] ?? requested);
  const select = (next: SettingsTabId) => {
    setOwnTab(next);
    onSelectTab?.(next);
  };
  return (
    <Dialog
      title={t("settings.title")}
      onClose={onClose}
      className="settings-dialog dialog--tall"
      tools={<TransferButtons transfer={transfer} />}
      subheader={
        <TabBar
          tabs={ids}
          selected={selected}
          onSelect={select}
          label={t("settings.tabs")}
          baseId={baseId}
          renderLabel={(id) => t(shown.find(({ tab: { id: other } }) => other === id)!.tab.label)}
          className="settings-tabs"
        />
      }
    >
      <TransferMessages status={transfer.status} />
      {shown.map(({ tab: { id }, sections }) => (
        <div
          key={id}
          role="tabpanel"
          id={tabPanelId(baseId, id)}
          className="tabs__panel settings"
          aria-labelledby={tabId(baseId, id)}
          hidden={id !== selected}
          data-panel={id}
        >
          {sections.map((section) => (
            <Section key={section.id} section={section} />
          ))}
        </div>
      ))}
      <p className="settings__note">{t("settings.note")}</p>
    </Dialog>
  );
}
