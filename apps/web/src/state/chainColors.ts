// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colours of the model chains (REQ-443, colours from REQ-456 variant C3): the weather chain in blue, the cloud chain in
 * slate, already paler at the first model and fading further from left to right. Each shade is the chain's base colour
 * mixed with the card background: in light mode over the white card, in dark mode over the dark card with
 * 25 % + 75 % of the share (so the shades stay strong enough on the dark surface). With three models the shares are
 * 72 %, 46 % and 24 %; other chain lengths are spread over the same curve. The meteogram draws each model header in
 * the model's shade of the weather chain (`modelHeaderColors`), taken from the models it draws
 * (`drawnModelHeaderColors`, REQ-770), and never in the meteogram's own orange.
 */
import type { ChainModelResult, WeatherModel } from "@graupel/download";
import { useMemo } from "react";
import { useChainSelection } from "./chain.ts";
import { usePageTheme, type PageTheme } from "./pageTheme.ts";

/** `main`: the weather chain, `cloud`: the cloud chain. */
export type ChainKind = "main" | "cloud";

/** Shade of one model: the fill colour and the text colour on it. */
export interface ChainShade {
  /** Hex colour of the card's top bar, its range badge and (weather chain) the meteogram header. */
  color: string;
  /** Text colour on `color`: dark in light mode, white in dark mode (REQ-456). */
  text: string;
}

/**
 * Text colours on a shade; the meteogram gets them as `modelHeader.text` and `.contrastText`. Both keep every shade of
 * their mode at a contrast of at least 4.5:1 (WCAG AA).
 */
export const TEXT_DARK = "#000000";
export const TEXT_LIGHT = "#ffffff";

/** Base colour of each chain (REQ-456): blue for the weather chain, slate for the cloud chain. */
export const CHAIN_BASE_COLORS: Readonly<Record<ChainKind, string>> = {
  main: "#1f6fd1",
  cloud: "#556579",
};

/** A model boundary in the meteogram: thin solid line in the chain's colour, partly transparent. */
export interface BoundaryStyle {
  color: string;
  opacity: number;
}

/**
 * Model boundaries in the meteogram per colour mode and chain (REQ-523): the chain's base colour, in dark mode the
 * lighter shade of the same hue so the line stands out on the dark card.
 */
export const BOUNDARY_STYLES: Readonly<Record<PageTheme, Readonly<Record<ChainKind, BoundaryStyle>>>> = {
  light: { main: { color: "#1f6fd1", opacity: 0.6 }, cloud: { color: "#556579", opacity: 0.6 } },
  dark: { main: { color: "#5e97de", opacity: 0.7 }, cloud: { color: "#8794a6", opacity: 0.7 } },
};

/**
 * Background of the chain cards per colour mode: `--color-surface` in styles/tokens.css (a test keeps both in step).
 * The shades are mixed over it.
 */
export const CARD_BACKGROUNDS: Readonly<Record<PageTheme, string>> = {
  light: "#ffffff",
  dark: "#1a2129",
};

/** Share of the base colour at the first, middle and last model (REQ-456: 72 %, 46 %, 24 % for three models). */
export const CHAIN_SHARES = [0.72, 0.46, 0.24] as const;

