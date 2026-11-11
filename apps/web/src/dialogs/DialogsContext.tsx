// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { InfoDialog, type InfoPanels } from "./InfoDialog.tsx";
import { INFO_TABS, type InfoTab } from "./infoTabs.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { SETTINGS_TAB_IDS, type SettingsTabId } from "./settings/sections.tsx";

type OpenDialog = { kind: "settings" } | { kind: "info"; tab: InfoTab } | null;

export interface InfoDialogControl {
  /** Whether the info popup is open. */
  isOpen: boolean;
  /** Selected tab (also while closed: the tab shown on the next `open()` without argument). */
  tab: InfoTab;
  /** Opens the info popup at a tab (default: the last selected one); switches the tab if it is already open. */
  open: (tab?: InfoTab) => void;
  close: () => void;
  selectTab: (tab: InfoTab) => void;
}

export interface SettingsDialogControl {
  isOpen: boolean;
  /** Selected tab (REQ-686), kept while the popup is closed: it opens again at the tab shown last. */
  tab: SettingsTabId;
  /** Opens the settings popup at the tab selected last. */
  open: () => void;
  close: () => void;
  selectTab: (tab: SettingsTabId) => void;
}

interface DialogsContextValue {
  info: InfoDialogControl;
  settings: SettingsDialogControl;
}

const noop = () => {};

// Without a provider (a region rendered alone) the controls do nothing.
const DialogsContext = createContext<DialogsContextValue>({
  info: { isOpen: false, tab: INFO_TABS[0], open: noop, close: noop, selectTab: noop },
  settings: { isOpen: false, tab: SETTINGS_TAB_IDS[0], open: noop, close: noop, selectTab: noop },
});

export interface DialogsProviderProps {
  /** Contents of the info tabs; a tab left out shows its default panel (see `dialogs/info/`). */
  infoPanels?: InfoPanels;
  children?: ReactNode;
}

/**
 * Holds the popups of the page (settings and info, REQ-434) and renders the open one. At most one popup is
 * open; opening one closes the other. Components open them with `useInfoDialog()` and `useSettingsDialog()`.
 */
export function DialogsProvider({ infoPanels, children }: DialogsProviderProps) {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const [infoTab, setInfoTab] = useState<InfoTab>(INFO_TABS[0]);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(SETTINGS_TAB_IDS[0]);

  const close = useCallback(() => setOpenDialog(null), []);
  const openInfo = useCallback(
    (tab?: InfoTab) => {
      const next = tab ?? infoTab;
      setInfoTab(next);
      setOpenDialog({ kind: "info", tab: next });
    },
    [infoTab],
  );
  const selectTab = useCallback((tab: InfoTab) => {
    setInfoTab(tab);
    setOpenDialog((current) => (current?.kind === "info" ? { kind: "info", tab } : current));
  }, []);
  const openSettings = useCallback(() => setOpenDialog({ kind: "settings" }), []);

  const value = useMemo<DialogsContextValue>(
    () => ({
      info: { isOpen: openDialog?.kind === "info", tab: infoTab, open: openInfo, close, selectTab },
      settings: {
        isOpen: openDialog?.kind === "settings",
        tab: settingsTab,
        open: openSettings,
        close,
        selectTab: setSettingsTab,
      },
    }),
    [openDialog, infoTab, openInfo, close, selectTab, openSettings, settingsTab],
  );

  return (
    <DialogsContext.Provider value={value}>
      {children}
      {openDialog?.kind === "settings" && (
        <SettingsDialog tab={settingsTab} onSelectTab={setSettingsTab} onClose={close} />
      )}
      {openDialog?.kind === "info" && (
        <InfoDialog tab={openDialog.tab} onSelectTab={selectTab} onClose={close} panels={infoPanels} />
      )}
    </DialogsContext.Provider>
  );
}

/** Opens and closes the info popup, e.g. `useInfoDialog().open("imprint")` for a footer link. */
export function useInfoDialog(): InfoDialogControl {
  return useContext(DialogsContext).info;
}

/** Opens and closes the settings popup. */
export function useSettingsDialog(): SettingsDialogControl {
  return useContext(DialogsContext).settings;
}
