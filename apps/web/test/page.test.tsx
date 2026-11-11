// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { usePageTheme } from "../src/state/pageTheme.ts";
import { Footer } from "../src/regions/Footer/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import {
  COLOR_MODE_STORAGE_KEY,
  applyColorMode,
  initColorMode,
  isColorMode,
  readStoredColorMode,
  setColorMode,
  useColorMode,
} from "../src/state/index.ts";

const html = document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  initColorMode();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  initColorMode();
});

describe("colour mode", () => {
  it("defaults to the system without a stored choice", () => {
    expect(readStoredColorMode()).toBe("system");
    expect(html.dataset.theme).toBeUndefined();
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "purple");
    expect(readStoredColorMode()).toBe("system");
  });

  it("recognises the three modes", () => {
    expect(["system", "light", "dark"].every(isColorMode)).toBe(true);
    expect([null, "auto", 1].some(isColorMode)).toBe(false);
  });

  it("forces light or dark with data-theme and follows the system without it", () => {
    applyColorMode("dark");
    expect(html.dataset.theme).toBe("dark");
    applyColorMode("light");
    expect(html.dataset.theme).toBe("light");
    applyColorMode("system");
    expect(html.dataset.theme).toBeUndefined();
  });

  it("stores the choice, forgets it for the system and applies the stored one at start", () => {
    setColorMode("dark");
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    setColorMode("system");
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "light");
    initColorMode();
    expect(html.dataset.theme).toBe("light");
  });

  it("updates hooks and the meteogram theme on a change, also from another tab", () => {
    const { result } = renderHook(() => ({ mode: useColorMode()[0], theme: usePageTheme() }));
    expect(result.current.mode).toBe("system");
    act(() => setColorMode("dark"));
    expect(result.current).toEqual({ mode: "dark", theme: "dark" });

    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "light");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: COLOR_MODE_STORAGE_KEY }));
    });
    expect(result.current.mode).toBe("light");
    expect(html.dataset.theme).toBe("light");
  });

  it("is chosen in the settings popup", () => {
    render(
      <I18nProvider browserLanguages={["de"]}>
        <DialogsProvider>
          <Header />
        </DialogsProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }));
    const group = within(screen.getByRole("dialog")).getByRole("radiogroup", { name: "Farbmodus" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual(["System", "Hell", "Dunkel"]);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(group).getByRole("radio", { name: "Dunkel" }));
    expect(html.dataset.theme).toBe("dark");
    expect((within(group).getByRole("radio", { name: "Dunkel" }) as HTMLInputElement).checked).toBe(true);
    expect(readStoredColorMode()).toBe("dark");

    fireEvent.click(within(group).getByRole("radio", { name: "System" }));
    expect(html.dataset.theme).toBeUndefined();
    expect(readStoredColorMode()).toBe("system");
  });
});

describe("footer", () => {
  function renderFooter(config: GraupelConfig = DEFAULT_CONFIG, language = "en") {
    render(
      <ConfigProvider config={config}>
        <I18nProvider browserLanguages={[language]}>
          <DialogsProvider>
            <Footer />
          </DialogsProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    return screen.getByRole("navigation", { name: language === "de" ? "Informationen" : "Information" });
  }

  it("links Info, imprint and data information, each opening its tab of the info popup", () => {
    const nav = renderFooter();
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Info",
      "Legal notice",
      "Privacy",
    ]);
    for (const [link, tab] of [
      ["Info", "About"],
      ["Legal notice", "Legal notice"],
      // REQ-484: the footer keeps the short link, the popup tab names the full privacy policy.
      ["Privacy", "Privacy policy"],
    ]) {
      fireEvent.click(within(nav).getByRole("button", { name: link }));
      const popup = screen.getByRole("dialog", { name: "Information" });
      expect(within(popup).getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
      fireEvent.click(within(popup).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("uses the domain's imprint label and the active language", () => {
    const config: GraupelConfig = {
      ...DEFAULT_CONFIG,
      legal: { ...DEFAULT_CONFIG.legal, imprint: { ...DEFAULT_CONFIG.legal.imprint, label: "Mentions légales" } },
    };
    const nav = renderFooter(config, "de");
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Info",
      "Mentions légales",
      "Datenschutz",
    ]);
  });

  it("is the page's contentinfo landmark", () => {
    render(<App />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("navigation", { name: "Information" })).toBeTruthy();
    expect(footer.textContent).not.toMatch(/follow/);
  });
});
