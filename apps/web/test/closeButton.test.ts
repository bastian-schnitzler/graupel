// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The X of every dialog and popup (REQ-776, generalising REQ-762): one shared rule (`close-button`, global.css) for all
 * of them, and the page's root element knows whether the keyboard is in use (`data-keyboard`), so only then a ring
 * shows on the focused X.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { KEYBOARD_ATTRIBUTE, initKeyboardInput, isKeyboardUse } from "../src/state/index.ts";

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** The files below `src` with one of the endings, recursively. */
function files(dir: string, ending: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, ending);
    return entry.name.endsWith(ending) ? [path] : [];
  });
}

describe("one rule for the X of all dialogs and popups (REQ-776)", () => {
  it("every button with the close icon has the class close-button", () => {
    const found: string[] = [];
    for (const path of files(SRC_DIR, ".tsx")) {
      const source = readFileSync(path, "utf8");
      // Each `<CloseIcon` and the opening tag of the button before it.
      for (const match of source.matchAll(/<CloseIcon\b/g)) {
        const before = source.slice(0, match.index);
        const tag = before.slice(before.lastIndexOf("<button"));
        const name = `${relative(SRC_DIR, path)} at ${match.index}`;
        found.push(name);
        expect(tag.startsWith("<button"), name).toBe(true);
        expect(tag, name).toMatch(/className="[^"]*\bclose-button\b/);
      }
    }
    // Dialog (two), error cards, legend and the tablet's full-screen X.
    expect(found.length).toBeGreaterThanOrEqual(5);
  });

  it("no style sheet but global.css sets a focus look of its own on an X", () => {
    const closeClasses = /\.(close-button|dialog__close|error-card__close|meteogram-legend__close|fullscreen-close__button)\b[^{,]*:focus/;
    const own = files(SRC_DIR, ".css")
      .filter((path) => !path.endsWith("global.css"))
      .filter((path) => closeClasses.test(readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")))
      .map((path) => relative(SRC_DIR, path));
    expect(own).toEqual([]);
  });

  it("the shared rule: no ring on focus, a ring in the icon's colour only with the keyboard", () => {
    const css = readFileSync(join(SRC_DIR, "styles/global.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".close-button")).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(rule(".close-button:focus")).toMatch(/outline:\s*none/);
    expect(rule(".close-button:focus")).toMatch(/box-shadow:\s*none/);
    const ring = rule(`:root[${KEYBOARD_ATTRIBUTE}] .close-button:focus-visible`);
    expect(ring).toMatch(/outline:\s*2px solid currentColor/);
  });
});

describe("keyboard use on the page's root element (REQ-776)", () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
  });

  const key = (init: KeyboardEventInit) => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  const keyboard = () => document.documentElement.hasAttribute(KEYBOARD_ATTRIBUTE);

  it("a key sets it, a pointer, mouse or touch takes it away", () => {
    stop = initKeyboardInput();
    expect(keyboard()).toBe(false);
    key({ key: "Tab" });
    expect(keyboard()).toBe(true);
    document.dispatchEvent(new Event("pointerdown"));
    expect(keyboard()).toBe(false);
    key({ key: "Enter" });
    document.dispatchEvent(new Event("mousedown"));
    expect(keyboard()).toBe(false);
    key({ key: " " });
    document.dispatchEvent(new Event("touchstart"));
    expect(keyboard()).toBe(false);
  });

  it("modifiers alone and shortcuts are no keyboard use", () => {
    stop = initKeyboardInput();
    for (const init of [{ key: "Shift" }, { key: "Meta" }, { key: "c", metaKey: true }, { key: "c", ctrlKey: true }]) {
      key(init);
      expect(keyboard(), JSON.stringify(init)).toBe(false);
    }
    expect(isKeyboardUse({ key: "Escape", metaKey: false, ctrlKey: false, altKey: false })).toBe(true);
    expect(isKeyboardUse({ key: "Tab", metaKey: false, ctrlKey: false, altKey: true })).toBe(false);
  });

  it("stopped, it no longer follows and leaves no attribute; a second start replaces the first", () => {
    const first = initKeyboardInput();
    key({ key: "Tab" });
    stop = initKeyboardInput();
    expect(keyboard()).toBe(false);
    key({ key: "Tab" });
    expect(keyboard()).toBe(true);
    first();
    expect(keyboard()).toBe(true);
    stop();
    stop = null;
    expect(keyboard()).toBe(false);
    key({ key: "Tab" });
    expect(keyboard()).toBe(false);
  });
});
