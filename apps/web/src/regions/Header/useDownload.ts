// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from "react";
import {
  appModeStore,
  installPromptStore,
  useAppMode,
  useInstallAvailability,
  type AppModeStore,
  type InstallPromptStore,
} from "../../state/index.ts";

export interface DownloadAction {
  /** Whether to offer the download: on the website only, never in the installed app (REQ-425). */
  shown: boolean;
  /** Opens the install prompt (Chromium) or, in browsers without one (Safari, Firefox), the install instructions. */
  start: () => void;
  /** Whether the install instructions are open. */
  instructions: boolean;
  closeInstructions: () => void;
}

/**
 * The download button's behaviour (REQ-425), shared by the header and, on a phone, the footer's menu (REQ-575).
 * Hidden after `appinstalled` and in Chromium while no prompt is offered.
 */
export function useDownload(
  appMode: AppModeStore = appModeStore,
  installPrompt: InstallPromptStore = installPromptStore,
): DownloadAction {
  const mode = useAppMode(appMode);
  const availability = useInstallAvailability(installPrompt);
  const [instructions, setInstructions] = useState(false);
  return {
    shown: mode === "website" && availability !== "none",
    start() {
      if (availability === "prompt") void installPrompt.install();
      else setInstructions(true);
    },
    instructions,
    closeInstructions: () => setInstructions(false),
  };
}
