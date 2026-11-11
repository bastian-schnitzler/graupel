// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Scroll lock of the page behind an open dialog (REQ-730): while a dialog is open (settings, model info, info,
 * history, …) the page behind does not scroll, neither by a swipe over the dialog or its edge nor by the wheel. The
 * root element gets a class (`overflow: hidden`, no overscroll; Dialog.css). Dialogs opened from inside another one
 * share the lock: it ends when the last of them closes.
 */

/** Class on the root element while a dialog is open. */
export const DIALOG_OPEN_CLASS = "dialog-open";
/** Class added with it when the page showed a scroll bar: its room is kept, so the page behind does not move sideways. */
export const DIALOG_GUTTER_CLASS = "dialog-open--gutter";

let locks = 0;

/** Whether the page's scrolling is locked right now. */
export function isPageScrollLocked(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(DIALOG_OPEN_CLASS);
}

/** Locks the page's scrolling; the returned function releases this lock (once, further calls do nothing). */
export function lockPageScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  if (locks === 0) {
    const scrollbar = window.innerWidth - root.clientWidth;
    root.classList.add(DIALOG_OPEN_CLASS);
    if (scrollbar > 0) root.classList.add(DIALOG_GUTTER_CLASS);
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) root.classList.remove(DIALOG_OPEN_CLASS, DIALOG_GUTTER_CLASS);
  };
}
