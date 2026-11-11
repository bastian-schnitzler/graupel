// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Error messages as closable cards in the bottom-left corner (REQ-492). Regions report a message under an id of their
 * own (`notify`) and take it back when its cause is gone (`dismiss`); the user closes a card with its X. The store keeps
 * message keys, not texts, so a card follows a change of the language.
 */
import { createContext, useContext, useEffect, useSyncExternalStore, type RefObject } from "react";
import type { MessageKey, MessageParams } from "../i18n/index.ts";

export interface Notice {
  /** Who reports it, e.g. `location.gps`; a new message under the same id replaces the old one. */
  id: string;
  message: MessageKey;
  /** Second, smaller line under the message, e.g. where to change a setting (REQ-509). */
  detail?: MessageKey;
  /** Placeholders of the message and its detail. */
  params?: MessageParams;
}

export interface NoticeStore {
  subscribe: (listener: () => void) => () => void;
  /** Shown cards, oldest first. */
  getNotices: () => readonly Notice[];
  /** Element the cards render into: the topmost open modal dialog, else `null` (the page). */
  getHost: () => HTMLElement | null;
  /**
   * Shows a message. The same id replaces its card in place; the same text under another id is not shown twice.
   */
  notify: (notice: Notice) => void;
  /** Removes the card of an id (closed by the user, or its cause resolved). Unknown ids are ignored. */
  dismiss: (id: string) => void;
  /** Registers an open modal dialog as host of the cards (the page behind it is inert); returns the removal. */
  addHost: (element: HTMLElement) => () => void;
}

const sameParams = (a?: MessageParams, b?: MessageParams) => {
  const left = Object.entries(a ?? {});
  const right = b ?? {};
  return left.length === Object.keys(right).length && left.every(([key, value]) => right[key] === value);
};

const sameText = (a: Notice, b: Notice) =>
  a.message === b.message && a.detail === b.detail && sameParams(a.params, b.params);

export function createNoticeStore(): NoticeStore {
  let notices: readonly Notice[] = [];
  let hosts: readonly HTMLElement[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getNotices: () => notices,
    getHost: () => hosts.at(-1) ?? null,
    notify(notice) {
      const index = notices.findIndex((shown) => shown.id === notice.id);
      if (index >= 0) {
        if (sameText(notices[index]!, notice)) return;
        notices = notices.map((shown, i) => (i === index ? notice : shown));
      } else {
        if (notices.some((shown) => sameText(shown, notice))) return;
        notices = [...notices, notice];
      }
      emit();
    },
    dismiss(id) {
      if (!notices.some((shown) => shown.id === id)) return;
      notices = notices.filter((shown) => shown.id !== id);
      emit();
    },
    addHost(element) {
      hosts = [...hosts, element];
      emit();
      return () => {
        if (!hosts.includes(element)) return;
        hosts = hosts.filter((host) => host !== element);
        emit();
      };
    },
  };
}

/** Store of the page; `NoticesProvider` puts its own in place (tests get a fresh one each render). */
export const NoticesContext = createContext<NoticeStore>(createNoticeStore());

/** `notify` and `dismiss` of the nearest notice store. */
export function useNotices(): Pick<NoticeStore, "notify" | "dismiss"> {
  return useContext(NoticesContext);
}

/** Shown cards; re-renders when they change. */
export function useNoticeList(store: NoticeStore): readonly Notice[] {
  return useSyncExternalStore(store.subscribe, store.getNotices, store.getNotices);
}

/** Current host of the cards; re-renders when a modal dialog opens or closes. */
export function useNoticeHost(store: NoticeStore): HTMLElement | null {
  return useSyncExternalStore(store.subscribe, store.getHost, () => null);
}

/**
 * Shows `message` under `id` while it is set, with `detail` as its second line if given, and removes the card when it
 * is cleared or the component unmounts. A card the user closed stays closed until the message or its detail changes
 * or comes back.
 */
export function useErrorNotice(id: string, message: MessageKey | null, detail?: MessageKey | null): void {
  const { notify, dismiss } = useNotices();
  useEffect(() => {
    if (!message) return;
    notify(detail ? { id, message, detail } : { id, message });
    return () => dismiss(id);
  }, [id, message, detail, notify, dismiss]);
}

/** Makes an open modal dialog the host of the cards while it is mounted. */
export function useNoticeHostElement(ref: RefObject<HTMLElement | null>): void {
  const store = useContext(NoticesContext);
  useEffect(() => {
    const element = ref.current;
    return element ? store.addHost(element) : undefined;
  }, [ref, store]);
}
