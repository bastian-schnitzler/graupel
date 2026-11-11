// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/** Test helpers for halos drawn as their own element behind a label (REQ-747). */
import { findAll, type VNode } from "../../src/render/vnode";

/** The group of `text` and its halo in `root` (class `label-halo`), or undefined without a halo. */
export const haloGroupOf = (root: VNode, text: VNode): VNode | undefined =>
  findAll(root, (node) => node.attrs.class === "label-halo" && node.children.includes(text))[0];

/** The halo copy drawn right before `text` in `root`, or undefined without a halo. */
export function haloOf(root: VNode, text: VNode): VNode | undefined {
  const group = haloGroupOf(root, text);
  return group?.children.find((child): child is VNode => typeof child !== "string" && child !== text);
}

/** What stands for `text` among its parent's children: its halo group, or the text itself without a halo. */
export const drawnNodeOf = (root: VNode, text: VNode): VNode => haloGroupOf(root, text) ?? text;
