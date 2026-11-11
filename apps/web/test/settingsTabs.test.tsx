// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tab bar of the settings popup (REQ-686): which setting sits in which tab, the tab Archive only in the installed app
 * with the days the history keeps and, on a phone, the history slider, and the tabs as WAI-ARIA tabs.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import {
  DialogsProvider,
  SETTINGS_TABS,
  SETTINGS_TAB_IDS,
  shownSettingsTabs,
  tabKeyTarget,
  type SettingsEnvironment,
} from "../src/dialogs/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, translate, type MessageKey } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import {
  ARCHIVE_DAYS_OPTIONS,
  ARCHIVE_DAYS_STORAGE_KEY,
  DEFAULT_ARCHIVE_DAYS,
  DEFAULT_HISTORY_SLIDER,
  HISTORY_SLIDER_STORAGE_KEY,
  INSTALLED_DISPLAY_MODES,
  readArchiveDays,
  readHistorySlider,
  resetDisplaySettings,
  setArchiveDays,
  setHistorySlider,
} from "../src/state/index.ts";
import { PHONE_QUERY } from "../src/state/phoneLandscape.ts";

/** A matchMedia stand-in: the queries in `matching` match, all others do not. */
function stubMedia(matching: readonly string[]) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

const INSTALLED = [INSTALLED_DISPLAY_MODES[0]!];

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.unstubAllGlobals();
});

function setup(config: GraupelConfig = DEFAULT_CONFIG, language = "en") {
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={config.languages} browserLanguages={[language]}>
        <NoticesProvider>
          <DialogsProvider>
            <Header />
          </DialogsProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const popup = () => screen.getByRole("dialog", { name: "Settings" });
const openSettings = () => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  return popup();
};
const tabList = () => within(popup()).getByRole("tablist", { name: "Settings sections" });
const tabNames = () => within(tabList()).getAllByRole("tab").map((tab) => tab.textContent);
const tab = (name: string) => within(tabList()).getByRole("tab", { name });
const panel = () => within(popup()).getByRole("tabpanel");

const environment = (overrides: Partial<SettingsEnvironment> = {}): SettingsEnvironment => ({
  config: DEFAULT_CONFIG,
  appMode: "website",
  ...overrides,
});
const layout = (env: SettingsEnvironment) =>
  shownSettingsTabs(env).map(({ tab: { id }, sections }) => [id, sections.map((section) => section.id)]);

