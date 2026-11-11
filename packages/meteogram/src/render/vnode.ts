// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Small virtual SVG tree: plain objects `{ tag, attrs, children }` that the
 * drawing functions return. `toSvgString` serialises a tree (also in Node,
 * without a DOM); `mount` and `patch` bring it into a DOM element.
 *
 * Attribute names are the real SVG/XML names (`stroke-width`, `clip-path`,
 * `data-testid`, `viewBox`). `null`, `undefined` and `false` leave an
 * attribute out; numbers are written with `String(value)`.
 */

export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue>;

export interface VNode {
  tag: string;
  attrs: Attrs;
  children: VChild[];
  /** Identity among siblings for `patch`; not written as an attribute. */
  key?: string;
}

/** A node or a text. */
export type VChild = VNode | string;

/** What a drawing function may hand to `h` as children. */
export type VInput = VChild | number | null | undefined | false | VInput[];

/** Flattens nested child lists and drops empty entries. */
export function flattenChildren(input: VInput[]): VChild[] {
  const result: VChild[] = [];
  const visit = (child: VInput) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }
    result.push(typeof child === "number" ? String(child) : child);
  };
  input.forEach(visit);
  return result;
}

/**
 * Creates a node. `attrs.key` becomes the node's key and is not written as
 * an attribute.
 */
export function h(
  tag: string,
  attrs: (Attrs & { key?: string | number }) | null = null,
  ...children: VInput[]
): VNode {
  const { key, ...rest } = attrs ?? {};
  const node: VNode = { tag, attrs: rest, children: flattenChildren(children) };
  if (key !== undefined && key !== null) node.key = String(key);
  return node;
}

export function isVNode(child: VChild): child is VNode {
  return typeof child !== "string";
}

/** Whether an attribute value is written at all. */
export function isAttrSet(value: AttrValue): value is string | number | true {
  return value !== null && value !== undefined && value !== false;
}

/** Attribute value as text (`true` gives an empty value). */
export function attrText(value: string | number | true): string {
  return value === true ? "" : String(value);
}

/** Depth-first search for nodes matching a predicate. */
export function findAll(
  root: VChild,
  predicate: (node: VNode) => boolean,
): VNode[] {
  const found: VNode[] = [];
  const visit = (child: VChild) => {
    if (!isVNode(child)) return;
    if (predicate(child)) found.push(child);
    child.children.forEach(visit);
  };
  visit(root);
  return found;
}

/** Text content of a node, like the DOM's `textContent`. */
export function textContent(child: VChild): string {
  return isVNode(child) ? child.children.map(textContent).join("") : child;
}
