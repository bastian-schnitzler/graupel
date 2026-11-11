// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Slot in the row of the day slider's grips (REQ-562): on a phone in portrait the meteogram panel renders place and
 * elevation into it (a portal), centred between the grips. The day slider registers the element, the panel reads it.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface SliderCaptionSlot {
  element: HTMLElement | null;
  setElement: (element: HTMLElement | null) => void;
}

const SliderCaptionContext = createContext<SliderCaptionSlot | null>(null);

export function SliderCaptionProvider({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ element, setElement }), [element]);
  return <SliderCaptionContext.Provider value={value}>{children}</SliderCaptionContext.Provider>;
}

/** The slot's element, or null without a provider or before the day slider is mounted. */
export function useSliderCaptionSlot(): HTMLElement | null {
  return useContext(SliderCaptionContext)?.element ?? null;
}

/** Callback ref for the day slider's slot element; does nothing without a provider. */
export function useSliderCaptionRef(): (element: HTMLElement | null) => void {
  return useContext(SliderCaptionContext)?.setElement ?? noop;
}

function noop() {}