describe("tabs and their settings (REQ-686)", () => {
  it("puts each setting in its tab; the tab Archive only in the installed app", () => {
    expect(SETTINGS_TAB_IDS).toEqual(["design", "start", "models", "meteogram", "archive"]);
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(SETTINGS_TAB_IDS);
    expect(layout(environment())).toEqual([
      ["design", ["colorMode", "map"]],
      ["start", ["startLocation", "daySlider"]],
      ["models", ["modelChain", "modelHeaders"]],
      ["meteogram", ["meteogram"]],
    ]);
    expect(layout(environment({ appMode: "installed" }))).toEqual([
      ["design", ["colorMode", "map"]],
      ["start", ["startLocation", "daySlider"]],
      ["models", ["modelChain", "modelHeaders"]],
      ["meteogram", ["meteogram"]],
      ["archive", ["history"]],
    ]);
    // Without the model chain block the tab Models keeps the model headers.
    expect(layout(environment({ config: { ...DEFAULT_CONFIG, modelChain: false } }))[2]).toEqual([
      "models",
      ["modelHeaders"],
    ]);
  });

  it("shows the tab bar below the heading row with Design selected, each tab with its controls", () => {
    setup();
    const dialog = openSettings();
    expect(tabNames()).toEqual(["Design", "Start", "Models", "Meteogram"]);
    // Below the heading row, outside the scrolling body, so it stays in place.
    const header = dialog.querySelector(".dialog__header")!;
    expect(header.nextElementSibling).toBe(tabList());
    expect(dialog.querySelector(".dialog__body")!.contains(tabList())).toBe(false);
    expect(tab("Design").getAttribute("aria-selected")).toBe("true");
    // One panel at a time; the others are hidden.
    expect(within(dialog).getAllByRole("tabpanel")).toHaveLength(1);
    expect(dialog.querySelectorAll('[role="tabpanel"]')).toHaveLength(4);

    const controls = (name: string) => {
      fireEvent.click(tab(name));
      expect(tab(name).getAttribute("aria-selected")).toBe("true");
      const shown = panel();
      expect(shown.getAttribute("aria-labelledby")).toBe(tab(name).id);
      expect(tab(name).getAttribute("aria-controls")).toBe(shown.id);
      return {
        headings: within(shown).getAllByRole("heading").map((heading) => heading.textContent),
        groups: within(shown)
          .queryAllByRole("radiogroup")
          .map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent),
        checkboxes: within(shown).queryAllByRole("checkbox").map((box) => box.parentElement?.textContent),
        selects: within(shown)
          .queryAllByRole("combobox")
          .map((select) => (select.id ? document.querySelector(`label[for="${select.id}"]`)?.textContent : null) ?? null),
      };
    };

    expect(controls("Design")).toEqual({
      headings: ["Colour mode", "Map"],
      groups: ["Colour mode", "Map"],
      checkboxes: [],
      selects: [],
    });
    expect(controls("Start")).toEqual({
      headings: ["Start place", "Day slider"],
      groups: [],
      checkboxes: ["Show the day slider"],
      selects: [null, "Days shown"],
    });
    expect(within(panel()).getByRole("combobox", { name: "Start place" })).toBeTruthy();
    // The hint stays with its setting.
    expect(within(panel()).getByText(/Applies the next time the page opens/)).toBeTruthy();
    expect(controls("Models")).toEqual({
      headings: ["Model chain", "Model headers"],
      groups: [],
      checkboxes: ["Show the weather chain", "Show the cloud chain", "Show model headers"],
      selects: [],
    });
    expect(within(panel()).getByText(/Drag the boundaries between the models/)).toBeTruthy();
    expect(controls("Meteogram")).toEqual({
      headings: ["Meteogram"],
      groups: ["Adjust axes when zooming", "Dew point", "Relative humidity"],
      checkboxes: ["Show the legend"],
      selects: [],
    });
    expect(within(panel()).getByText(/Applies to precipitation and wind/)).toBeTruthy();
    expect(within(panel()).getByText(/Auto shows the dew point/)).toBeTruthy();
    // The note on where the settings are kept stays below every tab.
    expect(within(dialog).getByText("Settings are saved in this browser only.")).toBeTruthy();
  });

  it("a setting changed in a tab takes effect at once", () => {
    setup();
    openSettings();
    fireEvent.click(tab("Models"));
    fireEvent.click(within(panel()).getByRole("checkbox", { name: "Show model headers" }));
    expect(window.localStorage.getItem("graupel.modelHeaders")).toBe("false");
    fireEvent.click(tab("Meteogram"));
    fireEvent.click(within(panel()).getByRole("checkbox", { name: "Show the legend" }));
    expect(window.localStorage.getItem("graupel.legend")).toBe("false");
  });

  it("switches tabs with the arrow keys, Home and End, moving the focus; only the selected tab is in the Tab order", () => {
    setup();
    openSettings();
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
    tab("Design").focus();
    expect(within(tabList()).getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    key("ArrowRight");
    expect(document.activeElement).toBe(tab("Start"));
    expect(tab("Start").getAttribute("aria-selected")).toBe("true");
    expect(within(panel()).getByRole("combobox", { name: "Start place" })).toBeTruthy();
    expect(within(tabList()).getAllByRole("tab").map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1]);
    key("End");
    expect(document.activeElement).toBe(tab("Meteogram"));
    key("ArrowRight");
    expect(document.activeElement).toBe(tab("Design"));
    key("ArrowLeft");
    expect(document.activeElement).toBe(tab("Meteogram"));
    key("Home");
    expect(document.activeElement).toBe(tab("Design"));
    expect(tab("Design").getAttribute("aria-selected")).toBe("true");
    // Other keys leave the tab alone.
    key("ArrowDown");
    expect(tab("Design").getAttribute("aria-selected")).toBe("true");
  });

  it("opens again at the tab shown last", () => {
    setup();
    openSettings();
    fireEvent.click(tab("Meteogram"));
    fireEvent.click(within(popup()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    openSettings();
    expect(tab("Meteogram").getAttribute("aria-selected")).toBe("true");
  });

  it("has the keys of the WAI-ARIA tabs pattern", () => {
    expect(tabKeyTarget("ArrowRight", 0, 5)).toBe(1);
    expect(tabKeyTarget("ArrowRight", 4, 5)).toBe(0);
    expect(tabKeyTarget("ArrowLeft", 0, 5)).toBe(4);
    expect(tabKeyTarget("ArrowLeft", 3, 5)).toBe(2);
    expect(tabKeyTarget("Home", 3, 5)).toBe(0);
    expect(tabKeyTarget("End", 1, 5)).toBe(4);
    expect(tabKeyTarget("Enter", 1, 5)).toBeUndefined();
  });

  it("names the tabs in every language", () => {
    const keys: MessageKey[] = [
      "settings.tabs",
      ...SETTINGS_TABS.map((tab) => tab.label),
      "settings.daySlider",
      "settings.modelHeaders",
      "settings.archive.days",
      "settings.archive.days.unlimited",
      "settings.archive.days.count",
      "settings.archive.days.hint",
      "settings.archive.historySlider",
      "settings.archive.historySlider.hint",
    ];
    for (const language of LANGUAGES) {
      for (const key of keys) expect(MESSAGES[language][key], `${language} ${key}`).toBeTruthy();
    }
    expect(SETTINGS_TABS.map((tab) => translate("de", tab.label))).toEqual([
      "Design",
      "Start",
      "Modelle",
      "Meteogramm",
      "Archiv",
    ]);
  });
});

describe("tab Archive of the installed app (REQ-686)", () => {
  it("is not shown on the website", () => {
    stubMedia([]);
    setup();
    openSettings();
    expect(tabNames()).not.toContain("Archive");
    expect(within(popup()).queryByRole("combobox", { name: "Days to keep", hidden: true })).toBeNull();
  });

  it("is the last tab in the installed app: days to keep, unlimited without a choice, then 365, 90, 14 and 5", () => {
    stubMedia(INSTALLED);
    setup();
    openSettings();
    expect(tabNames()).toEqual(["Design", "Start", "Models", "Meteogram", "Archive"]);
    fireEvent.click(tab("Archive"));
    expect(within(panel()).getByRole("heading").textContent).toBe("History");
    const select = within(panel()).getByRole("combobox", { name: "Days to keep" }) as HTMLSelectElement;
    expect(ARCHIVE_DAYS_OPTIONS).toEqual(["unlimited", 365, 90, 14, 5]);
    expect(DEFAULT_ARCHIVE_DAYS).toBe("unlimited");
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Unlimited",
      "365 days",
      "90 days",
      "14 days",
      "5 days",
    ]);
    expect([...select.options].map((option) => option.value)).toEqual(["unlimited", "365", "90", "14", "5"]);
    expect(select.value).toBe("unlimited");
    // The hint is its description.
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toMatch(
      /^The installed app keeps every fetch/,
    );

    fireEvent.change(select, { target: { value: "14" } });
    expect(readArchiveDays()).toBe(14);
    expect(window.localStorage.getItem(ARCHIVE_DAYS_STORAGE_KEY)).toBe("14");
    expect(select.value).toBe("14");
    // Unlimited again: nothing stored.
    fireEvent.change(select, { target: { value: "unlimited" } });
    expect(window.localStorage.getItem(ARCHIVE_DAYS_STORAGE_KEY)).toBeNull();
    // A choice made elsewhere (e.g. an import) shows at once.
    act(() => setArchiveDays(5));
    expect(select.value).toBe("5");
    // Not on a phone: no history slider.
    expect(within(panel()).queryByRole("checkbox")).toBeNull();
  });

  it("shows the history slider switch only on a phone, off without a choice", () => {
    stubMedia([...INSTALLED, PHONE_QUERY]);
    setup();
    openSettings();
    fireEvent.click(tab("Archive"));
    expect(DEFAULT_HISTORY_SLIDER).toBe(false);
    const box = within(panel()).getByRole("checkbox", { name: "Show the history slider" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(document.getElementById(box.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Shows the days with kept fetches in a bar like the day slider.",
    );
    // Below the days to keep and their hint.
    const select = within(panel()).getByRole("combobox", { name: "Days to keep" });
    expect(select.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(box);
    expect(readHistorySlider()).toBe(true);
    expect(window.localStorage.getItem(HISTORY_SLIDER_STORAGE_KEY)).toBe("true");
    fireEvent.click(box);
    expect(readHistorySlider()).toBe(false);
    expect(window.localStorage.getItem(HISTORY_SLIDER_STORAGE_KEY)).toBeNull();
    act(() => setHistorySlider(true));
    expect(box.checked).toBe(true);
  });

  it("falls back to the first tab when the tab shown last is gone (the app opened as a website)", () => {
    stubMedia(INSTALLED);
    const view = setup();
    openSettings();
    fireEvent.click(tab("Archive"));
    fireEvent.click(within(popup()).getByRole("button", { name: "Close" }));
    stubMedia([]);
    view.rerender(
      <ConfigProvider config={DEFAULT_CONFIG}>
        <I18nProvider languages={DEFAULT_CONFIG.languages} browserLanguages={["en"]}>
          <NoticesProvider>
            <DialogsProvider>
              <Header />
            </DialogsProvider>
          </NoticesProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    openSettings();
    expect(tabNames()).toEqual(["Design", "Start", "Models", "Meteogram"]);
    expect(tab("Design").getAttribute("aria-selected")).toBe("true");
  });
});
