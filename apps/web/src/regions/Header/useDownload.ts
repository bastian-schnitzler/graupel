// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from "react";
import {
  appModeStore,
  installPromptStore,
  useAppMode,
  useHideInstallButton,
  useInstallAvailability,
  type AppModeStore,
  type InstallPromptStore,
} from "../../state/index.ts";

export interface DownloadAction {
  /**
   * Whether to offer the download: on the website only, never in the installed app (REQ-425), and not when the
   * settings hide the install button (REQ-809).
   */
  shown: boolean;
  /** Opens the install dialog: why to install (REQ-806), then the browser's prompt (Chromium) or the instructions. */
  start: () => void;
  /** Whether the install dialog is open. */
  instructions: boolean;
  closeInstructions: () => void;
  /** Set while the dialog was opened with the browser's own prompt: closes the dialog and shows the prompt. */
  install?: () => void;
}

/**
 * The download button's behaviour (REQ-425), shared by the header and, on a phone, the footer's menu (REQ-575).
 * Hidden after `appinstalled`, in Chromium while no prompt is offered and when the settings hide it (REQ-809); the open
 * dialog closes then too.
 */
export function useDownload(
  appMode: AppModeStore = appModeStore,
  installPrompt: InstallPromptStore = installPromptStore,
): DownloadAction {
  const mode = useAppMode(appMode);
  const availability = useInstallAvailability(installPrompt);
  const hidden = useHideInstallButton();
  const [open, setOpen] = useState<"prompt" | "manual" | null>(null);
  const shown = mode === "website" && availability !== "none" && !hidden;
  // Installed or the prompt gone while the dialog is open: it closes (state adjusted while rendering).
  if (open !== null && !shown) setOpen(null);
  return {
    shown,
    start: () => setOpen(availability === "prompt" ? "prompt" : "manual"),
    instructions: open !== null && shown,
    closeInstructions: () => setOpen(null),
    ...(open === "prompt"
      ? {
          install() {
            setOpen(null);
            void installPrompt.install();
          },
        }
      : {}),
  };
}
