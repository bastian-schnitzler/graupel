// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Help" beside the other info entries (REQ-849, REQ-853): in the footer of wider screens it stands between "Info" and
 * the imprint, in the phone's menu after "Info"; both open the info popup at its Help tab and carry the tab's name, in
 * all 8 languages.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, type Language } from "../src/i18n/index.ts";
import { Footer } from "../src/regions/Footer/index.ts";
import { PhoneMenu } from "../src/regions/Header/index.ts";
import { PHONE_QUERY, createAppModeStore, createInstallPromptStore, type AppModeWindow } from "../src/state/index.ts";

/** Fixed time: Thursday, 12 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 12, 9);

let phone = false;
const original = window.matchMedia;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  phone = false;
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: query === PHONE_QUERY && phone,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = original;
  window.localStorage.clear();
});

/** The installed app: no installation entry in the menu. */
const installedApp = () =>
  createAppModeStore({
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    navigator: { standalone: true } as AppModeWindow["navigator"],
  });

function renderIn(language: Language, children: React.ReactNode) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={LANGUAGES} fallbackLanguage="en" browserLanguages={[language]}>
        <DialogsProvider>{children}</DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

/** The entries Info, Help, imprint and privacy as `language` names them; Help and the imprint carry their tab's name. */
const entriesIn = (language: Language) => {
  const m = MESSAGES[language];
  return [m["footer.info"], m["info.tab.help"], m["info.tab.imprint"], m["footer.privacy"]];
};

const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

describe("Help in the footer (REQ-849)", () => {
  it.each(LANGUAGES)("stands between Info and the imprint and opens the Help tab in %s (REQ-849)", (language) => {
    renderIn(language, <Footer />);
    const footer = screen.getByRole("contentinfo");
    const links = within(footer).getAllByRole("button");
    expect(links.map((link) => link.textContent)).toEqual(entriesIn(language));
    expect(links[1]!.dataset.infoTab).toBe("help");
    fireEvent.click(links[1]!);
    expect(selectedTab()).toBe(MESSAGES[language]["info.tab.help"]);
    expect(screen.getByRole("tabpanel", { name: MESSAGES[language]["info.tab.help"] })).toBeTruthy();
  });

  it("has no links on a phone, where Help is in the menu (REQ-582, REQ-853)", () => {
    phone = true;
    renderIn("en", <Footer />);
    expect(within(screen.getByRole("contentinfo")).queryAllByRole("button")).toEqual([]);
  });
});

describe("Help in the phone's menu (REQ-853)", () => {
  it.each(LANGUAGES)("follows Info and opens the Help tab in %s (REQ-853)", (language) => {
    phone = true;
    renderIn(language, <PhoneMenu appMode={installedApp()} installPrompt={createInstallPromptStore(new EventTarget() as Window)} />);
    fireEvent.click(screen.getByRole("button", { name: MESSAGES[language]["menu.label"] }));
    const panel = screen.getByTestId("phone-menu-panel");
    const buttons = within(panel).getAllByRole("button");
    // Settings, the divider, then Info, Help, the imprint and privacy.
    expect(buttons.map((button) => button.textContent).slice(-4)).toEqual(entriesIn(language));
    const help = buttons.at(-3)!;
    expect(help.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(help);
    expect(panel.hidden).toBe(true);
    expect(selectedTab()).toBe(MESSAGES[language]["info.tab.help"]);
  });
});
