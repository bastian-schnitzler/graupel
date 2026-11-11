// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The tablet's top row as on the desktop (REQ-748): with the desktop's header bar it stands in the desktop's card with
 * the page's top margin, not bare as the phone's place row; what it needs is measured with the search field at the
 * desktop's narrowest width (its flex basis, 8rem), so an upright iPad keeps the row with the history's day.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { SEARCH_MIN_REM, topRowNeeds } from "../src/layout/index.ts";
import { COARSE_POINTER_QUERY } from "../src/state/index.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** A device with a coarse pointer and the given screen; every other media query does not match. */
function coarseDevice(screenSize: { width: number; height: number }) {
  vi.stubGlobal("screen", screenSize);
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        media: query,
        matches: query === COARSE_POINTER_QUERY,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

describe("tablet's top row (REQ-748)", () => {
  it("stands in the desktop's card with the page's top margin, the header bar beside the place row, no menu", () => {
    coarseDevice({ width: 834, height: 1194 });
    const { container } = render(<App />);
    const top = container.querySelector(".app__top")!;
    expect(top.classList.contains("app__top--row")).toBe(true);
    expect(top.classList.contains("app__top--bare")).toBe(false);
    expect(container.querySelector(".app__inner")!.classList.contains("app__inner--flush-top")).toBe(false);
    expect(container.querySelector("[data-region=header]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  });

  it("leaves the phone's place row bare at the page's top edge, with the menu", () => {
    coarseDevice({ width: 390, height: 844 });
    const { container } = render(<App />);
    const top = container.querySelector(".app__top")!;
    expect(top.classList.contains("app__top--bare")).toBe(true);
    expect(top.classList.contains("app__top--row")).toBe(false);
    expect(container.querySelector(".app__inner")!.classList.contains("app__inner--flush-top")).toBe(true);
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
  });
});

/** An element of the given width (CSS px) and inline style. */
function box(className: string, width: number, style = "", children: HTMLElement[] = []) {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("style", style);
  element.getBoundingClientRect = () => ({ width, height: 40 }) as DOMRect;
  element.append(...children);
  return element;
}

describe("topRowNeeds (REQ-731, REQ-748)", () => {
  it("counts the search field at the desktop's narrowest width, 8rem, whatever its width now", () => {
    expect(SEARCH_MIN_REM).toBe(8);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    for (const searchWidth of [384, 234, 100]) {
      const bar = box("location__bar", 600, "column-gap: 8px", [
        box("location__search", searchWidth),
        box("location__map", 40),
        box("location__favorites", 80, "margin-left: 12px"),
        box("location__history", 119, "margin-left: 12px"),
      ]);
      const location = box("location", 600, "padding-left: 16px; padding-right: 16px", [bar]);
      const headerBar = box("header__bar", 261, "column-gap: 8px", [box("lang", 165), box("b", 40), box("b", 40)]);
      const header = box("header", 293, "padding-left: 16px; padding-right: 16px", [headerBar]);
      const top = box("app__top", 800, "column-gap: 0px", [location, header]);
      document.body.append(top);
      // Place row: field, map, favourites and history with their margins and three gaps, the location's padding;
      // header bar: language and two buttons with two gaps, the header's padding.
      const place = SEARCH_MIN_REM * rem + 40 + (80 + 12) + (119 + 12) + 3 * 8 + 32;
      const buttons = 165 + 40 + 40 + 2 * 8 + 32;
      expect(topRowNeeds(top)).toBeCloseTo(place + buttons);
      top.remove();
    }
  });

  it("is null while the row does not show both the place row and the header bar", () => {
    const top = box("app__top", 800, "", [box("location", 600, "", [box("location__bar", 600)])]);
    expect(topRowNeeds(top)).toBeNull();
  });
});
