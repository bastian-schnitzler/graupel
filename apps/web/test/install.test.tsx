// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, LANGUAGES, storeLanguage, translate } from "../src/i18n/index.ts";
import { App } from "../src/App.tsx";
import { HeaderContainer } from "../src/regions/Header/index.ts";
import {
  createAppModeStore,
  createInstallPromptStore,
  detectAppMode,
  installPlatform,
  useAppMode,
  type AppModeWindow,
  type BeforeInstallPromptEvent,
  type InstallPromptStore,
} from "../src/state/index.ts";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** A matchMedia stand-in whose display mode can be switched; fires `change` on the affected queries. */
function fakeDisplay(initial: string | null = null, standalone?: boolean) {
  let mode = initial;
  const lists: { query: string; listeners: Set<() => void> }[] = [];
  const win: AppModeWindow = {
    matchMedia: (query: string) => {
      const entry = { query, listeners: new Set<() => void>() };
      lists.push(entry);
      return {
        media: query,
        get matches() {
          return mode !== null && query === `(display-mode: ${mode})`;
        },
        addEventListener: (_type: string, listener: () => void) => entry.listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => entry.listeners.delete(listener),
      } as unknown as MediaQueryList;
    },
    navigator: { standalone } as AppModeWindow["navigator"],
  };
  return {
    win,
    lists,
    setMode(next: string | null) {
      mode = next;
      for (const entry of lists) for (const listener of entry.listeners) listener();
    },
  };
}

/** A window stand-in that may or may not know `beforeinstallprompt` (Chromium vs. Safari/Firefox). */
function fakeInstallWindow(supportsPrompt: boolean) {
  const target = new EventTarget() as EventTarget & { onbeforeinstallprompt?: null };
  if (supportsPrompt) target.onbeforeinstallprompt = null;
  return target as unknown as Window;
}

function promptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome, platform: "web" }) });
  return { event, prompt };
}

describe("app mode", () => {
  it("is website in a browser tab and installed in standalone or window-controls-overlay", () => {
    expect(detectAppMode(fakeDisplay().win)).toBe("website");
    expect(detectAppMode(fakeDisplay("browser").win)).toBe("website");
    expect(detectAppMode(fakeDisplay("fullscreen").win)).toBe("website");
    expect(detectAppMode(fakeDisplay("standalone").win)).toBe("installed");
    expect(detectAppMode(fakeDisplay("window-controls-overlay").win)).toBe("installed");
  });

  it("recognises a home-screen app on iOS and a window without matchMedia", () => {
    expect(detectAppMode(fakeDisplay(null, true).win)).toBe("installed");
    expect(detectAppMode(fakeDisplay(null, false).win)).toBe("website");
    expect(detectAppMode({ navigator: {} } as unknown as AppModeWindow)).toBe("website");
  });

  it("useAppMode follows display-mode changes and unsubscribes", () => {
    const display = fakeDisplay();
    const store = createAppModeStore(display.win);
    function Probe() {
      return <p>{useAppMode(store)}</p>;
    }
    const { unmount } = render(<Probe />);
    expect(screen.getByText("website")).toBeTruthy();
    act(() => display.setMode("standalone"));
    expect(screen.getByText("installed")).toBeTruthy();
    act(() => display.setMode(null));
    expect(screen.getByText("website")).toBeTruthy();
    unmount();
    expect(display.lists.every((entry) => entry.listeners.size === 0)).toBe(true);
  });
});

