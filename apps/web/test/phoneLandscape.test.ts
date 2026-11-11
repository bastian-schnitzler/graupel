// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Phone in landscape (REQ-454), not when the keyboard makes a portrait page wider than high while a text field has the
 * focus (REQ-628); and whether a text field has the focus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLoweredByKeyboard, isPhoneLandscape, isTypingInField } from "../src/state/phoneLandscape.ts";

/** Lets the media query of a phone in landscape match or not, as the page's shape would. */
function pageShape(landscape: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: landscape,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

/** The screen's sides as the browser tells them (0 when it tells nothing) and the page's width. */
function sizes(screenSides: { width: number; height: number }, pageWidth: number) {
  vi.stubGlobal("screen", screenSides);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: pageWidth });
}

/** Focuses a text field, as tapping the place search does. */
function typeInField() {
  document.body.innerHTML = '<input type="text">';
  document.querySelector("input")!.focus();
}

/** An iPhone 16: the screen's sides stay put on a turn. */
const IPHONE = { width: 393, height: 852 };
/** A phone whose browser swaps the screen's sides on a turn, as Chrome on Android does. */
const SWAPPED = { width: 852, height: 393 };

const innerWidth = window.innerWidth;

beforeEach(() => {
  sizes(IPHONE, 393);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
  document.body.replaceChildren();
});

describe("isLoweredByKeyboard", () => {
  it("is true while typing on a page no wider than the screen's short side", () => {
    typeInField();
    sizes(IPHONE, 393);
    expect(isLoweredByKeyboard()).toBe(true);
    sizes(SWAPPED, 393);
    expect(isLoweredByKeyboard()).toBe(true);
    // Rounding of the page's width.
    sizes(IPHONE, 394);
    expect(isLoweredByKeyboard()).toBe(true);
  });

  it("is false on a page as wide as the long side: a turn", () => {
    typeInField();
    sizes(IPHONE, 852);
    expect(isLoweredByKeyboard()).toBe(false);
    sizes(SWAPPED, 852);
    expect(isLoweredByKeyboard()).toBe(false);
  });

  it("is false without a text field focused, and when the browser tells nothing about the screen", () => {
    sizes(IPHONE, 393);
    expect(isLoweredByKeyboard()).toBe(false);
    typeInField();
    sizes({ width: 0, height: 0 }, 393);
    expect(isLoweredByKeyboard()).toBe(false);
  });
});

describe("isPhoneLandscape", () => {
  it("is false for a portrait page", () => {
    pageShape(false);
    sizes(IPHONE, 852);
    expect(isPhoneLandscape()).toBe(false);
  });

  it("is true for a landscape page as wide as the screen's long side", () => {
    pageShape(true);
    sizes(IPHONE, 852);
    expect(isPhoneLandscape()).toBe(true);
    sizes(SWAPPED, 852);
    expect(isPhoneLandscape()).toBe(true);
  });

  it("is false when only the keyboard made the page wider than high: a text field focused, the page narrow (REQ-628)", () => {
    pageShape(true);
    typeInField();
    sizes(IPHONE, 393);
    expect(isPhoneLandscape()).toBe(false);
  });

  it("counts a turn while typing: the page as wide as the long side", () => {
    pageShape(true);
    typeInField();
    sizes(IPHONE, 852);
    expect(isPhoneLandscape()).toBe(true);
  });

  it("follows the page's shape without a text field focused", () => {
    pageShape(true);
    sizes(IPHONE, 393);
    expect(isPhoneLandscape()).toBe(true);
  });

  it("follows the page's shape when the browser tells nothing about the screen, also while typing", () => {
    pageShape(true);
    sizes({ width: 0, height: 0 }, 393);
    expect(isPhoneLandscape()).toBe(true);
    typeInField();
    expect(isPhoneLandscape()).toBe(true);
  });
});

describe("isTypingInField", () => {
  const focus = (html: string) => {
    document.body.innerHTML = html;
    (document.body.firstElementChild as HTMLElement).focus();
  };

  it("is true for text inputs, text areas and editable content", () => {
    for (const html of [
      '<input type="text">',
      "<input>",
      '<input type="search">',
      '<input type="email">',
      '<input type="number">',
      "<textarea></textarea>",
      '<div contenteditable="true" tabindex="0"></div>',
    ]) {
      focus(html);
      expect(isTypingInField(), html).toBe(true);
    }
  });

  it("is false for buttons, check boxes, sliders and nothing focused", () => {
    for (const html of [
      "<button>OK</button>",
      '<input type="checkbox">',
      '<input type="radio">',
      '<input type="range">',
      '<a href="#">x</a>',
    ]) {
      focus(html);
      expect(isTypingInField(), html).toBe(false);
    }
    document.body.replaceChildren();
    expect(isTypingInField()).toBe(false);
  });
});
