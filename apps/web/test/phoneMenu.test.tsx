// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The phone's menu (REQ-575, REQ-580, REQ-582): a phone has no header bar and no line with elevation and coordinates
 * (REQ-573); language, installation, settings, info, imprint and privacy sit in a menu at the end of the place row,
 * after the favourites, and the place row has no card around it. The phone's footer keeps only the picture buttons.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { Footer } from "../src/regions/Footer/index.ts";
import { PhoneMenu } from "../src/regions/Header/index.ts";
import {
  PHONE_QUERY,
  createAppModeStore,
  createInstallPromptStore,
  type AppModeWindow,
  type BeforeInstallPromptEvent,
} from "../src/state/index.ts";

let phone = true;
// The installed app: its display mode matches (the page's own app mode store reads window.matchMedia).
let installed = false;
const original = window.matchMedia;

beforeEach(() => {
  phone = true;
  installed = false;
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: (query === PHONE_QUERY && phone) || (query === "(display-mode: standalone)" && installed),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = original;
  window.localStorage.clear();
});

/** A display that is the website (`standalone: false`) or the installed app. */
const display = (installed: boolean) =>
  createAppModeStore({
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: installed } as AppModeWindow["navigator"],
  });

/** A window stand-in that may or may not know `beforeinstallprompt` (Chromium vs. Safari/Firefox). */
function installWindow(supportsPrompt: boolean) {
  const target = new EventTarget() as EventTarget & { onbeforeinstallprompt?: null };
  if (supportsPrompt) target.onbeforeinstallprompt = null;
  return target as unknown as Window;
}

