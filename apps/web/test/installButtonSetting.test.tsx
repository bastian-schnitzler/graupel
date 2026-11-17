// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-809: the tab Design of the settings offers, on the website only, to hide the install button: Yes hides the
 * button in the header (desktop, tablet) and the entry in the phone's menu, No (the default) shows them. The choice is
 * stored like the other settings; export and import are tested in settingsFile.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, type MessageKey } from "../src/i18n/index.ts";
import { HeaderContainer, PhoneMenu } from "../src/regions/Header/index.ts";
import {
  DEFAULT_HIDE_INSTALL_BUTTON,
  HIDE_INSTALL_BUTTON_STORAGE_KEY,
  INSTALLED_DISPLAY_MODES,
  createAppModeStore,
  createInstallPromptStore,
  hideInstallButtonChoice,
  readHideInstallButton,
  resetDisplaySettings,
  setHideInstallButton,
  type AppModeWindow,
} from "../src/state/index.ts";

/** The page's own app mode (the settings popup reads `window.matchMedia`): the installed app when `installed`. */
function stubDisplay(installed: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: installed && query === INSTALLED_DISPLAY_MODES[0],
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** The website in a browser without an install prompt (Safari, Firefox): the button opens the instructions. */
const website = () =>
  createAppModeStore({
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: false } as AppModeWindow["navigator"],
  });
const noPrompt = () => createInstallPromptStore(new EventTarget() as unknown as Window);

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
  stubDisplay(false);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.unstubAllGlobals();
});

function wrap(children: ReactNode) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={DEFAULT_CONFIG.languages} fallbackLanguage="en" browserLanguages={["en"]}>
        <NoticesProvider>
          <DialogsProvider>{children}</DialogsProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const download = () => screen.queryByRole("button", { name: "Download" });
const popup = () => screen.getByRole("dialog", { name: "Settings" });
const openSettings = () => fireEvent.click(screen.getByRole("button", { name: "Settings" }));
const section = () => within(popup()).queryByRole("radiogroup", { name: "Hide the “Install” button" });

describe("hide the install button (REQ-809)", () => {
  it("is the last section of the tab Design, after colour mode and map, with Yes and No, No without a choice", () => {
    wrap(<HeaderContainer appMode={website()} installPrompt={noPrompt()} />);
    openSettings();
    expect(within(popup()).getByRole("tab", { name: "Design" }).getAttribute("aria-selected")).toBe("true");
    const panel = within(popup()).getByRole("tabpanel");
    expect(within(panel).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Colour mode",
      "Map",
      "Hide the “Install” button",
    ]);
    const group = section()!;
    expect(within(group).getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual(["Yes", "No"]);
    expect(DEFAULT_HIDE_INSTALL_BUTTON).toBe(false);
    expect(within(group).getByRole("radio", { name: "No" })).toHaveProperty("checked", true);
    expect(within(group).getByRole("radio", { name: "Yes" })).toHaveProperty("checked", false);
  });

  it("Yes hides the header's install button at once and is stored; No shows it again and removes the choice", () => {
    wrap(<HeaderContainer appMode={website()} installPrompt={noPrompt()} />);
    expect(download()).toBeTruthy();
    openSettings();
    fireEvent.click(within(section()!).getByRole("radio", { name: "Yes" }));
    expect(readHideInstallButton()).toBe(true);
    expect(window.localStorage.getItem(HIDE_INSTALL_BUTTON_STORAGE_KEY)).toBe("true");
    expect(screen.queryByRole("button", { name: "Download", hidden: true })).toBeNull();
    fireEvent.click(within(section()!).getByRole("radio", { name: "No" }));
    expect(readHideInstallButton()).toBe(false);
    expect(window.localStorage.getItem(HIDE_INSTALL_BUTTON_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Download", hidden: true })).toBeTruthy();
    // A choice made elsewhere (e.g. an import) shows at once.
    act(() => setHideInstallButton(true));
    expect(within(section()!).getByRole("radio", { name: "Yes" })).toHaveProperty("checked", true);
  });

  it("keeps the choice for the next visit", () => {
    window.localStorage.setItem(HIDE_INSTALL_BUTTON_STORAGE_KEY, "true");
    wrap(<HeaderContainer appMode={website()} installPrompt={noPrompt()} />);
    expect(download()).toBeNull();
    openSettings();
    expect(within(section()!).getByRole("radio", { name: "Yes" })).toHaveProperty("checked", true);
    // Anything else stored counts as no choice.
    cleanup();
    window.localStorage.setItem(HIDE_INSTALL_BUTTON_STORAGE_KEY, "yes");
    expect(hideInstallButtonChoice.read()).toBeNull();
    wrap(<HeaderContainer appMode={website()} installPrompt={noPrompt()} />);
    expect(download()).toBeTruthy();
  });

  it("Yes removes “Install app” from the phone's menu", () => {
    wrap(<PhoneMenu appMode={website()} installPrompt={noPrompt()} />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const panel = screen.getByTestId("phone-menu-panel");
    expect(within(panel).getByRole("button", { name: "Install app" })).toBeTruthy();
    act(() => setHideInstallButton(true));
    expect(within(panel).queryByRole("button", { name: "Install app" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Settings" })).toBeTruthy();
    act(() => setHideInstallButton(false));
    expect(within(panel).getByRole("button", { name: "Install app" })).toBeTruthy();
  });

  it("is not offered in the installed app", () => {
    stubDisplay(true);
    wrap(<HeaderContainer appMode={website()} installPrompt={noPrompt()} />);
    openSettings();
    expect(within(popup()).getByRole("tab", { name: "Design" }).getAttribute("aria-selected")).toBe("true");
    const panel = within(popup()).getByRole("tabpanel");
    expect(within(panel).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Colour mode", "Map"]);
    expect(within(popup()).queryByRole("radiogroup", { name: "Hide the “Install” button", hidden: true })).toBeNull();
  });

  it("is named in every language", () => {
    const keys: MessageKey[] = ["settings.installButton", "settings.installButton.yes", "settings.installButton.no"];
    for (const language of LANGUAGES) {
      for (const key of keys) expect(MESSAGES[language][key], `${language} ${key}`).toBeTruthy();
    }
    expect(MESSAGES.de["settings.installButton"]).toBe("Knopf „Installieren“ ausblenden");
  });
});
