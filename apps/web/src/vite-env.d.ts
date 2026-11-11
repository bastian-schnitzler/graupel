// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit of a preview build, shown after the version in the Info tab (REQ-724); unset on the domain builds. */
  readonly VITE_GRAUPEL_REVISION?: string;
}
