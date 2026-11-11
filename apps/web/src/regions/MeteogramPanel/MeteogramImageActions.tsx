// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import type { MeteogramController, MeteogramInput } from "@graupel/meteogram";
import { meteogramToPng } from "@graupel/meteogram/png";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useT, type MessageKey } from "../../i18n/index.ts";
import { CopyIcon, SaveImageIcon, ShareIcon } from "../../icons/index.ts";
import { useModelHeaders } from "../../state/displaySettings.ts";
import { keepingPlaceName } from "../../state/location.tsx";
import { useNotices } from "../../state/notices.ts";
import {
  TOUCH_QUERY,
  canCopyImage,
  canShareFiles,
  copyImage,
  imageFileName,
  keepScrollPosition,
  saveImage,
  withChartLabelRow,
} from "./imageActions.ts";
import { IMAGE_MARGIN_PX, pictureBackground, pictureScale, withImageMargin } from "./imageMargin.ts";
import { imageRenderOptions } from "./layout.ts";
import { useMeteogramToggles } from "./useMeteogramToggles.ts";

/** How long the feedback stays visible. */
export const FEEDBACK_MS = 2500;

function touchQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(TOUCH_QUERY);
}

function subscribeTouch(onChange: () => void): () => void {
  const query = touchQuery();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** Whether the device is operated by touch (phone, tablet). */
function useTouchDevice(): boolean {
  return useSyncExternalStore(subscribeTouch, () => touchQuery()?.matches ?? false, () => false);
}

/**
 * Time zone of the chart (the input's, else the place's, else UTC), in which its footer writes the time of the data:
 * the picture's file name takes the date from there (REQ-683).
 */
function chartTimeZone(input: MeteogramInput): string {
  let timeZone = input.timezone;
  if (!timeZone || timeZone === "auto") timeZone = input.location?.timezone;
  return !timeZone || timeZone === "auto" ? "UTC" : timeZone;
}

/**
 * File name of the picture (REQ-683, REQ-766): `YYMMDD_<place>.png` with the date the forecast was fetched (now
 * where the input has no time) and the name the chart gives the place.
 */
function fileNameOf(input: MeteogramInput): string {
  const fetched = input.generatedAt ? new Date(input.generatedAt) : new Date();
  return imageFileName(input.location?.name, Number.isNaN(fetched.getTime()) ? new Date() : fetched, chartTimeZone(input));
}

/** Success feedback next to the buttons; failures are error cards (REQ-492). */
interface Feedback {
  key: MessageKey;
}

export interface MeteogramImageActionsProps {
  /** The chart whose picture is copied or saved. */
  meteogram: RefObject<MeteogramController | null>;
  /** The chart's input: place and time of the data name the saved or shared file (REQ-683). */
  input: MeteogramInput;
  /**
   * `card`: in the column to the right of the chart (REQ-507); `footer`: in a row at the start of the page footer, on a
   * phone (REQ-541); `fullscreen`: in the side column of the full-screen view.
   */
  placement: "card" | "footer" | "fullscreen";
  /** More buttons of the group after copy and save: the tablet's full-screen button in the footer (REQ-728). */
  children?: ReactNode;
}

/**
 * Buttons to copy the meteogram as a picture and to save it (REQ-461): on touch devices to the photos through the share
 * sheet, on other devices as a PNG file (REQ-597); with short feedback in a live region; a failure shows an error card
 * (REQ-492). The picture is the core's PNG export of the chart the buttons belong to, with the model headers exactly
 * when the chart on screen shows them (REQ-539, DEC-094: the own choice in the settings, else `modelHeaders` of
 * config.json; `imageModelHeaders` has no effect for now); its wind arrows stand as densely as on a wide screen
 * (REQ-538, the core's default), and the dew point (REQ-593), the relative humidity (REQ-650) and whether the
 * precipitation and wind axes follow the visible range (REQ-656) as chosen in the settings. Copying and saving leave
 * the page where it is (REQ-574). Where a touch device can share files, the save button shows the share symbol and
 * shares the PNG (REQ-680); the file is named after the date of the data and the place (REQ-683). Above and below,
 * the picture has a band in its background colour, so the model headers and the footer row do not stand at its edge
 * (REQ-714).
 */
export function MeteogramImageActions({ meteogram, input, placement, children }: MeteogramImageActionsProps) {
  const t = useT();
  // The picture follows the model headers on screen (REQ-539, DEC-094).
  const modelHeaders = useModelHeaders();
  // The layout's switches as chosen in the settings, as on screen (REQ-661).
  const toggles = useMeteogramToggles();
  const touch = useTouchDevice();
  const [copySupported] = useState(() => typeof window !== "undefined" && canCopyImage());
  const [shareSupported] = useState(() => typeof window !== "undefined" && canShareFiles());
  // On a phone (a touch device) the picture is shared where the browser can share files (REQ-680).
  const sharing = touch && shareSupported;
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const { notify, dismiss } = useNotices();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function show(next: Feedback | null) {
    clearTimeout(timer.current);
    setFeedback(next);
    dismiss("meteogram.image");
    if (next) timer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }

  function fail(message: MessageKey) {
    show(null);
    notify({ id: "meteogram.image", message });
  }

  function png(): Promise<Blob> {
    const controller = meteogram.current;
    if (!controller) return Promise.reject(new Error("Meteogram not mounted"));
    // The page stays where it is, also when scrolled to the footer (REQ-574). The image keeps the chart's own label row,
    // which a phone in portrait hides below the chart (REQ-616).
    const render = imageRenderOptions(modelHeaders, toggles);
    // The picture and its band above and below take the same background colour and scale (REQ-714).
    const background = pictureBackground(controller.element);
    const scale = pictureScale();
    const picture = keepScrollPosition(() =>
      withChartLabelRow(controller.element, () => meteogramToPng(controller, { render, background, scale })),
    );
    return picture.then((blob) => withImageMargin(blob, { background, margin: IMAGE_MARGIN_PX * scale }));
  }

  function copy() {
    copyImage(png()).then(
      () => show({ key: "meteogram.image.copied" }),
      () => fail("meteogram.image.copyFailed"),
    );
  }

  function save() {
    // The share sheet or save dialog may hide the page; back from it, "My location" stays (REQ-765).
    keepingPlaceName(() => saveImage(png(), fileNameOf(input), { touch })).then(
      (outcome) => {
        if (outcome === "cancelled") show(null);
        else show({ key: outcome === "shared" ? "meteogram.image.shared" : "meteogram.image.saved" });
      },
      () => fail(sharing ? "meteogram.image.shareFailed" : "meteogram.image.saveFailed"),
    );
  }

  return (
    <div className={`meteogram-actions meteogram-actions--${placement}`} data-export-skip="">
      {copySupported && (
        <button
          type="button"
          className="icon-button meteogram-actions__button"
          aria-label={t("meteogram.image.copy")}
          title={t("meteogram.image.copy")}
          onClick={copy}
          data-testid="meteogram-copy"
        >
          <CopyIcon />
        </button>
      )}
      <button
        type="button"
        className="icon-button meteogram-actions__button"
        aria-label={t(sharing ? "meteogram.image.share" : "meteogram.image.save")}
        title={t(sharing ? "meteogram.image.share" : "meteogram.image.save")}
        onClick={save}
        data-testid="meteogram-save"
        data-action={sharing ? "share" : "save"}
      >
        {sharing ? <ShareIcon /> : <SaveImageIcon />}
      </button>
      {children}
      <span
        className={feedback ? "meteogram-actions__feedback is-ok" : "meteogram-actions__feedback"}
        role="status"
        data-testid="meteogram-image-feedback"
      >
        {feedback ? t(feedback.key) : ""}
      </span>
    </div>
  );
}
