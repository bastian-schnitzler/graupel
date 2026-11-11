// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useId, useRef, type ReactNode } from "react";
import { useConfig } from "../config/index.ts";
import { useT } from "../i18n/index.ts";
import { Dialog } from "./Dialog.tsx";
import { AboutPanel } from "./info/AboutPanel.tsx";
import { ImprintPanel } from "./info/ImprintPanel.tsx";
import { PrivacyPanel } from "./info/PrivacyPanel.tsx";
import { INFO_TABS, infoTabLabel, type InfoTab } from "./infoTabs.ts";
import { TabBar, tabId, tabPanelId } from "./TabBar.tsx";
import "./InfoDialog.css";

/** Contents of the info tabs; a tab left out shows its default panel. */
export type InfoPanels = Partial<Record<InfoTab, ReactNode>>;

const DEFAULT_PANELS: Readonly<Record<InfoTab, () => ReactNode>> = {
  about: () => <AboutPanel />,
  imprint: () => <ImprintPanel />,
  privacy: () => <PrivacyPanel />,
};

export interface InfoDialogProps {
  tab: InfoTab;
  onSelectTab: (tab: InfoTab) => void;
  onClose: () => void;
  panels?: InfoPanels;
}

/**
 * Info popup with the tabs About, Imprint and Privacy (WAI-ARIA tabs: arrow keys, Home and End move between
 * the tabs and select them; Tab moves into the panel).
 */
export function InfoDialog({ tab, onSelectTab, onClose, panels }: InfoDialogProps) {
  const t = useT();
  const config = useConfig();
  const baseId = useId();
  const selectedTabRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Dialog title={t("info.title")} onClose={onClose} initialFocus={selectedTabRef} className="info-dialog">
      <TabBar
        tabs={INFO_TABS}
        selected={tab}
        onSelect={onSelectTab}
        label={t("info.tabs")}
        baseId={baseId}
        renderLabel={(id) => infoTabLabel(id, config.legal.imprint, t)}
        selectedRef={selectedTabRef}
      />
      {INFO_TABS.map((id) => (
        <div
          key={id}
          role="tabpanel"
          id={tabPanelId(baseId, id)}
          className="tabs__panel"
          aria-labelledby={tabId(baseId, id)}
          tabIndex={0}
          hidden={id !== tab}
          data-panel={id}
        >
          {panels?.[id] ?? DEFAULT_PANELS[id]()}
        </div>
      ))}
    </Dialog>
  );
}