/** Share of the base colour at position `t` (0 first model, 1 last), linear between the points of `CHAIN_SHARES`. */
export function chainShare(t: number): number {
  const [first, middle, last] = CHAIN_SHARES;
  const clamped = Math.max(0, Math.min(1, t));
  return clamped <= 0.5
    ? first + (middle - first) * (clamped / 0.5)
    : middle + (last - middle) * ((clamped - 0.5) / 0.5);
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function hex(channel: number): string {
  return Math.floor(Math.max(0, Math.min(255, channel)) + 0.5)
    .toString(16)
    .padStart(2, "0");
}

/** `#rrggbb` of `color` laid over `background` with opacity `share` (0–1). */
export function mixColors(color: string, background: string, share: number): string {
  const top = channels(color);
  const bottom = channels(background);
  return `#${top.map((value, i) => hex(value * share + bottom[i]! * (1 - share))).join("")}`;
}

/**
 * The shades of a chain of `count` models, in chain order. `background` is the card colour the shades are mixed over;
 * by default the page's card colour of the mode (`CARD_BACKGROUNDS`).
 */
export function chainShades(
  count: number,
  kind: ChainKind,
  theme: PageTheme,
  background: string = CARD_BACKGROUNDS[theme],
): ChainShade[] {
  const n = Math.max(0, Math.floor(count));
  const text = theme === "dark" ? TEXT_LIGHT : TEXT_DARK;
  return Array.from({ length: n }, (_, index) => {
    const share = chainShare(n > 1 ? index / (n - 1) : 0);
    const opacity = theme === "dark" ? 0.25 + 0.75 * share : share;
    return {
      color: mixColors(CHAIN_BASE_COLORS[kind], background, opacity),
      text,
    };
  });
}

/** Meteogram header colour per model (catalogue id, else name): the model's shade in the weather chain. */
export function modelHeaderColors(models: readonly WeatherModel[], theme: PageTheme): Record<string, string> {
  const shades = chainShades(models.length, "main", theme);
  const colors: Record<string, string> = {};
  models.forEach((model, index) => {
    const key = model.id || model.name;
    if (key && !(key in colors)) colors[key] = shades[index]!.color;
  });
  return colors;
}

/** A model of the chain the meteogram draws: what its header is looked up by, and the model it replaces (REQ-767). */
export type DrawnChainModel = Pick<ChainModelResult, "model" | "id" | "replaces">;

/**
 * Header colours of the models the meteogram draws (REQ-770): the drawn chain (the result's `chain`) decides, not the
 * selected one, which may differ (the previous place's chart while the new one loads, an archived fetch, REQ-684). When
 * the drawn models are models of the selected chain in its order, each keeps the shade of its card (REQ-443), also
 * with a model of the chain left out; a replacement (REQ-767) counts as the model it replaces. Any other chain is
 * shaded over its own models in its order. Each colour is given by catalogue id and by name, as the meteogram looks it
 * up.
 */
export function drawnModelHeaderColors(
  drawn: readonly DrawnChainModel[] | null | undefined,
  selected: readonly WeatherModel[],
  theme: PageTheme,
): Record<string, string> {
  if (!drawn || drawn.length === 0) return modelHeaderColors(selected, theme);
  const positions = drawn.map((entry) => {
    const { model, id } = entry.replaces ?? entry;
    return selected.findIndex((candidate) => (id !== undefined && candidate.id === id) || candidate.name === model);
  });
  const inSelected = positions.every(
    (position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!),
  );
  const shades = chainShades(inSelected ? selected.length : drawn.length, "main", theme);
  const colors: Record<string, string> = {};
  drawn.forEach((entry, index) => {
    const color = shades[inSelected ? positions[index]! : index]!.color;
    for (const key of [entry.id, entry.model]) if (key && !(key in colors)) colors[key] = color;
  });
  return colors;
}

/**
 * Header colour of a model the colours leave out (REQ-770): the first shade of the weather chain instead of the
 * meteogram's orange.
 */
export function defaultModelHeaderColor(theme: PageTheme): string {
  return chainShades(1, "main", theme)[0]!.color;
}

/** Shades of a chain of `count` models in the page's colour mode. */
export function useChainShades(count: number, kind: ChainKind): ChainShade[] {
  const theme = usePageTheme();
  return useMemo(() => chainShades(count, kind, theme), [count, kind, theme]);
}

/**
 * Meteogram header colours in the page's colour mode: of the chain the meteogram draws (`drawn`, the shown result's
 * `chain`), measured against the selected weather chain (`drawnModelHeaderColors`, REQ-770).
 */
export function useModelHeaderColors(drawn?: readonly DrawnChainModel[] | null): Record<string, string> {
  const theme = usePageTheme();
  const { models } = useChainSelection();
  return useMemo(() => drawnModelHeaderColors(drawn, models, theme), [drawn, models, theme]);
}
