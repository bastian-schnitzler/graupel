// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Pluggable cache of downloaded chains. The default lives in memory for the
 * lifetime of the client; callers can plug in their own store
 * (e.g. IndexedDB) through the same interface.
 */

/** Store for finished results; methods may be synchronous or return promises. */
export interface ForecastCache<T = unknown> {
  get(key: string): T | undefined | Promise<T | undefined>;
  set(key: string, value: T): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface MemoryCacheOptions {
  /** Entries older than this are ignored and dropped (default: no expiry). */
  maxAgeMs?: number;
  /** Oldest entries are dropped beyond this many (default: no limit). */
  maxEntries?: number;
  /** Clock for the age check (default `Date.now`). */
  now?: () => number;
}

/** In-memory cache; never persisted. */
export function createMemoryCache<T = unknown>(options: MemoryCacheOptions = {}): ForecastCache<T> & {
  readonly size: number;
} {
  const entries = new Map<string, { value: T; stored: number }>();
  const clock = options.now ?? Date.now;
  const maxAge = options.maxAgeMs ?? Infinity;
  const maxEntries = Math.max(1, options.maxEntries ?? Infinity);
  return {
    get size() {
      return entries.size;
    },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (clock() - entry.stored > maxAge) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, stored: clock() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
