// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
export { Dialog, focusableElements, type DialogProps } from "./Dialog.tsx";
export {
  DialogsProvider,
  useInfoDialog,
  useSettingsDialog,
  type DialogsProviderProps,
  type InfoDialogControl,
  type SettingsDialogControl,
} from "./DialogsContext.tsx";
export { InfoDialog, type InfoDialogProps, type InfoPanels } from "./InfoDialog.tsx";
export { INFO_TABS, INFO_TAB_LABELS, infoTabLabel, isInfoTab, type InfoTab } from "./infoTabs.ts";
export { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog.tsx";
export {
  SETTINGS_TABS,
  SETTINGS_TAB_IDS,
  isSettingsTabId,
  shownSettingsTabs,
  type SettingsEnvironment,
  type SettingsSection,
  type SettingsSectionProps,
  type SettingsTab,
  type SettingsTabId,
  type ShownSettingsTab,
} from "./settings/sections.tsx";
export { TabBar, tabId, tabKeyTarget, tabPanelId, type TabBarProps } from "./TabBar.tsx";
export { InstallDialog, type InstallDialogProps } from "./InstallDialog.tsx";
