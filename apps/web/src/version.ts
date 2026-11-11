// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/** Version of the website, taken from package.json at build time (only this field ends up in the bundle). */
import { version } from "../package.json";

export const APP_VERSION = version;

/**
 * The version as the Info tab shows it (REQ-724): with the commit of the build in brackets on the preview
 * (graupel_test), whose build sets VITE_GRAUPEL_REVISION (scripts/build-preview.mjs); the domain builds leave the
 * variable out and show the version alone. Read when called, not by hostname.
 */
export function appVersionLabel(revision: string | undefined = import.meta.env.VITE_GRAUPEL_REVISION): string {
  return revision ? `${APP_VERSION} (${revision})` : APP_VERSION;
}
