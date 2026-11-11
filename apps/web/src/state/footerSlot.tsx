// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Slot at the start of the page footer's row (REQ-541): on a phone the meteogram's copy and save buttons are rendered
 * into it (a portal), left of the footer links. The footer registers the element, the meteogram panel reads it.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface FooterSlot {
  element: HTMLElement | null;
  setElement: (element: HTMLElement | null) => void;
}

const FooterSlotContext = createContext<FooterSlot | null>(null);

export function FooterSlotProvider({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ element, setElement }), [element]);
  return <FooterSlotContext.Provider value={value}>{children}</FooterSlotContext.Provider>;
}

/** The slot's element, or null without a provider or before the footer is mounted. */
export function useFooterSlot(): HTMLElement | null {
  return useContext(FooterSlotContext)?.element ?? null;
}

/** Callback ref for the footer's slot element; does nothing without a provider. */
export function useFooterSlotRef(): (element: HTMLElement | null) => void {
  return useContext(FooterSlotContext)?.setElement ?? noop;
}

function noop() {}
