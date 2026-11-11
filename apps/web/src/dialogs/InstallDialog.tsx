// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useT } from "../i18n/index.ts";
import { installPlatform, type InstallPlatform } from "../state/index.ts";
import { Dialog } from "./Dialog.tsx";

export interface InstallDialogProps {
  onClose: () => void;
  /** Platform whose steps are shown; defaults to the one of this browser. */
  platform?: InstallPlatform;
}

/**
 * Install instructions (REQ-425) for browsers without an install prompt (Safari, Firefox): the steps of the
 * browser's own menu for the detected platform, naming only what works on this device (REQ-658).
 */
export function InstallDialog({ onClose, platform = installPlatform(navigator) }: InstallDialogProps) {
  const t = useT();
  return (
    <Dialog title={t("install.title")} onClose={onClose} className="install-dialog">
      <p data-platform={platform}>{t(`install.${platform}`)}</p>
    </Dialog>
  );
}
