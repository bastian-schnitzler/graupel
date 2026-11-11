// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import {
  attrText,
  isAttrSet,
  isVNode,
  type AttrValue,
  type VChild,
  type VNode,
} from "./vnode";

export const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

// Namespace declarations belong to the markup only; in the DOM the element
// namespace comes from createElementNS.
const isNamespaceDeclaration = (name: string) =>
  name === "xmlns" || name.startsWith("xmlns:");

function setAttr(element: Element, name: string, value: AttrValue) {
  if (isNamespaceDeclaration(name)) return;
  if (!isAttrSet(value)) {
    removeAttr(element, name);
    return;
  }
  const text = attrText(value);
  if (name.startsWith("xlink:")) element.setAttributeNS(XLINK_NS, name, text);
  else if (name.startsWith("xml:")) element.setAttributeNS(XML_NS, name, text);
  else element.setAttribute(name, text);
}

function removeAttr(element: Element, name: string) {
  if (name.startsWith("xlink:")) element.removeAttributeNS(XLINK_NS, name.slice(6));
  else if (name.startsWith("xml:")) element.removeAttributeNS(XML_NS, name.slice(4));
  else element.removeAttribute(name);
}

function ownerDocument(parent: Node | null | undefined): Document {
  const doc =
    (parent && (parent.nodeType === 9 ? (parent as Document) : parent.ownerDocument)) ??
    (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("mount needs a DOM document");
  return doc;
}

/**
 * Elements are created in the SVG namespace from an `svg` element down;
 * anything else outside an SVG (e.g. a wrapping `div`) is an HTML element.
 */
function createNode(child: VChild, doc: Document, inSvg: boolean): Node {
  if (!isVNode(child)) return doc.createTextNode(child);
  const svg = inSvg || child.tag === "svg";
  const element = svg
    ? doc.createElementNS(SVG_NS, child.tag)
    : doc.createElement(child.tag);
  for (const [name, value] of Object.entries(child.attrs)) {
    setAttr(element, name, value);
  }
  for (const grandChild of child.children) {
    element.appendChild(createNode(grandChild, doc, svg));
  }
  return element;
}

const isSvgElement = (node: Node | null | undefined) =>
  !!node && node.nodeType === 1 && (node as Element).namespaceURI === SVG_NS;

/**
 * Creates the DOM for a virtual tree and appends it to `parent` (when given).
 * Returns the created node.
 */
export function mount(vnode: VChild, parent?: Node | null): Node {
  const node = createNode(vnode, ownerDocument(parent), isSvgElement(parent));
  parent?.appendChild(node);
  return node;
}

const sameKind = (a: VChild, b: VChild) =>
  isVNode(a) && isVNode(b)
    ? a.tag === b.tag && a.key === b.key
    : !isVNode(a) && !isVNode(b);

function replace(node: Node, next: VChild): Node {
  const parent = node.parentNode;
  const created = createNode(
    next,
    ownerDocument(node),
    isSvgElement(parent) || (isSvgElement(node) && isVNode(next) && next.tag !== "svg"),
  );
  parent?.replaceChild(created, node);
  return created;
}

/**
 * Brings the DOM `node`, created from `prev`, to the state of `next` and
 * returns the resulting node (a new one when the element had to be
 * replaced). Children are matched by position; a different tag or key at a
 * position replaces that subtree. Unchanged attributes and texts are not
 * touched, so a patch with an equal tree changes nothing in the DOM.
 */
export function patch(node: Node, prev: VChild, next: VChild): Node {
  if (prev === next) return node;
  if (!sameKind(prev, next)) return replace(node, next);
  if (!isVNode(prev) || !isVNode(next)) {
    if (prev !== next && node.nodeValue !== next) node.nodeValue = next as string;
    return node;
  }
  const element = node as Element;
  for (const name of Object.keys(prev.attrs)) {
    if (!(name in next.attrs) && !isNamespaceDeclaration(name)) removeAttr(element, name);
  }
  for (const [name, value] of Object.entries(next.attrs)) {
    if (prev.attrs[name] !== value) setAttr(element, name, value);
  }
  const domChildren = Array.from(element.childNodes);
  const common = Math.min(prev.children.length, next.children.length);
  for (let index = 0; index < common; index++) {
    patch(domChildren[index]!, prev.children[index]!, next.children[index]!);
  }
  for (let index = next.children.length; index < prev.children.length; index++) {
    element.removeChild(domChildren[index]!);
  }
  const doc = ownerDocument(element);
  const inSvg = isSvgElement(element);
  for (let index = prev.children.length; index < next.children.length; index++) {
    element.appendChild(createNode(next.children[index]!, doc, inSvg));
  }
  return element;
}

const rendered = new WeakMap<Element, { vnode: VChild; node: Node }>();

/**
 * Renders a tree into `container`: the first call mounts it, later calls
 * patch the DOM from the previous tree. Other content of the container is
 * left alone.
 */
export function render(container: Element, vnode: VChild): Node {
  const previous = rendered.get(container);
  const node =
    previous && previous.node.parentNode === container
      ? patch(previous.node, previous.vnode, vnode)
      : mount(vnode, container);
  rendered.set(container, { vnode, node });
  return node;
}

/** Removes what `render` put into `container`. */
export function unrender(container: Element): void {
  const previous = rendered.get(container);
  if (previous && previous.node.parentNode === container) {
    container.removeChild(previous.node);
  }
  rendered.delete(container);
}

export type { VNode };