describe("install prompt", () => {
  it("keeps the prompt event, shows it once and hides after appinstalled", async () => {
    const win = fakeInstallWindow(true);
    const store = createInstallPromptStore(win);
    expect(store.getSnapshot()).toBe("none");
    const { event, prompt } = promptEvent();
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getSnapshot()).toBe("prompt");
    await expect(store.install()).resolves.toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBe("none");
    await expect(store.install()).resolves.toBe("unavailable");

    win.dispatchEvent(promptEvent().event);
    win.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot()).toBe("none");
    store.dispose();
  });

  it("offers manual instructions in browsers without install prompt", () => {
    const win = fakeInstallWindow(false);
    const store = createInstallPromptStore(win);
    expect(store.getSnapshot()).toBe("manual");
    win.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot()).toBe("none");
  });

  // REQ-658: the hint names only what works on this device and browser.
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1", 5, "ios"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1", 5, "ios"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0.2592.56 Version/17.0 Mobile/15E148 Safari/604.1", 5, "ios"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15", 5, "ios"],
    ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", 0, "macos"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0", 0, "macosOther"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", 0, "macosOther"],
    ["Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0", 5, "android"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", 5, "android"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0", 0, "desktop"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", 0, "desktop"],
    ["Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", 0, "desktop"],
  ])("platform of %s (%i touch points) is %s", (userAgent, maxTouchPoints, platform) => {
    expect(installPlatform({ userAgent, maxTouchPoints })).toBe(platform);
  });

  it.each(LANGUAGES)("names no other device in %s (REQ-658)", (language) => {
    // Windows, Linux and ChromeOS: Chrome and Edge only; a Mac: Safari, Chrome or Edge, but no iPhone or iPad.
    const desktop = translate(language, "install.desktop");
    expect(desktop).toMatch(/Chrom.*Edg/);
    expect(desktop).not.toMatch(/iPhone|iPad|Mac|Safari/);
    const mac = translate(language, "install.macosOther");
    expect(mac).toMatch(/Safari/);
    expect(mac).toMatch(/Chrom.*Edg/);
    expect(mac).not.toMatch(/iPhone|iPad|Windows|Android/);
  });
});

function renderHeader(display: ReturnType<typeof fakeDisplay>, installPrompt: InstallPromptStore) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={DEFAULT_CONFIG.languages} fallbackLanguage="en" browserLanguages={["en"]}>
        <DialogsProvider>
          <HeaderContainer appMode={createAppModeStore(display.win)} installPrompt={installPrompt} />
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const download = () => screen.queryByRole("button", { name: "Download" });

describe("download button", () => {
  it("opens the install prompt on the website and disappears after installing", async () => {
    const win = fakeInstallWindow(true);
    const store = createInstallPromptStore(win);
    renderHeader(fakeDisplay(), store);
    expect(download()).toBeNull();
    const { event, prompt } = promptEvent();
    act(() => void win.dispatchEvent(event));
    fireEvent.click(download()!);
    expect(prompt).toHaveBeenCalledOnce();
    expect(download()).toBeNull();
    // Dismissed: Chromium offers the prompt again.
    act(() => void win.dispatchEvent(promptEvent().event));
    expect(download()).toBeTruthy();
    act(() => void win.dispatchEvent(new Event("appinstalled")));
    expect(download()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is hidden in the installed app, also with a prompt, and follows the display mode", () => {
    const win = fakeInstallWindow(true);
    const store = createInstallPromptStore(win);
    const display = fakeDisplay("standalone");
    renderHeader(display, store);
    act(() => void win.dispatchEvent(promptEvent().event));
    expect(download()).toBeNull();
    act(() => display.setMode(null));
    expect(download()).toBeTruthy();
    act(() => display.setMode("standalone"));
    expect(download()).toBeNull();
  });

  it("is hidden in an iOS home-screen app", () => {
    renderHeader(fakeDisplay(null, true), createInstallPromptStore(fakeInstallWindow(false)));
    expect(download()).toBeNull();
  });

  it("opens install instructions in browsers without install prompt", () => {
    renderHeader(fakeDisplay(), createInstallPromptStore(fakeInstallWindow(false)));
    const button = download()!;
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Install Graupel as an app" });
    // jsdom's user agent is a Linux one: the desktop hint (REQ-658).
    expect(dialog.querySelector("[data-platform]")?.textContent).toBe(translate("en", "install.desktop"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

describe("install texts", () => {
  it.each(LANGUAGES)("the instructions popup is translated in %s", (language) => {
    // jsdom has no install prompt: the page shows the instructions.
    storeLanguage(language);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: translate(language, "header.download") }));
    expect(screen.getByRole("dialog", { name: translate(language, "install.title") })).toBeTruthy();
    for (const platform of ["ios", "android", "macos", "macosOther", "desktop"] as const) {
      expect(translate(language, `install.${platform}`)).not.toBe(
        language === "en" ? "" : translate("en", `install.${platform}`),
      );
    }
  });
});
