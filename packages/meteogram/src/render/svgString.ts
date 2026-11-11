// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { attrText, isAttrSet, isVNode, type VChild } from "./vnode";

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

export interface SvgStringOptions {
  /** Prepend `<?xml version="1.0" encoding="UTF-8"?>` (standalone files). */
  xmlDeclaration?: boolean;
}

/**
 * Serialises a virtual tree to SVG/XML markup. Works without a DOM (Node,
 * workers); empty elements are self-closing.
 */
export function toSvgString(root: VChild, options: SvgStringOptions = {}): string {
  const parts: string[] = [];
  if (options.xmlDeclaration) {
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  }
  const write = (child: VChild) => {
    if (!isVNode(child)) {
      parts.push(escapeText(child));
      return;
    }
    parts.push("<", child.tag);
    for (const [name, value] of Object.entries(child.attrs)) {
      if (!isAttrSet(value)) continue;
      parts.push(" ", name, '="', escapeAttr(attrText(value)), '"');
    }
    if (child.children.length === 0) {
      parts.push("/>");
      return;
    }
    parts.push(">");
    child.children.forEach(write);
    parts.push("</", child.tag, ">");
  };
  write(root);
  return parts.join("");
}
