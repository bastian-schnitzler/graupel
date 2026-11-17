// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useT } from "../i18n/index.ts";
import { installGuide, type InstallGuide } from "../state/index.ts";
import { Dialog } from "./Dialog.tsx";
import { InstallPicture } from "./install/InstallPicture.tsx";
import "./InstallDialog.css";

export interface InstallDialogProps {
  onClose: () => void;
  /** Steps or hint shown; defaults to those of this browser. Not shown with `onInstall`. */
  guide?: InstallGuide;
  /**
   * The browser offered its own install prompt (Chromium): instead of the steps the dialog has a button that shows
   * it. The dialog closes before the prompt opens.
   */
  onInstall?: () => void;
}

const DEVICE_NAMES = { iphone: "iPhone", ipad: "iPad", mac: "Mac" } as const;

/**
 * Why install (REQ-806): the history kept on the device, and the page without the browser's address and navigation bars
 * (wording of REQ-852). Since REQ-843 without the heading "Why install?": the dialog starts with the list itself.
 */
function InstallReasons() {
  const t = useT();
  return (
    <ul className="install-why" data-testid="install-why">
      <li>{t("install.why.history")}</li>
      <li>{t("install.why.display")}</li>
    </ul>
  );
}

/**
 * The install dialog (REQ-425). It starts with why to install (REQ-806), a list without heading (REQ-843). With the
 * browser's own install prompt (Chromium) a button then shows that prompt. Browsers without one (Safari, Firefox) get the
 * numbered steps of exactly this device and browser in this version, each with a picture and a line of text (REQ-775). A browser that cannot
 * install at all gets the hint without pictures, naming only what works on this device (REQ-658).
 */
export function InstallDialog({ onClose, guide, onInstall }: InstallDialogProps) {
  const t = useT();
  return (
    <Dialog title={t("install.title")} onClose={onClose} className="install-dialog">
      <InstallReasons />
      {onInstall ? (
        <div className="install-dialog__actions" data-prompt="">
          <button type="button" className="install-dialog__install" onClick={onInstall}>
            {t("install.start")}
          </button>
        </div>
      ) : (
        <InstallGuideView guide={guide ?? installGuide(navigator)} />
      )}
    </Dialog>
  );
}

/** The steps with pictures or the hint without (REQ-775, REQ-658). */
function InstallGuideView({ guide }: { guide: InstallGuide }) {
  const t = useT();
  if (guide.kind === "hint") return <p data-platform={guide.hint}>{t(`install.${guide.hint}`)}</p>;
  return (
    <div data-guide={guide.guide}>
      <p className="install-dialog__lead">
        {guide.device === "android"
          ? t("install.lead.android", { browser: guide.browser })
          : t("install.lead.apple", { browser: guide.browser, device: DEVICE_NAMES[guide.device] })}
      </p>
      <ol className="install-steps" data-count={guide.steps.length}>
        {guide.steps.map((picture, index) => (
          <li key={picture} className="install-step">
            <InstallPicture picture={picture} device={guide.device} />
            <span className="install-step__number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="install-step__text">{t(`install.step.${picture}`)}</span>
          </li>
        ))}
      </ol>
      {guide.note && <p className="install-dialog__note">{t(`install.note.${guide.note}`)}</p>}
    </div>
  );
}
