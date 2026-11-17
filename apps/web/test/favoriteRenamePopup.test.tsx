// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Renaming a favourite on a phone and a tablet (REQ-862): the desktop renames in the menu's row as before (REQ-489);
 * on a phone and a tablet the pencil opens a popup "<name> rename?" with a field (the name so far, focused and
 * selected), OK and Cancel. OK and Enter take a changed name that is not empty; Cancel, Escape and the X drop it. The
 * texts in all 8 languages.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, LANGUAGES, MESSAGES, createTranslate, type Language } from "../src/i18n/index.ts";
import { FavoritesSplitButton } from "../src/regions/LocationPicker/FavoritesSplitButton.tsx";
import { COARSE_POINTER_QUERY, PHONE_QUERY, type Favorite } from "../src/state/index.ts";

/** Fixed time: Tuesday, 17 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 17, 9);

const ALM: Favorite = { name: "Alm", lat: 47.1718, lon: 12.6806, mapPoint: true };
const POINT: Favorite = { name: "", lat: 46.9263, lon: 10.9261, mapPoint: true };
const PT = "46.9263° N · 10.9261° E";
const SOLDEN: Favorite = { name: "Sölden", lat: 46.9655, lon: 11.0076 };

type Device = "desktop" | "phone" | "tablet";

/** Lets the page be a desktop (no coarse pointer), a phone (the phone's query) or a tablet (coarse pointer, iPad screen). */
function device(kind: Device) {
  vi.stubGlobal("screen", kind === "tablet" ? { width: 834, height: 1194 } : { width: 1280, height: 800 });
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        media: query,
        matches: (kind === "phone" && query === PHONE_QUERY) || (kind === "tablet" && query === COARSE_POINTER_QUERY),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

function renderButton(favorites: Favorite[], language: Language = "en") {
  const onRename = vi.fn();
  const t = createTranslate(language);
  render(
    <I18nProvider browserLanguages={[language]}>
      <FavoritesSplitButton
        place={{ name: "Sölden", lat: 46.9655, lon: 11.0076 }}
        favorites={favorites}
        isFavorite
        onToggle={() => undefined}
        onSelect={() => undefined}
        onRename={onRename}
        labelOf={(favorite) => (favorite.name === "" ? (language === "de" ? "46,9263° N · 10,9261° O" : PT) : favorite.name)}
      />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: t("location.favorites.menu") }));
  return onRename;
}

