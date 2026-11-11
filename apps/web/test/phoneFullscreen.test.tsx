// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's full-screen meteogram and the system around it: the browser's own full screen without its bars, where it
 * has the API (REQ-717, DEC-089); the history entry that keeps the view open on the back button and the Dialog that
 * holds Android's close request (REQ-716); the double tap (REQ-715).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../src/dialogs/Dialog.tsx";
import { I18nProvider } from "../src/i18n/index.ts";
import {
  DOUBLE_TAP_DISTANCE,
  DOUBLE_TAP_MS,
  FULLSCREEN_HISTORY_KEY,
  enterSystemFullscreen,
  exitSystemFullscreen,
  isDoubleTap,
  useBackButtonHold,
} from "../src/regions/MeteogramPanel/phoneFullscreen.ts";

/** Fullscreen API stand-in on the page: `requestFullscreen` on the root element, `exitFullscreen` on the document. */
function fakeFullscreenApi(result: () => Promise<void> | undefined = () => Promise.resolve()) {
  const root = document.documentElement;
  let current: Element | null = null;
  const request = vi.fn((options?: FullscreenOptions) => {
    void options;
    current = root;
    return result();
  });
  const exit = vi.fn(() => {
    current = null;
    return Promise.resolve();
  });
  Object.defineProperty(root, "requestFullscreen", { value: request, configurable: true });
  Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
  return {
    request,
    exit,
    set(element: Element | null) {
      current = element;
    },
    restore() {
      Reflect.deleteProperty(root, "requestFullscreen");
      Reflect.deleteProperty(document, "exitFullscreen");
      Reflect.deleteProperty(document, "fullscreenElement");
    },
  };
}

/** `navigator.userActivation` stand-in; `restore` takes it away again (jsdom has none). */
function fakeUserActivation(isActive: boolean) {
  Object.defineProperty(navigator, "userActivation", { value: { isActive }, configurable: true });
  return () => Reflect.deleteProperty(navigator, "userActivation");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("browser's full screen on a phone (REQ-717)", () => {
  let api: ReturnType<typeof fakeFullscreenApi> | null = null;
  afterEach(() => {
    api?.restore();
    api = null;
  });

  it("asks for the page's full screen with the navigation bar hidden where the browser has the API", () => {
    api = fakeFullscreenApi();
    enterSystemFullscreen();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(api.request.mock.contexts[0]).toBe(document.documentElement);
    expect(document.fullscreenElement).toBe(document.documentElement);
    // Already on the whole screen: not asked again.
    enterSystemFullscreen();
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("does nothing and throws nothing without the API (iOS Safari)", () => {
    expect(typeof document.documentElement.requestFullscreen).not.toBe("function");
    expect(() => enterSystemFullscreen()).not.toThrow();
    expect(() => exitSystemFullscreen()).not.toThrow();
  });

  it("stays quiet when the browser refuses, at once or later", async () => {
    const rejection = vi.fn();
    window.addEventListener("unhandledrejection", rejection);
    try {
      api = fakeFullscreenApi(() => Promise.reject(new TypeError("Permissions check failed")));
      expect(() => enterSystemFullscreen()).not.toThrow();
      api.restore();
      api = fakeFullscreenApi(() => {
        throw new TypeError("not allowed");
      });
      api.set(null);
      expect(() => enterSystemFullscreen()).not.toThrow();
      api.restore();
      // An older engine returns nothing.
      api = fakeFullscreenApi(() => undefined);
      expect(() => enterSystemFullscreen()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejection).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", rejection);
    }
  });

  it("does not ask without a touch the browser would accept", () => {
    api = fakeFullscreenApi();
    const restore = fakeUserActivation(false);
    try {
      enterSystemFullscreen();
      expect(api.request).not.toHaveBeenCalled();
    } finally {
      restore();
    }
    const again = fakeUserActivation(true);
    try {
      enterSystemFullscreen();
      expect(api.request).toHaveBeenCalledWith({ navigationUI: "hide" });
    } finally {
      again();
    }
  });

  it("leaves the full screen only when the page holds it", () => {
    api = fakeFullscreenApi();
    exitSystemFullscreen();
    expect(api.exit).not.toHaveBeenCalled();
    // Another element on the whole screen (a video) is left alone.
    api.set(document.body);
    exitSystemFullscreen();
    expect(api.exit).not.toHaveBeenCalled();
    api.set(document.documentElement);
    exitSystemFullscreen();
    expect(api.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
  });
});

function Hold({ enabled }: { enabled: boolean }) {
  useBackButtonHold(enabled);
  return null;
}

const ownEntry = () => (window.history.state as Record<string, unknown> | null)?.[FULLSCREEN_HISTORY_KEY] === true;

describe("back button in the phone's view (REQ-716)", () => {
  beforeEach(() => {
    window.history.replaceState({ page: "start" }, "");
  });

  it("adds a history entry on opening, adds it again when going back from it, and takes it away on closing", () => {
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const { rerender, unmount } = render(<Hold enabled />);
    expect(push).toHaveBeenCalledTimes(1);
    // The entry keeps what the page had in its state.
    expect(window.history.state).toEqual({ page: "start", [FULLSCREEN_HISTORY_KEY]: true });

    // Back: the browser is on the entry below, the view adds its entry again.
    window.history.replaceState({ page: "start" }, "");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { page: "start" } }));
    });
    expect(push).toHaveBeenCalledTimes(2);
    expect(ownEntry()).toBe(true);
    // A popstate onto the own entry (forward) adds nothing.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state as unknown }));
    });
    expect(push).toHaveBeenCalledTimes(2);

    rerender(<Hold enabled />);
    expect(push).toHaveBeenCalledTimes(2);
    unmount();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does nothing while off (the desktop's view)", () => {
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back");
    const { unmount } = render(<Hold enabled={false} />);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    unmount();
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("does not go back on closing when the own entry is no longer the current one", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const { unmount } = render(<Hold enabled />);
    window.history.replaceState({ page: "other" }, "");
    unmount();
    expect(back).not.toHaveBeenCalled();
  });
});

