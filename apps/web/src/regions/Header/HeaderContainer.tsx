// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { InstallDialog } from "../../dialogs/index.ts";
import type { AppModeStore, InstallPromptStore } from "../../state/index.ts";
import { Header } from "./Header.tsx";
import { useDownload } from "./useDownload.ts";

export interface HeaderContainerProps {
  /** Display mode source (tests); defaults to the page's window. */
  appMode?: AppModeStore;
  /** Install prompt source (tests); defaults to the page's window. */
  installPrompt?: InstallPromptStore;
}

/**
 * Header of the page with the download button wired up (REQ-425): shown only on the website, never in the
 * installed app. It opens the install dialog, which starts with why to install (REQ-806): with an install prompt
 * (Chromium) its button shows the prompt; in browsers without one (Safari, Firefox) it shows install
 * instructions. Hidden after `appinstalled`, in Chromium while no prompt is offered and when the settings hide it
 * (REQ-809).
 */
export function HeaderContainer({ appMode, installPrompt }: HeaderContainerProps) {
  const download = useDownload(appMode, installPrompt);
  return (
    <>
      <Header showDownload={download.shown} onDownload={download.start} />
      {download.instructions && <InstallDialog onClose={download.closeInstructions} onInstall={download.install} />}
    </>
  );
}
