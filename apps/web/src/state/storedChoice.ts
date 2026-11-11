// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * An own choice of a setting, kept in `localStorage` (like the map provider, REQ-467): without a choice the value from
 * config.json applies. Used by the settings of REQ-470 to REQ-473 (start place, model headers, day slider, days) and
 * by the dew point of the meteogram (REQ-593). Storage errors (private mode, blocked storage) keep the choice for this
 * visit only.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface StoredChoice<T> {
  /** `localStorage` key. */
  readonly key: string;
  /** Stored choice, or `null` without one (also when storage is unavailable or holds something invalid). */
  read: () => T | null;
  /** Stores the choice (`null` removes it, so config.json applies again) and tells every `use()`. */
  set: (choice: T | null) => void;
  /** Own choice (`null`: none), and a setter that stores it. */
  use: () => [T | null, (choice: T | null) => void];
  /** Forgets a choice kept for this visit only (tests). */
  reset: () => void;
}

/**
 * A stored choice under `key`; `decode` checks the stored text (`null`: invalid), `encode` writes it. Reading the same
 * text twice gives the same value, so objects can be used as React snapshots.
 */
export function storedChoice<T>(
  key: string,
  decode: (text: string) => T | null,
  encode: (value: T) => string,
): StoredChoice<T> {
  const listeners = new Set<() => void>();
  // Text of a choice kept for this visit only, when storing it failed; `undefined`: none.
  let unsaved: string | null | undefined;
  let cachedText: string | null = null;
  let cachedValue: T | null = null;

  const decodeCached = (text: string | null): T | null => {
    if (text !== cachedText) {
      cachedText = text;
      cachedValue = text === null ? null : decode(text);
    }
    return cachedValue;
  };

  const storedText = (): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const read = () => decodeCached(storedText());
  const snapshot = () => decodeCached(unsaved !== undefined ? unsaved : storedText());

  const set = (choice: T | null) => {
    const text = choice === null ? null : encode(choice);
    try {
      if (text === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, text);
      unsaved = undefined;
    } catch {
      unsaved = text;
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    // Another tab changed the choice.
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) onChange();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onStorage);
    };
  };

  function use(): [T | null, (choice: T | null) => void] {
    const choice = useSyncExternalStore(subscribe, snapshot, () => null);
    const setter = useCallback((next: T | null) => set(next), []);
    return [choice, setter];
  }

  const reset = () => {
    unsaved = undefined;
    for (const listener of listeners) listener();
  };

  return { key, read, set, use, reset };
}

/** Stored text of a boolean switch. */
export const decodeBoolean = (text: string): boolean | null => (text === "true" ? true : text === "false" ? false : null);
export const encodeBoolean = (value: boolean): string => String(value);
