// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// @vitest-environment jsdom
/** `mount`, `patch` and `render` against a real DOM (jsdom). */
import { afterEach, describe, expect, it } from "vitest";
import { SVG_NS, mount, patch, render, unrender } from "../src/render/dom";
import {
  renderMeteogramSvg,
  renderOverlayLayer,
  renderStaticLayer,
} from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { toSvgString } from "../src/render/svgString";
import { h } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

/** Mutations `action` causes below `root`. */
function mutationsOf(root: Node, action: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  action();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

/** An `svg` element in the document to mount SVG fragments into. */
function svgHost(): Element {
  return document.body.appendChild(document.createElementNS(SVG_NS, "svg"));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mount", () => {
  it("creates SVG elements with attributes and text in the SVG namespace", () => {
    const tree = h(
      "svg",
      { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 10 10" },
      h("g", { "data-testid": "group", hidden: false }, h("text", { x: 1 }, "Hi & bye")),
    );
    const svg = mount(tree, document.body) as SVGSVGElement;
    expect(svg.parentNode).toBe(document.body);
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(svg.hasAttribute("xmlns")).toBe(false);
    const group = svg.querySelector('[data-testid="group"]')!;
    expect(group.namespaceURI).toBe(SVG_NS);
    expect(group.hasAttribute("hidden")).toBe(false);
    expect(group.querySelector("text")!.textContent).toBe("Hi & bye");
  });

  it("creates SVG children below an existing SVG parent and HTML elsewhere", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    expect((mount(h("rect"), svg) as Element).namespaceURI).toBe(SVG_NS);
    expect((mount(h("div"), document.body) as Element).namespaceURI).toBe(
      "http://www.w3.org/1999/xhtml",
    );
  });

  it("gives the same markup as toSvgString for the whole meteogram", () => {
    const scene = createMeteogramScene(powerInput, powerOptions);
    const tree = renderMeteogramSvg(scene);
    const svg = mount(tree, document.body) as Element;
    const expected = new DOMParser().parseFromString(toSvgString(tree), "image/svg+xml");
    expect(svg.outerHTML).toBe(
      new XMLSerializer()
        .serializeToString(expected.documentElement)
        .replace(' xmlns="http://www.w3.org/2000/svg"', "")
        .replace(/<(\w+)([^>]*)\/>/g, "<$1$2></$1>"),
    );
  });
});

describe("patch", () => {
  it("changes only differing attributes and texts", () => {
    const before = h("g", null, h("rect", { x: 1, y: 2, fill: "red" }), h("text", null, "a"));
    const after = h("g", null, h("rect", { x: 1, y: 3 }), h("text", null, "b"));
    const g = mount(before, svgHost()) as Element;
    const rect = g.firstChild as Element;
    const records = mutationsOf(g, () => patch(g, before, after));
    expect(g.firstChild).toBe(rect);
    expect(rect.getAttribute("y")).toBe("3");
    expect(rect.hasAttribute("fill")).toBe(false);
    expect(g.lastChild!.textContent).toBe("b");
    expect(records.map((record) => record.type).sort()).toEqual([
      "attributes",
      "attributes",
      "characterData",
    ]);
  });

  it("does nothing for an equal tree", () => {
    const scene = createMeteogramScene(powerInput, powerOptions);
    const tree = renderMeteogramSvg(scene);
    const svg = mount(tree, document.body);
    expect(mutationsOf(svg, () => patch(svg, tree, renderMeteogramSvg(scene)))).toHaveLength(0);
  });

  it("adds and removes children at the end", () => {
    const one = h("g", null, h("rect"));
    const three = h("g", null, h("rect"), h("circle"), "t");
    const g = mount(one, svgHost()) as Element;
    patch(g, one, three);
    expect(Array.from(g.childNodes, (node) => node.nodeName)).toEqual(["rect", "circle", "#text"]);
    expect((g.childNodes[1] as Element).namespaceURI).toBe(SVG_NS);
    patch(g, three, one);
    expect(Array.from(g.childNodes, (node) => node.nodeName)).toEqual(["rect"]);
  });

  it("replaces a subtree on a different tag or key", () => {
    const before = h("g", null, h("rect", { key: "a" }), h("line"));
    const after = h("g", null, h("rect", { key: "b" }), h("circle"));
    const g = mount(before, svgHost()) as Element;
    const [rect, line] = Array.from(g.childNodes);
    patch(g, before, after);
    expect(g.childNodes[0]).not.toBe(rect);
    expect(g.childNodes[0]!.nodeName).toBe("rect");
    expect(g.childNodes[1]).not.toBe(line);
    expect(g.childNodes[1]!.nodeName).toBe("circle");
  });

  it("returns the new node when the root is replaced", () => {
    const rect = mount(h("rect"), document.body);
    const circle = patch(rect, h("rect"), h("circle", { r: 2 }));
    expect(circle).not.toBe(rect);
    expect(document.body.firstChild).toBe(circle);
    expect((circle as Element).getAttribute("r")).toBe("2");
  });
});

describe("layers in the DOM", () => {
  it("a hover change patches only the overlay layer", () => {
    const scene = createMeteogramScene(powerInput, powerOptions);
    const staticLayer = renderStaticLayer(scene);
    const before = renderMeteogramSvg(scene, { static: staticLayer });
    const svg = mount(before, document.body) as Element;
    const overlay = svg.querySelector('[data-layer="overlay"]')!;
    const staticGroup = svg.querySelector('[data-layer="static"]')!;
    const after = renderMeteogramSvg(scene, {
      static: staticLayer,
      overlay: renderOverlayLayer(scene, { time: Date.UTC(2026, 9, 16, 12) }),
    });

    const records = mutationsOf(svg, () => patch(svg, before, after));
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => overlay.contains(record.target))).toBe(true);
    expect(svg.querySelector('[data-layer="static"]')).toBe(staticGroup);
    expect(svg.querySelector('[data-testid="hover-cursor-line"]')).not.toBeNull();
    expect(svg.querySelector('[data-testid="current-time-cursor-line"]')).toBeNull();
  });
});

describe("render", () => {
  it("mounts first, then patches the same element, and unrenders", () => {
    const container = document.createElement("div");
    container.appendChild(document.createElement("p"));
    const first = render(container, h("svg", null, h("rect", { x: 1 })));
    const second = render(container, h("svg", null, h("rect", { x: 2 })));
    expect(second).toBe(first);
    expect(container.querySelector("rect")!.getAttribute("x")).toBe("2");
    expect(container.childNodes).toHaveLength(2);
    unrender(container);
    expect(Array.from(container.childNodes, (node) => node.nodeName)).toEqual(["P"]);
  });

  it("mounts again when its element was removed from the container", () => {
    const container = document.createElement("div");
    const first = render(container, h("svg"));
    container.removeChild(first);
    const second = render(container, h("svg"));
    expect(second).not.toBe(first);
    expect(second.parentNode).toBe(container);
  });
});
