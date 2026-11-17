// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Whether the page is used with the keyboard, for the focus hint of the close buttons (REQ-762, REQ-776): `<html>` has
 * `data-keyboard` after a key and loses it on a pointer or a touch. The browser's `:focus-visible` alone is not enough:
 * Safari on an iPad matches it when a view opened by a tap focuses its X, and browsers match it when a dialog opened
 * by a click focuses its X; the X then shows a blue frame. The shared rule in global.css (`.close-button`) shows a ring
 * only where both hold. Kept from the page's start, so the X focused by a dialog opened with a key shows it at once.
 */
export const KEYBOARD_ATTRIBUTE = "data-keyboard";

/** Keys pressed alone that are no keyboard use, as for the browser's own `:focus-visible`. */
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "CapsLock"]);

/** Whether a key press counts as using the page with the keyboard (no shortcut with a modifier, no modifier alone). */
export function isKeyboardUse(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !MODIFIER_KEYS.has(event.key);
}

let stop: (() => void) | null = null;

/**
 * Follows the last input on the page's root element from now on; a second call starts anew. Returns the function
 * that stops it and takes the attribute away.
 */
export function initKeyboardInput(doc: Document = document): () => void {
  stop?.();
  const root = doc.documentElement;
  const set = (keyboard: boolean) => {
    if (root.hasAttribute(KEYBOARD_ATTRIBUTE) !== keyboard) root.toggleAttribute(KEYBOARD_ATTRIBUTE, keyboard);
  };
  const onKey = (event: KeyboardEvent) => {
    if (isKeyboardUse(event)) set(true);
  };
  const onPointer = () => set(false);
  const POINTER_EVENTS = ["pointerdown", "mousedown", "touchstart"] as const;
  doc.addEventListener("keydown", onKey, true);
  for (const type of POINTER_EVENTS) doc.addEventListener(type, onPointer, { capture: true, passive: true });
  let stopped = false;
  const current = () => {
    if (stopped) return;
    stopped = true;
    doc.removeEventListener("keydown", onKey, true);
    for (const type of POINTER_EVENTS) doc.removeEventListener(type, onPointer, { capture: true });
    root.removeAttribute(KEYBOARD_ATTRIBUTE);
    if (stop === current) stop = null;
  };
  stop = current;
  return current;
}
