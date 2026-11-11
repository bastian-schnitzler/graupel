// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * jsdom has no `showModal`/`close` on <dialog>: a small stand-in that toggles the `open` attribute and fires
 * `close`. Escape, inertness and focus handling are not emulated; the Dialog component handles them itself.
 */
const proto = globalThis.HTMLDialogElement?.prototype;
if (proto && typeof proto.showModal !== "function") {
  proto.showModal = function showModal(this: HTMLDialogElement) {
    if (this.hasAttribute("open")) throw new DOMException("Dialog is already open", "InvalidStateError");
    this.setAttribute("open", "");
  };
  proto.show = function show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

/**
 * No network in the tests: a request nobody mocked (e.g. the forecast of a page rendered whole) stays pending until it
 * is aborted. Tests that need answers stub `fetch` themselves or pass their own.
 */
globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  })) as typeof fetch;