function renderDialog(holdOpen: boolean, onClose = vi.fn()) {
  render(
    <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
      <Dialog title="View" onClose={onClose} bare closeButton={false} holdOpen={holdOpen}>
        <p>Chart</p>
      </Dialog>
    </I18nProvider>,
  );
  return { onClose, dialog: screen.getByRole("dialog", { name: "View", hidden: true }) as HTMLDialogElement };
}

describe("dialog held open (REQ-716)", () => {
  it("does not close on the system's close request (Android's back button), but on Escape", () => {
    const { onClose, dialog } = renderDialog(true);
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens again when the browser closes it anyway", () => {
    const { dialog } = renderDialog(true);
    const showModal = vi.fn(() => dialog.setAttribute("open", ""));
    Object.defineProperty(dialog, "showModal", { value: showModal, configurable: true });
    dialog.removeAttribute("open");
    fireEvent(dialog, new Event("close"));
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("comes back on top when the page takes the full screen while it is open (REQ-717)", () => {
    const { dialog } = renderDialog(true);
    const close = vi.fn(() => dialog.removeAttribute("open"));
    const showModal = vi.fn(() => dialog.setAttribute("open", ""));
    Object.defineProperty(dialog, "close", { value: close, configurable: true });
    Object.defineProperty(dialog, "showModal", { value: showModal, configurable: true });
    let current: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
    try {
      // Left: nothing to do.
      fireEvent(document, new Event("fullscreenchange"));
      expect(showModal).not.toHaveBeenCalled();
      current = document.documentElement;
      fireEvent(document, new Event("fullscreenchange"));
      expect(close).toHaveBeenCalledTimes(1);
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(dialog.hasAttribute("open")).toBe(true);
      // An element inside the dialog on the full screen stays where it is.
      current = dialog.querySelector("p");
      fireEvent(document, new Event("fullscreenchange"));
      expect(showModal).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
  });

  it("closes on the close request as before when not held", () => {
    const { onClose, dialog } = renderDialog(false);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("double tap (REQ-715)", () => {
  const tap = (x: number, y: number, time: number) => ({ x, y, time });

  it("is a second tap soon after the first and close to it", () => {
    expect(isDoubleTap(tap(100, 100, 1000), tap(104, 98, 1000 + DOUBLE_TAP_MS))).toBe(true);
    expect(isDoubleTap(tap(100, 100, 1000), tap(100 + DOUBLE_TAP_DISTANCE, 100, 1100))).toBe(true);
  });

  it("is no double tap without a first tap, later, farther or out of order", () => {
    expect(isDoubleTap(null, tap(100, 100, 1000))).toBe(false);
    expect(isDoubleTap(tap(100, 100, 1000), tap(100, 100, 1001 + DOUBLE_TAP_MS))).toBe(false);
    expect(isDoubleTap(tap(100, 100, 1000), tap(100 + DOUBLE_TAP_DISTANCE + 1, 100, 1100))).toBe(false);
    expect(isDoubleTap(tap(100, 100, 1000), tap(100, 100, 900))).toBe(false);
  });
});
