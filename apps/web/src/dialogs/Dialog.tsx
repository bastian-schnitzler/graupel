// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useT } from "../i18n/index.ts";
import { CloseIcon } from "../icons/index.ts";
import { useNoticeHostElement } from "../state/notices.ts";
import { lockPageScroll } from "../state/scrollLock.ts";
import "./Dialog.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isRadio = (element: Element): element is HTMLInputElement =>
  element instanceof HTMLInputElement && element.type === "radio" && element.name !== "";

/**
 * Focusable elements inside a container, in tab order, without those in hidden parts (e.g. inactive tab panels). A
 * group of radio buttons counts once, as Tab reaches it: by its checked button, or its first without one (e.g. the
 * dew point option at the end of the settings, REQ-593).
 */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
  return items.filter((element) => {
    if (!isRadio(element)) return true;
    const group = items.filter((other) => isRadio(other) && other.name === element.name && other.form === element.form);
    return element === (group.find((radio) => (radio as HTMLInputElement).checked) ?? group[0]);
  });
}

export interface DialogProps {
  /** Heading of the dialog, also its accessible name. */
  title: ReactNode;
  /** Called on the close button, Escape and a click on the backdrop. */
  onClose: () => void;
  /** Element focused when the dialog opens; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  /**
   * Without the heading row (REQ-460): no title bar and no divider, the close button sits in a column at the side
   * above `tools`. The title is then only the accessible name (`aria-label`), so it must be a string.
   */
  bare?: boolean;
  /**
   * Further controls: under the close button of a bare dialog, otherwise in the heading row between the title and
   * the close button (REQ-469).
   */
  tools?: ReactNode;
  /**
   * Whether a bare dialog shows its close button (default); without it and without `tools` it has no side column and
   * closes on Escape or from outside (the phone's full-screen meteogram, REQ-537).
   */
  closeButton?: boolean;
  /**
   * Shown below the heading row, outside the scrolling body, so it stays in place while the body scrolls (the tab bar
   * of the settings, REQ-686). Not in a bare dialog.
   */
  subheader?: ReactNode;
  /** Test id of the `<dialog>` element. */
  testId?: string;
  /**
   * Whether the system's close request leaves the dialog open: Android's back button (`cancel`) does not close it, and
   * if the browser closes it anyway, it opens again (the phone's full-screen meteogram, REQ-716). Escape on a keyboard
   * still closes it.
   */
  holdOpen?: boolean;
  children?: ReactNode;
}

/**
 * Modal popup on the native `<dialog>` (`showModal`: the page behind is inert). Rendered while open; keeps
 * Tab inside the dialog, closes on Escape, close button and backdrop, and gives the focus back to the element
 * that had it before (e.g. the button that opened it). While it is open the page behind does not scroll (REQ-730).
 */
export function Dialog({
  title,
  onClose,
  initialFocus,
  className,
  bare = false,
  tools,
  closeButton = true,
  subheader,
  testId,
  holdOpen = false,
  children,
}: DialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const pressedOnBackdrop = useRef(false);
  const holdOpenRef = useRef(holdOpen);
  useEffect(() => {
    holdOpenRef.current = holdOpen;
  }, [holdOpen]);
  // Error cards render inside the open dialog, since the page behind it is inert (REQ-492).
  useNoticeHostElement(ref);
  // The page behind stays where it is while the dialog is open, also on a swipe over the dialog (REQ-730).
  useEffect(() => lockPageScroll(), []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // A close request the page may not refuse (Android's back button without a touch before it) closes the dialog
    // natively: opened again while it is held (REQ-716).
    const onNativeClose = () => {
      if (holdOpenRef.current && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    };
    dialog.addEventListener("close", onNativeClose);
    // The page's full screen, asked for while the dialog is open (the phone's full-screen meteogram, REQ-717), puts the
    // page above it in the top layer: shown again, the dialog comes back on top.
    const onFullscreenChange = () => {
      const element = document.fullscreenElement;
      if (!element || !dialog.open || dialog.contains(element) || typeof dialog.showModal !== "function") return;
      dialog.close();
      dialog.showModal();
      (closeRef.current ?? focusableElements(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    // The close button gets the focus, also in a bare dialog (content first) and before tools in the heading row.
    (initialFocus?.current ?? closeRef.current ?? focusableElements(dialog)[0] ?? dialog).focus();
    return () => {
      dialog.removeEventListener("close", onNativeClose);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      if (previous?.isConnected) previous.focus();
    };
  }, [initialFocus, bare]);

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    // A dialog opened from inside another one (REQ-514) keeps Tab to itself.
    event.stopPropagation();
    const items = focusableElements(event.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  // The dialog box fills the <dialog> element, so a press and release on the element itself is on the backdrop.
  function handleMouseDown(event: MouseEvent<HTMLDialogElement>) {
    pressedOnBackdrop.current = event.target === event.currentTarget;
  }
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
    pressedOnBackdrop.current = false;
  }

  return (
    <dialog
      ref={ref}
      className={className ? `dialog ${className}` : "dialog"}
      data-testid={testId}
      {...(bare ? { "aria-label": typeof title === "string" ? title : undefined } : { "aria-labelledby": titleId })}
      onCancel={(event) => {
        event.preventDefault();
        // Android's back button comes as `cancel` (REQ-716); Escape is handled on its key above.
        if (!holdOpen) onClose();
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {bare ? (
        <div className="dialog__box dialog__box--bare">
          <div className="dialog__body">{children}</div>
          {(closeButton || tools != null) && (
            <div className="dialog__tools">
              {closeButton && (
                <button
                  ref={closeRef}
                  type="button"
                  className="icon-button dialog__close"
                  aria-label={t("dialog.close")}
                  title={t("dialog.close")}
                  onClick={onClose}
                >
                  <CloseIcon />
                </button>
              )}
              {tools}
            </div>
          )}
        </div>
      ) : (
        <div className="dialog__box">
          <div className="dialog__header">
            <h2 className="dialog__title" id={titleId}>
              {title}
            </h2>
            {tools ? <div className="dialog__header-tools">{tools}</div> : null}
            <button
              ref={closeRef}
              type="button"
              className="icon-button dialog__close"
              aria-label={t("dialog.close")}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          {subheader}
          <div className="dialog__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