function setup({
  config = DEFAULT_CONFIG,
  installed = true,
  win = installWindow(false),
}: { config?: GraupelConfig; installed?: boolean; win?: Window } = {}) {
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={config.languages} fallbackLanguage={config.defaultLanguage} browserLanguages={["en"]}>
        <DialogsProvider>
          <PhoneMenu appMode={display(installed)} installPrompt={createInstallPromptStore(win)} />
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const menuButton = () => screen.getByRole("button", { name: "Menu" });
const panel = () => screen.getByTestId("phone-menu-panel");
/** The panel's entries from the top: the language field, the buttons and the divider. */
const entries = () =>
  [...panel().children].map((child) =>
    child.tagName === "HR" ? "—" : child.tagName === "LABEL" ? "Language" : child.textContent,
  );
const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

describe("phone menu (REQ-575, REQ-580, REQ-582)", () => {
  it("opens with language, settings, a divider, info, imprint and privacy; no installation in the installed app", () => {
    setup();
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);
    fireEvent.click(menuButton());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(menuButton().getAttribute("aria-controls")).toBe(panel().id);
    expect(panel().hidden).toBe(false);
    expect(within(panel()).getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(entries()).toEqual(["Language", "Settings", "—", "Info", "Legal notice", "Privacy"]);
    expect(within(panel()).getByRole("separator")).toBeTruthy();
    // A second tap closes it.
    fireEvent.click(menuButton());
    expect(panel().hidden).toBe(true);
  });

  it("opens the settings and the info popup at the info, imprint and privacy tabs, closing itself", () => {
    setup();
    fireEvent.click(menuButton());
    fireEvent.click(within(panel()).getByRole("button", { name: "Settings" }));
    expect(panel().hidden).toBe(true);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    for (const [entry, tab] of [
      ["Info", "About"],
      ["Legal notice", "Legal notice"],
      ["Privacy", "Privacy policy"],
    ]) {
      fireEvent.click(menuButton());
      fireEvent.click(within(panel()).getByRole("button", { name: entry }));
      expect(panel().hidden).toBe(true);
      expect(selectedTab()).toBe(tab);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("switches the language and closes", () => {
    setup();
    fireEvent.click(menuButton());
    fireEvent.change(within(panel()).getByRole("combobox", { name: "Language" }), { target: { value: "de" } });
    expect(panel().hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));
    expect(entries()).toEqual(["Language", "Einstellungen", "—", "Info", "Impressum", "Datenschutz"]);
  });

  it("closes on Escape, giving the focus back to its button, and on a tap beside it", () => {
    setup();
    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(menuButton());
    fireEvent.click(menuButton());
    fireEvent.pointerDown(within(panel()).getByRole("button", { name: "Info" }));
    expect(panel().hidden).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(panel().hidden).toBe(true);
  });

  it("has no language picker when the domain offers one language", () => {
    setup({ config: { ...DEFAULT_CONFIG, languages: ["de"], defaultLanguage: "de" } });
    fireEvent.click(screen.getByRole("button", { name: "Menü" }));
    expect(within(panel()).queryByRole("combobox")).toBeNull();
    expect(entries()).toEqual(["Einstellungen", "—", "Info", "Impressum", "Datenschutz"]);
  });

  it("offers the installation on the website below the language, highlighted: instructions without prompt (REQ-425)", () => {
    setup({ installed: false });
    fireEvent.click(menuButton());
    expect(entries()).toEqual(["Language", "Install app", "Settings", "—", "Info", "Legal notice", "Privacy"]);
    const install = within(panel()).getByRole("button", { name: "Install app" });
    expect(install.classList.contains("phone-menu__item--install")).toBe(true);
    fireEvent.click(install);
    expect(panel().hidden).toBe(true);
    expect(screen.getByRole("dialog", { name: "Install Graupel as an app" })).toBeTruthy();
  });

  it("offers the installation on the website with the browser's prompt once Chromium offers it", () => {
    const win = installWindow(true);
    setup({ installed: false, win });
    fireEvent.click(menuButton());
    expect(within(panel()).queryByRole("button", { name: "Install app" })).toBeNull();
    const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
    let prompted = 0;
    Object.assign(event, {
      prompt: async () => void prompted++,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    act(() => void win.dispatchEvent(event));
    fireEvent.click(within(panel()).getByRole("button", { name: "Install app" }));
    expect(prompted).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 " +
  "Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

function renderFooter() {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={DEFAULT_CONFIG.languages} fallbackLanguage="en" browserLanguages={["en"]}>
        <DialogsProvider>
          <Footer />
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

describe("footer (REQ-582)", () => {
  it("holds on a phone only the slot of the picture buttons, without links and menu", () => {
    renderFooter();
    const footer = screen.getByRole("contentinfo");
    const row = footer.querySelector(".footer__row")!;
    expect(row.classList.contains("footer__row--phone")).toBe(true);
    // Closer to the chart than the footer on wider screens (REQ-577).
    expect(footer.classList.contains("footer--phone")).toBe(true);
    expect([...row.children].map((child) => child.className)).toEqual(["footer__start"]);
    expect(within(footer).queryAllByRole("button")).toEqual([]);
  });

  it("leaves room for Safari's bottom bar in Safari on the iPhone only (REQ-581, REQ-611)", () => {
    const agent = vi.spyOn(navigator, "userAgent", "get");
    const room = () => screen.getByRole("contentinfo").classList.contains("footer--safari");
    agent.mockReturnValue(IPHONE_SAFARI);
    renderFooter();
    expect(room()).toBe(true);
    // Another browser on the iPhone or on Android: no bar over the page, no room.
    for (const other of [IPHONE_CHROME, ANDROID_CHROME]) {
      cleanup();
      agent.mockReturnValue(other);
      renderFooter();
      expect(room()).toBe(false);
    }
    // The installed app from Safari has no bar either.
    cleanup();
    agent.mockReturnValue(IPHONE_SAFARI);
    installed = true;
    renderFooter();
    expect(room()).toBe(false);
  });

  it("keeps its links on wider screens", () => {
    phone = false;
    renderFooter();
    const footer = screen.getByRole("contentinfo");
    const row = footer.querySelector(".footer__row")!;
    expect([...row.children].map((child) => child.className)).toEqual(["footer__start", "footer__nav"]);
    expect(footer.classList.contains("footer--phone")).toBe(false);
    expect(footer.classList.contains("footer--safari")).toBe(false);
    expect(within(footer).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Info",
      "Legal notice",
      "Privacy",
    ]);
  });
});

describe("page on a phone (REQ-573, REQ-580)", () => {
  it("has no header bar, no card around the place row and the menu after the favourites", () => {
    const { container } = render(<App />);
    expect(container.querySelector('[data-region="header"]')).toBeNull();
    expect(container.querySelector(".app__header")).toBeNull();
    expect(container.querySelector(".app__top")!.classList.contains("app__top--bare")).toBe(true);
    expect(screen.queryByTestId("location-elevation")).toBeNull();
    expect(screen.queryByTestId("location-coordinates")).toBeNull();
    const bar = container.querySelector('[data-region="location"] .location__bar')!;
    const last = [...bar.children].slice(-2).map((child) => child.className);
    expect(last).toEqual(["split-button location__favorites", "phone-menu"]);
    expect(within(bar as HTMLElement).getByRole("button", { name: "Menu" })).toBeTruthy();
  });

  it("keeps header bar, card, elevation and coordinates on wider screens, without the menu", () => {
    phone = false;
    const { container } = render(<App />);
    expect(container.querySelector('[data-region="header"]')).toBeTruthy();
    expect(container.querySelector(".app__top")!.classList.contains("app__top--bare")).toBe(false);
    expect(screen.getByTestId("location-elevation")).toBeTruthy();
    expect(screen.getByTestId("location-coordinates")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  });
});
