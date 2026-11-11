// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import { findAll, flattenChildren, h, textContent } from "../src/render/vnode";
import { toSvgString } from "../src/render/svgString";

describe("virtual tree", () => {
  it("flattens nested children and drops null, undefined and false", () => {
    const node = h("g", null, [h("rect"), null, [false, "a", [undefined, 3]]], h("line"));
    expect(node.children).toEqual([h("rect"), "a", "3", h("line")]);
    expect(flattenChildren([[[]], null])).toEqual([]);
  });

  it("takes the key out of the attributes", () => {
    const node = h("rect", { key: 7, x: 1 });
    expect(node.key).toBe("7");
    expect(node.attrs).toEqual({ x: 1 });
    expect(h("rect", { x: 1 }).key).toBeUndefined();
  });

  it("finds nodes and their text", () => {
    const tree = h(
      "svg",
      null,
      h("g", { "data-testid": "a" }, h("text", null, "x", "y")),
      h("text", { "data-testid": "a" }, "z"),
    );
    expect(findAll(tree, (node) => node.attrs["data-testid"] === "a")).toHaveLength(2);
    expect(textContent(tree)).toBe("xyz");
  });
});

describe("toSvgString", () => {
  it("writes attributes in order, leaves out empty ones and self-closes empty elements", () => {
    const markup = toSvgString(
      h(
        "svg",
        { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 10 10" },
        h("rect", { x: 0, y: 1.5, fill: undefined, stroke: null, hidden: false, "data-on": true }),
        h("text", { "text-anchor": "middle" }, "5", " m"),
      ),
    );
    expect(markup).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<rect x="0" y="1.5" data-on=""/>' +
        '<text text-anchor="middle">5 m</text></svg>',
    );
  });

  it("escapes text and attribute values", () => {
    expect(toSvgString(h("text", { "data-label": 'a "b" & <c>' }, "x < y & z > 1"))).toBe(
      '<text data-label="a &quot;b&quot; &amp; &lt;c&gt;">x &lt; y &amp; z &gt; 1</text>',
    );
  });

  it("prepends an XML declaration on request", () => {
    expect(toSvgString(h("svg"), { xmlDeclaration: true })).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><svg/>',
    );
  });

  it("serialises a plain text root", () => {
    expect(toSvgString("a&b")).toBe("a&amp;b");
  });
});
