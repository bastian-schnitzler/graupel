// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { DialogsProvider, INFO_TAB_LABELS, INFO_TABS, useInfoDialog, type InfoPanels, type InfoTab } from "../src/dialogs/index.ts";
import {
  I18nProvider,
  LANGUAGES,
  LANGUAGE_NAMES,
  LANGUAGE_STORAGE_KEY,
  storeLanguage,
  translate,
} from "../src/i18n/index.ts";
import { Header, type HeaderProps } from "../src/regions/Header/index.ts";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const probe: { openInfo?: (tab?: InfoTab) => void } = {};
function InfoProbe() {
  const { open } = useInfoDialog();
  useEffect(() => {
    probe.openInfo = open;
  });
  return null;
}
const openInfo = (tab?: InfoTab) => probe.openInfo?.(tab);

function setup({
  config = DEFAULT_CONFIG,
  header,
  infoPanels,
  extra,
}: { config?: GraupelConfig; header?: HeaderProps; infoPanels?: InfoPanels; extra?: ReactNode } = {}) {
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={config.languages} fallbackLanguage={config.defaultLanguage} browserLanguages={["en"]}>
        <DialogsProvider infoPanels={infoPanels}>
          <Header {...header} />
          <InfoProbe />
          {extra}
        </DialogsProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });
const dialog = () => screen.getByRole("dialog");
const key = (target: Element, k: string, init: object = {}) => fireEvent.keyDown(target, { key: k, ...init });

describe("language picker", () => {
  it("offers the configured languages, each named in itself", () => {
    setup({ config: { ...DEFAULT_CONFIG, languages: ["de", "fr", "sl"] } });
    const select = screen.getByRole("combobox", { name: "Language" });
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Deutsch", "Français", "Slovenščina"]);
    expect(options.map((o) => o.getAttribute("lang"))).toEqual(["de", "fr", "sl"]);
  });

  it("lists English first and German second, whatever order the config gives (REQ-534)", () => {
    setup({ config: { ...DEFAULT_CONFIG, languages: ["fr", "de", "en", "it"] } });
    const options = within(screen.getByRole("combobox", { name: "Language" })).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("lang"))).toEqual(["en", "de", "fr", "it"]);
  });

  it("offers all eight languages by default with English first", () => {
    setup();
    const options = within(screen.getByRole("combobox", { name: "Language" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "English",
      "Deutsch",
      "Français",
      "Italiano",
      "Slovenščina",
      "Čeština",
      "Nederlands",
      "Dansk",
    ]);
  });

  it("switching the language changes the texts and stores the choice", () => {
    setup();
    expect(button("Settings")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "de" } });
    expect(button("Einstellungen")).toBeTruthy();
    expect(button("Info")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sprache" })).toHaveProperty("value", "de");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
  });

  it("is left out when the domain offers one language", () => {
    setup({ config: { ...DEFAULT_CONFIG, languages: ["it"], defaultLanguage: "it" } });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(button("Impostazioni"));
    expect(within(dialog()).queryByRole("combobox", { name: "Lingua" })).toBeNull();
  });

  it("has the globe inside the field: one label holds field, globe and arrow, both icons decorative (REQ-526)", () => {
    const { container } = setup();
    const select = screen.getByRole("combobox", { name: "Language" });
    const label = select.closest("label");
    expect(label?.classList.contains("header__language")).toBe(true);
    const globe = label?.querySelector("svg.header__globe");
    const chevron = label?.querySelector("svg.header__chevron");
    expect(globe?.classList.contains("icon")).toBe(true);
    expect(globe?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    // No globe of its own outside the field.
    expect(container.querySelectorAll(".header__globe")).toHaveLength(1);
  });

  it("shows no lone globe when the domain offers one language (REQ-526)", () => {
    const { container } = setup({ config: { ...DEFAULT_CONFIG, languages: ["it"], defaultLanguage: "it" } });
    expect(container.querySelector(".header__language")).toBeNull();
    expect(container.querySelector(".header__globe")).toBeNull();
  });
});

