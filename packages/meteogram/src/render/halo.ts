// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Halo behind a label (REQ-747): a stroke in the background colour that keeps a text readable on the data.
 * It is drawn as its own text element right before the filled text, not as the stroke of the text itself with
 * `paint-order: stroke`: Safari (WebKit) painted such a stroke over the fill of stretched texts, so the values turned
 * into dark spots.
 */
import { type Attrs, h, isVNode, type VChild, type VNode } from "./vnode";

/** Stroke of a halo. */
export interface Halo {
  stroke: string;
  "stroke-width": string;
  "stroke-linejoin": "round";
}

/** Halo in `color`, 3 units wide with round joins (the width all labels over the plot use). */
export const labelHalo = (color: string): Halo => ({ stroke: color, "stroke-width": "3", "stroke-linejoin": "round" });

/** Attributes of the filled text the halo copy leaves out: its fill and what identifies it (test ids, data). */
const isOwnAttr = (name: string) => name === "fill" || name.startsWith("data-") || name === "class";

/** Copy of a text's child (a `tspan` or a string) for the halo: same place and text, without its own attributes. */
function haloChild(child: VChild): VChild {
  if (!isVNode(child)) return child;
  const attrs: Attrs = {};
  for (const [name, value] of Object.entries(child.attrs)) if (!isOwnAttr(name)) attrs[name] = value;
  const copy: VNode = { tag: child.tag, attrs, children: child.children.map(haloChild) };
  if (child.key !== undefined) copy.key = child.key;
  return copy;
}

/**
 * `text` with a halo behind it: a group of a copy of the text that only strokes (`fill="none"`, `aria-hidden`, no test
 * id) and the text itself, unchanged. Without a halo the text alone.
 */
export function withHalo(text: VNode, halo: Halo | null | undefined): VNode {
  if (!halo) return text;
  const attrs: Attrs = {};
  for (const [name, value] of Object.entries(text.attrs)) if (!isOwnAttr(name)) attrs[name] = value;
  const copy: VNode = {
    tag: text.tag,
    attrs: { ...attrs, fill: "none", ...halo, "aria-hidden": "true", "data-halo": "true" },
    children: text.children.map(haloChild),
  };
  if (text.key !== undefined) copy.key = `${text.key}-halo`;
  return h("g", { key: text.key === undefined ? undefined : `${text.key}-with-halo`, class: "label-halo" }, copy, text);
}
