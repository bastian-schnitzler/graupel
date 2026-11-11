// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Vite/Vitest import of a file as text (`./file.svg?raw`).
declare module "*?raw" {
  const content: string;
  export default content;
}

// Vite/Vitest `import.meta.glob` (eager imports of several files).
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