describe("icon buttons (REQ-455)", () => {
  it("shows settings and info as icons only, named for screen readers and in a tooltip", () => {
    setup();
    for (const name of ["Settings", "Info"]) {
      const b = button(name);
      expect(b.getAttribute("title")).toBe(name);
      expect(b.querySelector("svg")).toBeTruthy();
      expect(b.querySelector(".visually-hidden")?.textContent).toBe(name);
    }
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "de" } });
    expect(button("Einstellungen").getAttribute("title")).toBe("Einstellungen");
  });
});

describe("download button", () => {
  it("is hidden by default", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("is shown on request and calls onDownload", () => {
    const onDownload = vi.fn();
    setup({ header: { showDownload: true, onDownload } });
    fireEvent.click(button("Download"));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("shows only its icon, named in a tooltip, right of info (REQ-501)", () => {
    setup({ header: { showDownload: true } });
    const download = button("Download");
    expect(download.getAttribute("title")).toBe("Download");
    expect(download.querySelector("span")?.className).toBe("visually-hidden");
    expect(button("Info").nextElementSibling).toBe(download);
  });
});

describe("settings popup", () => {
  it("opens, keeps the focus inside, closes with Escape and returns the focus", () => {
    setup();
    const opener = button("Settings");
    opener.focus();
    fireEvent.click(opener);
    const popup = screen.getByRole("dialog", { name: "Settings" });
    expect(popup.hasAttribute("open")).toBe(true);
    const close = within(popup).getByRole("button", { name: "Close" });
    // The close button gets the focus; the first focusable is the export button in the title row. The tab bar follows
    // (REQ-686) with the tab Design selected; the last focusable is the map choice at the end of that tab: its radio
    // group as Tab reaches it, by the checked one.
    const first = within(popup).getByRole("button", { name: "Export settings" });
    const tabs = within(popup).getByRole("tablist", { name: "Settings sections" });
    expect(within(tabs).getByRole("tab", { name: "Design" }).getAttribute("aria-selected")).toBe("true");
    const map = within(popup).getByRole("radiogroup", { name: "Map" });
    const last = within(map)
      .getAllByRole("radio")
      .find((radio) => (radio as HTMLInputElement).checked)!;
    expect(last).toBeTruthy();
    expect(document.activeElement).toBe(close);
    last.focus();
    key(last, "Tab");
    expect(document.activeElement).toBe(first);
    key(first, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
    // In the tab Meteogram the last is the relative humidity below the dew point (REQ-650, REQ-686), by its checked
    // option (Off without a choice); the hidden tabs do not count. With another option checked, Tab leaves the group
    // from that one.
    fireEvent.click(within(tabs).getByRole("tab", { name: "Meteogram" }));
    const humidity = within(popup).getByRole("radiogroup", { name: "Relative humidity" });
    const off = within(humidity).getByRole("radio", { name: "Off" });
    expect(off).toHaveProperty("checked", true);
    first.focus();
    key(first, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(off);
    fireEvent.click(within(humidity).getByRole("radio", { name: "On" }));
    const on = within(humidity).getByRole("radio", { name: "On" });
    first.focus();
    key(first, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(on);
    key(on, "Tab");
    expect(document.activeElement).toBe(first);
    expect(within(popup).getByText("Settings are saved in this browser only.")).toBeTruthy();

    key(last, "Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("has no language choice; the header keeps it and the open popup follows it (REQ-468)", () => {
    setup();
    fireEvent.click(button("Settings"));
    expect(within(dialog()).queryByRole("combobox", { name: "Language" })).toBeNull();
    expect(within(dialog()).queryByRole("heading", { name: "Language" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Language", hidden: true }), { target: { value: "nl" } });
    expect(screen.getByRole("dialog", { name: "Instellingen" })).toBeTruthy();
  });

  it("has export and import as icon buttons in the title row, between the title and the close button (REQ-469)", () => {
    setup();
    fireEvent.click(button("Settings"));
    const row = dialog().querySelector(".dialog__header")!;
    const items = [...row.children];
    expect(items.map((item) => item.tagName)).toEqual(["H2", "DIV", "BUTTON"]);
    expect(items[0]?.textContent).toBe("Settings");
    expect(items[2]?.getAttribute("aria-label")).toBe("Close");
    const tools = within(items[1] as HTMLElement).getAllByRole("button");
    expect(tools.map((tool) => tool.getAttribute("aria-label"))).toEqual(["Export settings", "Import settings"]);
    for (const tool of tools) {
      expect(tool.textContent).toBe("");
      expect(tool.querySelector("svg")).toBeTruthy();
      expect(tool.getAttribute("title")).toMatch(/^(Export|Import) settings/);
    }
    expect(tools[1]?.getAttribute("title")).toContain("the current favourites are replaced");
    // The old section with its text and text buttons is gone.
    expect(within(dialog()).queryByRole("heading", { name: "Export and import" })).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: "Export" })).toBeNull();
  });

  it("closes with the close button and a click on the backdrop", () => {
    setup();
    fireEvent.click(button("Settings"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button("Settings"));
    fireEvent.mouseDown(dialog());
    fireEvent.click(dialog());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the popup open on a click inside", () => {
    setup();
    fireEvent.click(button("Settings"));
    const note = within(dialog()).getByText("Settings are saved in this browser only.");
    fireEvent.mouseDown(note);
    fireEvent.click(note);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("info popup", () => {
  const tab = (name: string) => within(dialog()).getByRole("tab", { name });
  const selected = () => within(dialog()).getByRole("tab", { selected: true });
  const panel = () => within(dialog()).getByRole("tabpanel");

  it("opens on About with the focus on the selected tab", () => {
    setup();
    const opener = button("Info");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Information" })).toBeTruthy();
    expect(within(dialog()).getByRole("tablist", { name: "Information sections" })).toBeTruthy();
    expect(
      within(dialog())
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["About", "Legal notice", "Privacy policy"]);
    expect(selected().textContent).toBe("About");
    expect(document.activeElement).toBe(selected());
    expect(within(panel()).getByRole("img", { name: "Graupel logo" })).toBeTruthy();
    expect(panel().getAttribute("aria-labelledby")).toBe(selected().id);
    expect(selected().getAttribute("aria-controls")).toBe(panel().id);

    key(selected(), "Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps one popup and one scrolling body while the tab changes (REQ-525)", () => {
    setup();
    fireEvent.click(button("Info"));
    const popup = dialog();
    expect(popup.classList.contains("info-dialog")).toBe(true);
    const body = popup.querySelector(".dialog__body");
    for (const name of ["Legal notice", "Privacy policy", "About"]) {
      fireEvent.click(tab(name));
      expect(dialog()).toBe(popup);
      expect(panel().parentElement).toBe(body);
    }
  });

  it("moves between tabs with arrow keys, Home and End", () => {
    setup();
    fireEvent.click(button("Info"));
    key(selected(), "ArrowRight");
    expect(selected().textContent).toBe("Legal notice");
    expect(document.activeElement).toBe(selected());
    // REQ-484: no heading repeats the tab; the tab names the panel.
    expect(within(panel()).queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "Legal notice" })).toBe(panel());
    key(selected(), "End");
    expect(selected().textContent).toBe("Privacy policy");
    key(selected(), "ArrowRight");
    expect(selected().textContent).toBe("About");
    key(selected(), "ArrowLeft");
    expect(selected().textContent).toBe("Privacy policy");
    expect(within(panel()).queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "Privacy policy" })).toBe(panel());
    key(selected(), "Home");
    expect(selected().textContent).toBe("About");
    // Only the selected tab is in the tab order.
    expect(
      within(dialog())
        .getAllByRole("tab")
        .map((t) => t.tabIndex),
    ).toEqual([0, -1, -1]);
    fireEvent.click(tab("Privacy policy"));
    expect(selected().textContent).toBe("Privacy policy");
  });

  it("opens at a given tab from elsewhere and switches the tab when already open", () => {
    setup();
    act(() => openInfo("imprint"));
    expect(selected().textContent).toBe("Legal notice");
    expect(document.activeElement).toBe(selected());
    act(() => openInfo("privacy"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(selected().textContent).toBe("Privacy policy");
    key(selected(), "Escape");
    // Without a tab it opens at the last selected one.
    act(() => openInfo());
    expect(selected().textContent).toBe("Privacy policy");
  });

  it("replaces the settings popup", () => {
    setup();
    fireEvent.click(button("Settings"));
    act(() => openInfo("about"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Information" })).toBeTruthy();
  });

  it("uses the imprint label of the domain and given panels", () => {
    setup({
      config: { ...DEFAULT_CONFIG, legal: { ...DEFAULT_CONFIG.legal, imprint: { label: "Mentions légales" } } },
      infoPanels: { imprint: <p>Hoster: GitHub</p> },
    });
    act(() => openInfo("imprint"));
    expect(selected().textContent).toBe("Mentions légales");
    expect(panel().textContent).toBe("Hoster: GitHub");
  });

  it("is reachable through a link elsewhere on the page", () => {
    function FooterLink() {
      const info = useInfoDialog();
      return (
        <button type="button" onClick={() => info.open("privacy")}>
          Privacy link
        </button>
      );
    }
    setup({ extra: <FooterLink /> });
    const link = button("Privacy link");
    link.focus();
    fireEvent.click(link);
    expect(selected().textContent).toBe("Privacy policy");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(link);
  });

  it("keeps Tab inside the popup and out of hidden panels", () => {
    setup();
    fireEvent.click(button("Info"));
    const close = within(dialog()).getByRole("button", { name: "Close" });
    // The last focusable element is the last link of the About panel.
    const links = within(panel()).getAllByRole("link");
    const last = links[links.length - 1]!;
    last.focus();
    key(last, "Tab");
    expect(document.activeElement).toBe(close);
    key(close, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe("texts", () => {
  it.each(LANGUAGES)("header and popups are translated in %s", (language) => {
    storeLanguage(language);
    render(<App />);
    const tr = (k: Parameters<typeof translate>[1]) => translate(language, k);
    expect(screen.getByRole("combobox", { name: tr("header.language") })).toHaveProperty("value", language);
    expect(screen.getByRole("option", { name: LANGUAGE_NAMES[language] })).toBeTruthy();

    fireEvent.click(button(tr("header.settings")));
    expect(screen.getByRole("dialog", { name: tr("settings.title") })).toBeTruthy();
    expect(within(dialog()).getByRole("heading", { level: 3, name: tr("settings.map") })).toBeTruthy();
    const modes = within(dialog()).getByRole("radiogroup", { name: tr("settings.colorMode") });
    expect(within(modes).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual([
      tr("settings.colorMode.system"),
      tr("settings.colorMode.light"),
      tr("settings.colorMode.dark"),
    ]);
    expect(within(dialog()).getByRole("button", { name: tr("settings.transfer.export") })).toBeTruthy();
    expect(within(dialog()).getByRole("button", { name: tr("settings.transfer.import") })).toBeTruthy();
    expect(within(dialog()).getByText(tr("settings.note"))).toBeTruthy();
    key(dialog(), "Escape");

    // The footer has an Info link too; this is the header's.
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: tr("header.info") }));
    expect(screen.getByRole("dialog", { name: tr("info.title") })).toBeTruthy();
    expect(within(dialog()).getByRole("button", { name: tr("dialog.close") })).toBeTruthy();
    expect(within(dialog()).getByRole("tablist", { name: tr("info.tabs") })).toBeTruthy();
    expect(
      within(dialog())
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(INFO_TABS.map((id) => tr(INFO_TAB_LABELS[id])));
    for (const id of INFO_TABS) {
      const label = tr(INFO_TAB_LABELS[id]);
      fireEvent.click(within(dialog()).getByRole("tab", { name: label }));
      // REQ-484: the tab label names the panel; imprint and privacy policy repeat it in no heading.
      const panel = within(dialog()).getByRole("tabpanel", { name: label });
      if (id !== "about") expect(within(panel).queryByRole("heading", { level: 3 })).toBeNull();
      const text = panel.textContent;
      if (id === "about") expect(text).toContain(tr("info.about.description"));
      else if (id === "privacy") expect(text).toContain(tr("privacy.intro"));
      else expect(text).toContain(tr("info.imprint.operator"));
    }
  });
});
