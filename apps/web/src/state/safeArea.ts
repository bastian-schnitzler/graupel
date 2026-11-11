// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The screen's side insets (REQ-618): the page reaches the screen's edges (viewport-fit=cover), so a phone in landscape
 * reports where its camera lies over the page. Read where the page places something itself (e.g. a popover shifted to
 * stay on screen); stylesheets use `env(safe-area-inset-*)` directly.
 */

/** Left and right inset in CSS px; 0 where the browser reports none (desktops, tablets, phones in portrait). */
export interface SideInsets {
  left: number;
  right: number;
}

/** Reads the insets from a hidden probe padded by them; outside a browser, or where it knows no `env()`, 0. */
export function readSideInsets(): SideInsets {
  if (typeof document === "undefined" || !document.body) return { left: 0, right: 0 };
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none";
  probe.style.paddingLeft = "env(safe-area-inset-left)";
  probe.style.paddingRight = "env(safe-area-inset-right)";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = { left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0 };
  probe.remove();
  return insets;
}
