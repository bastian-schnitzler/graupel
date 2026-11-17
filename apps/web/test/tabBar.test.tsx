// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fitting of the popups' tab bar (REQ-780): the tabs stay in one row; where they do not fit, spacing and font get
 * smaller level by level down to a lower bound, then the bar scrolls and the selected tab is scrolled into view. jsdom
 * has no layout, so the widths are stand-ins that shrink with each level.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TAB_FIT_LEVELS,
  TabBar,
  fitTabBar,
  scrollPanelToTop,
  scrollTabIntoView,
  tabPanelId,
} from "../src/dialogs/TabBar.tsx";
import { KEYBOARD_ATTRIBUTE } from "../src/state/index.ts";

/** A bar `clientWidth` wide whose tabs need `widths[level]` at each level of `data-fit`. */
function bar(clientWidth: number, widths: readonly number[]) {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { get: () => clientWidth });
  Object.defineProperty(element, "scrollWidth", {
    get: () => Math.max(clientWidth, widths[Number(element.dataset.fit ?? 0)]!),
  });
  return element;
}

/** Widths of three tabs at the levels 0 to 5: each level a little narrower. */
const WIDTHS = [420, 380, 360, 330, 310, 290];

afterEach(cleanup);

describe("fitTabBar (REQ-780)", () => {
  it("keeps the roomiest look where the tabs fit", () => {
    const element = bar(600, WIDTHS);
    element.dataset.fit = "3";
    expect(fitTabBar(element)).toBe(0);
    expect(element.dataset.fit).toBeUndefined();
  });

  it("takes the first level at which the tabs fit, spacing before font", () => {
    expect(fitTabBar(bar(380, WIDTHS))).toBe(1);
    expect(fitTabBar(bar(348, WIDTHS))).toBe(3);
    expect(fitTabBar(bar(300, WIDTHS))).toBe(5);
  });

  it("stops at the lower bound where even that does not fit: the bar scrolls", () => {
    const element = bar(278, WIDTHS);
    expect(fitTabBar(element)).toBe(TAB_FIT_LEVELS);
    expect(element.dataset.fit).toBe(String(TAB_FIT_LEVELS));
    expect(element.scrollWidth).toBeGreaterThan(element.clientWidth);
  });

  it("goes back to roomier levels when the bar grows", () => {
    let width = 278;
    const element = document.createElement("div");
    Object.defineProperty(element, "clientWidth", { get: () => width });
    Object.defineProperty(element, "scrollWidth", {
      get: () => Math.max(width, WIDTHS[Number(element.dataset.fit ?? 0)]!),
    });
    expect(fitTabBar(element)).toBe(5);
    width = 400;
    expect(fitTabBar(element)).toBe(1);
  });
});

describe("scrollTabIntoView (REQ-780)", () => {
  const rect = (left: number, width: number) => ({ left, right: left + width }) as DOMRect;

  it("scrolls only the bar, just far enough to show the tab", () => {
    const element = bar(278, [320]);
    element.scrollLeft = 0;
    const tab = document.createElement("button");
    element.getBoundingClientRect = () => rect(20, 278);
    tab.getBoundingClientRect = () => rect(180, 150);
    scrollTabIntoView(element, tab);
    expect(element.scrollLeft).toBe(180 + 150 - (20 + 278));
  });

  it("leaves a bar alone whose tabs fit", () => {
    const element = bar(400, [320]);
    const tab = document.createElement("button");
    element.getBoundingClientRect = () => rect(20, 400);
    tab.getBoundingClientRect = () => rect(500, 150);
    scrollTabIntoView(element, tab);
    expect(element.scrollLeft).toBe(0);
  });
});

describe("TabBar (REQ-780)", () => {
  it("renders one row of tabs without a fit level where nothing overflows", () => {
    render(
      <TabBar
        tabs={["about", "imprint", "privacy"]}
        selected="privacy"
        onSelect={() => {}}
        label="Information sections"
        baseId="info"
        renderLabel={(id) => ({ about: "Über", imprint: "Mentions légales", privacy: "Datenschutzerklärung" })[id]}
      />,
    );
    const list = screen.getByRole("tablist", { name: "Information sections" });
    expect(list.className).toBe("tabs");
    expect(list.dataset.fit).toBeUndefined();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Über",
      "Mentions légales",
      "Datenschutzerklärung",
    ]);
  });
});

