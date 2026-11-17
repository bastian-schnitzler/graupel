// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit of the build, shown after the version in the Info tab when set (REQ-724); release builds leave it unset. */
  readonly VITE_GRAUPEL_REVISION?: string;
}