const menu = () => screen.getByRole("menu", { hidden: true });
const pencil = (name: string) => within(menu()).getByRole("menuitem", { name: `Rename ${name}`, hidden: true });
const popup = () => screen.queryByTestId("rename-favorite-dialog");
const field = () => within(popup()!).getByRole("textbox", { name: "Name of the favourite" }) as HTMLInputElement;
const button = (name: string) => within(popup()!).getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("renaming a favourite (REQ-862)", () => {
  it("renames in the menu's row on the desktop, without a popup", () => {
    device("desktop");
    const onRename = renderButton([SOLDEN, ALM]);
    fireEvent.click(pencil("Alm"));
    expect(popup()).toBeNull();
    const inline = within(menu()).getByRole("textbox", { name: "Name of the favourite", hidden: true }) as HTMLInputElement;
    expect(inline.value).toBe("Alm");
    fireEvent.change(inline, { target: { value: "Hütte" } });
    fireEvent.keyDown(inline, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(ALM, "Hütte");
  });

  for (const kind of ["phone", "tablet"] as const) {
    describe(`on a ${kind}`, () => {
      beforeEach(() => device(kind));

      it("opens a popup with the question, the name so far focused and selected, OK and Cancel", () => {
        renderButton([SOLDEN, ALM]);
        fireEvent.click(pencil("Alm"));
        const dialog = popup()!;
        expect(dialog).not.toBeNull();
        expect(dialog.tagName).toBe("DIALOG");
        expect(dialog.classList.contains("dialog")).toBe(true);
        expect(within(dialog).getByRole("heading", { name: "Rename Alm?" })).toBeTruthy();
        expect(field().value).toBe("Alm");
        expect(document.activeElement).toBe(field());
        expect([field().selectionStart, field().selectionEnd]).toEqual([0, 3]);
        expect(button("OK")).toBeTruthy();
        expect(button("Cancel")).toBeTruthy();
        // The X of the other dialogs, without a blue frame (REQ-776).
        expect(within(dialog).getByRole("button", { name: "Close" }).classList.contains("close-button")).toBe(true);
        // The row itself stays as it is: no field in the menu.
        expect(within(menu()).queryByRole("textbox", { hidden: true })).toBeNull();
        expect(menu().hidden).toBe(false);
      });

      it("takes a changed name with OK, trimmed, and keeps the menu open", () => {
        const onRename = renderButton([SOLDEN, ALM]);
        fireEvent.click(pencil("Alm"));
        fireEvent.change(field(), { target: { value: "  Hütte  " } });
        fireEvent.click(button("OK"));
        expect(onRename).toHaveBeenCalledExactlyOnceWith(ALM, "Hütte");
        expect(popup()).toBeNull();
        expect(menu().hidden).toBe(false);
      });

      it("takes a changed name with Enter", () => {
        const onRename = renderButton([SOLDEN, ALM]);
        fireEvent.click(pencil("Alm"));
        fireEvent.change(field(), { target: { value: "Hütte" } });
        fireEvent.submit(field().form!);
        expect(onRename).toHaveBeenCalledExactlyOnceWith(ALM, "Hütte");
        expect(popup()).toBeNull();
      });

      it("drops the name with Cancel, Escape and the X", () => {
        const onRename = renderButton([SOLDEN, ALM]);
        fireEvent.click(pencil("Alm"));
        fireEvent.change(field(), { target: { value: "Hütte" } });
        fireEvent.click(button("Cancel"));
        expect(popup()).toBeNull();

        fireEvent.click(pencil("Alm"));
        // The popup starts again from the name so far.
        expect(field().value).toBe("Alm");
        fireEvent.change(field(), { target: { value: "Hütte" } });
        fireEvent.keyDown(field(), { key: "Escape" });
        expect(popup()).toBeNull();
        // Escape closes only the popup, not the menu behind it.
        expect(menu().hidden).toBe(false);

        fireEvent.click(pencil("Alm"));
        fireEvent.change(field(), { target: { value: "Hütte" } });
        fireEvent.click(within(popup()!).getByRole("button", { name: "Close" }));
        expect(popup()).toBeNull();
        expect(onRename).not.toHaveBeenCalled();
      });

      it("does not take an empty name: OK disabled, Enter does nothing, the popup stays", () => {
        const onRename = renderButton([SOLDEN, ALM]);
        fireEvent.click(pencil("Alm"));
        fireEvent.change(field(), { target: { value: "   " } });
        expect(button("OK").disabled).toBe(true);
        expect(field().getAttribute("aria-invalid")).toBe("true");
        fireEvent.submit(field().form!);
        expect(popup()).not.toBeNull();
        expect(onRename).not.toHaveBeenCalled();
      });

      it("does not report an unchanged name; a point without own name starts empty (REQ-536)", () => {
        const onRename = renderButton([SOLDEN, ALM, POINT]);
        fireEvent.click(pencil("Alm"));
        fireEvent.click(button("OK"));
        expect(popup()).toBeNull();
        expect(onRename).not.toHaveBeenCalled();

        fireEvent.click(pencil(PT));
        expect(within(popup()!).getByRole("heading", { name: `Rename ${PT}?` })).toBeTruthy();
        expect(field().value).toBe("");
        expect(field().getAttribute("aria-invalid")).toBeNull();
        expect(button("OK").disabled).toBe(true);
        fireEvent.change(field(), { target: { value: "Ferner" } });
        fireEvent.click(button("OK"));
        expect(onRename).toHaveBeenCalledExactlyOnceWith(POINT, "Ferner");
      });

      it("speaks the page language", () => {
        renderButton([POINT], "de");
        fireEvent.click(within(menu()).getByRole("menuitem", { name: "46,9263° N · 10,9261° O umbenennen", hidden: true }));
        const dialog = popup()!;
        expect(within(dialog).getByRole("heading", { name: "46,9263° N · 10,9261° O umbenennen?" })).toBeTruthy();
        expect(within(dialog).getByRole("textbox", { name: "Name des Favoriten" })).toBeTruthy();
        expect(within(dialog).getByRole("button", { name: "OK" })).toBeTruthy();
        expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeTruthy();
      });
    });
  }

  it("has the question, OK and Cancel in all 8 languages, the question with the name", () => {
    expect(LANGUAGES).toHaveLength(8);
    for (const language of LANGUAGES) {
      const messages = MESSAGES[language] as Record<string, string>;
      for (const key of ["location.favorites.renameQuestion", "location.favorites.renameOk", "location.favorites.renameCancel"]) {
        expect(messages[key], `${language} ${key}`).toMatch(/\S/);
      }
      expect(messages["location.favorites.renameQuestion"]).toContain("{name}");
      expect(messages["location.favorites.renameQuestion"]).toMatch(/\?$/);
    }
    expect(MESSAGES.de["location.favorites.renameQuestion"]).toBe("{name} umbenennen?");
    expect(MESSAGES.de["location.favorites.renameCancel"]).toBe("Abbrechen");
  });
});
