// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Whether a full-screen map is open (`MapDialog`: location picker or model chain). The dialog marks the root element
 * with a class while it is open; it locks the page's scrolling (REQ-512), and a phone turned to landscape meanwhile
 * keeps the map instead of opening the full-screen meteogram (REQ-645).
 */

/** Class on the root element while a full-screen map is open. */
export const MAP_DIALOG_OPEN_CLASS = "map-dialog-open";

/** Whether a full-screen map is open right now (REQ-645). */
export function isMapDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(MAP_DIALOG_OPEN_CLASS);
}