describe("a newly selected tab starts at its top (REQ-854)", () => {
  /** A scrolling box (the dialog's body) holding the panels of the tabs `about` and `privacy`. */
  function Popup({ selected, onSelect }: { selected: "about" | "privacy"; onSelect: (tab: "about" | "privacy") => void }) {
    return (
      <div data-testid="page">
        <TabBar
          tabs={["about", "privacy"]}
          selected={selected}
          onSelect={onSelect}
          label="Information sections"
          baseId="info"
          renderLabel={(id) => id}
        />
        <div data-testid="body">
          {(["about", "privacy"] as const).map((id) => (
            <div key={id} role="tabpanel" id={tabPanelId("info", id)} hidden={id !== selected} />
          ))}
        </div>
      </div>
    );
  }

  it("scrolls the body back to the top when another tab is chosen, by a click or a key", () => {
    function Host() {
      const [selected, setSelected] = useState<"about" | "privacy">("privacy");
      return <Popup selected={selected} onSelect={setSelected} />;
    }
    render(<Host />);
    const body = screen.getByTestId("body");
    // Far down in the privacy policy (the iPad of the report), then "Info".
    body.scrollTop = 2400;
    fireEvent.click(screen.getByRole("tab", { name: "about" }));
    expect(screen.getByRole("tab", { name: "about" }).getAttribute("aria-selected")).toBe("true");
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 800;
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(screen.getByRole("tab", { name: "privacy" }).getAttribute("aria-selected")).toBe("true");
    expect(body.scrollTop).toBe(0);
  });

  it("also when the tab is selected from outside, and not on a render that keeps the tab", () => {
    const { rerender } = render(<Popup selected="privacy" onSelect={() => {}} />);
    const body = screen.getByTestId("body");
    body.scrollTop = 1200;
    rerender(<Popup selected="privacy" onSelect={() => {}} />);
    expect(body.scrollTop).toBe(1200);
    rerender(<Popup selected="about" onSelect={() => {}} />);
    expect(body.scrollTop).toBe(0);
  });

  it("scrollPanelToTop: the panel and its scrolling ancestors, never the page", () => {
    const outer = document.createElement("div");
    const panel = document.createElement("div");
    outer.append(panel);
    document.body.append(outer);
    panel.scrollTop = 50;
    outer.scrollTop = 300;
    document.documentElement.scrollTop = 40;
    document.body.scrollTop = 30;
    outer.scrollLeft = 70;
    scrollPanelToTop(panel);
    expect([panel.scrollTop, outer.scrollTop, outer.scrollLeft]).toEqual([0, 0, 70]);
    expect(document.documentElement.scrollTop).toBe(40);
    expect(document.body.scrollTop).toBe(30);
    outer.remove();
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
});

describe("no frame around a tab, only its underline (REQ-859)", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/dialogs/Tabs.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  /** The rule whose selector is exactly `selector`, at the start of a line. */
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("no ring and no touch highlight on a tab; the selected one is underlined", () => {
    expect(rule(".tabs__tab")).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    expect(rule(".tabs__tab:focus")).toMatch(/outline:\s*none/);
    expect(rule(".tabs__tab:focus")).toMatch(/box-shadow:\s*none/);
    expect(rule('.tabs__tab[aria-selected="true"]')).toMatch(/border-bottom-color:\s*var\(--color-accent\)/);
  });

  it("with the keyboard the focused tab is marked by colour and a thin underline, still without a frame", () => {
    const keyboard = rule(`:root[${KEYBOARD_ATTRIBUTE}] .tabs__tab:focus-visible`);
    expect(keyboard).toMatch(/color:\s*var\(--color-accent\)/);
    expect(keyboard).toMatch(/text-decoration:\s*underline/);
    expect(keyboard).not.toMatch(/outline|box-shadow|border(?!-bottom)/);
    // No other rule draws a frame on a focused tab.
    expect(css).not.toMatch(/\.tabs__tab[^{]*:focus[^{]*\{[^}]*outline:(?!\s*none)/);
  });
});
